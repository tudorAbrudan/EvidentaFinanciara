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
import { normalizeDate, normalizeAmount, suggestCategory, type ParsedRow } from './bankStatementParser';
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
      "merchant": "..."
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
- "merchant" e numele furnizorului/comerciantului dacă apare clar; altfel omite-l.`;

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

interface AiRow {
  date?: string;
  amount?: number | string;
  currency?: string;
  description?: string;
  merchant?: string;
}

function parseResponse(response: string, defaultCurrency: string): ParsedRow[] {
  // Extragem JSON-ul (în caz că modelul a adăugat text înainte/după)
  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  if (start < 0 || end < start) return [];
  const jsonStr = response.slice(start, end + 1);

  let parsed: { rows?: AiRow[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  if (!parsed.rows || !Array.isArray(parsed.rows)) return [];

  const rows: ParsedRow[] = [];
  for (const r of parsed.rows) {
    if (!r.date || r.amount === undefined) continue;
    const isoDate = normalizeDate(String(r.date));
    if (!isoDate) continue;
    const amount =
      typeof r.amount === 'number' ? r.amount : normalizeAmount(String(r.amount));
    if (amount === null || !Number.isFinite(amount)) continue;
    const currency = r.currency?.toUpperCase() || defaultCurrency;
    const description = r.description?.trim() || undefined;
    const merchant = r.merchant?.trim() || undefined;
    const category_key = suggestCategory(description ?? '', merchant);
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

// ─── Mapper public ───────────────────────────────────────────────────────────

export async function mapStatementWithAi(
  ocrText: string,
  defaultCurrency = 'RON'
): Promise<PdfParseResult> {
  const messages = buildPrompt(ocrText, defaultCurrency);
  const response = await sendAiRequest(messages, MAX_TOKENS);
  const rows = parseResponse(response, defaultCurrency);
  const warnings: string[] =
    rows.length === 0
      ? ['AI-ul nu a returnat tranzacții valide. Verifică textul OCR sau reîncearcă.']
      : [];
  return { rows, format: rows.length > 0 ? 'generic' : 'unknown', warnings };
}
