import type { Transaction } from '@/types';

const CASH_WITHDRAWAL_REGEX = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function detectCashWithdrawal(tx: Transaction): boolean {
  if (tx.amount >= 0) return false;
  if (tx.is_internal_transfer) return false;
  const haystack = normalize(`${tx.description ?? ''} ${tx.merchant ?? ''}`);
  return CASH_WITHDRAWAL_REGEX.test(haystack);
}
