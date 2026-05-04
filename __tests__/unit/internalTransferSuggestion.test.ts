import { db } from '@/services/db';
import {
  detectTransferType,
  countPendingTransferSuggestions,
  dismissTransferSuggestion,
  listPendingTransferSuggestions,
  convertToTransfer,
} from '@/services/internalTransferSuggestion';
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

describe('detectTransferType — cash', () => {
  it.each([
    ['RETRAGERE NUMERAR ATM BCR BUCURESTI', null],
    ['retragere atm', null],
    ['bancomat OTP', null],
    ['atm transilvania', null],
    [null, 'ATM Revolut'],
    ['cash withdrawal', null],
    ['extragere numerar', null],
    ['Extrăgere Numerar', null],
  ])('detectează cash pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectTransferType(tx)).toBe('cash');
  });

  it('cash priority peste savings când ambele match', () => {
    const tx = makeTx({ description: 'retragere economii ATM' });
    expect(detectTransferType(tx)).toBe('cash');
  });
});

describe('detectTransferType — savings_out', () => {
  it.each([
    'transfer la economii',
    'transfer spre economii',
    'transfer catre depozit',
    'alimentare cont economii',
    'alimentare economii',
    'constituire depozit BCR 6M',
    'economisire automata',
    'Alimentare Economii',
    'Constituire Depozit',
  ])('detectează savings_out pe %p', description => {
    const tx = makeTx({ description, amount: -1000 });
    expect(detectTransferType(tx)).toBe('savings_out');
  });
});

describe('detectTransferType — savings_in', () => {
  it.each([
    'transfer din economii',
    'transfer de la economii',
    'transfer din depozit',
    'retragere economii',
    'retragere din economii',
    'lichidare depozit',
    'Lichidare Depozit BCR',
  ])('detectează savings_in pe %p', description => {
    const tx = makeTx({ description, amount: 1000 });
    expect(detectTransferType(tx)).toBe('savings_in');
  });

  it('savings_in nu match dacă amount e negativ', () => {
    const tx = makeTx({ description: 'transfer din economii', amount: -100 });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('cash savings_out nu match pentru amount > 0', () => {
    const tx = makeTx({ description: 'retragere atm', amount: 100 });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('dobanda lunara cont NU match savings_in', () => {
    const tx = makeTx({ description: 'dobanda lunara cont', amount: 50 });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('capitalizare dobanda NU match savings_in', () => {
    const tx = makeTx({ description: 'capitalizare dobanda', amount: 30 });
    expect(detectTransferType(tx)).toBeNull();
  });
});

describe('detectTransferType — null cases', () => {
  it.each([
    ['atmosferă restaurant', null],
    ['caratm SRL', null],
    ['cumpărare card MEGA IMAGE', null],
    [null, null],
    ['', ''],
  ])('returnează null pentru %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('returnează null pentru tranzacții transfer intern deja convertite', () => {
    const tx = makeTx({ is_internal_transfer: true, description: 'ATM BCR' });
    expect(detectTransferType(tx)).toBeNull();
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

describe('listPendingTransferSuggestions / countPendingTransferSuggestions', () => {
  beforeEach(() => {
    (db.getAllAsync as jest.Mock).mockReset();
  });

  it('SQL exclude transfer/dismissed/duplicate, sortat date DESC, fără filtru pe semn amount', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await listPendingTransferSuggestions();
    const calls = (db.getAllAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toMatch(/is_internal_transfer\s*=\s*0/);
    expect(sql).toMatch(/cash_suggestion_dismissed\s*=\s*0/);
    expect(sql).toMatch(/duplicate_of_id IS NULL/);
    expect(sql).toMatch(/ORDER BY date DESC/);
    expect(sql).not.toMatch(/amount\s*<\s*0/);
    expect(params).toEqual(['-365 days']);
  });

  it('populează suggested_type pe fiecare rând returnat', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      rowFor({ id: 'a', amount: -100, description: 'ATM BCR' }),
      rowFor({ id: 'b', amount: -200, description: 'transfer la economii' }),
      rowFor({ id: 'c', amount: 300, description: 'lichidare depozit' }),
      rowFor({ id: 'd', description: 'cumpărare card MEGA' }),
    ]);
    const pending = await listPendingTransferSuggestions();
    expect(pending.map(p => ({ id: p.id, suggested_type: p.suggested_type }))).toEqual([
      { id: 'a', suggested_type: 'cash' },
      { id: 'b', suggested_type: 'savings_out' },
      { id: 'c', suggested_type: 'savings_in' },
    ]);
  });

  it('respectă limitul default (10) după filtrare', async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      rowFor({
        id: `tx-${i}`,
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const pending = await listPendingTransferSuggestions();
    expect(pending).toHaveLength(10);
  });

  it('respectă limitul custom', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => rowFor({ id: `tx-${i}` }));
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const pending = await listPendingTransferSuggestions({ limit: 3 });
    expect(pending).toHaveLength(3);
  });

  it('trece sinceDays custom în SQL ca `-N days`', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await listPendingTransferSuggestions({ sinceDays: 30 });
    const params = (db.getAllAsync as jest.Mock).mock.calls[0][1];
    expect(params).toEqual(['-30 days']);
  });

  it('countPendingTransferSuggestions întoarce numărul filtrat (cumulat pe toate tipurile)', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      rowFor({ id: 'a', amount: -100, description: 'ATM BCR' }),
      rowFor({ id: 'b', amount: -200, description: 'transfer la economii' }),
      rowFor({ id: 'c', amount: 300, description: 'lichidare depozit' }),
      rowFor({ id: 'd', description: 'cumpărare card MEGA' }),
    ]);
    expect(await countPendingTransferSuggestions()).toBe(3);
  });
});

describe('dismissTransferSuggestion', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
  });

  it('apelează UPDATE cu cash_suggestion_dismissed = 1 și id corect', async () => {
    await dismissTransferSuggestion('tx-123');
    expect(db.runAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = (db.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/UPDATE transactions/);
    expect(sql).toMatch(/SET cash_suggestion_dismissed\s*=\s*1/);
    expect(sql).toMatch(/WHERE id\s*=\s*\?/);
    expect(params).toEqual(['tx-123']);
  });
});

describe('convertToTransfer — direcție outbound (amount < 0)', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  });

  it('happy path cash: actualizează sursa și inserează jumătate-cash legate reciproc', async () => {
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
    expect(updateSql).toMatch(/cash_suggestion_dismissed\s*=\s*1/);
    expect(updateParams[1]).toBe('cat-sys-transfer');
    expect(updateParams[2]).toBe('tx-src');

    const [insertSql, insertParams] = calls[1];
    expect(insertSql).toMatch(/INSERT INTO transactions/);
    expect(insertParams[1]).toBe('acc-cash');
    expect(insertParams[3]).toBe(500);
    expect(insertParams[5]).toBe(500);
  });

  it('happy path savings_out: target savings primește mirror pozitiv', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-src',
          amount: -1000,
          description: 'transfer la economii',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });

    await convertToTransfer('tx-src', 'acc-savings');

    const calls = (db.runAsync as jest.Mock).mock.calls;
    const insertParams = calls[1][1];
    expect(insertParams[1]).toBe('acc-savings');
    expect(insertParams[3]).toBe(1000);
  });

  it('throw dacă sursa nu există', async () => {
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(null);
    await expect(convertToTransfer('tx-missing', 'acc-cash')).rejects.toThrow(/sursă/i);
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

  it('throw dacă target e cont curent (bank), nu cash/savings', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src' }))
      .mockResolvedValueOnce({ id: 'acc-bank2', type: 'bank', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-bank2')).rejects.toThrow(
      /cash|economii|savings/i
    );
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target e card', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src' }))
      .mockResolvedValueOnce({ id: 'acc-card', type: 'card', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-card')).rejects.toThrow(/cash|economii|savings/i);
  });

  it('throw dacă valutele nu se potrivesc', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src', currency: 'EUR', amount: -100 }))
      .mockResolvedValueOnce({ id: 'acc-cash-ron', type: 'cash', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-cash-ron')).rejects.toThrow(/valut[ăa]/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });
});

describe('convertToTransfer — direcție inbound (amount > 0, savings_in)', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  });

  it('happy path: target savings primește mirror NEGATIV (banii ies din economii)', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-src',
          amount: 800,
          description: 'lichidare depozit',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });

    await convertToTransfer('tx-src', 'acc-savings');

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
    const calls = (db.runAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    const insertParams = calls[1][1];
    expect(insertParams[1]).toBe('acc-savings');
    expect(insertParams[3]).toBe(-800);
    expect(insertParams[5]).toBe(-800);
  });

  it('throw dacă target e cash (savings_in necesită savings)', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({ id: 'tx-src', amount: 500, description: 'lichidare depozit' })
      )
      .mockResolvedValueOnce({ id: 'acc-cash', type: 'cash', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-cash')).rejects.toThrow(/economii|savings/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target e bank', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src', amount: 500 }))
      .mockResolvedValueOnce({ id: 'acc-bank2', type: 'bank', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-bank2')).rejects.toThrow(/economii|savings/i);
  });
});
