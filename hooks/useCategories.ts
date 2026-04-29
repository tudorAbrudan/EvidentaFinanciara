import { useEffect, useState, useCallback } from 'react';

import * as cats from '@/services/categories';
import type { ExpenseCategory } from '@/types';

export function useCategories(includeArchived = false) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [spending, setSpending] = useState<cats.CategorySpending[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, sp] = await Promise.all([
        cats.getCategories(includeArchived),
        cats.getMonthlySpending(),
      ]);
      setCategories(list);
      setSpending(sp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare categorii');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    categories,
    spending,
    loading,
    error,
    refresh,
    createCategory: cats.createCategory,
    updateCategory: cats.updateCategory,
    archiveCategory: cats.archiveCategory,
    deleteCategory: cats.deleteCategory,
    getCategoryByKey: cats.getCategoryByKey,
  };
}
