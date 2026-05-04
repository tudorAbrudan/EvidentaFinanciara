// Teste separate pentru ramura FX non-RON din convertToTransfer.
// Necesită jest.mock la nivel de fișier pentru @/services/fxRates.

import { convertToTransfer } from '@/services/cashSuggestion';
import { db } from '@/services/db';
import { getRateRon } from '@/services/fxRates';

jest.mock('@/services/fxRates', () => ({
  __esModule: true,
  getRateRon: jest.fn(),
}));

const mockGetRateRon = getRateRon as jest.Mock;

function rowFor(
  over: Partial<{
    id: string;
    account_id: string;
    date: string;
    amount: number;
    currency: string;
    description: string;
    merchant: string;
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
    source: 'manual',
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

describe('convertToTransfer — ramură FX non-RON', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
    mockGetRateRon.mockReset();
  });

  it('non-RON: pairAmountRon calculat din rate BNR', async () => {
    mockGetRateRon.mockResolvedValue(5);
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-eur',
          currency: 'EUR',
          amount: -100,
          description: 'ATM Revolut',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-cash-eur', type: 'cash', currency: 'EUR' });

    await convertToTransfer('tx-eur', 'acc-cash-eur');

    const calls = (db.runAsync as jest.Mock).mock.calls;
    const insertParams = calls[1][1];
    expect(insertParams[3]).toBe(100); // amount inversat
    expect(insertParams[4]).toBe('EUR'); // currency
    expect(insertParams[5]).toBe(500); // pairAmountRon = 100 * 5
  });

  it('non-RON: pairAmountRon = null când fetch curs eșuează', async () => {
    mockGetRateRon.mockRejectedValue(new Error('rate fetch failed'));
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-eur', currency: 'EUR', amount: -100 }))
      .mockResolvedValueOnce({ id: 'acc-cash-eur', type: 'cash', currency: 'EUR' });

    await convertToTransfer('tx-eur', 'acc-cash-eur');

    const calls = (db.runAsync as jest.Mock).mock.calls;
    const insertParams = calls[1][1];
    expect(insertParams[5]).toBeNull(); // pairAmountRon e null
  });
});
