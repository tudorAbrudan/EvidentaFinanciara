import AsyncStorage from '@react-native-async-storage/async-storage';
import * as db from '@/services/db';

jest.mock('@/services/db', () => ({
  __esModule: true,
  db: {
    runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => cb()),
  },
  generateId: jest.fn(() => 'demo-acc-id'),
}));

import { createDemoData, deleteDemoData, hasDemoData, getDemoAccountId } from '@/services/demoData';

const DEMO_KEY = 'settings_demo_account_id';

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  // generateId returnează valori unice per apel (cont + tranzacții)
  let i = 0;
  (require('@/services/db').generateId as jest.Mock).mockImplementation(() => {
    i += 1;
    return i === 1 ? 'demo-acc-id' : `demo-tx-${i}`;
  });
});

describe('createDemoData', () => {
  it('inserts a financial account and ~30 transactions, persists tracking key', async () => {
    const result = await createDemoData();

    expect(result.accountId).toBe('demo-acc-id');
    expect(result.transactionCount).toBeGreaterThanOrEqual(28);
    expect(result.transactionCount).toBeLessThanOrEqual(35);

    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    const insertAccount = calls.find(c => /INSERT INTO financial_accounts/.test(c[0]));
    expect(insertAccount).toBeDefined();
    expect(insertAccount?.[1]).toEqual(
      expect.arrayContaining(['demo-acc-id', 'Cont demo', 'bank', 'RON'])
    );

    const insertTx = calls.filter(c => /INSERT INTO transactions/.test(c[0]));
    expect(insertTx.length).toBe(result.transactionCount);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(DEMO_KEY, 'demo-acc-id');
  });

  it('marks demo transactions with source=demo', async () => {
    await createDemoData();
    const txCalls = (db.db.runAsync as jest.Mock).mock.calls.filter(c =>
      /INSERT INTO transactions/.test(c[0])
    );
    for (const call of txCalls) {
      expect(call[1]).toEqual(expect.arrayContaining(['demo']));
    }
  });

  it('is idempotent — returns existing accountId without inserting again', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('existing-demo-id');

    const result = await createDemoData();

    expect(result.accountId).toBe('existing-demo-id');
    expect(result.transactionCount).toBe(0);
    expect(db.db.runAsync).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('includes some uncategorized transactions (category_id NULL) intentionally', async () => {
    await createDemoData();
    const txCalls = (db.db.runAsync as jest.Mock).mock.calls.filter(c =>
      /INSERT INTO transactions/.test(c[0])
    );
    // category_id e poziția 9 în VALUES (după id, account_id, date, amount, currency, amount_ron, description, merchant)
    const uncategorized = txCalls.filter(call => call[1][8] === null);
    expect(uncategorized.length).toBeGreaterThan(0);
  });
});

describe('deleteDemoData', () => {
  it('deletes transactions and the demo account, then clears tracking key', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('demo-acc-id');

    await deleteDemoData();

    expect(db.db.withTransactionAsync).toHaveBeenCalled();
    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    expect(calls.some(c => /DELETE FROM transactions/.test(c[0]))).toBe(true);
    expect(calls.some(c => /DELETE FROM financial_accounts/.test(c[0]))).toBe(true);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(DEMO_KEY);
  });

  it('is no-op when no demo account exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await deleteDemoData();

    expect(db.db.withTransactionAsync).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it('still clears the tracking key if the DB delete throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('demo-acc-id');
    (db.db.withTransactionAsync as jest.Mock).mockRejectedValueOnce(new Error('DB busy'));

    await expect(deleteDemoData()).rejects.toThrow('DB busy');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(DEMO_KEY);
  });
});

describe('hasDemoData & getDemoAccountId', () => {
  it('hasDemoData returns true when key is set', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('some-id');
    expect(await hasDemoData()).toBe(true);
  });

  it('hasDemoData returns false when key is missing', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await hasDemoData()).toBe(false);
  });

  it('getDemoAccountId returns stored id or null', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('demo-acc-id');
    expect(await getDemoAccountId()).toBe('demo-acc-id');

    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await getDemoAccountId()).toBeNull();
  });
});
