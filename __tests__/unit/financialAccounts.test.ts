import * as db from '@/services/db';

jest.mock('@/services/db', () => ({
  __esModule: true,
  db: {
    runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
  },
  generateId: () => 'acc-test-id',
}));

import {
  getCurrentBalance,
  getCurrentBalances,
  createFinancialAccount,
} from '@/services/financialAccounts';

describe('getCurrentBalance', () => {
  it('returns initial_balance + sum of transactions', async () => {
    (db.db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce({ initial_balance: 1000 }) // first call: account
      .mockResolvedValueOnce({ total: -250 }); // second: tx sum
    const balance = await getCurrentBalance('a1');
    expect(balance).toBe(750);
  });

  it('returns 0 for non-existent account', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValueOnce(null);
    const balance = await getCurrentBalance('missing');
    expect(balance).toBe(0);
  });

  it('handles null sum (no transactions yet)', async () => {
    (db.db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce({ initial_balance: 500 })
      .mockResolvedValueOnce({ total: null });
    const balance = await getCurrentBalance('a1');
    expect(balance).toBe(500);
  });
});

describe('getCurrentBalances', () => {
  it('returns map id → balance for all accounts', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([
      { id: 'a1', total: 1000 },
      { id: 'a2', total: -50.25 },
    ]);
    const map = await getCurrentBalances();
    expect(map.get('a1')).toBe(1000);
    expect(map.get('a2')).toBe(-50.25);
    expect(map.size).toBe(2);
  });

  it('returns empty map when there are no accounts', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    const map = await getCurrentBalances();
    expect(map.size).toBe(0);
  });
});

describe('createFinancialAccount', () => {
  it('inserts default RON currency and 0 initial balance when omitted', async () => {
    (db.db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 1 });
    const account = await createFinancialAccount({ name: 'Cont nou', type: 'bank' });
    expect(account.currency).toBe('RON');
    expect(account.initial_balance).toBe(0);
    expect(account.archived).toBe(false);

    const insertCall = (db.db.runAsync as jest.Mock).mock.calls[0];
    expect(insertCall[0]).toMatch(/INSERT INTO financial_accounts/);
  });

  it('preserves provided currency and initial balance', async () => {
    const account = await createFinancialAccount({
      name: 'Revolut EUR',
      type: 'bank',
      currency: 'EUR',
      initial_balance: 250.5,
    });
    expect(account.currency).toBe('EUR');
    expect(account.initial_balance).toBe(250.5);
  });
});
