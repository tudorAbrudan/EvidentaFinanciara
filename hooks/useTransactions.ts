import { useEffect, useState, useCallback } from 'react';
import type { Transaction } from '@/types';
import * as tx from '@/services/transactions';

export function useTransactions(filter: tx.TransactionFilter = {}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<tx.MonthlyTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterKey = JSON.stringify(filter);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await tx.getTransactions(filter);
      setTransactions(list);
      const ym = new Date().toISOString().slice(0, 7);
      const totals = await tx.getMonthlyTotals(ym, filter.account_id);
      setMonthlyTotals(totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare tranzacții');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    transactions,
    monthlyTotals,
    loading,
    error,
    refresh,
    createTransaction: tx.createTransaction,
    updateTransaction: tx.updateTransaction,
    deleteTransaction: tx.deleteTransaction,
    markAsDuplicate: tx.markAsDuplicate,
    unmarkDuplicate: tx.unmarkDuplicate,
    linkAsInternalTransfer: tx.linkAsInternalTransfer,
    unlinkInternalTransfer: tx.unlinkInternalTransfer,
    findDuplicateCandidates: tx.findDuplicateCandidates,
    findInternalTransferCandidates: tx.findInternalTransferCandidates,
  };
}
