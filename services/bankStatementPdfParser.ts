/**
 * Parser pentru extrase bancare în format PDF.
 *
 * Pipeline: text OCR → detectare format → parser dedicat (BT) sau generic.
 * Format generic: regex pe linii cu pattern dată + sumă (cu/fără valută).
 * Refolosește `normalizeDate`, `normalizeAmount`, `suggestCategory` din `bankStatementParser`.
 *
 * Output identic cu parser-ul CSV (`ParsedRow[]`) — convergem pe același flux.
 */

import {
  normalizeDate,
  normalizeAmount,
  suggestCategory,
  type ParsedRow,
} from './bankStatementParser';

export type PdfStatementFormat = 'bt' | 'generic' | 'unknown';

export interface PdfParseResult {
  rows: ParsedRow[];
  format: PdfStatementFormat;
  warnings: string[];
}

// ─── Detectare format ─────────────────────────────────────────────────────────

const BT_HEADERS = [
  /banca\s+transilvania/i,
  /\bbt\s+(?:24|express|mobile)\b/i,
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

// ─── Helper: detectare valută în linie ────────────────────────────────────────

function detectCurrency(line: string, fallback: string): string {
  const m = line.match(/\b(RON|EUR|USD|GBP|CHF|HUF|PLN|JPY|MDL|TRY|BGN)\b/i);
  if (m) return m[1].toUpperCase();
  return fallback;
}

// ─── Parser BT ────────────────────────────────────────────────────────────────

/**
 * Layout BT (extras lunar PDF): liniile cu tranzacții au formatul aproximativ:
 *   DD.MM.YYYY   <descriere lungă>   [+/-]X.XXX,XX [RON]   sold după
 *
 * OCR-ul poate sparge o tranzacție pe 2-3 linii (descrierea trece pe rând nou).
 * Strategia: căutăm linii care încep cu o dată (sau au o dată în primele 12 caractere)
 * și agregăm liniile non-dată următoare ca extensie a descrierii.
 *
 * Coloana „Valută" în BT poate să nu apară pe fiecare rând (presupus RON dacă lipsește).
 * Detectăm semnul: BT marchează cheltuielile cu „-" sau prin coloana „Debit".
 */
function parseBt(text: string, defaultCurrency: string): PdfParseResult {
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);

  // Identificăm secțiunea cu tranzacții — sărim peste header și sumar
  // Heuristic: începem după prima linie care conține „Data" sau „TRANZACTII"
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (
      /\b(data\s+(?:tranzac|valut)|tranzac[tț]ii\b|detalii\s+tranzac|miscari\s+(?:in\s+)?cont)/i.test(
        lines[i]
      )
    ) {
      startIdx = i + 1;
      break;
    }
  }

  type Pending = {
    date: string;
    descriptionParts: string[];
    rawLine: string;
  };

  let pending: Pending | null = null;

  const flush = () => {
    if (!pending) return;
    const fullText = `${pending.rawLine} ${pending.descriptionParts.join(' ')}`;
    const row = extractTransaction(pending.date, fullText, defaultCurrency);
    if (row) rows.push(row);
    pending = null;
  };

  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) continue;

    // Linie de sumar / total / sold final → ignorăm
    if (/\b(sold\s+(?:initial|final)|total\s+(?:debite|credite|rulaj))/i.test(ln)) {
      flush();
      continue;
    }

    const dateMatch = ln.match(/\b(\d{2}[./-]\d{2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch) {
      flush();
      const isoDate = normalizeDate(dateMatch[1]);
      if (!isoDate) continue;
      pending = {
        date: isoDate,
        descriptionParts: [],
        rawLine: ln,
      };
    } else if (pending) {
      pending.descriptionParts.push(ln.trim());
    }
  }
  flush();

  if (rows.length === 0) {
    warnings.push('Niciun rând nu a fost extras din extrasul BT — verifică OCR-ul sau folosește fallback AI.');
  }

  return { rows, format: 'bt', warnings };
}

// ─── Extragere tranzacție dintr-o linie completă (dată deja parsată) ────────

function extractTransaction(
  isoDate: string,
  fullText: string,
  defaultCurrency: string
): ParsedRow | null {
  // Căutăm toate sumele candidate în text
  const amountRe = /([+-]?\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2})/g;
  const matches: { value: number; index: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = amountRe.exec(fullText)) !== null) {
    const val = normalizeAmount(m[1]);
    if (val !== null) matches.push({ value: val, index: m.index, raw: m[1] });
  }

  if (matches.length === 0) return null;

  // Heuristică: în extras BT layout-ul e „... [debit] [credit] [sold]"
  // Cea mai mică valoare (în modul) tinde să fie suma tranzacției,
  // cea mai mare e soldul. Dacă avem ≥2 sume, prima sumă (negativă sau pozitivă)
  // e tranzacția; ultima e soldul. Dacă avem 1 sumă, e tranzacția.
  let txAmount: number;
  if (matches.length === 1) {
    txAmount = matches[0].value;
  } else {
    // Prima sumă este de obicei tranzacția (debit sau credit)
    txAmount = matches[0].value;
  }

  // Dacă suma nu are semn explicit, încercăm să detectăm din context
  if (!/[+-]/.test(matches[0].raw)) {
    // Cuvinte cheie pentru cheltuieli (debit)
    const debitKw = /\b(plata|cumparare|comision|retragere|debit|trimis|achit|tax[aă]|abon)/i;
    const creditKw = /\b(incasare|virament\s+intern|salariu|credit|primit|deposit|alimentare)/i;
    if (debitKw.test(fullText) && txAmount > 0) txAmount = -txAmount;
    else if (creditKw.test(fullText) && txAmount < 0) txAmount = Math.abs(txAmount);
    // Altfel păstrăm semnul originar
  }

  // Curățăm descrierea: scoatem suma și data
  let description = fullText
    .replace(matches[0].raw, ' ')
    .replace(/\b\d{2}[./-]\d{2}[./-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(RON|EUR|USD|GBP|CHF|HUF|PLN|JPY|MDL|TRY|BGN)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Eliminăm și restul sumelor (sold, etc.)
  for (let i = 1; i < matches.length; i++) {
    description = description.replace(matches[i].raw, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  // Heuristic merchant: primele 2-3 cuvinte semnificative după curățire
  const merchantWords = description
    .split(/\s+/)
    .filter(w => w.length > 2 && !/^\d+$/.test(w))
    .slice(0, 3);
  const merchant = merchantWords.length > 0 ? merchantWords.join(' ') : undefined;

  const currency = detectCurrency(fullText, defaultCurrency);
  const category_key = suggestCategory(description, merchant);

  return {
    date: isoDate,
    amount: txAmount,
    currency,
    description: description || undefined,
    merchant,
    category_key,
  };
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
