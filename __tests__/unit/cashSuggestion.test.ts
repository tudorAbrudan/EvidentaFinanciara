import {
  detectCashWithdrawal,
  countPendingCashSuggestions,
  dismissCashSuggestion,
  listPendingCashSuggestions,
  convertToTransfer,
} from '@/services/cashSuggestion';
import { db } from '@/services/db';
import type { Transaction } from '@/types';

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    date: '2026-05-01',
    amount: -500,
    currency: 'RON',
    source: 'manual',
    is_internal_transfer: false,
    is_refund: false,
    cash_suggestion_dismissed: false,
    createdAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('detectCashWithdrawal', () => {
  it.each([
    ['RETRAGERE NUMERAR ATM BCR BUCURESTI', null],
    ['retragere atm', null],
    ['bancomat OTP', null],
    ['atm transilvania', null],
    [null, 'ATM Revolut'],
    ['cash withdrawal', null],
    ['extragere numerar', null],
    ['Extrăgere Numerar', null], // diacritice normalizate
  ])('detectează match pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectCashWithdrawal(tx)).toBe(true);
  });

  it.each([
    ['atmosferă restaurant', null],
    ['caratm SRL', null],
    ['cumpărare card MEGA IMAGE', null],
    [null, null], // gol
    ['', ''],
  ])('NU match pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });

  it('returnează false pentru tranzacții pozitive', () => {
    const tx = makeTx({ amount: 500, description: 'RETRAGERE ATM' });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });

  it('returnează false pentru transferuri interne (deja convertite)', () => {
    const tx = makeTx({ is_internal_transfer: true, description: 'ATM BCR' });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });
});

function rowFor(
  over: Partial<{
    id: string;
    account_id: string;
    date: string;
    amount: number;
    currency: string;
    description: string;
    merchant: string;
    source: string;
    is_internal_transfer: number;
    cash_suggestion_dismissed: number;
    duplicate_of_id: string | null;
  }>
) {
  return {
    id: over.id ?? 'tx-1',
    account_id: over.account_id ?? 'acc-bank',
    date: over.date ?? '2026-05-01',
    amount: over.amount ?? -500,
    currency: over.currency ?? 'RON',
    amount_ron: null,
    description: over.description ?? 'RETRAGERE ATM BCR',
    merchant: over.merchant ?? null,
    category_id: null,
    source: over.source ?? 'manual',
    statement_id: null,
    is_internal_transfer: over.is_internal_transfer ?? 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: over.duplicate_of_id ?? null,
    cash_suggestion_dismissed: over.cash_suggestion_dismissed ?? 0,
    notes: null,
    created_at: '2026-05-01T10:00:00.000Z',
  };
}

describe('listPendingCashSuggestions / countPendingCashSuggestions', () => {
  beforeEach(() => {
    (db.getAllAsync as jest.Mock).mockReset();
  });

  it('SQL conține clauzele așteptate (amount<0, exclude transfer/dismissed/duplicate, sortat date DESC)', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await listPendingCashSuggestions();
    const calls = (db.getAllAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toMatch(/amount\s*<\s*0/);
    expect(sql).toMatch(/is_internal_transfer\s*=\s*0/);
    expect(sql).toMatch(/cash_suggestion_dismissed\s*=\s*0/);
    expect(sql).toMatch(/duplicate_of_id IS NULL/);
    expect(sql).toMatch(/ORDER BY date DESC/);
    expect(params).toEqual(['-365 days']);
  });

  it('filtrează rândurile care nu sunt retrageri (defense in depth peste regex)', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      rowFor({ id: 'a', description: 'ATM BCR' }),
      rowFor({ id: 'b', description: 'cumpărare card MEGA' }),
      rowFor({ id: 'c', description: 'bancomat OTP' }),
    ]);
    const pending = await listPendingCashSuggestions();
    expect(pending.map(p => p.id)).toEqual(['a', 'c']);
  });

  it('respectă limitul default (10) după filtrare', async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      rowFor({
        id: `tx-${i}`,
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const pending = await listPendingCashSuggestions();
    expect(pending).toHaveLength(10);
  });

  it('respectă limitul custom', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => rowFor({ id: `tx-${i}` }));
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const pending = await listPendingCashSuggestions({ limit: 3 });
    expect(pending).toHaveLength(3);
  });

  it('trece sinceDays custom în SQL ca `-N days`', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await listPendingCashSuggestions({ sinceDays: 30 });
    const params = (db.getAllAsync as jest.Mock).mock.calls[0][1];
    expect(params).toEqual(['-30 days']);
  });

  it('mapează corect rândul SQLite în Transaction', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      rowFor({
        id: 'tx-x',
        account_id: 'acc-1',
        amount: -200,
        currency: 'EUR',
        description: 'ATM Revolut',
      }),
    ]);
    const [tx] = await listPendingCashSuggestions();
    expect(tx.id).toBe('tx-x');
    expect(tx.account_id).toBe('acc-1');
    expect(tx.amount).toBe(-200);
    expect(tx.currency).toBe('EUR');
    expect(tx.is_internal_transfer).toBe(false);
    expect(tx.cash_suggestion_dismissed).toBe(false);
  });

  it('countPendingCashSuggestions întoarce numărul filtrat (nu plafonat la limit)', async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      rowFor({ id: `tx-${i}`, description: `RETRAGERE ATM ${i}` })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    expect(await countPendingCashSuggestions()).toBe(15);
  });

  it('count exclude rândurile non-retragere', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      rowFor({ id: 'a', description: 'ATM BCR' }),
      rowFor({ id: 'b', description: 'cumpărare card MEGA' }),
    ]);
    expect(await countPendingCashSuggestions()).toBe(1);
  });
});

describe('dismissCashSuggestion', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
  });

  it('apelează UPDATE cu cash_suggestion_dismissed = 1 și id corect', async () => {
    await dismissCashSuggestion('tx-123');
    expect(db.runAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = (db.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/UPDATE transactions/);
    expect(sql).toMatch(/SET cash_suggestion_dismissed\s*=\s*1/);
    expect(sql).toMatch(/WHERE id\s*=\s*\?/);
    expect(params).toEqual(['tx-123']);
  });

  it('e idempotent (a doua chemare emite același UPDATE fără eroare)', async () => {
    await dismissCashSuggestion('tx-123');
    await dismissCashSuggestion('tx-123');
    expect(db.runAsync).toHaveBeenCalledTimes(2);
  });
});

describe('convertToTransfer', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  });

  it('happy path: actualizează sursa și inserează jumătate-cash legate reciproc', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-src',
          account_id: 'acc-bank',
          amount: -500,
          currency: 'RON',
          description: 'RETRAGERE ATM BCR',
          source: 'statement',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-cash', type: 'cash', currency: 'RON' });

    await convertToTransfer('tx-src', 'acc-cash');

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);

    const calls = (db.runAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);

    const [updateSql, updateParams] = calls[0];
    expect(updateSql).toMatch(/UPDATE transactions/);
    expect(updateSql).toMatch(/is_internal_transfer\s*=\s*1/);
    expect(updateSql).toMatch(/linked_transaction_id\s*=\s*\?/);
    expect(updateSql).toMatch(/category_id\s*=\s*\?/);
    expect(updateSql).toMatch(/cash_suggestion_dismissed\s*=\s*1/);
    expect(updateParams[1]).toBe('cat-sys-transfer');
    expect(updateParams[2]).toBe('tx-src');
    const pairId = updateParams[0];
    expect(typeof pairId).toBe('string');
    expect(pairId.length).toBeGreaterThan(0);

    const [insertSql, insertParams] = calls[1];
    expect(insertSql).toMatch(/INSERT INTO transactions/);
    expect(insertParams[0]).toBe(pairId); // pereche linked
    expect(insertParams[1]).toBe('acc-cash'); // account_id
    expect(insertParams[2]).toBe('2026-05-01'); // date
    expect(insertParams[3]).toBe(500); // amount inversat (+500)
    expect(insertParams[4]).toBe('RON'); // currency
    expect(insertParams[5]).toBe(500); // amount_ron pentru RON e amount
    expect(insertParams[8]).toBe('cat-sys-transfer'); // category_id
    expect(insertParams[10]).toBe('tx-src'); // linked_transaction_id
  });

  it('throw dacă sursa nu există', async () => {
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(null);
    await expect(convertToTransfer('tx-missing', 'acc-cash')).rejects.toThrow(/sursă/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă sursa e venit (amount > 0)', async () => {
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(
      rowFor({ id: 'tx-src', amount: 500, description: 'incasare' })
    );
    await expect(convertToTransfer('tx-src', 'acc-cash')).rejects.toThrow(/negative|debituri/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă sursa e deja transfer intern', async () => {
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(
      rowFor({ id: 'tx-src', is_internal_transfer: 1 })
    );
    await expect(convertToTransfer('tx-src', 'acc-cash')).rejects.toThrow(/deja transfer/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target nu există', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src' }))
      .mockResolvedValueOnce(null);
    await expect(convertToTransfer('tx-src', 'acc-missing')).rejects.toThrow(/destinație/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target nu e cont cash', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src' }))
      .mockResolvedValueOnce({ id: 'acc-other-bank', type: 'bank', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-other-bank')).rejects.toThrow(/cont cash/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă valutele nu se potrivesc', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src', currency: 'EUR', amount: -100 }))
      .mockResolvedValueOnce({ id: 'acc-cash-ron', type: 'cash', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-cash-ron')).rejects.toThrow(/valut[ăa]/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });
});
