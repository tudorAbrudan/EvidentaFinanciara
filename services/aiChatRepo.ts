import { db, generateId } from './db';

import type { ChatErrorKind, ChatMessage, ChatRole, ChatTemplate, EvidenceItem } from '@/types';

interface Row {
  id: string;
  role: string;
  content: string;
  template: string | null;
  sql_used: string | null;
  evidence_json: string | null;
  explanation_short: string | null;
  error_kind: string | null;
  created_at: string;
}

function mapRow(r: Row): ChatMessage {
  return {
    id: r.id,
    role: r.role as ChatRole,
    content: r.content,
    template: (r.template ?? undefined) as ChatTemplate | undefined,
    sqlUsed: r.sql_used ?? undefined,
    evidence: r.evidence_json ? (JSON.parse(r.evidence_json) as EvidenceItem[]) : undefined,
    explanationShort: r.explanation_short ?? undefined,
    errorKind: (r.error_kind ?? undefined) as ChatErrorKind | undefined,
    createdAt: r.created_at,
  };
}

export async function appendMessage(
  input: Omit<ChatMessage, 'id' | 'createdAt'>
): Promise<ChatMessage> {
  const id = generateId();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO chat_messages
       (id, role, content, template, sql_used, evidence_json, explanation_short, error_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.role,
      input.content,
      input.template ?? null,
      input.sqlUsed ?? null,
      input.evidence ? JSON.stringify(input.evidence) : null,
      input.explanationShort ?? null,
      input.errorKind ?? null,
      createdAt,
    ]
  );
  return { id, createdAt, ...input };
}

export async function listMessages(limit?: number): Promise<ChatMessage[]> {
  const limitSql = limit ? `LIMIT ${Math.max(1, limit | 0)}` : '';
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM chat_messages ORDER BY created_at ASC ${limitSql}`
  );
  return rows.map(mapRow);
}

export async function clearAll(): Promise<void> {
  await db.runAsync('DELETE FROM chat_messages');
}

export interface ChatPair {
  user: ChatMessage;
  assistant: ChatMessage;
}

export async function recentPairs(n: number): Promise<ChatPair[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ${Math.max(1, (n * 2 + 10) | 0)}`
  );
  const msgs = rows.map(mapRow);
  const pairs: ChatPair[] = [];
  for (let i = 0; i < msgs.length - 1 && pairs.length < n; i++) {
    const a = msgs[i];
    const u = msgs[i + 1];
    if (a.role === 'assistant' && u.role === 'user') {
      pairs.push({ user: u, assistant: a });
      i++;
    }
  }
  return pairs;
}
