/**
 * Acoperirea cu extrase, per cont — „n-ai încărcat extrasul pentru contul X".
 *
 * În fluxul real al userului nu există tranzacții introduse manual: tot ce știe
 * aplicația vine din extrasele importate la final de lună. Un extras care
 * lipsește nu e o formalitate, ci o lună în care cifrele afișate sunt pur și
 * simplu false. De aceea acoperirea e poarta prin care trec analizele de lună
 * (`isMonthComplete`), nu doar un mesaj de atenționare.
 *
 * Modul pur: fără DB, fără AsyncStorage. Primește conturile, extrasele și ziua
 * de azi; întoarce ce lipsește.
 */
import { getAllBankStatements } from './bankStatements';
import { getFinancialAccounts } from './financialAccounts';
import { getCoverageMutedAccounts } from './settings';

import type { BankStatement, FinancialAccount } from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un interval dedus din tranzacții (`inferred`) care acoperă cel puțin atâtea
 * zile dintr-o lună se citește ca luna întreagă. Un extras pe iunie a cărui
 * primă tranzacție e pe 3 și ultima pe 28 e un extras pe iunie, nu un gol de
 * două zile la fiecare capăt.
 */
const INFERRED_MONTH_MIN_DAYS = 20;

/** Sub atâtea zile, un gol e zgomot (sărbători, un extras tăiat cu o zi). */
const MIN_PARTIAL_GAP_DAYS = 3;

/** O lună neacoperită în proporția asta se raportează ca lună lipsă, nu ca gol. */
const MISSING_MONTH_RATIO = 0.5;

/** Două intervale se lipesc dacă între ele rămâne cel mult o zi. */
const MAX_JOIN_GAP_DAYS = 1;

const MONTHS = [
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie',
];

export interface CoverageGap {
  /** Prima zi neacoperită, YYYY-MM-DD. */
  from: string;
  /** Ultima zi neacoperită, YYYY-MM-DD. */
  to: string;
  days: number;
  message: string;
}

export interface AccountCoverage {
  account_id: string;
  account_name: string;
  /** Luni (YYYY-MM) neacoperite în proporție de cel puțin 50%. */
  missing_months: string[];
  /** Goluri mai scurte, de cel puțin 3 zile, în luni altfel acoperite. */
  partial_gaps: CoverageGap[];
  /** Ultima zi acoperită de extrase, indiferent de fereastra verificată. */
  last_covered_to: string | null;
  /**
   * Zile neacoperite per lună, doar pentru lunile din fereastra contului.
   * Prezența cheii spune că luna e așteptată de la contul ăsta; valoarea 0 că
   * e acoperită integral.
   */
  uncovered_days_by_month: Record<string, number>;
  /** Mesajele gata de afișat, lunile lipsă înaintea golurilor. */
  messages: string[];
}

export interface CoverageReport {
  accounts: AccountCoverage[];
  /** Ultima lună închisă la data dată (YYYY-MM); fereastra se oprește aici. */
  last_closed_month: string;
}

interface Interval {
  from: string;
  to: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Zile și luni, în UTC. Comparațiile se fac pe șiruri: YYYY-MM-DD se ordonează
// lexicografic exact ca temporal.
// ────────────────────────────────────────────────────────────────────────────

function dayMs(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getTime();
}

function toYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  return toYmd(dayMs(ymd) + days * DAY_MS);
}

/** Numărul de zile din intervalul închis [a, b]. */
function daysInclusive(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS) + 1;
}

function ymOf(ymd: string): string {
  return ymd.slice(0, 7);
}

function monthStart(ym: string): string {
  return `${ym}-01`;
}

function monthEnd(ym: string): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  // Ziua 0 a lunii următoare = ultima zi a lunii cerute.
  return toYmd(Date.UTC(year, month, 0));
}

function shiftMonth(ym: string, delta: number): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  let cursor = fromYm;
  while (cursor <= toYm) {
    out.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return out;
}

function monthName(ym: string): string {
  return MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
}

/** „2026-08" → „august 2026", pentru mesajele din ecrane. */
export function formatMonthLabel(ym: string): string {
  return `${monthName(ym)} ${ym.slice(0, 4)}`;
}

function dayOf(ymd: string): number {
  return Number(ymd.slice(8, 10));
}

// ────────────────────────────────────────────────────────────────────────────
// Intervale
// ────────────────────────────────────────────────────────────────────────────

/**
 * Intervalele acoperite de un extras.
 *
 * Perioada din antet se ia ca atare — e ce a tipărit banca. Cea dedusă din
 * tranzacții se lărgește la luna întreagă doar unde acoperă destul din ea;
 * altfel ar raporta un gol fals la începutul fiecărei luni.
 */
function intervalsOf(statement: BankStatement): Interval[] {
  const { period_from: from, period_to: to } = statement;
  if (!YMD_RE.test(from) || !YMD_RE.test(to) || to < from) return [];
  if (statement.period_source === 'header') return [{ from, to }];

  const out: Interval[] = [];
  for (const ym of monthsBetween(ymOf(from), ymOf(to))) {
    const segFrom = from > monthStart(ym) ? from : monthStart(ym);
    const segTo = to < monthEnd(ym) ? to : monthEnd(ym);
    if (daysInclusive(segFrom, segTo) >= INFERRED_MONTH_MIN_DAYS) {
      out.push({ from: monthStart(ym), to: monthEnd(ym) });
    } else {
      out.push({ from: segFrom, to: segTo });
    }
  }
  return out;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && iv.from <= addDays(last.to, MAX_JOIN_GAP_DAYS + 1)) {
      if (iv.to > last.to) last.to = iv.to;
      continue;
    }
    merged.push({ ...iv });
  }
  return merged;
}

/** Zilele din [windowFrom, windowTo] pe care intervalele nu le acoperă. */
function uncoveredRuns(covered: Interval[], windowFrom: string, windowTo: string): Interval[] {
  const runs: Interval[] = [];
  let cursor = windowFrom;
  for (const iv of covered) {
    if (iv.to < cursor) continue;
    if (iv.from > windowTo) break;
    if (iv.from > cursor) {
      runs.push({ from: cursor, to: addDays(iv.from, -1) });
    }
    cursor = addDays(iv.to, 1);
    if (cursor > windowTo) break;
  }
  if (cursor <= windowTo) runs.push({ from: cursor, to: windowTo });
  return runs.map(run => ({ from: run.from, to: run.to < windowTo ? run.to : windowTo }));
}

/** Taie un interval pe granițe de lună. */
function splitByMonth(interval: Interval): Interval[] {
  return monthsBetween(ymOf(interval.from), ymOf(interval.to)).map(ym => ({
    from: interval.from > monthStart(ym) ? interval.from : monthStart(ym),
    to: interval.to < monthEnd(ym) ? interval.to : monthEnd(ym),
  }));
}

/**
 * @param stopDay ziua în care se oprește extrasul dinaintea golului, dacă se
 *   oprește în aceeași lună; `null` dacă golul nu e coada unui extras.
 */
function gapMessage(gap: Interval, days: number, stopDay: number | null): string {
  const fromYm = ymOf(gap.from);
  const toYm = ymOf(gap.to);

  if (fromYm !== toYm) {
    return `Lipsesc ${dayOf(gap.from)} ${monthName(fromYm)} – ${dayOf(gap.to)} ${formatMonthLabel(toYm)} din extrase.`;
  }

  const range = days === 1 ? `${dayOf(gap.from)}` : `${dayOf(gap.from)}–${dayOf(gap.to)}`;
  if (stopDay !== null) {
    // Cazul exportului făcut înainte de sfârșitul lunii: extrasul se oprește pe
    // 28, extrasul lunii următoare începe pe 1, iar zilele dintre ele nu apar
    // în niciun extras — tranzacții pierdute, nu o formalitate.
    return `Extrasul din ${monthName(fromYm)} se oprește pe ${stopDay}; lipsesc ${range} ${monthName(fromYm)}. Re-exportă luna întreagă.`;
  }
  return `Lipsesc ${range} ${formatMonthLabel(fromYm)} din extrase.`;
}

// ────────────────────────────────────────────────────────────────────────────
// Raportul
// ────────────────────────────────────────────────────────────────────────────

function coverageForAccount(
  account: FinancialAccount,
  statements: BankStatement[],
  lastClosedMonth: string
): AccountCoverage | null {
  const covered = mergeIntervals(statements.flatMap(intervalsOf));
  const first = covered[0];
  const lastInterval = covered[covered.length - 1];
  if (first === undefined || lastInterval === undefined) return null;

  const base: AccountCoverage = {
    account_id: account.id,
    account_name: account.name,
    missing_months: [],
    partial_gaps: [],
    last_covered_to: lastInterval.to,
    uncovered_days_by_month: {},
    messages: [],
  };

  const windowFrom = first.from;
  const windowTo = monthEnd(lastClosedMonth);
  // Cont cu extrase doar în luna curentă: încă nu are nicio lună închisă de
  // verificat, deci nu avem ce-i reproșa.
  if (windowFrom > windowTo) return base;

  const runs = uncoveredRuns(covered, windowFrom, windowTo);

  const uncoveredByMonth: Record<string, number> = {};
  const expectedMonths = monthsBetween(ymOf(windowFrom), lastClosedMonth);
  for (const ym of expectedMonths) uncoveredByMonth[ym] = 0;
  for (const run of runs) {
    for (const seg of splitByMonth(run)) {
      const ym = ymOf(seg.from);
      uncoveredByMonth[ym] = (uncoveredByMonth[ym] ?? 0) + daysInclusive(seg.from, seg.to);
    }
  }

  const missingMonths: string[] = [];
  for (const ym of expectedMonths) {
    const expectedFrom = windowFrom > monthStart(ym) ? windowFrom : monthStart(ym);
    const expectedTo = windowTo < monthEnd(ym) ? windowTo : monthEnd(ym);
    const expectedDays = daysInclusive(expectedFrom, expectedTo);
    const uncovered = uncoveredByMonth[ym] ?? 0;
    if (expectedDays > 0 && uncovered / expectedDays >= MISSING_MONTH_RATIO) {
      missingMonths.push(ym);
    }
  }
  const missingSet = new Set(missingMonths);

  // Golurile parțiale sunt ce rămâne după ce scoatem lunile deja raportate ca
  // lipsă: altfel aceeași lipsă ar fi anunțată de două ori.
  const kept: Interval[] = [];
  for (const run of runs) {
    for (const seg of splitByMonth(run)) {
      if (missingSet.has(ymOf(seg.from))) continue;
      kept.push(seg);
    }
  }
  const partialGaps: CoverageGap[] = [];
  for (const seg of mergeIntervals(kept)) {
    const days = daysInclusive(seg.from, seg.to);
    if (days < MIN_PARTIAL_GAP_DAYS) continue;
    // Unde se oprește acoperirea dinaintea golului. Comparăm pe `to`, nu pe
    // `from`: intervalele lipite încep în luna precedentă (iulie+august devin
    // unul singur), iar o verificare pe `from` ar rata exact cazul pe care
    // mesajul îl descrie — extrasul exportat înainte de sfârșitul lunii.
    const stopsBefore = covered.filter(iv => iv.to < seg.from).pop();
    const stopDay =
      stopsBefore !== undefined && ymOf(stopsBefore.to) === ymOf(seg.from)
        ? dayOf(stopsBefore.to)
        : null;
    partialGaps.push({
      from: seg.from,
      to: seg.to,
      days,
      message: gapMessage(seg, days, stopDay),
    });
  }

  return {
    ...base,
    missing_months: missingMonths,
    partial_gaps: partialGaps,
    uncovered_days_by_month: uncoveredByMonth,
    messages: [
      ...missingMonths.map(ym => `Lipsește extrasul pe ${formatMonthLabel(ym)}.`),
      ...partialGaps.map(gap => gap.message),
    ],
  };
}

/** Ultima lună închisă la data dată. */
export function lastClosedMonthYM(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Golurile de acoperire, per cont.
 *
 * Sunt vizate conturile nearhivate, care nu sunt numerar, care au cel puțin un
 * extras importat vreodată și pentru care userul n-a spus explicit că nu
 * importă extrase. Un cont fără niciun extras nu e o omisiune, ci un cont ținut
 * altfel; primul import îl aduce în verificare.
 */
export function findCoverageGaps(
  accounts: FinancialAccount[],
  statements: BankStatement[],
  today: Date,
  mutedAccountIds: string[] = []
): CoverageReport {
  const lastClosedMonth = lastClosedMonthYM(today);
  const muted = new Set(mutedAccountIds);

  const byAccount = new Map<string, BankStatement[]>();
  for (const st of statements) {
    const list = byAccount.get(st.account_id);
    if (list === undefined) byAccount.set(st.account_id, [st]);
    else list.push(st);
  }

  const result: AccountCoverage[] = [];
  for (const account of accounts) {
    if (account.archived || account.type === 'cash' || muted.has(account.id)) continue;
    const own = byAccount.get(account.id);
    if (own === undefined || own.length === 0) continue;
    const coverage = coverageForAccount(account, own, lastClosedMonth);
    if (coverage !== null) result.push(coverage);
  }

  return { accounts: result, last_closed_month: lastClosedMonth };
}

/**
 * Poarta pentru analizele de lună (anomalii, sugestii, raport).
 *
 * O lună e completă doar dacă fiecare cont care o aștepta o acoperă integral.
 * Luna curentă nu e niciodată completă: extrasele ei n-au fost încă emise.
 * Fără niciun cont care s-o aștepte răspunsul e tot „nu" — n-avem pe ce baza
 * afirmații de tipul „ai cheltuit cu 40% mai puțin".
 */
export function isMonthComplete(report: CoverageReport, month: string): boolean {
  if (month > report.last_closed_month) return false;
  const relevant = report.accounts.filter(a => month in a.uncovered_days_by_month);
  if (relevant.length === 0) return false;
  return relevant.every(a => (a.uncovered_days_by_month[month] ?? 0) === 0);
}

export interface MonthAccountStatus {
  account_id: string;
  account_name: string;
  covered: boolean;
}

/**
 * Starea unei luni pe conturile care o așteptau.
 *
 * E ce se arată la finalul importului — „Luna august: ✓ BT RON · lipsește BT
 * EUR" — adică exact momentul în care userul mai are fișierele la îndemână și
 * poate importa următorul extras fără să se întoarcă altă dată.
 */
export function monthStatus(report: CoverageReport, month: string): MonthAccountStatus[] {
  return report.accounts
    .filter(a => month in a.uncovered_days_by_month)
    .map(a => ({
      account_id: a.account_id,
      account_name: a.account_name,
      covered: (a.uncovered_days_by_month[month] ?? 0) === 0,
    }));
}

/**
 * Propoziția care marchează o lună pe care nu ne putem baza, sau `null` dacă
 * luna e acoperită integral.
 *
 * Fără ea, aplicația afirmă „cheltuiești cu 40% mai puțin luna asta" pe o lună
 * căreia îi lipsește un extras — adică exact minciuna pe care datele parțiale o
 * produc singure. Un user fără niciun extras importat nu primește nimic: nu
 * ține evidența așa, deci n-are ce să-i lipsească.
 */
export function describeIncompleteMonth(report: CoverageReport, month: string): string | null {
  if (report.accounts.length === 0) return null;
  if (isMonthComplete(report, month)) return null;

  if (month > report.last_closed_month) {
    const label = formatMonthLabel(month);
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} nu s-a încheiat — cifrele se completează după importul extraselor.`;
  }

  const missing = report.accounts
    .filter(a => (a.uncovered_days_by_month[month] ?? 0) > 0)
    .map(a => a.account_name);
  if (missing.length === 0) {
    return `Cifrele pe ${formatMonthLabel(month)} sunt parțiale.`;
  }
  const list =
    missing.length === 1
      ? (missing[0] ?? '')
      : `${missing.slice(0, -1).join(', ')} și ${missing[missing.length - 1] ?? ''}`;
  return `Lipsește extrasul pentru ${list}. Cifrele pe ${formatMonthLabel(month)} sunt parțiale.`;
}

/**
 * Raportul de acoperire citit din baza de date.
 *
 * `today` e parametru, nu `new Date()` ascuns înăuntru: ecranele îl pot fixa în
 * teste, iar granița de lună închisă devine verificabilă.
 */
export async function loadCoverageReport(today: Date = new Date()): Promise<CoverageReport> {
  const [accounts, statements, muted] = await Promise.all([
    getFinancialAccounts(),
    getAllBankStatements(),
    getCoverageMutedAccounts(),
  ]);
  return findCoverageGaps(accounts, statements, today, muted);
}
