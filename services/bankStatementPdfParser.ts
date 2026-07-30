/**
 * Parser pentru extrase bancare în format PDF.
 *
 * Pipeline: text (text layer sau OCR) → detectare format → parser dedicat (BT)
 * sau generic. Refolosește `normalizeDate`, `normalizeAmount`, `suggestCategory`
 * din `bankStatementParser`. Output identic cu parser-ul CSV (`ParsedRow[]`).
 *
 * Parserul BT se auto-verifică: extrasul conține propriile totaluri de control
 * (`RULAJ ZI`, `RULAJ TOTAL CONT`), deci putem raporta la ban dacă rândurile
 * extrase se potrivesc cu ce spune banca — și exact ce zi nu se potrivește.
 */

import {
  applyDirectionHint,
  normalizeDate,
  normalizeAmount,
  suggestCategory,
  type ParsedRow,
  // Extensia explicită e necesară ca `scripts/parse-real-pdf.ts` să poată
  // importa parserul direct în Node (ESM), fără bundler.
} from './bankStatementParser.ts';

export type PdfStatementFormat = 'bt' | 'generic' | 'unknown';

export interface ReconciliationDay {
  date: string;
  /** Debit/credit așa cum le declară rândul `RULAJ ZI` din extras. */
  expectedDebit: number;
  expectedCredit: number;
  /** Debit/credit calculate din tranzacțiile extrase de parser. */
  actualDebit: number;
  actualCredit: number;
  ok: boolean;
}

export interface ReconciliationTotals {
  expectedDebit: number;
  expectedCredit: number;
  actualDebit: number;
  actualCredit: number;
  ok: boolean;
}

export interface PdfReconciliation {
  days: ReconciliationDay[];
  totals: ReconciliationTotals;
  /** Câte tranzacții a extras parserul. */
  transactionCount: number;
  /** Câte linii `REF:` are extrasul — trebuie să fie egal cu `transactionCount`. */
  refCount: number;
}

export interface PdfParseResult {
  rows: ParsedRow[];
  format: PdfStatementFormat;
  warnings: string[];
  reconciliation?: PdfReconciliation;
}

/** Extrasul e verificat matematic: fiecare zi și totalul bat la ban. */
export function isFullyReconciled(rec: PdfReconciliation | undefined): boolean {
  if (!rec) return false;
  return (
    rec.totals.ok &&
    rec.days.length > 0 &&
    rec.days.every(d => d.ok) &&
    rec.transactionCount === rec.refCount
  );
}

/** Formatare RO a unei sume: `97423.94` → `97.423,94`. */
export function formatAmountRo(value: number): string {
  const [int, dec] = Math.abs(value).toFixed(2).split('.');
  let grouped = '';
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) grouped += '.';
    grouped += int[i];
  }
  return `${value < 0 ? '-' : ''}${grouped},${dec}`;
}

// ─── Detectare format ─────────────────────────────────────────────────────────

const BT_HEADERS = [
  /banca\s+transilvania/i,
  /\bbt\s*(?:24|express|mobile)\b/i,
  /extras\s+(?:de\s+)?cont.*\bbt\b/i,
];

const DATE_LINE_RE = /\b(\d{2}[./-]\d{2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const AMOUNT_HINT_RE = /[+-]?\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2}/;

export function detectStatementFormat(text: string): PdfStatementFormat {
  const head = text.slice(0, 2000);
  if (BT_HEADERS.some(re => re.test(head))) return 'bt';

  // Format generic: măcar 3 linii cu pattern dată+sumă
  const lines = text.split(/\r?\n/);
  let hits = 0;
  for (const ln of lines) {
    if (DATE_LINE_RE.test(ln) && AMOUNT_HINT_RE.test(ln)) {
      hits++;
      if (hits >= 3) return 'generic';
    }
  }
  return 'unknown';
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseStatementPdf(text: string, defaultCurrency = 'RON'): PdfParseResult {
  const format = detectStatementFormat(text);
  if (format === 'bt') return parseBt(text, defaultCurrency);
  if (format === 'generic') return parseGeneric(text, defaultCurrency);
  return {
    rows: [],
    format: 'unknown',
    warnings: ['Formatul extrasului PDF nu a fost recunoscut.'],
  };
}

// ─── Parser BT — clasificare de linii ─────────────────────────────────────────

/** Oprim parsarea aici: după aceste linii urmează doar sumar și disclaimer. */
const STOP_RE = /^(SUME BLOCATE|TOTAL DISPONIBIL|Acest extras de cont)/i;

/**
 * Header/footer de pagină, repetate la fiecare pagină. Le sărim fără să
 * închidem blocul curent — o tranzacție poate fi ruptă exact peste ele.
 */
const PAGE_CHROME = [
  /^BANCA TRANSILVANIA/i,
  /^Info clienti:/i,
  /apelabil din orice retea/i,
  /^inclusiv international$/i,
  /^Solicitant:/i,
  /^Tiparit:/i,
  /^Clasificare BT/i,
  /C\.U\.I\.\s*\d|SWIFT:\s*BTRLRO22|www\.bancatransilvania\.ro/i,
  /^\d+\s*\/\s*\d+$/,
];

/** Capul de tabel, care poate veni pe o linie sau spart pe coloane. */
const TABLE_HEADER_CELLS = ['data', 'descriere', 'debit', 'credit'];

function isPageChrome(line: string): boolean {
  if (PAGE_CHROME.some(re => re.test(line))) return true;
  const cells = line.toLowerCase().split(/\s+/);
  return cells.every(c => TABLE_HEADER_CELLS.includes(c));
}

/** Linie care conține doar o sumă (coloana Debit sau Credit). */
const AMOUNT_LINE_RE = /^\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/;
const DATE_PREFIX_RE = /^(\d{2}[./]\d{2}[./]\d{4})\b\s*(.*)$/;
const REF_LINE_RE = /^REF:\s*(\S+)/;

type SummaryMarker = 'rulaj-zi' | 'sold-zi' | 'rulaj-total' | 'sold-total' | 'sold-anterior';

const SUMMARY_MARKERS: { re: RegExp; marker: SummaryMarker; amounts: number }[] = [
  { re: /^RULAJ\s+ZI\b/i, marker: 'rulaj-zi', amounts: 2 },
  { re: /^SOLD\s+FINAL\s+ZI\b/i, marker: 'sold-zi', amounts: 1 },
  { re: /^RULAJ\s+TOTAL\s+CONT\b/i, marker: 'rulaj-total', amounts: 2 },
  { re: /^SOLD\s+FINAL\s+CONT\b/i, marker: 'sold-total', amounts: 1 },
  { re: /^SOLD\s+ANTERIOR\b/i, marker: 'sold-anterior', amounts: 1 },
];

type Direction = 'debit' | 'credit' | 'unknown';

interface BtTransaction {
  date: string;
  /** Sumă absolută; semnul se decide la reconciliere. */
  amount: number;
  /** Prima linie a blocului — tipul operațiunii, baza lexiconului de semn. */
  opType: string;
  description: string;
  reference: string;
  direction: Direction;
}

interface OpenBlock {
  descLines: string[];
  amount: number | null;
  reference: string | null;
}

interface BtHeader {
  holder: string;
  currency: string;
  iban: string;
}

// ─── Parser BT ────────────────────────────────────────────────────────────────

/**
 * Layout BT (extras PDF): data apare o dată pe zi (header de zi), urmată de
 * mai multe tranzacții. Fiecare tranzacție e un bloc de linii: tipul
 * operațiunii, descrierea pe 2–4 linii, `REF:` și suma pe linia ei. Ordinea
 * `REF` / sumă variază (la granițe de pagină suma vine prima), deci blocul se
 * închide când are ambele și începe altceva.
 *
 * Semnul nu e o informație textuală în extras (debit vs credit sunt coloane),
 * așa că îl deducem în două trepte: lexicon pe tipul operațiunii, apoi
 * reconciliere pe zi cu `RULAJ ZI`.
 */
function parseBt(text: string, defaultCurrency: string): PdfParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  const header = extractHeader(lines, defaultCurrency);

  const transactions: BtTransaction[] = [];
  const dayTotals = new Map<string, { debit: number; credit: number }>();
  const dayOrder: string[] = [];
  let accountTotals: { debit: number; credit: number } | null = null;
  let refCount = 0;

  let currentDate: string | null = null;
  let block: OpenBlock | null = null;
  let summary: { marker: SummaryMarker; needed: number; values: number[] } | null = null;

  const closeBlock = () => {
    const b = block;
    block = null;
    if (!b) return;
    if (b.amount === null || b.reference === null) {
      // Blocurile fără nici sumă nici referință sunt text de header — le ignorăm.
      if (b.amount !== null || b.reference !== null) {
        warnings.push(
          `Bloc de tranzacție incomplet (${b.reference ?? 'fără REF'}) — a fost ignorat.`
        );
      }
      return;
    }
    if (!currentDate) {
      warnings.push(`Tranzacția ${b.reference} nu are dată asociată — a fost ignorată.`);
      return;
    }
    const description = b.descLines
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    transactions.push({
      date: currentDate,
      amount: b.amount,
      opType: b.descLines[0] ?? '',
      description,
      reference: b.reference,
      direction: classifyDirection(description, header),
    });
  };

  const dropSummary = () => {
    if (summary && summary.values.length < summary.needed) {
      warnings.push('Un rând de sumar din extras nu are toate sumele — nu a fost folosit.');
    }
    summary = null;
  };

  const applySummary = (marker: SummaryMarker, values: number[]) => {
    if (marker === 'rulaj-zi' && currentDate) {
      if (!dayTotals.has(currentDate)) dayOrder.push(currentDate);
      dayTotals.set(currentDate, { debit: values[0], credit: values[1] });
    } else if (marker === 'rulaj-total') {
      accountTotals = { debit: values[0], credit: values[1] };
    }
    // `SOLD FINAL ZI` / `SOLD FINAL CONT` / `SOLD ANTERIOR`: consumate ca să nu
    // rămână sume orfane, dar nu intră în reconciliere.
  };

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    if (STOP_RE.test(line)) break;
    if (isPageChrome(line)) continue;

    const dateMatch = DATE_PREFIX_RE.exec(line);
    if (dateMatch) {
      const iso = normalizeDate(dateMatch[1]);
      if (iso) {
        dropSummary();
        closeBlock();
        currentDate = iso;
      }
      line = dateMatch[2].trim();
      if (!line) continue;
    }

    const marker = SUMMARY_MARKERS.find(m => m.re.test(line));
    if (marker) {
      dropSummary();
      closeBlock();
      summary = { marker: marker.marker, needed: marker.amounts, values: [] };
      continue;
    }

    if (AMOUNT_LINE_RE.test(line)) {
      const value = normalizeAmount(line);
      if (value === null) continue;

      if (summary) {
        summary.values.push(value);
        if (summary.values.length >= summary.needed) {
          applySummary(summary.marker, summary.values);
          summary = null;
        }
        continue;
      }
      if (!block || (block.amount !== null && block.reference === null)) {
        warnings.push(`Sumă fără tranzacție asociată: ${formatAmountRo(value)}.`);
        continue;
      }
      if (block.amount !== null) closeBlock();
      if (!block) block = { descLines: [], amount: null, reference: null };
      block.amount = value;
      continue;
    }

    const refMatch = REF_LINE_RE.exec(line);
    if (refMatch) {
      dropSummary();
      refCount++;
      if (block?.reference != null && block.amount !== null) closeBlock();
      if (!block) block = { descLines: [], amount: null, reference: null };
      if (block.reference == null) block.reference = refMatch[1];
      else warnings.push(`Referință duplicată în același bloc: ${refMatch[1]}.`);
      continue;
    }

    // Linie de descriere
    dropSummary();
    if (block && block.amount !== null && block.reference !== null) closeBlock();
    if (!block) block = { descLines: [], amount: null, reference: null };
    block.descLines.push(line);
  }
  dropSummary();
  closeBlock();

  const reconciliation = reconcile(
    transactions,
    dayOrder,
    dayTotals,
    accountTotals,
    refCount,
    warnings
  );

  const rows: ParsedRow[] = transactions.map(t => {
    const amount = t.direction === 'credit' ? t.amount : -t.amount;
    const merchant = extractMerchant(t.opType, t.description);
    const row: ParsedRow = {
      date: t.date,
      amount,
      currency: header.currency,
      description: t.description || undefined,
      merchant,
      reference: t.reference,
      category_key: suggestCategory(t.description, merchant),
    };
    // Rândurile rămase ambigue după reconciliere primesc euristica de semn
    // folosită de restul importului — mai bine decât o presupunere tăcută.
    return t.direction === 'unknown' ? applyDirectionHint(row) : row;
  });

  if (rows.length === 0) {
    warnings.push(
      'Niciun rând nu a fost extras din extrasul BT — verifică documentul sau folosește fallback AI.'
    );
  }

  return { rows, format: 'bt', warnings, reconciliation };
}

// ─── Header extras ────────────────────────────────────────────────────────────

function extractHeader(lines: string[], defaultCurrency: string): BtHeader {
  let holder = '';
  let currency = defaultCurrency;
  let iban = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!holder && /^Client:/i.test(line) && i > 0) {
      holder = lines[i - 1].trim();
    }
    const cur = /\bCONT\s+\d{3}([A-Z]{3})CRT/.exec(line);
    if (cur) currency = cur[1];
    const ib = /^Cod IBAN:\s*(\S+)/i.exec(line);
    if (ib) iban = ib[1];
  }

  return { holder, currency, iban };
}

// ─── Treapta 1: lexicon determinist pe tipul operațiunii ──────────────────────

const DEBIT_OPS = /^(Plata|Comision|Rambursare|Dob[aâ]nda|Retragere|Nota contabila)/i;
const CREDIT_OPS = /^Incasare/i;
const FROM_SAVINGS = /\b(?:din|de la)\s+economii\b/i;
const TO_SAVINGS = /\b(?:catre|c[ăa]tre|la|spre|in|[îi]n)\s+(?:contul\s+de\s+)?economii\b/i;
const OPEN_DEPOSIT = /\bconstituire\s+(?:cont|depozit)/i;
const P2P_RECIPIENT = /\bcatre\s+([^;]+?)\s+reprezentand\b/i;
const DEBITED_ACCOUNT = /\bCont\s+debitat:\s*([A-Z0-9]+)/i;
const CREDITED_ACCOUNT = /\bCont\s+creditat:\s*([A-Z0-9]+)/i;

/**
 * Deduce direcția din tipul operațiunii. Întoarce `unknown` când textul nu e
 * neechivoc — reconcilierea pe zi decide atunci, nu o presupunere.
 */
function classifyDirection(description: string, header: BtHeader): Direction {
  if (/^Transfer intern/i.test(description)) {
    if (FROM_SAVINGS.test(description)) return 'credit';
    if (TO_SAVINGS.test(description) || OPEN_DEPOSIT.test(description)) return 'debit';
    return 'unknown';
  }

  if (/^P2P\b/i.test(description)) {
    const recipient = P2P_RECIPIENT.exec(description);
    if (!recipient || !header.holder) return 'unknown';
    return sameName(recipient[1], header.holder) ? 'credit' : 'debit';
  }

  if (/^Schimb valutar/i.test(description)) {
    const debited = DEBITED_ACCOUNT.exec(description);
    if (debited) return sameIban(debited[1], header.iban) ? 'debit' : 'credit';
    const credited = CREDITED_ACCOUNT.exec(description);
    if (credited) return sameIban(credited[1], header.iban) ? 'credit' : 'debit';
    return 'unknown';
  }

  if (DEBIT_OPS.test(description)) return 'debit';
  if (CREDIT_OPS.test(description)) return 'credit';
  return 'unknown';
}

function nameTokens(s: string): string[] {
  return s
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(t => t.length > 1);
}

/** Compară nume ignorând spații multiple, cratime și ordinea prenumelor. */
function sameName(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || ta.length !== tb.length) return false;
  return [...ta].sort().join(' ') === [...tb].sort().join(' ');
}

function sameIban(a: string, b: string): boolean {
  return b.length > 0 && a.replace(/\W/g, '').toUpperCase() === b.replace(/\W/g, '').toUpperCase();
}

// ─── Treapta 2: reconciliere pe zi ────────────────────────────────────────────

const CENT = (v: number) => Math.round(v * 100);
/** Toleranță de un ban — extrasul și parserul lucrează pe aceleași zecimale. */
const TOLERANCE = 1;
/** Peste atâtea tranzacții ambigue într-o zi renunțăm la căutarea prin forță brută. */
const MAX_AMBIGUOUS = 10;

function reconcile(
  transactions: BtTransaction[],
  dayOrder: string[],
  dayTotals: Map<string, { debit: number; credit: number }>,
  accountTotals: { debit: number; credit: number } | null,
  refCount: number,
  warnings: string[]
): PdfReconciliation {
  const byDate = new Map<string, BtTransaction[]>();
  for (const t of transactions) {
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }

  const dates = [...dayOrder];
  for (const date of byDate.keys()) if (!dates.includes(date)) dates.push(date);
  dates.sort();

  const days: ReconciliationDay[] = [];
  for (const date of dates) {
    const txs = byDate.get(date) ?? [];
    const expected = dayTotals.get(date);
    if (!expected) {
      warnings.push(`Ziua ${date} nu are rând „RULAJ ZI" — nu poate fi verificată.`);
    } else {
      resolveDay(txs, CENT(expected.debit), CENT(expected.credit));
    }
    const actual = sumDirections(txs);
    const ok =
      expected !== undefined &&
      Math.abs(CENT(actual.debit) - CENT(expected.debit)) <= TOLERANCE &&
      Math.abs(CENT(actual.credit) - CENT(expected.credit)) <= TOLERANCE;
    if (expected && !ok) {
      warnings.push(
        `Ziua ${date} nu se reconciliază: extras ${formatAmountRo(expected.debit)} / ` +
          `${formatAmountRo(expected.credit)}, calculat ${formatAmountRo(actual.debit)} / ` +
          `${formatAmountRo(actual.credit)}.`
      );
    }
    days.push({
      date,
      expectedDebit: expected?.debit ?? 0,
      expectedCredit: expected?.credit ?? 0,
      actualDebit: actual.debit,
      actualCredit: actual.credit,
      ok,
    });
  }

  const actualTotals = sumDirections(transactions);
  const totalsOk =
    accountTotals !== null &&
    Math.abs(CENT(actualTotals.debit) - CENT(accountTotals.debit)) <= TOLERANCE &&
    Math.abs(CENT(actualTotals.credit) - CENT(accountTotals.credit)) <= TOLERANCE;
  if (accountTotals === null) {
    warnings.push('Extrasul nu conține „RULAJ TOTAL CONT" — totalurile nu pot fi verificate.');
  } else if (!totalsOk) {
    warnings.push(
      `Totalurile nu se reconciliază: extras ${formatAmountRo(accountTotals.debit)} / ` +
        `${formatAmountRo(accountTotals.credit)}, calculat ${formatAmountRo(actualTotals.debit)} / ` +
        `${formatAmountRo(actualTotals.credit)}.`
    );
  }
  if (refCount !== transactions.length) {
    warnings.push(
      `Extrasul are ${refCount} referințe de tranzacție, dar au fost extrase ${transactions.length}.`
    );
  }

  return {
    days,
    totals: {
      expectedDebit: accountTotals?.debit ?? 0,
      expectedCredit: accountTotals?.credit ?? 0,
      actualDebit: actualTotals.debit,
      actualCredit: actualTotals.credit,
      ok: totalsOk,
    },
    transactionCount: transactions.length,
    refCount,
  };
}

function sumDirections(txs: BtTransaction[]): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const t of txs) {
    if (t.direction === 'credit') credit += t.amount;
    else debit += t.amount;
  }
  return { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 };
}

/**
 * Caută atribuirea de semne care reconciliază ziua. Aplicăm doar dacă soluția e
 * unică — două soluții înseamnă că nu știm, iar o cifră plauzibilă-dar-greșită e
 * mai rea decât una declarată nesigură.
 */
function resolveDay(txs: BtTransaction[], expectedDebit: number, expectedCredit: number): void {
  const ambiguous = txs.filter(t => t.direction === 'unknown');
  if (ambiguous.length === 0 || ambiguous.length > MAX_AMBIGUOUS) return;

  let knownDebit = 0;
  let knownCredit = 0;
  for (const t of txs) {
    if (t.direction === 'debit') knownDebit += CENT(t.amount);
    else if (t.direction === 'credit') knownCredit += CENT(t.amount);
  }

  const cents = ambiguous.map(t => CENT(t.amount));
  let solution: number | null = null;
  let solutions = 0;
  for (let mask = 0; mask < 1 << ambiguous.length; mask++) {
    let debit = knownDebit;
    let credit = knownCredit;
    for (let i = 0; i < cents.length; i++) {
      if (mask & (1 << i)) credit += cents[i];
      else debit += cents[i];
    }
    if (
      Math.abs(debit - expectedDebit) <= TOLERANCE &&
      Math.abs(credit - expectedCredit) <= TOLERANCE
    ) {
      solutions++;
      if (solutions > 1) return;
      solution = mask;
    }
  }
  if (solution === null) return;
  for (let i = 0; i < ambiguous.length; i++) {
    ambiguous[i].direction = solution & (1 << i) ? 'credit' : 'debit';
  }
}

// ─── Merchant ─────────────────────────────────────────────────────────────────

const TID_RE = /\bTID:?\s*(\S+)\s+(.*)$/i;
const MERCHANT_STOP = /;|\bvaloare\s+(?:tranzactie|trz)\b|\bRRN:?|\d{6,}/i;

/**
 * Euristică de merchant: contrapartea pentru transferuri, numele comerciantului
 * de după codul TID pentru POS, altfel primul segment util din descriere.
 *
 * `opType` (prima linie a blocului) e exclus din varianta de fallback — altfel
 * merchant-ul ar fi „Transfer intern - canal" în loc de „Transfer din economii".
 */
function extractMerchant(opType: string, description: string): string | undefined {
  const recipient = P2P_RECIPIENT.exec(description);
  if (recipient) return firstWords(recipient[1], 4);

  const tid = TID_RE.exec(description);
  if (tid) {
    const merchant = firstWords(tid[2].split(MERCHANT_STOP)[0], 4);
    if (merchant) return merchant;
  }

  const rest = description.startsWith(opType) ? description.slice(opType.length) : description;
  for (const segment of rest.split(';')) {
    const s = segment.trim();
    if (s.length >= 3 && /[A-Za-z]{3}/.test(s) && !/^REF/i.test(s)) return firstWords(s, 4);
  }
  return undefined;
}

function firstWords(text: string, max: number): string | undefined {
  const words = text
    // Numele rupte de sfârșitul de linie („ABRUDAN TUDOR-" + „VASILE") se lipesc
    // la loc; cratima cu spațiu de ambele părți („intern - canal") rămâne.
    .replace(/(\S)-\s+/g, '$1-')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .slice(0, max);
  return words.length > 0 ? words.join(' ') : undefined;
}

// ─── Parser generic ──────────────────────────────────────────────────────────

/**
 * Parser euristic pentru orice extras PDF: orice linie cu o dată + o sumă
 * cu format zecimal e considerată o tranzacție.
 *
 * Avertisment: poate genera fals pozitive (ex. linii de sumar). UI-ul afișează
 * warning-ul de fiabilitate redusă.
 */
function parseGeneric(text: string, defaultCurrency: string): PdfParseResult {
  const warnings: string[] = [
    'Format generic — fiabilitate redusă. Verifică tranzacțiile înainte de import.',
  ];
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);

  for (const ln of lines) {
    if (!ln.trim()) continue;
    // Sărim explicit peste linii de sumar
    if (/\b(sold\s+(?:initial|final)|total\s+(?:debite|credite|rulaj|tranzac))/i.test(ln)) continue;

    const dateMatch = ln.match(/\b(\d{2}[./-]\d{2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
    if (!dateMatch) continue;
    const isoDate = normalizeDate(dateMatch[1]);
    if (!isoDate) continue;

    const row = extractTransaction(isoDate, ln, defaultCurrency);
    if (row) rows.push(row);
  }

  if (rows.length === 0) {
    warnings.push('Niciun rând nu a fost extras — folosește fallback AI.');
  }

  return { rows, format: 'generic', warnings };
}

function detectCurrency(line: string, fallback: string): string {
  const m = line.match(/\b(RON|EUR|USD|GBP|CHF|HUF|PLN|JPY|MDL|TRY|BGN)\b/i);
  if (m) return m[1].toUpperCase();
  return fallback;
}

function extractTransaction(
  isoDate: string,
  fullText: string,
  defaultCurrency: string
): ParsedRow | null {
  // Eliminăm datele înainte de căutarea sumelor — altfel `01.03.2026` se confundă
  // cu o sumă (matchează ca `01.03` = 1.03 în regex-ul de amount).
  const textForAmounts = fullText
    .replace(/\b\d{2}[./-]\d{2}[./-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');

  const amountRe = /([+-]?\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2})/g;
  const matches: { value: number; index: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = amountRe.exec(textForAmounts)) !== null) {
    const val = normalizeAmount(m[1]);
    if (val !== null) matches.push({ value: val, index: m.index, raw: m[1] });
  }

  if (matches.length === 0) return null;

  // Prima sumă e de obicei tranzacția (debit sau credit); ultima e soldul.
  let txAmount = matches[0].value;

  if (!/[+-]/.test(matches[0].raw)) {
    const debitKw = /\b(plata|cumparare|comision|retragere|debit|trimis|achit|tax[aă]|abon)/i;
    const creditKw = /\b(incasare|virament\s+intern|salariu|credit|primit|deposit|alimentare)/i;
    if (debitKw.test(fullText) && txAmount > 0) txAmount = -txAmount;
    else if (creditKw.test(fullText) && txAmount < 0) txAmount = Math.abs(txAmount);
  }

  let description = fullText
    .replace(matches[0].raw, ' ')
    .replace(/\b\d{2}[./-]\d{2}[./-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(RON|EUR|USD|GBP|CHF|HUF|PLN|JPY|MDL|TRY|BGN)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  for (let i = 1; i < matches.length; i++) {
    description = description
      .replace(matches[i].raw, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const merchantWords = description
    .split(/\s+/)
    .filter(w => w.length > 2 && !/^\d+$/.test(w))
    .slice(0, 3);
  const merchant = merchantWords.length > 0 ? merchantWords.join(' ') : undefined;

  return {
    date: isoDate,
    amount: txAmount,
    currency: detectCurrency(fullText, defaultCurrency),
    description: description || undefined,
    merchant,
    category_key: suggestCategory(description, merchant),
  };
}
