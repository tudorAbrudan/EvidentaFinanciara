/**
 * Scheme Zod centralizate pentru toate răspunsurile AI structurate.
 *
 * Beneficii vs parsing ad-hoc:
 *   - Validare tipuri strictă (un câmp `amount: "abc"` în loc de number → eroare clară).
 *   - Mesaje de eroare reutilizabile pentru telemetrie / debug.
 *   - Single source of truth: schema folosită și în mapper, și în eval harness.
 *
 * Toate funcțiile sunt pure (nu fac DB sau fetch); pot fi folosite din runner-i CLI.
 */

import { z } from 'zod';

import type { ChatTemplate } from '@/types';

const TEMPLATES: [ChatTemplate, ...ChatTemplate[]] = [
  'search_merchant',
  'top_merchants',
  'monthly_total',
  'category_evolution',
  'period_compare',
  'list_accounts',
  'list_categories',
  'raw_list',
  'cannot_answer',
];

// ─── Statement mapper (text OCR sau vision) ────────────────────────────────

export const StatementRowSchema = z.object({
  date: z.string(),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().optional(),
  description: z.string().optional(),
  merchant: z.string().optional(),
});

export const StatementResponseSchema = z.object({
  rows: z.array(StatementRowSchema),
});

export type StatementRowParsed = z.infer<typeof StatementRowSchema>;
export type StatementResponseParsed = z.infer<typeof StatementResponseSchema>;

// ─── Chat AI (SQL gen + template) ──────────────────────────────────────────

export const ChatResponseSchema = z.object({
  sql: z.string().nullable(),
  template: z.enum(TEMPLATES),
  params: z.record(z.string(), z.unknown()).default({}),
  explanation_short: z.string(),
});

export type ChatResponseParsed = z.infer<typeof ChatResponseSchema>;

// ─── Parsing helper ────────────────────────────────────────────────────────

export interface ParseResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    kind: 'no_json_found' | 'invalid_json' | 'schema_violation';
    message: string;
    /** Path-ul Zod la primul câmp invalid, dacă există (`rows.0.amount`). */
    path?: string;
  };
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/**
 * Tolerant parser pentru răspunsuri AI care uneori includ text înainte/după
 * JSON. Caută primul `{` și ultimul `}`, parsează și aplică schema.
 */
export function parseAiJsonResponse<T>(response: string, schema: z.ZodType<T>): ParseResult<T> {
  const cleaned = stripCodeFence(response);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) {
    return { ok: false, error: { kind: 'no_json_found', message: 'Nu am găsit JSON în răspuns.' } };
  }
  const jsonStr = cleaned.slice(start, end + 1);

  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'invalid_json',
        message: `JSON.parse a eșuat: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      error: {
        kind: 'schema_violation',
        message: first?.message ?? 'schema invalid',
        path: first?.path.join('.'),
      },
    };
  }
  return { ok: true, data: result.data };
}
