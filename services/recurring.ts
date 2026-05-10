import { db } from './db';
import { normalizeMerchant } from './merchantCategoryRules';

export type RecurringStatus = 'active' | 'missing' | 'expired';

export interface RecurringSeries {
  merchant_normalized: string;
  merchant_display: string;
  median_amount_ron: number;
  cadence_days: number;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  expected_next: string;
  status: RecurringStatus;
  category_id?: string;
  category_name?: string;
}

export interface TxLite {
  merchant: string;
  amount_ron: number;
  date: string;
  category_id?: string;
  category_name?: string;
}

const AMOUNT_TOLERANCE = 0.1;
const MIN_CADENCE_DAYS = 25;
const MAX_CADENCE_DAYS = 35;
const MIN_OCCURRENCES = 3;
const MAX_AGE_ACTIVE_DAYS = 35;
const MAX_AGE_MISSING_DAYS = 70;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildRecurringSeries(txs: TxLite[], today: string): RecurringSeries[] {
  // Group by normalized merchant
  const groups = new Map<string, TxLite[]>();
  const display = new Map<string, string>();
  for (const tx of txs) {
    const merchantTrimmed = tx.merchant.trim();
    if (!merchantTrimmed) continue;
    const key = normalizeMerchant(merchantTrimmed);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      display.set(key, merchantTrimmed);
    }
    groups.get(key)!.push(tx);
  }

  const series: RecurringSeries[] = [];
  for (const [key, items] of groups.entries()) {
    if (items.length < MIN_OCCURRENCES) continue;

    // Sort by date ascending
    const sorted = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Amount filter: median + tolerance ±10%
    const absAmounts = sorted.map(t => Math.abs(t.amount_ron));
    const medianAmount = median(absAmounts);
    if (medianAmount === 0) continue;
    const inToleranceCount = absAmounts.filter(
      a => Math.abs(a - medianAmount) / medianAmount <= AMOUNT_TOLERANCE
    ).length;
    if (inToleranceCount < MIN_OCCURRENCES) continue;

    // Cadence filter: median interval în 25-35 zile + majoritatea intervalelor în range
    // (median singur ar trece [10, 49] cu media 29.5 — fals positiv pe outlier-i extremi).
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }
    const medianCadence = median(intervals);
    if (medianCadence < MIN_CADENCE_DAYS || medianCadence > MAX_CADENCE_DAYS) continue;
    const inRangeIntervals = intervals.filter(
      d => d >= MIN_CADENCE_DAYS && d <= MAX_CADENCE_DAYS
    ).length;
    if (inRangeIntervals * 2 < intervals.length) continue; // majoritate strict

    const firstSeen = sorted[0].date;
    const lastSeen = sorted[sorted.length - 1].date;
    const ageDays = daysBetween(lastSeen, today);
    const status: RecurringStatus =
      ageDays <= MAX_AGE_ACTIVE_DAYS
        ? 'active'
        : ageDays <= MAX_AGE_MISSING_DAYS
          ? 'missing'
          : 'expired';

    const expectedNext = addDays(lastSeen, Math.round(medianCadence));

    // Category info: ia cea mai frecventă atribuire (simplu: ultima cu category set)
    const lastWithCategory = [...sorted]
      .reverse()
      .find(t => t.category_id !== undefined && t.category_id !== null);

    series.push({
      merchant_normalized: key,
      merchant_display: display.get(key) ?? key,
      median_amount_ron: medianAmount,
      cadence_days: Math.round(medianCadence),
      occurrences: sorted.length,
      first_seen: firstSeen,
      last_seen: lastSeen,
      expected_next: expectedNext,
      status,
      category_id: lastWithCategory?.category_id,
      category_name: lastWithCategory?.category_name,
    });
  }

  // Sort: active first, then missing, then expired; secondary by median_amount desc
  const order: Record<RecurringStatus, number> = { active: 0, missing: 1, expired: 2 };
  series.sort((a, b) => {
    const dord = order[a.status] - order[b.status];
    if (dord !== 0) return dord;
    return b.median_amount_ron - a.median_amount_ron;
  });

  return series;
}

export async function detectRecurringSeries(): Promise<RecurringSeries[]> {
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsAgo = addDays(today, -180);

  const rows =
    (await db.getAllAsync<{
      merchant: string | null;
      amount_ron: number | null;
      amount: number;
      date: string;
      category_id: string | null;
      category_name: string | null;
    }>(
      `SELECT
         t.merchant AS merchant,
         t.amount_ron AS amount_ron,
         t.amount AS amount,
         t.date AS date,
         t.category_id AS category_id,
         c.name AS category_name
       FROM transactions t
       LEFT JOIN expense_categories c ON c.id = t.category_id
       WHERE t.date >= ?
         AND t.date <= ?
         AND t.duplicate_of_id IS NULL
         AND t.is_internal_transfer = 0
         AND t.amount < 0
         AND t.merchant IS NOT NULL
         AND TRIM(t.merchant) <> ''`,
      [sixMonthsAgo, today]
    )) ?? [];

  const txs: TxLite[] = rows.map(r => ({
    merchant: r.merchant ?? '',
    amount_ron: r.amount_ron ?? r.amount,
    date: r.date,
    category_id: r.category_id ?? undefined,
    category_name: r.category_name ?? undefined,
  }));

  return buildRecurringSeries(txs, today);
}
