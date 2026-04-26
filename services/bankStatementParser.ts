/**
 * Parser pentru extrase bancare în format CSV.
 *
 * Suportă multiple formate uzuale (ING, BCR, BT, Raiffeisen, Revolut).
 * Folosește sniffing pe header pentru a detecta formatul; cade pe euristici
 * generice dacă header-ul nu e recunoscut.
 *
 * Output: tranzacții normalizate (sumă semnată, dată ISO YYYY-MM-DD,
 * descriere, merchant, categorie sugerată), folosibile direct în import flow.
 */

import type { CategoryKey } from '@/types';

export interface ParsedRow {
  date: string; // YYYY-MM-DD
  amount: number; // semnat: negativ = cheltuială
  currency: string;
  description?: string;
  merchant?: string;
  reference?: string;
  category_key?: CategoryKey; // sugestie din regex pe descriere
}

export interface ParseResult {
  rows: ParsedRow[];
  format: 'ing' | 'bcr' | 'bt' | 'raiffeisen' | 'revolut' | 'generic';
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-categorization keywords (Română + English)
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: { key: CategoryKey; patterns: RegExp[] }[] = [
  {
    key: 'food',
    patterns: [
      /\b(kaufland|lidl|carrefour|auchan|profi|mega image|penny|cora|metro|selgros)\b/i,
      /\b(restaurant|pizz|kfc|mcdonald|burger|cafenea|cofetarie|patiserie|gelaterie|food)\b/i,
      /\bglovo|tazz|food panda|bolt food\b/i,
    ],
  },
  {
    key: 'transport',
    patterns: [
      /\bbolt|uber|str ?taxi|cab\b/i,
      /\b(metrorex|stb|cfr|tramvai|tarom|wizz|ryanair|blue air)\b/i,
      /\b(rovinieta|vignette|toll)\b/i,
    ],
  },
  {
    key: 'vehicle',
    patterns: [
      /\b(omv|petrom|mol|rompetrol|lukoil|gazprom|shell)\b/i,
      /\b(carburant|benzin|motorin|diesel|fuel|station|tank)\b/i,
      /\b(service auto|auto service|atelier auto|vulcanizare)\b/i,
    ],
  },
  {
    key: 'utilities',
    patterns: [
      /\b(enel|e\.on|electrica|engie|gdf|distrigaz|hidroelectrica|apanova|raja)\b/i,
      /\b(orange|vodafone|digi|telekom|rcs)\b/i,
      /\b(factur[aă] curent|gaz|apa|salubrit|internet|tv cablu)\b/i,
    ],
  },
  {
    key: 'health',
    patterns: [
      /\b(farmacia|farmacie|catena|sensiblu|dr\.\s?max|help net)\b/i,
      /\b(spital|clinica|policlinica|medlife|regina maria|sanador|memorial|laborator|analize)\b/i,
      /\b(stomatolog|dentist|medic)\b/i,
    ],
  },
  {
    key: 'home',
    patterns: [
      /\b(dedeman|leroy|brico|hornbach|jumbo|ikea|home tech)\b/i,
      /\b(asociatie proprietari|intretinere|chirie|rent)\b/i,
    ],
  },
  {
    key: 'subscriptions',
    patterns: [
      /\b(netflix|spotify|hbo|disney|apple|icloud|google|youtube|amazon prime|microsoft|adobe|github|chatgpt|openai|anthropic|claude)\b/i,
      /\babonament\b/i,
    ],
  },
  {
    key: 'shopping',
    patterns: [
      /\b(emag|altex|mediagalaxy|flanco|fashion days|hm|h&m|zara|reserved|c&a|deichmann|sport vision|decathlon)\b/i,
      /\b(amazon|aliexpress|ebay|temu)\b/i,
    ],
  },
  {
    key: 'entertainment',
    patterns: [
      /\b(cineplex|happy cinema|imax|grand cinema)\b/i,
      /\b(steam|playstation|xbox|nintendo|epic games)\b/i,
    ],
  },
  {
    key: 'travel',
    patterns: [
      /\b(booking|airbnb|hotel|hostel|expedia)\b/i,
      /\b(blue air|tarom|wizzair|ryanair|lufthansa|emirates|turkish)\b/i,
    ],
  },
];

export function suggestCategory(description: string, merchant?: string): CategoryKey | undefined {
  const text = `${merchant ?? ''} ${description}`.toLowerCase();
  for (const { key, patterns } of CATEGORY_KEYWORDS) {
    for (const re of patterns) {
      if (re.test(text)) return key;
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV tokenizer (handles quoted fields with commas)
// ─────────────────────────────────────────────────────────────────────────────

export function parseCsvLine(line: string, separator = ','): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === separator) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

function detectSeparator(headerLine: string): ',' | ';' | '\t' {
  const counts = {
    ',': (headerLine.match(/,/g) ?? []).length,
    ';': (headerLine.match(/;/g) ?? []).length,
    '\t': (headerLine.match(/\t/g) ?? []).length,
  };
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

// ─────────────────────────────────────────────────────────────────────────────
// Date / amount normalization
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeDate(s: string): string | null {
  const trimmed = s.trim();
  // ISO YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // YYYY/MM/DD
  m = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  m = trimmed.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // DD.MM.YY
  m = trimmed.match(/^(\d{2})[./-](\d{2})[./-](\d{2})$/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
    return `${yyyy}-${m[2]}-${m[1]}`;
  }
  return null;
}

export function normalizeAmount(s: string): number | null {
  if (!s) return null;
  let cleaned = s.replace(/[^\d,.\- ]/g, '').trim();
  if (!cleaned) return null;
  // RO style: 1.234,56 → 1234.56
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // 1234,56 → 1234.56
    cleaned = cleaned.replace(/\s/g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/\s/g, '');
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main parse function (auto-detects format)
// ─────────────────────────────────────────────────────────────────────────────

export function parseBankStatementCsv(input: string, defaultCurrency = 'RON'): ParseResult {
  // Strip BOM
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], format: 'generic', warnings: ['Fișier CSV gol sau fără conținut.'] };
  }

  const sep = detectSeparator(lines[0]);
  const header = parseCsvLine(lines[0], sep).map(h => h.toLowerCase());

  const format = detectFormat(header);
  const idx = mapColumns(header, format);
  const warnings: string[] = [];

  if (idx.date < 0) {
    warnings.push('Coloana de dată nu a fost găsită; verifică header-ul CSV.');
  }
  if (idx.amount < 0 && (idx.debit < 0 || idx.credit < 0)) {
    warnings.push('Coloana de sumă nu a fost găsită.');
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], sep);
    const row = parseRow(cells, idx, defaultCurrency);
    if (row) rows.push(row);
    else warnings.push(`Linia ${i + 1}: tranzacție invalidă, săritura.`);
  }

  return { rows, format, warnings };
}

function detectFormat(header: string[]): ParseResult['format'] {
  const joined = header.join(' ');
  if (/started date|completed date|orig\. amount/i.test(joined)) return 'revolut';
  if (/data tranzactie.*data valuta.*beneficiar/i.test(joined)) return 'bt';
  if (/data inreg|sume in cont|sume out cont/i.test(joined)) return 'bcr';
  if (/data tranzac[tț]ie.*sum[aă]/i.test(joined) && /referin[tț]/i.test(joined)) return 'ing';
  if (/booking date.*value date.*amount/i.test(joined)) return 'raiffeisen';
  return 'generic';
}

interface ColumnMap {
  date: number;
  amount: number;
  currency: number;
  description: number;
  merchant: number;
  debit: number;
  credit: number;
  reference: number;
}

function findColumn(header: string[], patterns: RegExp[]): number {
  for (const re of patterns) {
    const idx = header.findIndex(h => re.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

function mapColumns(header: string[], format: ParseResult['format']): ColumnMap {
  const date = findColumn(header, [
    /^date$|^data$|tranzac[tț]ie|completed date|booking date|posting date|data inreg/i,
  ]);
  const amount = findColumn(header, [/^amount$|^sum[aă]$|^suma$|^valoare$/i]);
  const debit = findColumn(header, [/debit|sume out cont|out|cheltui/i]);
  const credit = findColumn(header, [/credit|sume in cont|^in$|incasari/i]);
  const currency = findColumn(header, [/^currency$|^moned[aă]$|valuta/i]);
  const description = findColumn(header, [
    /descriere|description|details|detalii|reason|narrative|explica/i,
  ]);
  const merchant = findColumn(header, [/beneficiar|merchant|partener|payee|counter/i]);
  const reference = findColumn(header, [/referin[tț]|reference|^ref$|^id$/i]);
  return {
    date,
    amount,
    debit,
    credit,
    currency,
    description,
    merchant,
    reference,
    // some formats reuse columns
    ...(format === 'revolut' && {
      // Revolut split debit/credit not used; "Amount" is signed already.
    }),
  };
}

function parseRow(cells: string[], idx: ColumnMap, defaultCurrency: string): ParsedRow | null {
  const dateStr = idx.date >= 0 ? cells[idx.date] : '';
  const date = normalizeDate(dateStr ?? '');
  if (!date) return null;

  let amount: number | null = null;
  if (idx.amount >= 0) {
    amount = normalizeAmount(cells[idx.amount] ?? '');
  } else if (idx.debit >= 0 || idx.credit >= 0) {
    const dr = idx.debit >= 0 ? normalizeAmount(cells[idx.debit] ?? '') : 0;
    const cr = idx.credit >= 0 ? normalizeAmount(cells[idx.credit] ?? '') : 0;
    if ((cr ?? 0) > 0) amount = cr;
    else if ((dr ?? 0) > 0) amount = -(dr ?? 0);
    else amount = 0;
  }
  if (amount === null) return null;

  const currency = (idx.currency >= 0 ? cells[idx.currency] : '') || defaultCurrency;
  const description = idx.description >= 0 ? cells[idx.description] : '';
  const merchant = idx.merchant >= 0 ? cells[idx.merchant] : '';
  const reference = idx.reference >= 0 ? cells[idx.reference] : '';

  const cleanDesc = (description || '').trim();
  const cleanMerchant = (merchant || '').trim();
  const category_key = suggestCategory(cleanDesc, cleanMerchant);

  return {
    date,
    amount,
    currency: currency.trim().toUpperCase() || defaultCurrency,
    description: cleanDesc || undefined,
    merchant: cleanMerchant || undefined,
    reference: reference?.trim() || undefined,
    category_key,
  };
}
