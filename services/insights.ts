import {
  detectSpendingAnomalies,
  type CategoryAnomalyInput,
  type SpendingAnomaly,
} from './spendingAnomalies';
import { isMonthComplete, loadCoverageReport, type CoverageReport } from './statementCoverage';
import { getCategoryMonthlySeries, getTransactions } from './transactions';

export type InsightSeverity = 'positive' | 'warning' | 'neutral';

/**
 * `category_new` a fost scos odată cu motorul vechi: detectorul de anomalii nu
 * are noțiunea de „categorie apărută prima dată" (are `new_merchant`, care e
 * altceva), iar un membru pe care nu-l mai emite nimeni e cod mort pe care
 * niciun gate nu-l semnalează.
 */
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

const MAX_INSIGHTS = 3;

/**
 * Traduce anomaliile în cardurile pe care ecranul le afișează deja.
 *
 * Cardul rămâne cum e; se schimbă doar motorul care decide ce scrie pe el.
 * Mesajul vine din detector — acolo sunt cifrele și explicația — iar aici se
 * face doar potrivirea de formă și ordinea.
 *
 * `delta_pct` se raportează la mediană, nu la medie: procentul trebuie să
 * răspundă la „cu cât mai mult decât de obicei", iar „de obicei" e mediana.
 */
export function buildInsightsFromAnomalies(
  totalAnomaly: SpendingAnomaly | null,
  categoryAnomalies: SpendingAnomaly[]
): MonthlyInsight[] {
  const toInsight = (anomaly: SpendingAnomaly, type: InsightType): MonthlyInsight => ({
    id: type === 'total_change' ? 'total' : `cat:${anomaly.category_id ?? 'uncat'}`,
    type,
    severity: anomaly.severity,
    delta_ron: anomaly.excess_ron,
    delta_pct: anomaly.median_ron > 0 ? (anomaly.excess_ron / anomaly.median_ron) * 100 : 0,
    ...(type === 'category_change'
      ? { category_id: anomaly.category_id ?? undefined, category_name: anomaly.category_name }
      : {}),
    message: anomaly.message,
  });

  const out: MonthlyInsight[] = [];
  if (totalAnomaly !== null) out.push(toInsight(totalAnomaly, 'total_change'));
  for (const anomaly of categoryAnomalies) out.push(toInsight(anomaly, 'category_change'));
  return out.slice(0, MAX_INSIGHTS);
}

function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [y, m] = yearMonth.split('-').map(n => parseInt(n, 10));
  if (Number.isNaN(y) || Number.isNaN(m)) return yearMonth;
  const date = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

/** Câte luni complete se iau în istoric, și cât de departe se caută după ele. */
const HISTORY_MONTHS = 12;
const MAX_LOOKBACK_MONTHS = 24;

/**
 * Ultimele luni **complete** dinaintea lunii date, cronologic.
 *
 * Se sare peste lunile cărora le lipsește un extras: o lună incompletă băgată în
 * istoric ar coborî mediana și ar face luna curentă să pară o anomalie, când de
 * fapt anomalia era în date.
 */
function completeMonthsBefore(report: CoverageReport, month: string, count: number): string[] {
  const out: string[] = [];
  let cursor = shiftYearMonth(month, -1);
  for (let i = 0; i < MAX_LOOKBACK_MONTHS && out.length < count; i += 1) {
    if (isMonthComplete(report, cursor)) out.unshift(cursor);
    cursor = shiftYearMonth(cursor, -1);
  }
  return out;
}

const UNCATEGORIZED = '__uncat__';

/**
 * Insights pentru o lună, pe motorul de anomalii.
 *
 * Poarta e `isMonthComplete`: pe o lună căreia îi lipsește un extras nu se emite
 * nimic. O comparație pe date parțiale nu e o aproximare, e o afirmație falsă —
 * iar ecranul o marchează separat, prin `describeIncompleteMonth`.
 */
export async function computeMonthlyInsights(
  currentMonth: string,
  accountId?: string
): Promise<MonthlyInsight[]> {
  const report = await loadCoverageReport();
  if (!isMonthComplete(report, currentMonth)) return [];

  const history = completeMonthsBefore(report, currentMonth, HISTORY_MONTHS);
  const from = history[0];
  if (from === undefined) return [];

  // O singură interogare pentru sume și numărători; tranzacțiile ferestrei vin
  // separat, fiindcă `new_merchant` are nevoie de comercianți, iar seria
  // agregată nu-i poate purta.
  const [series, windowTxs] = await Promise.all([
    getCategoryMonthlySeries(from, currentMonth, accountId),
    getTransactions({
      account_id: accountId,
      fromDate: `${from}-01`,
      toDate: `${currentMonth}-31`,
      onlyExpenses: true,
      excludeTransfers: true,
      excludeDuplicates: true,
    }),
  ]);

  const known = new Set(history);
  const byCategory = new Map<string, CategoryAnomalyInput>();
  const monthTotals = new Map<string, { total: number; count: number }>();

  for (const point of series) {
    const bucket = monthTotals.get(point.yearMonth) ?? { total: 0, count: 0 };
    monthTotals.set(point.yearMonth, {
      total: bucket.total + point.total_ron,
      count: bucket.count + point.transaction_count,
    });

    const key = point.category_id ?? UNCATEGORIZED;
    let entry = byCategory.get(key);
    if (entry === undefined) {
      entry = {
        category_id: point.category_id,
        category_name: point.category_name,
        history: [],
        current: { yearMonth: currentMonth, total_ron: 0, transaction_count: 0 },
        current_transactions: [],
        known_merchants: [],
      };
      byCategory.set(key, entry);
    }
    const point_ = {
      yearMonth: point.yearMonth,
      total_ron: point.total_ron,
      transaction_count: point.transaction_count,
    };
    if (point.yearMonth === currentMonth) entry.current = point_;
    else if (known.has(point.yearMonth)) entry.history.push(point_);

    const lastYear = `${Number(currentMonth.slice(0, 4)) - 1}-${currentMonth.slice(5, 7)}`;
    if (point.yearMonth === lastYear) entry.same_month_last_year_ron = point.total_ron;
  }

  for (const tx of windowTxs) {
    const key = tx.category_id ?? UNCATEGORIZED;
    const entry = byCategory.get(key);
    if (entry === undefined) continue;
    const value = tx.currency === 'RON' ? Math.abs(tx.amount) : Math.abs(tx.amount_ron ?? 0);
    if (tx.date.slice(0, 7) === currentMonth) {
      entry.current_transactions.push({
        id: tx.id,
        amount_ron: value,
        merchant: tx.merchant ?? null,
      });
    } else if (tx.merchant) {
      entry.known_merchants.push(tx.merchant);
    }
  }

  const categoryAnomalies = detectSpendingAnomalies([...byCategory.values()]);

  // Totalul lunii trece prin același detector, ca o serie unică: planul cere ca
  // și `total_change` să se mute pe mediană.
  // Perechea lună–valoare se construiește într-o singură trecere: dacă aș filtra
  // întâi și aș citi luna după indice, o lună completă fără cheltuieli ar
  // desincroniza tăcut etichetele de la acel punct încolo.
  const totalHistory = history
    .map(ym => ({ yearMonth: ym, bucket: monthTotals.get(ym) }))
    .filter(
      (entry): entry is { yearMonth: string; bucket: { total: number; count: number } } =>
        entry.bucket !== undefined
    )
    .map(entry => ({
      yearMonth: entry.yearMonth,
      total_ron: entry.bucket.total,
      transaction_count: entry.bucket.count,
    }));
  const currentTotal = monthTotals.get(currentMonth) ?? { total: 0, count: 0 };
  const totalAnomaly: SpendingAnomaly | null =
    totalHistory.length > 0
      ? (detectSpendingAnomalies([
          {
            category_id: null,
            category_name: 'Total',
            history: totalHistory,
            current: {
              yearMonth: currentMonth,
              total_ron: currentTotal.total,
              transaction_count: currentTotal.count,
            },
            current_transactions: [],
            known_merchants: [],
          },
        ])[0] ?? null)
      : null;

  return buildInsightsFromAnomalies(totalAnomaly, categoryAnomalies);
}
