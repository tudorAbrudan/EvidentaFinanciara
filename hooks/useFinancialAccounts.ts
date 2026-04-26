import { useEffect, useState, useCallback } from 'react';
import type { FinancialAccount } from '@/types';
import * as fa from '@/services/financialAccounts';

export interface AccountWithBalance extends FinancialAccount {
  balance: number;
}

export function useFinancialAccounts(includeArchived = false) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, balances] = await Promise.all([
        fa.getFinancialAccounts(includeArchived),
        fa.getCurrentBalances(),
      ]);
      setAccounts(list.map(a => ({ ...a, balance: balances.get(a.id) ?? a.initial_balance })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare conturi');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    accounts,
    loading,
    error,
    refresh,
    createAccount: fa.createFinancialAccount,
    updateAccount: fa.updateFinancialAccount,
    archiveAccount: fa.archiveFinancialAccount,
    deleteAccount: fa.deleteFinancialAccount,
    getAccount: fa.getFinancialAccount,
  };
}
