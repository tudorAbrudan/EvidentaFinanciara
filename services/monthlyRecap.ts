import AsyncStorage from '@react-native-async-storage/async-storage';

import { computeMonthlyInsights } from './insights';
import {
  getCategoryBreakdown,
  getMonthlyTotals,
  type CategoryBreakdownItem,
  type MonthlyTotals,
} from './transactions';

const KEY_LAST_RECAP_MONTH = 'settings_last_recap_month';
const MIN_TRANSACTIONS_FOR_RECAP = 5;
const TOP_N = 3;

export interface MonthlyRecapCategory {
  category_id: string | null;
  name: string;
  amount_ron: number;
  color: string | null;
  icon: string | null;
}

export interface MonthlyRecap {
  month: string;
  expense_ron: number;
  income_ron: number;
  net_ron: number;
  transaction_count: number;
  top_categories: MonthlyRecapCategory[];
  delta_vs_previous_pct?: number;
  highlight_insight?: string;
}

export function previousMonthYM(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function currentMonthYM(today: Date): string {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function buildRecapSummary(
  month: string,
  totals: MonthlyTotals,
  breakdown: CategoryBreakdownItem[],
  prevExpense?: number,
  highlightInsight?: string
): MonthlyRecap | null {
  if (totals.transaction_count < MIN_TRANSACTIONS_FOR_RECAP) return null;

  // Top 3 categorii pentru cheltuieli (incluzând necategorizat ca eventuală
  // categorie distinctă, dacă userul are > 0 tranzacții ne-categorisite vrea
  // să o vadă).
  const top = [...breakdown]
    .sort((a, b) => b.total_ron - a.total_ron)
    .slice(0, TOP_N)
    .map(it => ({
      category_id: it.category_id,
      name: it.category_name,
      amount_ron: it.total_ron,
      color: it.color,
      icon: it.icon,
    }));

  let deltaPct: number | undefined;
  if (prevExpense !== undefined && prevExpense > 0) {
    deltaPct = ((totals.expense_ron - prevExpense) / prevExpense) * 100;
  }

  return {
    month,
    expense_ron: totals.expense_ron,
    income_ron: totals.income_ron,
    net_ron: totals.net_ron,
    transaction_count: totals.transaction_count,
    top_categories: top,
    delta_vs_previous_pct: deltaPct,
    highlight_insight: highlightInsight,
  };
}

export async function buildRecap(month: string): Promise<MonthlyRecap | null> {
  const totals = await getMonthlyTotals(month);
  if (totals.transaction_count < MIN_TRANSACTIONS_FOR_RECAP) return null;

  const breakdown = await getCategoryBreakdown(month);

  // Luna anterioară (month - 1) pentru deltă
  const [y, m] = month.split('-').map(n => parseInt(n, 10));
  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  const prevMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const prevTotals = await getMonthlyTotals(prevMonth);

  // Highlight: primul insight calculat pentru luna respectivă
  let highlight: string | undefined;
  try {
    const insights = await computeMonthlyInsights(month);
    highlight = insights[0]?.message;
  } catch {
    // best-effort
  }

  return buildRecapSummary(
    month,
    totals,
    breakdown,
    prevTotals.expense_ron > 0 ? prevTotals.expense_ron : undefined,
    highlight
  );
}

export async function shouldShowRecap(): Promise<string | null> {
  const today = new Date();
  const targetMonth = previousMonthYM(today);
  const seen = await AsyncStorage.getItem(KEY_LAST_RECAP_MONTH);
  if (seen === targetMonth) return null;
  return targetMonth;
}

export async function markRecapShown(month: string): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_RECAP_MONTH, month);
}

export async function resetRecapForTesting(): Promise<void> {
  await AsyncStorage.removeItem(KEY_LAST_RECAP_MONTH);
}
