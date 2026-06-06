/**
 * AI Statement Mapper
 *
 * Trimite textul OCR al unui extras bancar la AI și returnează tranzacțiile
 * structurate ca JSON. Pattern identic cu `aiOcrMapper.ts`:
 * - Sanitizare anti-prompt-injection.
 * - Limită text 15000 caractere.
 * - Prompt minimal cu schema JSON cerută.
 * - Fără date sensibile suplimentare (nu există `private_notes` pe `transactions`).
 */

import { sendAiRequest, type AiMessage } from './aiProvider';
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

const MAX_OCR_CHARS = 15000;
const MAX_TOKENS = 4000; // răspunsul JSON poate fi lung pentru extras lunar complet

// ─── Sanitizare ──────────────────────────────────────────────────────────────

function sanitizeOcrText(text: string): string {
  return text
    .slice(0, MAX_OCR_CHARS)
    .replace(/"""/g, "'''")
    .replace(/```/g, '~~~')
    .replace(/<\|/g, '< |')
    .replace(/\[INST\]/gi, '[inst]')
    .replace(/\[\/INST\]/gi, '[/inst]');
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(ocrText: string, defaultCurrency: string): AiMessage[] {
  const sanitized = sanitizeOcrText(ocrText);

  const system = `Ești un asistent care extrage tranzacții dintr-un extras bancar (text OCR în română).
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
- Currency implicit "${defaultCurrency}" dacă nu e specificat în text.
- Nu inventa tranzacții. Dacă o linie e ambiguă, omite-o.
- Nu include solduri, totaluri, dobânzi sau comisioane de extras (doar tranzacțiile reale).
- "merchant" e numele furnizorului/comerciantului dacă apare clar; altfel omite-l.
- "category" e categoria tranzacției, OBLIGATORIU una din lista exactă: ${CATEGORY_KEY_VALUES.join(', ')}. Alege pe baza comerciantului/descrierii (ex. LIDL/MEGAIMAGE/restaurant → food, OMV/MOL → vehicle, EON/ELECTRICA/DIGI → utilities, farmacie/clinică → health, Netflix/Apple → subscriptions, eMAG/olx → shopping). Dacă nu ești sigur, omite "category".`;

  const user = `Text OCR extras bancar:
---
${sanitized}
---

Returnează DOAR JSON-ul cu tranzacțiile.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─── Parse răspuns AI ────────────────────────────────────────────────────────

export interface ParseStats {
  total: number; // câte rânduri a returnat AI-ul
  accepted: number; // câte au trecut prin normalize
  rejected: number; // câte au fost respinse (date invalidă, sumă NaN etc.)
  schemaError?: string; // dacă JSON-ul în sine e invalid
}

export interface MapperParseOutput {
  rows: ParsedRow[];
  stats: ParseStats;
}

export function parseResponse(response: string, defaultCurrency: string): MapperParseOutput {
  const result = parseAiJsonResponse(response, StatementResponseSchema);
  if (!result.ok || !result.data) {
    return {
      rows: [],
      stats: {
        total: 0,
        accepted: 0,
        rejected: 0,
        schemaError: `${result.error?.kind}: ${result.error?.message}${result.error?.path ? ` (la ${result.error.path})` : ''}`,
      },
    };
  }

  const rawRows = result.data.rows;
  const rows: ParsedRow[] = [];
  let rejected = 0;

  for (const r of rawRows) {
    const isoDate = normalizeDate(String(r.date));
    if (!isoDate) {
      rejected++;
      continue;
    }
    const amount = typeof r.amount === 'number' ? r.amount : normalizeAmount(String(r.amount));
    if (amount === null || !Number.isFinite(amount)) {
      rejected++;
      continue;
    }
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

  return {
    rows,
    stats: {
      total: rawRows.length,
      accepted: rows.length,
      rejected,
    },
  };
}

// ─── Mapper public ───────────────────────────────────────────────────────────

export async function mapStatementWithAi(
  ocrText: string,
  defaultCurrency = 'RON'
): Promise<PdfParseResult> {
  const messages = buildPrompt(ocrText, defaultCurrency);
  const response = await sendAiRequest(messages, MAX_TOKENS);
  const { rows, stats } = parseResponse(response, defaultCurrency);
  const warnings: string[] = [];
  if (stats.schemaError) {
    warnings.push(`AI-ul a returnat răspuns invalid: ${stats.schemaError}. Reîncearcă.`);
  } else if (rows.length === 0) {
    warnings.push('AI-ul nu a returnat tranzacții valide. Verifică textul OCR sau reîncearcă.');
  } else if (stats.rejected > 0) {
    warnings.push(
      `${stats.rejected} ${stats.rejected === 1 ? 'tranzacție a fost respinsă' : 'tranzacții au fost respinse'} la validare (date sau sume invalide).`
    );
  }
  return { rows, format: rows.length > 0 ? 'generic' : 'unknown', warnings };
}

// Funcție utilitară pentru buildPrompt (testare snapshot + eval harness).
export { buildPrompt };
