import { db } from '@/services/db';
import {
  convertToTransfer,
  countPendingTransferSuggestions,
  dismissTransferSuggestion,
  listPendingTransferSuggestions,
} from '@/services/internalTransferSuggestion';

function makeRow(id: string, date: string, amount: number, description: string, currency = 'RON') {
  return {
    id,
    account_id: 'acc-bank',
    date,
    amount,
    currency,
    amount_ron: null,
    description,
    merchant: null,
    category_id: null,
    source: 'statement',
    statement_id: null,
    is_internal_transfer: 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: null,
    cash_suggestion_dismissed: 0,
    notes: null,
    created_at: '2026-05-01T10:00:00.000Z',
  };
}

describe('internal transfer suggestion flow', () => {
  beforeEach(() => {
    (db.getAllAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  });

  it('list mixt (cash + savings_out + savings_in) → convert pe fiecare → 3 perechi atomice', async () => {
    const rows = [
      makeRow('tx-1', '2026-05-03', -100, 'RETRAGERE ATM 1'),
      makeRow('tx-2', '2026-05-02', -200, 'transfer la economii'),
      makeRow('tx-3', '2026-05-01', 300, 'lichidare depozit'),
    ];
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);

    const pending = await listPendingTransferSuggestions();
    expect(pending.map(p => ({ id: p.id, type: p.suggested_type }))).toEqual([
      { id: 'tx-1', type: 'cash' },
      { id: 'tx-2', type: 'savings_out' },
      { id: 'tx-3', type: 'savings_in' },
    ]);

    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rows[0])
      .mockResolvedValueOnce({ id: 'acc-cash', type: 'cash', currency: 'RON' });
    await convertToTransfer('tx-1', 'acc-cash');

    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rows[1])
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });
    await convertToTransfer('tx-2', 'acc-savings');

    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rows[2])
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });
    await convertToTransfer('tx-3', 'acc-savings');

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(3);
    expect((db.runAsync as jest.Mock).mock.calls).toHaveLength(6);

    const calls = (db.runAsync as jest.Mock).mock.calls;
    expect(calls[0][0]).toMatch(/UPDATE transactions/);
    expect(calls[1][0]).toMatch(/INSERT INTO transactions/);
    expect(calls[1][1][3]).toBe(100);
    expect(calls[3][1][3]).toBe(200);
    expect(calls[5][1][3]).toBe(-300);
  });

  it('dismiss → SQL filter exclude tranzacția pe interogarea următoare', async () => {
    const row = makeRow('tx-1', '2026-05-01', -500, 'RETRAGERE ATM');
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([row]);
    expect(await countPendingTransferSuggestions()).toBe(1);

    await dismissTransferSuggestion('tx-1');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('cash_suggestion_dismissed = 1'),
      ['tx-1']
    );

    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([]);
    expect(await countPendingTransferSuggestions()).toBe(0);
  });
});
