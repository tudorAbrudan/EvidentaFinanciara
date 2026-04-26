import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/services/transactions', () => ({
  __esModule: true,
  getTransactions: jest.fn(),
}));

import * as txService from '@/services/transactions';
import { useCategoryTransactions } from '@/hooks/useCategoryTransactions';

describe('useCategoryTransactions', () => {
  beforeEach(() => {
    (txService.getTransactions as jest.Mock).mockReset();
    (txService.getTransactions as jest.Mock).mockResolvedValue([]);
  });

  it('does NOT fetch when categoryKey is null', async () => {
    renderHook(() => useCategoryTransactions('2026-04', null));
    await new Promise(r => setTimeout(r, 10));
    expect(txService.getTransactions).not.toHaveBeenCalled();
  });

  it('fetches with uncategorized=true when categoryKey is "__uncat__"', async () => {
    renderHook(() => useCategoryTransactions('2026-04', '__uncat__'));
    await waitFor(() => expect(txService.getTransactions).toHaveBeenCalled());
    const arg = (txService.getTransactions as jest.Mock).mock.calls[0][0];
    expect(arg.uncategorized).toBe(true);
    expect(arg.category_id).toBeUndefined();
    expect(arg.fromDate).toBe('2026-04-01');
    expect(arg.toDate).toBe('2026-04-31');
    expect(arg.onlyExpenses).toBe(true);
    expect(arg.excludeDuplicates).toBe(true);
    expect(arg.excludeTransfers).toBe(true);
  });

  it('fetches with category_id when categoryKey is a real id', async () => {
    renderHook(() => useCategoryTransactions('2026-04', 'cat-abc'));
    await waitFor(() => expect(txService.getTransactions).toHaveBeenCalled());
    const arg = (txService.getTransactions as jest.Mock).mock.calls[0][0];
    expect(arg.category_id).toBe('cat-abc');
    expect(arg.uncategorized).toBeUndefined();
  });

  it('passes accountId through when set', async () => {
    renderHook(() => useCategoryTransactions('2026-04', 'cat-abc', 'acc-1'));
    await waitFor(() => expect(txService.getTransactions).toHaveBeenCalled());
    const arg = (txService.getTransactions as jest.Mock).mock.calls[0][0];
    expect(arg.account_id).toBe('acc-1');
  });

  it('refetches when categoryKey changes', async () => {
    const { rerender } = renderHook(
      ({ key }: { key: string | null }) => useCategoryTransactions('2026-04', key),
      { initialProps: { key: 'cat-abc' as string | null } }
    );
    await waitFor(() =>
      expect((txService.getTransactions as jest.Mock).mock.calls.length).toBe(1)
    );
    rerender({ key: 'cat-xyz' });
    await waitFor(() =>
      expect((txService.getTransactions as jest.Mock).mock.calls.length).toBe(2)
    );
  });

  it('exposes error message in Romanian on failure', async () => {
    (txService.getTransactions as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useCategoryTransactions('2026-04', 'cat-abc'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toContain('boom');
  });
});
