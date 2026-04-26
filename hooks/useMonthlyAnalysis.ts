import { useEffect, useState, useCallback } from 'react';
import * as tx from '@/services/transactions';
import type { Transaction } from '@/types';

export interface MonthlyAnalysis {
  yearMonth: string;
  totals: tx.MonthlyTotals;
  breakdown: tx.CategoryBreakdownItem[];
  recent: Transaction[];
}

/**
 * Hook care încarcă tot ce trebuie pentru o lună de analiză:
 * totaluri, breakdown pe categorii și ultimele tranzacții.
 *
 * Filtrul `accountId` e opțional: dacă e omis, analiza acoperă toate conturile
 * (modul „pe categorii, nu pe bancă" cerut de utilizator).
 */
export function useMonthlyAnalysis(yearMonth: string, accountId?: string) {
  const [analysis, setAnalysis] = useState<MonthlyAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [totals, breakdown, recent] = await Promise.all([
        tx.getMonthlyTotals(yearMonth, accountId),
        tx.getCategoryBreakdown(yearMonth, accountId),
        tx.getTransactions({
          account_id: accountId,
          fromDate: `${yearMonth}-01`,
          toDate: `${yearMonth}-31`,
          excludeDuplicates: true,
          excludeTransfers: false,
          limit: 25,
        }),
      ]);
      setAnalysis({ yearMonth, totals, breakdown, recent });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare analiză');
    } finally {
      setLoading(false);
    }
  }, [yearMonth, accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { analysis, loading, error, refresh };
}
