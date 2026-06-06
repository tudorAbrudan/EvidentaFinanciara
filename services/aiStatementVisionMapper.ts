/**
 * AI Statement Vision Mapper
 *
 * Trimite PDF-ul unui extras bancar direct la vision AI (multi-image) și
 * returnează tranzacțiile structurate. Spre deosebire de `aiStatementMapper.ts`
 * (care folosește textul OCR), acest mapper trimite paginile randate ca imagini
 * → AI-ul vede structura originală (tabele, header-e, totaluri) și nu mai
 * confundă subtotaluri cu tranzacții.
 *
 * Disponibil DOAR pentru provider `external` (cheie API proprie). Pentru
 * `builtin` / `local` / `none` rămâne fluxul `aiStatementMapper` (text OCR).
 *
 * Strategia multi-pagini:
 * 1. Toate paginile într-o singură cerere (AI vede contextul complet → evită dublarea totalurilor).
 * 2. Dacă serverul răspunde cu `AiContextOverflowError`, split în chunks de
 *    `CHUNK_SIZE` pagini, apel secvențial, merge cu deduplicare.
 *
 * Privacy: extrasul nu conține `private_notes` (acel câmp e doar pe `Document`).
 */

import { sendAiRequestWithImage, AiContextOverflowError, getAiConfig } from './aiProvider';
import {
  parseAiJsonResponse,
  StatementResponseSchema,
  isCategoryKey,
  CATEGORY_KEY_VALUES,
} from './aiSchemas';
import {
  normalizeDate,
  normalizeAmount,
  suggestCategory,
  type ParsedRow,
} from './bankStatementParser';
import type { PdfParseResult } from './bankStatementPdfParser';
import { renderAllPdfPagesAsBase64 } from './pdfOcr';

const MAX_TOKENS = 4000;
const CHUNK_SIZE = 3;

export interface VisionProgressEvent {
  stage: 'rendering' | 'sending' | 'sending-chunked';
  current?: number;
  total?: number;
}

export type VisionProgressCallback = (event: VisionProgressEvent) => void;

// ─── Prompt builder ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ești un asistent care extrage tranzacții dintr-un extras bancar furnizat ca imagini (pagini PDF randate).
Returnezi DOAR JSON valid, fără text suplimentar, fără markdown, fără explicații.
Schema:
{
  "rows": [
    {
      "date": "YYYY-MM-DD",
      "amount": -123.45,
      "currency": "RON",
      "description": "...",
      "merchant": "...",
      "category": "food"
    }
  ]
}
Reguli:
- "amount" e SEMNAT: negativ pentru cheltuieli (debit), pozitiv pentru venituri (credit).
- Folosește punct zecimal pentru sume (123.45, nu 123,45).
- Data în format ISO YYYY-MM-DD.
- Nu inventa tranzacții. Dacă o linie e ambiguă, omite-o.
- IMPORTANT: NU include solduri inițiale, solduri finale, totale (sume „Total debit", „Total credit", „Sold"), comisioane lunare de extras, dobânzi calculate sau orice agregat — doar tranzacțiile individuale efective.
- "merchant" e numele furnizorului/comerciantului dacă apare clar; altfel omite-l.
- "category" e categoria tranzacției, OBLIGATORIU una din lista exactă: ${CATEGORY_KEY_VALUES.join(', ')}. Alege pe baza comerciantului/descrierii (ex. LIDL/MEGAIMAGE → food, OMV/MOL → vehicle, EON/ELECTRICA/DIGI → utilities, farmacie/clinică → health, Netflix/Apple → subscriptions, eMAG/olx → shopping). Dacă nu ești sigur, omite "category".
- Dacă primești mai multe pagini ale aceluiași extras, returnează tranzacțiile din TOATE paginile, fără să le repeți.`;

function buildUserText(defaultCurrency: string, isChunk: boolean): string {
  const base = `Extrage tranzacțiile din imaginile atașate (extras bancar). Currency implicit: "${defaultCurrency}". Returnează DOAR JSON-ul cu schema cerută.`;
  if (isChunk) {
    return `${base}\nNotă: aceasta este o secțiune dintr-un extras mai mare; returnează doar tranzacțiile vizibile pe paginile de aici.`;
  }
  return base;
}

// ─── Parsare răspuns ─────────────────────────────────────────────────────────

export function parseResponse(response: string, defaultCurrency: string): ParsedRow[] {
  const result = parseAiJsonResponse(response, StatementResponseSchema);
  if (!result.ok || !result.data) return [];

  const rows: ParsedRow[] = [];
  for (const r of result.data.rows) {
    const isoDate = normalizeDate(String(r.date));
    if (!isoDate) continue;
    const amount = typeof r.amount === 'number' ? r.amount : normalizeAmount(String(r.amount));
    if (amount === null || !Number.isFinite(amount)) continue;
    const currency = r.currency?.toUpperCase() || defaultCurrency;
    const description = r.description?.trim() || undefined;
    const merchant = r.merchant?.trim() || undefined;
    // Categoria AI dacă e validă, altfel fallback pe keyword-uri deterministe.
    const aiCategory = r.category?.trim().toLowerCase();
    const category_key = isCategoryKey(aiCategory)
      ? aiCategory
      : suggestCategory(description ?? '', merchant);
    rows.push({
      date: isoDate,
      amount,
      currency,
      description,
      merchant,
      category_key,
    });
  }
  return rows;
}

// Expus pentru snapshot tests + eval harness.
export { SYSTEM_PROMPT as VISION_SYSTEM_PROMPT, buildUserText as buildVisionUserText };

// ─── Deduplicare merge chunks ─────────────────────────────────────────────────

function dedupKey(r: ParsedRow): string {
  const desc = (r.description ?? r.merchant ?? '').slice(0, 40).toLowerCase();
  return `${r.date}|${r.amount.toFixed(2)}|${desc}`;
}

function mergeRows(chunks: ParsedRow[][]): ParsedRow[] {
  const seen = new Set<string>();
  const out: ParsedRow[] = [];
  for (const chunk of chunks) {
    for (const row of chunk) {
      const key = dedupKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

// ─── Single-shot vs chunked ──────────────────────────────────────────────────

async function singleShot(images: string[], defaultCurrency: string): Promise<ParsedRow[]> {
  const response = await sendAiRequestWithImage(
    SYSTEM_PROMPT,
    buildUserText(defaultCurrency, false),
    images,
    'image/jpeg',
    MAX_TOKENS
  );
  return parseResponse(response, defaultCurrency);
}

async function chunkedShots(
  images: string[],
  defaultCurrency: string,
  onProgress?: VisionProgressCallback
): Promise<ParsedRow[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < images.length; i += CHUNK_SIZE) {
    chunks.push(images.slice(i, i + CHUNK_SIZE));
  }

  const results: ParsedRow[][] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ stage: 'sending-chunked', current: i + 1, total: chunks.length });
    const response = await sendAiRequestWithImage(
      SYSTEM_PROMPT,
      buildUserText(defaultCurrency, true),
      chunks[i],
      'image/jpeg',
      MAX_TOKENS
    );
    results.push(parseResponse(response, defaultCurrency));
  }

  return mergeRows(results);
}

// ─── Mapper public ───────────────────────────────────────────────────────────

/**
 * Trimite un extras bancar PDF direct la vision AI și returnează tranzacțiile.
 * Necesită provider `external` — verificarea e responsabilitatea apelantului.
 */
export async function mapStatementWithVisionAi(
  pdfUri: string,
  defaultCurrency = 'RON',
  onProgress?: VisionProgressCallback
): Promise<PdfParseResult> {
  // Hard guard: nu permitem fluxul vision pe alt provider decât `external`.
  // (Builtin protejează cota de 20/zi; local nu suportă vision real.)
  const config = await getAiConfig();
  if (config.type !== 'external') {
    throw new Error(
      'Trimiterea directă a extrasului la AI este disponibilă doar cu cheie API proprie. Configurează una din Setări → Asistent AI sau folosește „Re-analizează cu AI" pe text OCR.'
    );
  }

  onProgress?.({ stage: 'rendering' });
  const images = await renderAllPdfPagesAsBase64(pdfUri);
  if (images.length === 0) {
    return {
      rows: [],
      format: 'unknown',
      warnings: ['Nu s-au putut randa paginile PDF pentru analiza vision.'],
    };
  }

  let rows: ParsedRow[];
  try {
    onProgress?.({ stage: 'sending', total: images.length });
    rows = await singleShot(images, defaultCurrency);
  } catch (e) {
    if (e instanceof AiContextOverflowError) {
      rows = await chunkedShots(images, defaultCurrency, onProgress);
    } else {
      throw e;
    }
  }

  const warnings: string[] =
    rows.length === 0
      ? ['AI vision nu a returnat tranzacții valide. Verifică PDF-ul sau încearcă fluxul OCR + AI.']
      : ['Extras analizat direct cu AI vision — verifică tranzacțiile cu atenție.'];

  return {
    rows,
    format: rows.length > 0 ? 'generic' : 'unknown',
    warnings,
  };
}
