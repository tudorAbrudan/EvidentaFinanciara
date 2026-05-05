import * as db from '@/services/db';
import {
  findDuplicateCandidates,
  findInternalTransferCandidates,
  getMonthlyTotals,
  getTransaction,
  getTransactions,
} from '@/services/transactions';

// Mock the db module so we can return arbitrary rows.
jest.mock('@/services/db', () => ({
  __esModule: true,
  db: {
    runAsync: jest.fn(),
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
  },
  generateId: () => 'test-id',
}));

type Row = {
  id: string;
  account_id: string | null;
  date: string;
  amount: number;
  currency: string;
  amount_ron: number | null;
  description: string | null;
  merchant: string | null;
  category_id: string | null;
  source: string;
  statement_id: string | null;
  is_internal_transfer: number;
  linked_transaction_id: string | null;
  is_refund: number;
  duplicate_of_id: string | null;
  cash_suggestion_dismissed: number;
  notes: string | null;
  created_at: string;
};

function row(overrides: Partial<Row> & Pick<Row, 'id' | 'date' | 'amount'>): Row {
  return {
    account_id: 'acc-1',
    currency: 'RON',
    amount_ron: null,
    description: null,
    merchant: null,
    category_id: null,
    source: 'manual',
    statement_id: null,
    is_internal_transfer: 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: null,
    cash_suggestion_dismissed: 0,
    notes: null,
    created_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findDuplicateCandidates', () => {
  it('detects two transactions with same amount/merchant within 1 day', async () => {
    const rows: Row[] = [
      row({ id: 't1', date: '2026-04-01', amount: -100, merchant: 'Kaufland' }),
      row({ id: 't2', date: '2026-04-01', amount: -100, merchant: 'Kaufland' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findDuplicateCandidates();
    expect(result).toHaveLength(1);
    expect(result[0].primary.id).toBe('t1');
    expect(result[0].candidates).toHaveLength(1);
    expect(result[0].candidates[0].id).toBe('t2');
  });

  it('does NOT match when amounts differ', async () => {
    const rows: Row[] = [
      row({ id: 't1', date: '2026-04-01', amount: -100, merchant: 'Kaufland' }),
      row({ id: 't2', date: '2026-04-01', amount: -150, merchant: 'Kaufland' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findDuplicateCandidates();
    expect(result).toHaveLength(0);
  });

  it('does NOT match when more than 1 day apart', async () => {
    const rows: Row[] = [
      row({ id: 't1', date: '2026-04-01', amount: -100, merchant: 'Kaufland' }),
      row({ id: 't2', date: '2026-04-05', amount: -100, merchant: 'Kaufland' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findDuplicateCandidates();
    expect(result).toHaveLength(0);
  });

  it('matches by description if merchant is missing', async () => {
    const rows: Row[] = [
      row({ id: 't1', date: '2026-04-01', amount: -50, description: 'Plata abonament' }),
      row({ id: 't2', date: '2026-04-01', amount: -50, description: 'Plata abonament' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findDuplicateCandidates();
    expect(result).toHaveLength(1);
  });

  it('does NOT match when both merchant and description are empty', async () => {
    const rows: Row[] = [
      row({ id: 't1', date: '2026-04-01', amount: -50 }),
      row({ id: 't2', date: '2026-04-01', amount: -50 }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findDuplicateCandidates();
    expect(result).toHaveLength(0);
  });
});

describe('findInternalTransferCandidates', () => {
  it('matches outflow + inflow with opposite amounts in different accounts', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-04-01', amount: -500, account_id: 'a1' }),
      row({ id: 'in', date: '2026-04-02', amount: 500, account_id: 'a2' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findInternalTransferCandidates();
    expect(result).toHaveLength(1);
    expect(result[0].outflow.id).toBe('out');
    expect(result[0].inflow.id).toBe('in');
  });

  it('does NOT match transactions in the same account', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-04-01', amount: -500, account_id: 'a1' }),
      row({ id: 'in', date: '2026-04-02', amount: 500, account_id: 'a1' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findInternalTransferCandidates();
    expect(result).toHaveLength(0);
  });

  it('does NOT match if more than 2 days apart', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-04-01', amount: -500, account_id: 'a1' }),
      row({ id: 'in', date: '2026-04-05', amount: 500, account_id: 'a2' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findInternalTransferCandidates();
    expect(result).toHaveLength(0);
  });

  it('chooses closest matching inflow when multiple candidates exist', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-04-03', amount: -500, account_id: 'a1' }),
      row({ id: 'in1', date: '2026-04-01', amount: 500, account_id: 'a2' }),
      row({ id: 'in2', date: '2026-04-04', amount: 500, account_id: 'a2' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findInternalTransferCandidates();
    expect(result).toHaveLength(1);
    expect(result[0].inflow.id).toBe('in2');
  });
});

describe('getMonthlyTotals', () => {
  it('returns income, expense, and net from sql aggregate', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({
      income: 5000,
      expense: -3500,
      cnt: 12,
    });
    const totals = await getMonthlyTotals('2026-04');
    expect(totals.income_ron).toBe(5000);
    expect(totals.expense_ron).toBe(3500);
    expect(totals.net_ron).toBe(1500);
    expect(totals.transaction_count).toBe(12);
  });

  it('returns zeros when no rows exist', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({ income: 0, expense: 0, cnt: 0 });
    const totals = await getMonthlyTotals('2026-04');
    expect(totals.income_ron).toBe(0);
    expect(totals.expense_ron).toBe(0);
    expect(totals.net_ron).toBe(0);
  });
});

describe('cash_suggestion_dismissed mapRow', () => {
  it('mapRow: cash_suggestion_dismissed=0 → false', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue(
      row({ id: 't1', date: '2026-04-01', amount: -100, cash_suggestion_dismissed: 0 })
    );
    const tx = await getTransaction('t1');
    expect(tx?.cash_suggestion_dismissed).toBe(false);
  });

  it('mapRow: cash_suggestion_dismissed=1 → true', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue(
      row({ id: 't1', date: '2026-04-01', amount: -100, cash_suggestion_dismissed: 1 })
    );
    const tx = await getTransaction('t1');
    expect(tx?.cash_suggestion_dismissed).toBe(true);
  });
});

describe('getTransactions filter flags', () => {
  beforeEach(() => {
    (db.db.getAllAsync as jest.Mock).mockReset();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
  });

  it('uncategorized=true adds "category_id IS NULL" to WHERE', async () => {
    await getTransactions({ uncategorized: true });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/category_id IS NULL/);
  });

  it('onlyExpenses=true adds "amount < 0" to WHERE', async () => {
    await getTransactions({ onlyExpenses: true });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/amount < 0/);
  });

  it('uncategorized + onlyExpenses both applied', async () => {
    await getTransactions({ uncategorized: true, onlyExpenses: true });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/category_id IS NULL/);
    expect(sql).toMatch(/amount < 0/);
  });

  it('default call (no flags) does NOT include the new clauses', async () => {
    await getTransactions({});
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).not.toMatch(/category_id IS NULL/);
    expect(sql).not.toMatch(/amount < 0/);
  });

  it('absAmountRange {min, max} adds OR clause cu interval semnat și absolut', async () => {
    await getTransactions({ absAmountRange: { min: 100, max: 500 } });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    const params = (db.db.getAllAsync as jest.Mock).mock.calls[0][1] as number[];
    expect(sql).toMatch(/\(amount BETWEEN \? AND \?\) OR \(amount BETWEEN \? AND \?\)/);
    expect(params).toEqual([-500, -100, 100, 500]);
  });

  it('absAmountRange cu doar min adds "amount <= -min OR amount >= min"', async () => {
    await getTransactions({ absAmountRange: { min: 200 } });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    const params = (db.db.getAllAsync as jest.Mock).mock.calls[0][1] as number[];
    expect(sql).toMatch(/amount <= \? OR amount >= \?/);
    expect(params).toEqual([-200, 200]);
  });

  it('absAmountRange cu doar max adds "amount BETWEEN -max AND max"', async () => {
    await getTransactions({ absAmountRange: { max: 100 } });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    const params = (db.db.getAllAsync as jest.Mock).mock.calls[0][1] as number[];
    expect(sql).toMatch(/amount BETWEEN \? AND \?/);
    expect(params).toEqual([-100, 100]);
  });

  it('absAmountRange absent → no clause', async () => {
    await getTransactions({});
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).not.toMatch(/BETWEEN/);
  });
});
