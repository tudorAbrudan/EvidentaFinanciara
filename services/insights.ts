import { getCategoryBreakdown, getMonthlyTotals, type CategoryBreakdownItem } from './transactions';

export type InsightSeverity = 'positive' | 'warning' | 'neutral';

export type InsightType = 'total_change' | 'category_change';

export interface MonthlyInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  message: string;
  delta_ron: number;
  delta_pct: number;
  category_id?: string;
  category_name?: string;
}

const PCT_THRESHOLD = 20; // 20%
const ABS_TOTAL_THRESHOLD_RON = 50; // total: ignoră oscilații sub 50 RON
const ABS_CAT_THRESHOLD_RON = 100; // categorie: ignoră categorii sub 100 RON luna curentă
const MAX_INSIGHTS = 3;

interface MonthCatMap {
  [categoryId: string]: { expense: number; name: string };
}

function indexBreakdown(items: CategoryBreakdownItem[]): MonthCatMap {
  const map: MonthCatMap = {};
  for (const it of items) {
    if (it.category_id == null) continue; // ignorăm necategorizat pentru insights
    map[it.category_id] = { expense: it.total_ron, name: it.category_name };
  }
  return map;
}

function pct(current: number, baseline: number): number {
  if (baseline === 0) return current > 0 ? 100 : 0;
  return ((current - baseline) / baseline) * 100;
}

/**
 * Logica pură de derivat insights din breakdown-uri lunare. Separată de DB
 * pentru a fi testabilă fără mock-uri.
 *
 * @param currentExpenseTotal — total cheltuieli lună curentă (suma absolută RON)
 * @param previousExpenseTotals — totaluri ale ultimelor 3 luni (în ordine descrescătoare după dată)
 * @param current — breakdown pe categorii lună curentă
 * @param previousMonths — breakdown-uri pentru ultimele 3 luni
 */
export function buildInsightsFromBreakdowns(
  currentExpenseTotal: number,
  previousExpenseTotals: number[],
  current: CategoryBreakdownItem[],
  previousMonths: CategoryBreakdownItem[][]
): MonthlyInsight[] {
  const insights: MonthlyInsight[] = [];

  // Insight pe total general
  const validPrev = previousExpenseTotals.filter(t => t > 0);
  if (validPrev.length > 0) {
    const baseline = validPrev.reduce((a, b) => a + b, 0) / validPrev.length;
    const deltaRon = currentExpenseTotal - baseline;
    const deltaPct = pct(currentExpenseTotal, baseline);
    if (Math.abs(deltaPct) >= PCT_THRESHOLD && Math.abs(deltaRon) >= ABS_TOTAL_THRESHOLD_RON) {
      const up = deltaRon > 0;
      insights.push({
        id: 'total',
        type: 'total_change',
        severity: up ? 'warning' : 'positive',
        delta_ron: deltaRon,
        delta_pct: deltaPct,
        message: up
          ? `Cheltuiești cu ${Math.round(Math.abs(deltaPct))}% mai mult luna asta — ${Math.round(Math.abs(deltaRon))} RON peste media ultimelor 3 luni.`
          : `Cheltuiești cu ${Math.round(Math.abs(deltaPct))}% mai puțin luna asta — ${Math.round(Math.abs(deltaRon))} RON sub media ultimelor 3 luni.`,
      });
    }
  }

  // Insights pe categorii
  const currentMap = indexBreakdown(current);
  const prevMaps = previousMonths.map(indexBreakdown);

  const allCategoryIds = new Set<string>(Object.keys(currentMap));
  for (const m of prevMaps) for (const id of Object.keys(m)) allCategoryIds.add(id);

  const categoryInsights: MonthlyInsight[] = [];
  for (const catId of allCategoryIds) {
    const currentExpense = currentMap[catId]?.expense ?? 0;
    if (currentExpense < ABS_CAT_THRESHOLD_RON) continue; // filtru zgomot

    const prevPresence = prevMaps.filter(m => m[catId] !== undefined);
    if (prevPresence.length === 0) continue; // categorie nouă fără istoric — ignorăm

    const baseline =
      prevPresence.reduce((sum, m) => sum + (m[catId]?.expense ?? 0), 0) / prevPresence.length;
    const deltaRon = currentExpense - baseline;
    const deltaPct = pct(currentExpense, baseline);
    if (Math.abs(deltaPct) < PCT_THRESHOLD) continue;

    const up = deltaRon > 0;
    const name = currentMap[catId]?.name ?? prevMaps.find(m => m[catId])?.[catId]?.name ?? '?';
    categoryInsights.push({
      id: `cat:${catId}`,
      type: 'category_change',
      severity: up ? 'warning' : 'positive',
      delta_ron: deltaRon,
      delta_pct: deltaPct,
      category_id: catId,
      category_name: name,
      message: up
        ? `Mai mult la ${name}: +${Math.round(Math.abs(deltaPct))}% (≈ ${Math.round(Math.abs(deltaRon))} RON peste media).`
        : `Mai puțin la ${name}: −${Math.round(Math.abs(deltaPct))}% (≈ ${Math.round(Math.abs(deltaRon))} RON sub media).`,
    });
  }

  categoryInsights.sort((a, b) => Math.abs(b.delta_ron) - Math.abs(a.delta_ron));

  // Total e mereu primul (dacă există), apoi categorii
  return [...insights, ...categoryInsights].slice(0, MAX_INSIGHTS);
}

function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [y, m] = yearMonth.split('-').map(n => parseInt(n, 10));
  if (Number.isNaN(y) || Number.isNaN(m)) return yearMonth;
  const date = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

export async function computeMonthlyInsights(
  currentMonth: string,
  accountId?: string
): Promise<MonthlyInsight[]> {
  const previousMonthsYM = [
    shiftYearMonth(currentMonth, -1),
    shiftYearMonth(currentMonth, -2),
    shiftYearMonth(currentMonth, -3),
  ];

  const [currentBreakdown, ...prevBreakdowns] = await Promise.all([
    getCategoryBreakdown(currentMonth, accountId),
    ...previousMonthsYM.map(ym => getCategoryBreakdown(ym, accountId)),
  ]);

  const [currentTotals, ...prevTotals] = await Promise.all([
    getMonthlyTotals(currentMonth, accountId),
    ...previousMonthsYM.map(ym => getMonthlyTotals(ym, accountId)),
  ]);

  return buildInsightsFromBreakdowns(
    currentTotals.expense_ron,
    prevTotals.map(t => t.expense_ron),
    currentBreakdown,
    prevBreakdowns
  );
}
