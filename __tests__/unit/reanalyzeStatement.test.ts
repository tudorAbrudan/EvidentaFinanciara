/**
 * Test pentru reanalyzeStatement.
 *
 * Verifică:
 * 1. Flip semn pentru „Incasare" stocată ca negativ (+ amount_ron pe RON).
 * 2. Categorie din keyword (LIDL → food).
 * 3. Regula merchant învățată are prioritate (category_learned=1).
 * 4. useAi=false → fără apel AI, neîncadratele rămân neatinse.
 * 5. useAi=true → AI completează golurile.
 * 6. Query-ul exclude transferurile interne.
 */

import { reanalyzeStatement } from '@/services/transactions';

const mockGetAll = jest.fn();
const mockRun = jest.fn();

jest.mock('@/services/db', () => ({
  __esModule: true,
  db: {
    getAllAsync: (...a: unknown[]) => mockGetAll(...a),
    runAsync: (...a: unknown[]) => mockRun(...a),
    getFirstAsync: jest.fn(),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      await fn();
    },
  },
  generateId: () => 'test-id',
}));

const mockGetRule = jest.fn();
jest.mock('@/services/merchantCategoryRules', () => ({
  getRuleForMerchant: (...a: unknown[]) => mockGetRule(...a),
  upsertRule: jest.fn(),
}));

jest.mock('@/services/categories', () => ({
  getCategoryByKey: (key: string) => Promise.resolve({ id: `cat-${key}` }),
}));

const mockAi = jest.fn();
jest.mock('@/services/aiCategoryMapper', () => ({
  categorizeTransactionsWithAi: (...a: unknown[]) => mockAi(...a),
}));

interface RowInput {
  id: string;
  amount: number;
  currency?: string;
  amount_ron?: number | null;
  description?: string | null;
  merchant?: string | null;
}

function fullRow(r: RowInput) {
  return {
    account_id: 'acc-1',
    date: '2026-05-15',
    currency: 'RON',
    amount_ron: null,
    description: null,
    merchant: null,
    category_id: null,
    source: 'import',
    statement_id: 'stmt-1',
    is_internal_transfer: 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: null,
    cash_suggestion_dismissed: 0,
    category_learned: 0,
    notes: null,
    created_at: '2026-05-15',
    ...r,
  };
}

/** Reconstituie un map col→val din ultimul UPDATE pentru un id dat. */
function updateFor(id: string): Record<string, string | number | null> | null {
  for (const call of mockRun.mock.calls) {
    const [sql, params] = call as [string, (string | number | null)[]];
    if (params[params.length - 1] !== id) continue;
    const cols = [...sql.matchAll(/(\w+) = \?/g)].map(m => m[1]);
    const map: Record<string, string | number | null> = {};
    cols.forEach((c, i) => (map[c] = params[i]));
    return map;
  }
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRule.mockResolvedValue(null);
  mockAi.mockResolvedValue(new Map());
});

describe('reanalyzeStatement', () => {
  it('flipează semnul unei „Incasare" stocate ca cheltuială (+ amount_ron RON)', async () => {
    mockGetAll.mockResolvedValue([
      fullRow({ id: 't1', amount: -26400, description: 'Incasare OP - canal electronic' }),
    ]);

    const res = await reanalyzeStatement('stmt-1', { useAi: false });

    expect(res.signFlipped).toBe(1);
    const upd = updateFor('t1');
    expect(upd?.amount).toBe(26400);
    expect(upd?.amount_ron).toBe(26400);
  });

  it('atribuie categoria din keyword (LIDL → food)', async () => {
    mockGetAll.mockResolvedValue([
      fullRow({ id: 't2', amount: -32.49, description: 'Plata la POS', merchant: 'LIDL RO-547' }),
    ]);

    await reanalyzeStatement('stmt-1', { useAi: false });

    const upd = updateFor('t2');
    expect(upd?.category_id).toBe('cat-food');
    expect(upd?.category_learned).toBe(0);
  });

  it('regula merchant învățată are prioritate față de keyword', async () => {
    mockGetRule.mockResolvedValue({ category_id: 'cat-custom' });
    mockGetAll.mockResolvedValue([
      fullRow({ id: 't3', amount: -32.49, description: 'Plata la POS', merchant: 'LIDL RO-547' }),
    ]);

    await reanalyzeStatement('stmt-1', { useAi: false });

    const upd = updateFor('t3');
    expect(upd?.category_id).toBe('cat-custom');
    expect(upd?.category_learned).toBe(1);
  });

  it('useAi=false: nu cheamă AI; tranzacția neîncadrată rămâne neatinsă', async () => {
    mockGetAll.mockResolvedValue([
      fullRow({ id: 't4', amount: -50, description: 'Plata la POS', merchant: 'BONAS CRISENI' }),
    ]);

    const res = await reanalyzeStatement('stmt-1', { useAi: false });

    expect(mockAi).not.toHaveBeenCalled();
    expect(updateFor('t4')).toBeNull(); // niciun UPDATE (nimic de schimbat)
    expect(res.updated).toBe(0);
  });

  it('useAi=true: AI completează golul (BONAS → food)', async () => {
    mockGetAll.mockResolvedValue([
      fullRow({ id: 't5', amount: -50, description: 'Plata la POS', merchant: 'BONAS CRISENI' }),
    ]);
    mockAi.mockResolvedValue(new Map([['t5', 'food']]));

    const res = await reanalyzeStatement('stmt-1', { useAi: true });

    expect(mockAi).toHaveBeenCalledTimes(1);
    expect(res.aiUsed).toBe(1);
    expect(updateFor('t5')?.category_id).toBe('cat-food');
  });

  it('query-ul exclude transferurile interne', async () => {
    mockGetAll.mockResolvedValue([]);
    await reanalyzeStatement('stmt-1', { useAi: false });
    const sql = mockGetAll.mock.calls[0][0] as string;
    expect(sql).toMatch(/is_internal_transfer = 0/);
  });
});
