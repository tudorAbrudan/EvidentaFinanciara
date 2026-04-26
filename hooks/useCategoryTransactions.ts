import { useEffect, useState, useCallback } from 'react';
import * as tx from '@/services/transactions';
import type { Transaction } from '@/types';

/**
 * Sentinel pentru categoria „Necategorizat" (tranzacții fără category_id).
 * Folosit de UI când utilizatorul expandează rândul „Necategorizat" din breakdown.
 */
export const UNCATEGORIZED_KEY = '__uncat__';

/**
 * Încarcă tranzacțiile dintr-o categorie pentru o lună dată.
 *
 * `categoryKey` interpretare:
 *   - `null`              → hook dezactivat, nu face fetch (loading=false, transactions=[]).
 *   - `UNCATEGORIZED_KEY` → fetch tranzacții fără categorie (`category_id IS NULL`).
 *   - alt string          → fetch tranzacții cu acel `category_id`.
 *
 * Filtrele aplicate sunt aliniate cu `getCategoryBreakdown`:
 * doar cheltuieli (`amount < 0`), exclude transferuri interne și duplicate.
 */
export function useCategoryTransactions(
  yearMonth: string,
  categoryKey: string | null,
  accountId?: string
) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (categoryKey === null) {
      setTransactions([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const filter: tx.TransactionFilter = {
        account_id: accountId,
        fromDate: `${yearMonth}-01`,
        toDate: `${yearMonth}-31`,
        excludeDuplicates: true,
        excludeTransfers: true,
        onlyExpenses: true,
      };
      if (categoryKey === UNCATEGORIZED_KEY) {
        filter.uncategorized = true;
      } else {
        filter.category_id = categoryKey;
      }
      const list = await tx.getTransactions(filter);
      setTransactions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu s-a putut încărca lista');
    } finally {
      setLoading(false);
    }
  }, [yearMonth, categoryKey, accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { transactions, loading, error, refresh };
}
