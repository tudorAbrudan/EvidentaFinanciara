/**
 * „Categoria X e atipică luna asta" — pe mediană, nu pe medie.
 *
 * Motorul vechi (`insights.ts`) compară luna curentă cu **media** ultimelor 3
 * luni. O singură lună cu concediu strică media și produce semnale false luni
 * la rând. Aici baseline-ul e mediana, iar dispersia e MAD — amândouă nemișcate
 * de o valoare extremă.
 *
 * Rulează **doar pe luni închise și complete** (vezi `isMonthComplete` din
 * `statementCoverage`): pe date parțiale, orice comparație e o afirmație falsă.
 *
 * Modul pur: primește serii deja modelate, nu atinge DB.
 */
import { formatMonthLabel } from './statementCoverage';

/** Sub atâtea luni de istoric, mediana nu înseamnă nimic. */
const MIN_HISTORY_MONTHS = 4;

/** Constanta care face MAD comparabil cu deviația standard pe o distribuție normală. */
const MAD_SCALE = 1.4826;

/**
 * Podeaua dispersiei. O chirie fixă are MAD = 0; fără podea, 10 lei diferență
 * ar da un `z` infinit și un semnal absurd în fiecare lună.
 */
const DISPERSION_FLOOR_PCT = 0.15;
const DISPERSION_FLOOR_RON = 50;

const Z_THRESHOLD = 3;
const MIN_EXCESS_RON = 150;
const MIN_EXCESS_PCT = 0.3;

const SINGLE_LARGE_SHARE = 0.5;
const NEW_MERCHANT_SHARE = 0.5;
const MORE_FREQUENT_FACTOR = 1.5;
const HIGHER_TICKET_FACTOR = 1.3;

/** Cât de aproape de aceeași lună de anul trecut înseamnă „sezonier, nu anormal". */
const SEASONAL_TOLERANCE = 0.25;

export type AnomalyExplanation =
  | 'single_large'
  | 'new_merchant'
  | 'more_frequent'
  | 'higher_ticket'
  | 'unspecified';

export interface CategoryMonthPoint {
  yearMonth: string;
  /** Sumă absolută, pozitivă. */
  total_ron: number;
  transaction_count: number;
}

export interface AnomalyTx {
  id: string;
  /** Sumă absolută, pozitivă. */
  amount_ron: number;
  merchant: string | null;
}

export interface CategoryAnomalyInput {
  category_id: string | null;
  category_name: string;
  /** Luni complete, cronologic, FĂRĂ luna analizată. Cel mult 12. */
  history: CategoryMonthPoint[];
  current: CategoryMonthPoint;
  current_transactions: AnomalyTx[];
  /** Comercianții văzuți în istoric; orice altceva e „nou". */
  known_merchants: string[];
  /** Totalul aceleiași luni de anul trecut, dacă e cunoscut. */
  same_month_last_year_ron?: number | null;
}

export interface SpendingAnomaly {
  id: string;
  category_id: string | null;
  category_name: string;
  month: string;
  direction: 'up' | 'down';
  severity: 'warning' | 'positive' | 'neutral';
  explanation: AnomalyExplanation;
  current_ron: number;
  median_ron: number;
  /** `current − mediană`, cu semn. */
  excess_ron: number;
  z: number;
  message: string;
  evidence_tx_ids: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function normalizeMerchant(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function formatRon(value: number): string {
  const whole = Math.round(Math.abs(value)).toString();
  let grouped = '';
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += '.';
    grouped += whole[i];
  }
  return grouped;
}

interface Explanation {
  tag: AnomalyExplanation;
  detail: string;
  evidence: string[];
}

/**
 * Prima explicație care se potrivește, în ordinea din plan. Ordinea contează:
 * o plată unică mare explică mai bine decât „mai multe tranzacții", chiar dacă
 * amândouă sunt adevărate.
 */
function explain(input: CategoryAnomalyInput, excess: number): Explanation {
  const txs = input.current_transactions;

  const largest = [...txs].sort((a, b) => b.amount_ron - a.amount_ron)[0];
  if (largest !== undefined && largest.amount_ron >= excess * SINGLE_LARGE_SHARE) {
    const where = largest.merchant ? ` la ${largest.merchant}` : '';
    return {
      tag: 'single_large',
      detail: `O singură plată de ${formatRon(largest.amount_ron)} RON${where} explică diferența.`,
      evidence: [largest.id],
    };
  }

  const known = new Set(input.known_merchants.map(normalizeMerchant));
  const fresh = txs.filter(t => t.merchant !== null && !known.has(normalizeMerchant(t.merchant)));
  const freshTotal = fresh.reduce((sum, t) => sum + t.amount_ron, 0);
  if (fresh.length > 0 && freshTotal >= excess * NEW_MERCHANT_SHARE) {
    const names = [...new Set(fresh.map(t => t.merchant ?? ''))].slice(0, 3).join(', ');
    return {
      tag: 'new_merchant',
      detail: `Comercianți noi (${names}) explică ${formatRon(freshTotal)} RON din diferență.`,
      evidence: fresh.map(t => t.id),
    };
  }

  const medianCount = median(input.history.map(h => h.transaction_count));
  if (medianCount > 0 && input.current.transaction_count >= medianCount * MORE_FREQUENT_FACTOR) {
    return {
      tag: 'more_frequent',
      detail: `${input.current.transaction_count} tranzacții, față de ${Math.round(medianCount)} obișnuit.`,
      evidence: txs.map(t => t.id),
    };
  }

  const historicAverages = input.history
    .filter(h => h.transaction_count > 0)
    .map(h => h.total_ron / h.transaction_count);
  const medianAverage = median(historicAverages);
  const currentAverage =
    input.current.transaction_count > 0
      ? input.current.total_ron / input.current.transaction_count
      : 0;
  if (medianAverage > 0 && currentAverage >= medianAverage * HIGHER_TICKET_FACTOR) {
    return {
      tag: 'higher_ticket',
      detail: `Valoarea medie a crescut de la ${formatRon(medianAverage)} la ${formatRon(currentAverage)} RON.`,
      evidence: txs.map(t => t.id),
    };
  }

  return { tag: 'unspecified', detail: '', evidence: txs.map(t => t.id) };
}

/**
 * Anomalia unei categorii pe o lună, sau `null` dacă luna e în tipar.
 *
 * Cele două praguri lucrează împreună: `z` spune „e departe față de cât variază
 * de obicei", iar pragul absolut oprește semnalele pe categorii mărunte, unde
 * și 40 de lei par enormi statistic.
 */
export function detectCategoryAnomaly(input: CategoryAnomalyInput): SpendingAnomaly | null {
  if (input.history.length < MIN_HISTORY_MONTHS) return null;

  const totals = input.history.map(h => h.total_ron);
  const med = median(totals);
  const rawMad = median(totals.map(t => Math.abs(t - med)));
  const dispersion = Math.max(rawMad * MAD_SCALE, med * DISPERSION_FLOOR_PCT, DISPERSION_FLOOR_RON);

  const excess = input.current.total_ron - med;
  const z = excess / dispersion;
  if (Math.abs(z) < Z_THRESHOLD) return null;

  const minExcess = Math.max(MIN_EXCESS_RON, med * MIN_EXCESS_PCT);
  if (Math.abs(excess) < minExcess) return null;

  const direction = excess >= 0 ? 'up' : 'down';
  const monthLabel = formatMonthLabel(input.current.yearMonth);
  const head =
    `${input.category_name}: ${formatRon(input.current.total_ron)} RON în ${monthLabel}, ` +
    `față de ${formatRon(med)} RON obișnuit.`;

  const explanation =
    direction === 'up'
      ? explain(input, excess)
      : { tag: 'unspecified' as AnomalyExplanation, detail: '', evidence: [] };

  // Sezonalitatea nu anulează semnalul, îi scade tonul: cifra e reală, dar
  // „mare față de restul anului" și „mare față de aceeași lună de anul trecut"
  // sunt două afirmații diferite, iar userul o vrea pe a doua.
  const lastYear = input.same_month_last_year_ron;
  const seasonal =
    lastYear != null &&
    lastYear > 0 &&
    Math.abs(input.current.total_ron - lastYear) <= lastYear * SEASONAL_TOLERANCE;

  const severity: SpendingAnomaly['severity'] = seasonal
    ? 'neutral'
    : direction === 'up'
      ? 'warning'
      : 'positive';

  const parts = [head];
  if (explanation.detail !== '') parts.push(explanation.detail);
  if (seasonal) {
    const lastYearMonth = `${Number(input.current.yearMonth.slice(0, 4)) - 1}-${input.current.yearMonth.slice(5, 7)}`;
    parts.push(`Similar cu ${formatMonthLabel(lastYearMonth)} (${formatRon(lastYear)} RON).`);
  }

  return {
    id: `anomaly:${input.category_id ?? 'uncat'}:${input.current.yearMonth}`,
    category_id: input.category_id,
    category_name: input.category_name,
    month: input.current.yearMonth,
    direction,
    severity,
    explanation: explanation.tag,
    current_ron: Math.round(input.current.total_ron * 100) / 100,
    median_ron: Math.round(med * 100) / 100,
    excess_ron: Math.round(excess * 100) / 100,
    z: Math.round(z * 100) / 100,
    message: parts.join(' '),
    evidence_tx_ids: explanation.evidence,
  };
}

/**
 * Anomaliile lunii, sortate: creșterile înaintea scăderilor, apoi după cât de
 * mare e diferența. Scăderile sunt informative, nu acționabile — de aceea trec
 * după, cum cere planul.
 */
export function detectSpendingAnomalies(inputs: CategoryAnomalyInput[]): SpendingAnomaly[] {
  const found: SpendingAnomaly[] = [];
  for (const input of inputs) {
    const anomaly = detectCategoryAnomaly(input);
    if (anomaly !== null) found.push(anomaly);
  }
  return found.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'up' ? -1 : 1;
    return Math.abs(b.excess_ron) - Math.abs(a.excess_ron);
  });
}
