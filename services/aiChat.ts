import { z } from 'zod';

import { buildMessages } from './aiChatPrompt';
import { appendMessage, recentPairs } from './aiChatRepo';
import { validateAndNormalizeSql } from './aiChatSqlGuard';
import { formatResponse, type CtxLookups } from './aiChatTemplates';
import { AiContextOverflowError, isAiLimitReached, sendAiRequest } from './aiProvider';
import { getCategories } from './categories';
import { db } from './db';
import { getFinancialAccounts } from './financialAccounts';

import type { ChatMessage, ChatTemplate } from '@/types';

const TEMPLATES: ChatTemplate[] = [
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

const AiResponseSchema = z.object({
  sql: z.string().nullable(),
  template: z.enum(TEMPLATES as [ChatTemplate, ...ChatTemplate[]]),
  params: z.record(z.string(), z.unknown()).default({}),
  explanation_short: z.string(),
});

const SQL_TIMEOUT_MS = 3000;
const MAX_HISTORY_PAIRS = 4;

export interface AskResult {
  user: ChatMessage;
  assistant: ChatMessage;
}

async function loadCtx(): Promise<CtxLookups> {
  const accs = await getFinancialAccounts(false);
  const cats = await getCategories(false);
  return {
    accounts: new Map(accs.map(a => [a.id, { id: a.id, name: a.name, type: a.type }])),
    categories: new Map(cats.map(c => [c.id, { id: c.id, name: c.name }])),
  };
}

async function executeSqlReadOnly(sql: string): Promise<Record<string, unknown>[]> {
  await db.runAsync('PRAGMA query_only = 1');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      db.getAllAsync<Record<string, unknown>>(sql),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SQL timeout')), SQL_TIMEOUT_MS);
      }),
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    await db.runAsync('PRAGMA query_only = 0').catch(() => undefined);
  }
}

function parseAiResponse(text: string): z.infer<typeof AiResponseSchema> | null {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    const validated = AiResponseSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

export async function askAssistant(question: string): Promise<AskResult> {
  const userMsg = await appendMessage({ role: 'user', content: question });

  if (await isAiLimitReached()) {
    const assistant = await appendMessage({
      role: 'system_error',
      content:
        'Ai atins limita zilnică pentru AI. Configurează cheia proprie din Setări → Asistent AI.',
      errorKind: 'quota_exhausted',
    });
    return { user: userMsg, assistant };
  }

  const history = await recentPairs(MAX_HISTORY_PAIRS);
  const messages = buildMessages(history, question);

  let aiText: string;
  let parsed: z.infer<typeof AiResponseSchema> | null = null;
  let sqlGuardError: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      aiText = await sendAiRequest(
        attempt === 1
          ? messages
          : [
              ...messages,
              {
                role: 'user',
                content: `Răspunsul anterior nu e valid: ${sqlGuardError ?? 'JSON invalid'}. Reformulează strict ca JSON conform schemei.`,
              },
            ]
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Eroare AI necunoscută';
      const kind = e instanceof AiContextOverflowError ? 'context_overflow' : 'network';
      const assistant = await appendMessage({
        role: 'system_error',
        content:
          kind === 'context_overflow'
            ? 'Conversația e prea lungă; șterge-o din meniu.'
            : `Eroare conexiune: ${msg}`,
        errorKind: kind,
      });
      return { user: userMsg, assistant };
    }

    parsed = parseAiResponse(aiText);
    if (!parsed) {
      sqlGuardError = 'JSON invalid';
      continue;
    }

    if (parsed.template === 'cannot_answer') {
      break;
    }

    if (parsed.sql) {
      const guard = validateAndNormalizeSql(parsed.sql);
      if (!guard.ok) {
        sqlGuardError = guard.reason;
        parsed = null;
        continue;
      }
      parsed.sql = guard.sql;
    }
    break;
  }

  if (!parsed) {
    const assistant = await appendMessage({
      role: 'system_error',
      content: 'Nu pot răspunde la întrebare — reformulează sau încearcă altă variantă.',
      errorKind: 'invalid_sql',
    });
    return { user: userMsg, assistant };
  }

  let rows: Record<string, unknown>[] = [];
  if (parsed.sql) {
    try {
      rows = await executeSqlReadOnly(parsed.sql);
    } catch (e) {
      const assistant = await appendMessage({
        role: 'system_error',
        content:
          e instanceof Error && e.message === 'SQL timeout'
            ? 'Întrebarea durează prea mult; simplifică-o (ex. limitează perioada).'
            : 'Eroare la rularea query-ului. Reformulează întrebarea.',
        errorKind: 'invalid_sql',
      });
      return { user: userMsg, assistant };
    }
  }

  const ctx = await loadCtx();
  const formatted = formatResponse(parsed.template, rows, parsed.params, ctx);

  const assistant = await appendMessage({
    role: 'assistant',
    content: formatted.text,
    template: parsed.template,
    sqlUsed: parsed.sql ?? undefined,
    evidence: formatted.evidence,
    explanationShort: parsed.explanation_short,
  });

  return { user: userMsg, assistant };
}
