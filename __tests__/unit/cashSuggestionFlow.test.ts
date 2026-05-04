import {
  convertToTransfer,
  countPendingCashSuggestions,
  dismissCashSuggestion,
  listPendingCashSuggestions,
} from '@/services/cashSuggestion';
import { db } from '@/services/db';

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

describe('cash suggestion flow', () => {
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

  it('list → convertToTransfer pe fiecare → 3 mutații atomice (UPDATE + INSERT pe pereche)', async () => {
    const rows = [
      makeRow('tx-1', '2026-05-03', -100, 'RETRAGERE ATM 1'),
      makeRow('tx-2', '2026-05-02', -200, 'RETRAGERE ATM 2'),
      makeRow('tx-3', '2026-05-01', -300, 'RETRAGERE ATM 3'),
    ];
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);

    const pending = await listPendingCashSuggestions();
    expect(pending.map(p => p.id)).toEqual(['tx-1', 'tx-2', 'tx-3']);

    for (const tx of pending) {
      const row = rows.find(r => r.id === tx.id)!;
      (db.getFirstAsync as jest.Mock)
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ id: 'acc-cash', type: 'cash', currency: 'RON' });
      await convertToTransfer(tx.id, 'acc-cash');
    }

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(3);
    expect((db.runAsync as jest.Mock).mock.calls).toHaveLength(6);

    // Verifică că fiecare pereche e: UPDATE source + INSERT pair
    const calls = (db.runAsync as jest.Mock).mock.calls;
    expect(calls[0][0]).toMatch(/UPDATE transactions/);
    expect(calls[1][0]).toMatch(/INSERT INTO transactions/);
    expect(calls[2][0]).toMatch(/UPDATE transactions/);
    expect(calls[3][0]).toMatch(/INSERT INTO transactions/);
    expect(calls[4][0]).toMatch(/UPDATE transactions/);
    expect(calls[5][0]).toMatch(/INSERT INTO transactions/);
  });

  it('dismiss → SQL filter exclude tranzacția pe interogarea următoare', async () => {
    const row = makeRow('tx-1', '2026-05-01', -500, 'RETRAGERE ATM');
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([row]);
    expect(await countPendingCashSuggestions()).toBe(1);

    await dismissCashSuggestion('tx-1');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('cash_suggestion_dismissed = 1'),
      ['tx-1']
    );

    // Pe interogarea următoare, SQL conține `cash_suggestion_dismissed = 0` deci
    // tranzacția dismiss-uită ar fi exclusă de SQLite real; aici simulăm asta.
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([]);
    expect(await countPendingCashSuggestions()).toBe(0);
  });
});
