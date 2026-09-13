import * as db from '@/services/db';
import {
  bulkDeleteTransactions,
  findDuplicateCandidates,
  findInternalTransferCandidates,
  getCategoryMonthlySeries,
  getMonthlyIncomeSeries,
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
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
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
  // Explicit, nu prin scurgere: `getAllAsync` e folosit acum și de regula
  // numerarului. Fără setarea asta, testele treceau doar fiindcă mock-ul
  // păstra o valoare lăsată de un test anterior — adică din ordinea de rulare.
  beforeEach(() => {
    (db.db.getAllAsync as jest.Mock).mockReset();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
  });

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

describe('bulkDeleteTransactions', () => {
  beforeEach(() => {
    (db.db.runAsync as jest.Mock).mockReset();
    (db.db.runAsync as jest.Mock).mockResolvedValue({ changes: 0 });
    (db.db.getAllAsync as jest.Mock).mockReset();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    (db.db.withTransactionAsync as jest.Mock).mockClear();
  });

  it('lista vidă → no-op, fără queries', async () => {
    const result = await bulkDeleteTransactions([]);
    expect(result).toEqual({ deletedCount: 0, statementsRemoved: 0 });
    expect((db.db.runAsync as jest.Mock).mock.calls).toHaveLength(0);
    expect((db.db.withTransactionAsync as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('rulează în db.withTransactionAsync (atomic)', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1']);
    expect((db.db.withTransactionAsync as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('DELETE rulează în interiorul callback-ului withTransactionAsync', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    let runCallsBeforeWrapper = 0;
    let runCallsInsideWrapper = 0;
    (db.db.withTransactionAsync as jest.Mock).mockImplementationOnce(
      async (fn: () => Promise<void>) => {
        runCallsBeforeWrapper = (db.db.runAsync as jest.Mock).mock.calls.length;
        await fn();
        runCallsInsideWrapper =
          (db.db.runAsync as jest.Mock).mock.calls.length - runCallsBeforeWrapper;
      }
    );
    await bulkDeleteTransactions(['t1']);
    expect(runCallsBeforeWrapper).toBe(0);
    expect(runCallsInsideWrapper).toBeGreaterThan(0);
  });

  it('emite UPDATE pentru a dezlega contraparte transfer intern', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls.map(c => c[0] as string);
    const found = calls.find(s =>
      /UPDATE transactions[\s\S]*is_internal_transfer = 0[\s\S]*linked_transaction_id IS NOT NULL/.test(
        s
      )
    );
    expect(found).toBeTruthy();
  });

  it('emite UPDATE pentru a dezmarca duplicate care pointează spre IDs ce se șterg', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls.map(c => c[0] as string);
    const found = calls.find(s => /UPDATE transactions SET duplicate_of_id = NULL/.test(s));
    expect(found).toBeTruthy();
  });

  it('emite DELETE FROM transactions cu IDs', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1', 't2']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    const deleteCall = calls.find(c => /DELETE FROM transactions WHERE id IN/.test(c[0] as string));
    expect(deleteCall).toBeTruthy();
    expect(deleteCall![1]).toEqual(['t1', 't2']);
  });

  it('auto-purge statement-uri orfane: șterge bank_statements ne-mai-referențiate', async () => {
    (db.db.getAllAsync as jest.Mock)
      .mockResolvedValueOnce([{ statement_id: 's1' }, { statement_id: 's2' }])
      .mockResolvedValueOnce([{ statement_id: 's2' }]);
    (db.db.runAsync as jest.Mock).mockImplementation(async (sql: string) => {
      if (/DELETE FROM bank_statements/.test(sql)) return { changes: 1 };
      if (/DELETE FROM transactions/.test(sql)) return { changes: 2 };
      return { changes: 0 };
    });
    const result = await bulkDeleteTransactions(['t1', 't2']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    const purge = calls.find(c => /DELETE FROM bank_statements WHERE id IN/.test(c[0] as string));
    expect(purge).toBeTruthy();
    expect(purge![1]).toEqual(['s1']);
    expect(result.statementsRemoved).toBe(1);
  });

  it('NU emite DELETE bank_statements dacă niciun statement nu rămâne orfan', async () => {
    (db.db.getAllAsync as jest.Mock)
      .mockResolvedValueOnce([{ statement_id: 's1' }])
      .mockResolvedValueOnce([{ statement_id: 's1' }]);
    await bulkDeleteTransactions(['t1']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls.map(c => c[0] as string);
    const purge = calls.find(s => /DELETE FROM bank_statements/.test(s));
    expect(purge).toBeFalsy();
  });

  it('chunking: 1500 IDs sparte în 3 batch-uri pentru DELETE', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    const ids = Array.from({ length: 1500 }, (_, i) => `id-${i}`);
    await bulkDeleteTransactions(ids);
    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    const deleteCalls = calls.filter(c =>
      /DELETE FROM transactions WHERE id IN/.test(c[0] as string)
    );
    expect(deleteCalls).toHaveLength(3);
    expect((deleteCalls[0][1] as string[]).length).toBe(500);
    expect((deleteCalls[1][1] as string[]).length).toBe(500);
    expect((deleteCalls[2][1] as string[]).length).toBe(500);
  });

  it('returnează deletedCount = suma db.changes pe DELETE-uri', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    (db.db.runAsync as jest.Mock).mockImplementation(async (sql: string) => {
      if (/DELETE FROM transactions/.test(sql)) return { changes: 3 };
      return { changes: 0 };
    });
    const result = await bulkDeleteTransactions(['t1', 't2', 't3']);
    expect(result.deletedCount).toBe(3);
  });
});

describe('getMonthlyIncomeSeries', () => {
  it('exclude transferurile interne și duplicatele (anti-dublare venit)', async () => {
    (db.db.getAllAsync as jest.Mock).mockClear();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await getMonthlyIncomeSeries(6);
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/is_internal_transfer = 0/);
    expect(sql).toMatch(/duplicate_of_id IS NULL/);
    expect(sql).toMatch(/amount > 0/);
  });

  it('întoarce un punct pe lună, 0 pentru lunile fără venit', async () => {
    // Calculăm a doua lună din interval ca să nu depindem de data curentă.
    const now = new Date();
    const ym = (back: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([{ ym: ym(1), total: 26400 }]);

    const series = await getMonthlyIncomeSeries(3);

    expect(series).toHaveLength(3);
    expect(series.find(p => p.yearMonth === ym(1))?.total_ron).toBe(26400);
    expect(series.find(p => p.yearMonth === ym(2))?.total_ron).toBe(0);
  });

  it('monthsBack <= 0 → listă goală fără query', async () => {
    (db.db.getAllAsync as jest.Mock).mockClear();
    const series = await getMonthlyIncomeSeries(0);
    expect(series).toEqual([]);
    expect(db.db.getAllAsync as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('potrivire transferuri: comision și valută', () => {
  it('leagă 1000 ieșit de 995 intrat + 5 comision, marcat ca sugestie', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-05-01', amount: -1000, account_id: 'a1' }),
      row({ id: 'in', date: '2026-05-01', amount: 995, account_id: 'a2' }),
      row({
        id: 'fee',
        date: '2026-05-01',
        amount: -5,
        account_id: 'a1',
        description: 'Comision transfer',
      }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findInternalTransferCandidates();
    expect(result).toHaveLength(1);
    expect(result[0].outflow.id).toBe('out');
    expect(result[0].inflow.id).toBe('in');
    expect(result[0].kind).toBe('fee');
    expect(result[0].fees?.map(f => f.id)).toEqual(['fee']);
  });

  it('nu leagă când diferența nu e explicată de un comision', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-05-01', amount: -1000, account_id: 'a1' }),
      row({ id: 'in', date: '2026-05-01', amount: 900, account_id: 'a2' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    expect(await findInternalTransferCandidates()).toHaveLength(0);
  });

  it('potrivește RON→EUR prin valorile convertite, ca sugestie', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-05-01', amount: -4970, account_id: 'a1', amount_ron: -4970 }),
      row({
        id: 'in',
        date: '2026-05-01',
        amount: 1000,
        currency: 'EUR',
        account_id: 'a2',
        amount_ron: 4970,
      }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findInternalTransferCandidates();
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('fx');
  });

  it('nu potrivește valutar când lipsește cursul (amount_ron NULL)', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-05-01', amount: -4970, account_id: 'a1' }),
      row({ id: 'in', date: '2026-05-01', amount: 1000, currency: 'EUR', account_id: 'a2' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    expect(await findInternalTransferCandidates()).toHaveLength(0);
  });

  it('potrivirea exactă rămâne marcată exact, deci se leagă automat', async () => {
    const rows: Row[] = [
      row({ id: 'out', date: '2026-05-01', amount: -500, account_id: 'a1' }),
      row({ id: 'in', date: '2026-05-01', amount: 500, account_id: 'a2' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const result = await findInternalTransferCandidates();
    expect(result[0].kind).toBe('exact');
  });

  it('plata la comerciant nu devine niciodată candidat', async () => {
    const rows: Row[] = [
      row({ id: 'lidl', date: '2026-05-01', amount: -187.4, account_id: 'a1', merchant: 'Lidl' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    expect(await findInternalTransferCandidates()).toHaveLength(0);
  });

  it('comisionul nu e tratat el însuși ca latură de transfer', async () => {
    const rows: Row[] = [
      row({
        id: 'fee',
        date: '2026-05-01',
        amount: -5,
        account_id: 'a1',
        description: 'Comision administrare',
      }),
      row({ id: 'in', date: '2026-05-01', amount: 5, account_id: 'a2' }),
    ];
    (db.db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    expect(await findInternalTransferCandidates()).toHaveLength(0);
  });
});

describe('getCategoryMonthlySeries', () => {
  beforeEach(() => {
    (db.db.getAllAsync as jest.Mock).mockReset();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
  });

  it('grupează pe lună și categorie, într-o singură interogare', async () => {
    await getCategoryMonthlySeries('2025-09', '2026-08');
    expect((db.db.getAllAsync as jest.Mock).mock.calls).toHaveLength(1);
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/GROUP BY ym, t\.category_id/);
    expect(sql).toMatch(/COUNT\(\*\) AS cnt/);
  });

  it('limitează intervalul la lunile cerute', async () => {
    await getCategoryMonthlySeries('2025-09', '2026-08');
    const params = (db.db.getAllAsync as jest.Mock).mock.calls[0][1] as string[];
    expect(params[0]).toBe('2025-09');
    expect(params[1]).toBe('2026-08');
  });

  it('exclude duplicatele, transferurile interne și veniturile', async () => {
    await getCategoryMonthlySeries('2025-09', '2026-08');
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/duplicate_of_id IS NULL/);
    expect(sql).toMatch(/is_internal_transfer = 0/);
    expect(sql).toMatch(/amount < 0/);
  });

  it('întoarce sume pozitive și nume implicit pentru necategorizat', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([
      { ym: '2026-08', category_id: null, category_name: null, total: -450.5, cnt: 3 },
    ]);
    const series = await getCategoryMonthlySeries('2025-09', '2026-08');
    expect(series).toEqual([
      {
        yearMonth: '2026-08',
        category_id: null,
        category_name: 'Necategorizat',
        total_ron: 450.5,
        transaction_count: 3,
      },
    ]);
  });
});

describe('getMonthlyTotals — valută și restituiri', () => {
  beforeEach(() => {
    (db.db.getAllAsync as jest.Mock).mockReset();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
  });

  it('nu adună suma brută în valută când lipsește cursul, și o raportează', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({
      income: 0,
      expense: -100,
      cnt: 2,
      missing_rate: 1,
    });
    const totals = await getMonthlyTotals('2026-05');
    expect(totals.expense_ron).toBe(100);
    expect(totals.missing_rate_count).toBe(1);
  });

  it('nu raportează missing_rate_count când totul are curs', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({
      income: 500,
      expense: -100,
      cnt: 3,
      missing_rate: 0,
    });
    const totals = await getMonthlyTotals('2026-05');
    expect(totals.missing_rate_count).toBeUndefined();
  });

  it('SQL-ul folosește CASE pe currency, nu COALESCE', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({
      income: 0,
      expense: 0,
      cnt: 0,
      missing_rate: 0,
    });
    await getMonthlyTotals('2026-05');
    const sql = (db.db.getFirstAsync as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(sql).toContain("CASE WHEN currency = 'RON'");
    expect(sql).not.toContain('COALESCE(amount_ron, amount)');
  });

  it('restituirile ies din venituri și intră ca reducere de cheltuială', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({
      income: 0,
      expense: 0,
      cnt: 0,
      missing_rate: 0,
    });
    await getMonthlyTotals('2026-05');
    const sql = (db.db.getFirstAsync as jest.Mock).mock.calls.at(-1)?.[0] as string;
    // Verificăm regulile, nu forma exactă a expresiei: varianta anterioară fixa
    // paranteza întreagă și s-a rupt la prima schimbare legitimă a ei.
    expect(sql).toContain('is_refund = 0'); // venitul exclude restituirile
    expect(sql).toContain('is_refund = 1'); // cheltuiala le include
  });

  it('ajustările de sold nu intră nici la venituri, nici la cheltuieli', async () => {
    // „Aliniază la extras" creează o tranzacție care corectează soldul. E o
    // recunoaștere că lipsea ceva, nu o plată: dacă ar intra în agregări, ar
    // apărea ca o cheltuială sau un venit pe care userul nu l-a făcut.
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({
      income: 0,
      expense: 0,
      cnt: 0,
      missing_rate: 0,
    });
    await getMonthlyTotals('2026-05');
    const sql = (db.db.getFirstAsync as jest.Mock).mock.calls.at(-1)?.[0] as string;
    const occurrences = sql.split("source != 'adjustment'").length - 1;
    expect(occurrences).toBe(2); // o dată la venituri, o dată la cheltuieli
  });
});
