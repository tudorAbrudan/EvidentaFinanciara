import { buildMessages, type PromptContext } from './aiChatPrompt';
import { appendMessage, recentPairs } from './aiChatRepo';
import { validateAndNormalizeSql } from './aiChatSqlGuard';
import { formatResponse, type CtxLookups } from './aiChatTemplates';
import { AiContextOverflowError, isAiLimitReached, sendAiRequest } from './aiProvider';
import { ChatResponseSchema, parseAiJsonResponse, type ChatResponseParsed } from './aiSchemas';
import { getCategories } from './categories';
import { db } from './db';
import { getFinancialAccounts } from './financialAccounts';

import type { ChatMessage } from '@/types';

const SQL_TIMEOUT_MS = 3000;
const MAX_HISTORY_PAIRS = 4;

export interface AskResult {
  user: ChatMessage;
  assistant: ChatMessage;
}

/**
 * Data locală, nu UTC: `toISOString()` ar da ziua precedentă seara (RO e UTC+2/+3),
 * ceea ce mută greșit „azi" și „luna asta" la granița de lună.
 */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Un singur load pentru ambele scopuri: catalogul trimis modelului în prompt și
 * lookup-urile folosite la formatarea răspunsului. Se încarcă înainte de
 * `buildMessages`, nu după rularea SQL-ului.
 */
async function loadCtx(): Promise<{ lookups: CtxLookups; prompt: PromptContext }> {
  const accs = await getFinancialAccounts(false);
  const cats = await getCategories(false);
  return {
    lookups: {
      accounts: new Map(accs.map(a => [a.id, { id: a.id, name: a.name, type: a.type }])),
      categories: new Map(cats.map(c => [c.id, { id: c.id, name: c.name }])),
    },
    prompt: {
      today: localToday(),
      accounts: accs.map(a => ({ id: a.id, name: a.name, currency: a.currency })),
      categories: cats.map(c => ({ id: c.id, name: c.name, key: c.key })),
    },
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

function parseAiResponse(text: string): ChatResponseParsed | null {
  const r = parseAiJsonResponse(text, ChatResponseSchema);
  return r.ok && r.data ? r.data : null;
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

  const ctx = await loadCtx();
  const history = await recentPairs(MAX_HISTORY_PAIRS);
  const messages = buildMessages(ctx.prompt, history, question);

  let aiText: string;
  let parsed: ChatResponseParsed | null = null;
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

  const formatted = formatResponse(parsed.template, rows, parsed.params, ctx.lookups);

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
