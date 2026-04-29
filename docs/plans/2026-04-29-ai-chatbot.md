# Asistent AI conversațional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab nou „Asistent" (înlocuiește slot-ul Setări din tab bar) cu chat conversațional peste DB local. AI generează SQL SELECT, app rulează read-only și formează răspunsul prin template-uri locale (zero halucinare numerică). Persistent în SQLite, multi-turn, evidence collapsible.

**Architecture:** 5 servicii pure noi în `services/` (`aiChat.ts`, `aiChatPrompt.ts`, `aiChatSqlGuard.ts`, `aiChatTemplates.ts`, `aiChatRepo.ts`), 2 componente UI (`ChatMessage.tsx`, `EvidenceList.tsx`), 1 ecran (`app/(tabs)/assistant.tsx`), tabel SQLite nou (`chat_messages`). Setări mutat din tab într-o rută Stack, accesibil prin icon ⚙️ în header Sumar.

**Tech Stack:** React Native + Expo (TypeScript), expo-sqlite, Expo Router, Jest. Dep nou: `zod` (validare runtime JSON-ul AI-ului).

**Spec referință:** `docs/specs/2026-04-29-ai-chatbot-design.md`

**Convenții repo:**

- Working dir pentru toate comenzile: `/Users/ax/work/finante/` (repo root).
- Path-urile din plan sunt relative la repo root.
- TS strict, fără `any`, texte UI în română.
- `useColorScheme` se importă **doar** din `@/components/useColorScheme`.
- `Colors` din `@/constants/Colors` (NOT `@/theme/colors`); `primary`/`statusColors` din `@/theme/colors`.
- `services/aiChat*` nu importă din `components/`, `app/`, `hooks/` (enforced de `dependency-cruiser`).
- Frecvent commits, după fiecare task. Husky rulează lint-staged + type-check pe pre-commit.
- `npm run check` final trebuie să treacă (lint + type + tests + knip + madge + dep-cruise + audit).

**Skills proiect aplicabile (citește înainte de implementare):**

- `.claude/skills/rn-expo-conventions/` — pentru fișierele UI (`app/`, `components/`).
- `.claude/skills/sqlite-migration/` — pentru `services/db.ts` și `services/manifestHash.ts`.
- `.claude/skills/ai-prompt-ro/` — pentru `aiChatPrompt.ts` și template-uri.

---

## Task 1: Adaugă dependența `zod`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Instalează zod**

```bash
cd /Users/ax/work/finante && npm install zod
```

Expected: `zod` apare la `dependencies` în `package.json`. Versiune minimă acceptată: `^3.23.0` (compat React Native).

- [ ] **Step 2: Verifică build OK**

```bash
cd /Users/ax/work/finante && npm run type-check
```

Expected: zero erori.

- [ ] **Step 3: Commit**

```bash
cd /Users/ax/work/finante && git add package.json package-lock.json && git commit -m "chore(deps): add zod pentru validare JSON AI"
```

---

## Task 2: Tabel `chat_messages` în SQLite + index

**Files:**

- Modify: `services/db.ts:12-99` (blocul `db.execSync`)
- Test: `__tests__/unit/db.test.ts` (creat dacă nu există)

- [ ] **Step 1: Adaugă schema în `services/db.ts`**

În `db.execSync(...)`, după linia cu `CREATE TABLE IF NOT EXISTS fx_rates` (~linia 87) și înainte de blocul de `CREATE INDEX`, adaugă:

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  template TEXT,
  sql_used TEXT,
  evidence_json TEXT,
  explanation_short TEXT,
  error_kind TEXT,
  created_at TEXT NOT NULL
);
```

În blocul de `CREATE INDEX` adaugă (după ultimul index existent):

```sql
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
```

- [ ] **Step 2: Rulează lint + type-check**

```bash
cd /Users/ax/work/finante && npm run lint && npm run type-check
```

Expected: zero erori.

- [ ] **Step 3: Verifică manifest hash**

Citește `services/manifestHash.ts`. Funcția `buildCanonicalManifest` operează pe orice obiect. Schema nouă va avea hash diferit la următorul `manifestHash` call. Nu e nevoie de cod nou aici — schema e enumerată live din `sqlite_master` în consumer-i. Dacă există vreun consumer care enumără tabelele (caut cu Grep `sqlite_master`), confirmă că noul tabel nu spargi backup-uri vechi.

```bash
cd /Users/ax/work/finante && grep -rn "sqlite_master\|chat_messages" services/ __tests__/
```

Expected: niciun crash în `services/backup.ts` sau alte locuri.

- [ ] **Step 4: Commit**

```bash
cd /Users/ax/work/finante && git add services/db.ts && git commit -m "feat(db): adaugă tabel chat_messages pentru istoric Asistent AI"
```

---

## Task 3: Tipuri partajate pentru chat (`ChatTemplate`, `EvidenceItem`, `ChatMessage`)

**Files:**

- Create: `types/chat.ts`
- Modify: `types/index.ts` (re-export — verifică dacă există)

- [ ] **Step 1: Citește forma `types/index.ts`**

```bash
cd /Users/ax/work/finante && cat types/index.ts | head -30
```

Confirmă că tipurile sunt centralizate aici (e patternul existent).

- [ ] **Step 2: Creează `types/chat.ts`**

```typescript
export type ChatTemplate =
  | 'search_merchant'
  | 'top_merchants'
  | 'monthly_total'
  | 'category_evolution'
  | 'period_compare'
  | 'list_accounts'
  | 'list_categories'
  | 'raw_list'
  | 'cannot_answer';

export type ChatRole = 'user' | 'assistant' | 'system_error';

export type ChatErrorKind =
  | 'invalid_sql'
  | 'quota_exhausted'
  | 'cannot_answer'
  | 'context_overflow'
  | 'network';

export type EvidenceItem =
  | {
      kind: 'transaction';
      id: string;
      date: string;
      amount: number;
      merchant: string;
      account: string;
      category?: string;
    }
  | { kind: 'account'; id: string; name: string; type: string }
  | { kind: 'category'; id: string; name: string; parent?: string }
  | { kind: 'aggregate'; label: string; period: string; total: number; count: number };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  template?: ChatTemplate;
  sqlUsed?: string;
  evidence?: EvidenceItem[];
  explanationShort?: string;
  errorKind?: ChatErrorKind;
  createdAt: string;
}
```

- [ ] **Step 3: Re-export din `types/index.ts`**

Adaugă la finalul `types/index.ts`:

```typescript
export * from './chat';
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/ax/work/finante && npm run type-check
```

Expected: zero erori.

- [ ] **Step 5: Commit**

```bash
cd /Users/ax/work/finante && git add types/ && git commit -m "feat(types): adaugă tipuri partajate pentru chat AI"
```

---

## Task 4: `services/aiChatRepo.ts` — CRUD pe `chat_messages`

**Files:**

- Create: `services/aiChatRepo.ts`
- Test: `__tests__/unit/aiChatRepo.test.ts`

- [ ] **Step 1: Scrie testul (failing)**

Creează `__tests__/unit/aiChatRepo.test.ts`:

```typescript
import { db } from '@/services/db';
import { appendMessage, listMessages, clearAll, recentPairs } from '@/services/aiChatRepo';

describe('aiChatRepo', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockClear();
    (db.getAllAsync as jest.Mock).mockClear();
  });

  it('appendMessage inserează cu id generat și createdAt ISO', async () => {
    (db.runAsync as jest.Mock).mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    const msg = await appendMessage({
      role: 'user',
      content: 'La ce bănci am cont?',
    });
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(msg.createdAt).toString()).not.toBe('Invalid Date');
    expect(msg.role).toBe('user');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO chat_messages'),
      expect.any(Array)
    );
  });

  it('appendMessage stringifică evidence', async () => {
    (db.runAsync as jest.Mock).mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    await appendMessage({
      role: 'assistant',
      content: 'Ai 3 conturi.',
      template: 'list_accounts',
      evidence: [{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }],
    });
    const params = (db.runAsync as jest.Mock).mock.calls[0][1] as unknown[];
    const evidenceParam = params.find(p => typeof p === 'string' && p.startsWith('['));
    expect(evidenceParam).toBe(
      JSON.stringify([{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }])
    );
  });

  it('listMessages parsează evidence_json înapoi la array', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: 'm1',
        role: 'assistant',
        content: 'X',
        template: 'list_accounts',
        sql_used: null,
        evidence_json: JSON.stringify([{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }]),
        explanation_short: 'lista conturi',
        error_kind: null,
        created_at: '2026-04-29T10:00:00.000Z',
      },
    ]);
    const msgs = await listMessages();
    expect(msgs[0].evidence).toEqual([{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }]);
  });

  it('clearAll șterge toate mesajele', async () => {
    await clearAll();
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM chat_messages');
  });

  it('recentPairs grupează user+assistant și skipează system_error', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: '4',
        role: 'assistant',
        content: 'A2',
        explanation_short: 'a2',
        sql_used: null,
        template: 'raw_list',
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:04:00.000Z',
      },
      {
        id: '3',
        role: 'user',
        content: 'Q2',
        explanation_short: null,
        sql_used: null,
        template: null,
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:03:00.000Z',
      },
      {
        id: 'e1',
        role: 'system_error',
        content: 'Eroare',
        explanation_short: null,
        sql_used: null,
        template: null,
        evidence_json: null,
        error_kind: 'network',
        created_at: '2026-04-29T10:02:00.000Z',
      },
      {
        id: '2',
        role: 'assistant',
        content: 'A1',
        explanation_short: 'a1',
        sql_used: null,
        template: 'raw_list',
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:01:00.000Z',
      },
      {
        id: '1',
        role: 'user',
        content: 'Q1',
        explanation_short: null,
        sql_used: null,
        template: null,
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:00:00.000Z',
      },
    ]);
    const pairs = await recentPairs(5);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].user.content).toBe('Q2');
    expect(pairs[0].assistant.content).toBe('A2');
    expect(pairs[1].user.content).toBe('Q1');
  });
});
```

- [ ] **Step 2: Rulează testul, trebuie să eșueze**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatRepo.test.ts
```

Expected: FAIL — `Cannot find module '@/services/aiChatRepo'`.

- [ ] **Step 3: Implementează `services/aiChatRepo.ts`**

```typescript
import { db, generateId } from './db';

import type { ChatMessage, ChatRole, ChatTemplate, ChatErrorKind, EvidenceItem } from '@/types';

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
  // rows came DESC; iterate to find pairs (assistant followed by user in time order)
  const pairs: ChatPair[] = [];
  for (let i = 0; i < msgs.length - 1 && pairs.length < n; i++) {
    const a = msgs[i];
    const u = msgs[i + 1];
    if (a.role === 'assistant' && u.role === 'user') {
      pairs.push({ user: u, assistant: a });
      i++; // consume the user
    }
  }
  return pairs;
}
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatRepo.test.ts
```

Expected: PASS toate.

- [ ] **Step 5: Commit**

```bash
cd /Users/ax/work/finante && git add services/aiChatRepo.ts __tests__/unit/aiChatRepo.test.ts && git commit -m "feat(aiChat): aiChatRepo CRUD pe chat_messages"
```

---

## Task 5: `services/aiChatSqlGuard.ts` — validare SQL defense-in-depth

**Files:**

- Create: `services/aiChatSqlGuard.ts`
- Test: `__tests__/unit/aiChatSqlGuard.test.ts`

- [ ] **Step 1: Scrie testul (failing)**

Creează `__tests__/unit/aiChatSqlGuard.test.ts`:

```typescript
import { validateAndNormalizeSql } from '@/services/aiChatSqlGuard';

describe('aiChatSqlGuard', () => {
  describe('ACCEPT', () => {
    it.each([
      ['SELECT * FROM transactions LIMIT 100', 'SELECT * FROM transactions LIMIT 100'],
      [
        "SELECT * FROM transactions WHERE merchant LIKE '%MCD%' LIMIT 100",
        "SELECT * FROM transactions WHERE merchant LIKE '%MCD%' LIMIT 100",
      ],
      [
        "SELECT SUM(amount_ron) FROM transactions WHERE date >= '2026-01-01' LIMIT 1",
        "SELECT SUM(amount_ron) FROM transactions WHERE date >= '2026-01-01' LIMIT 1",
      ],
      [
        'WITH cte AS (SELECT * FROM transactions LIMIT 50) SELECT * FROM cte LIMIT 50',
        'WITH cte AS (SELECT * FROM transactions LIMIT 50) SELECT * FROM cte LIMIT 50',
      ],
      [
        'SELECT t.*, c.name FROM transactions t LEFT JOIN expense_categories c ON c.id = t.category_id LIMIT 100',
        'SELECT t.*, c.name FROM transactions t LEFT JOIN expense_categories c ON c.id = t.category_id LIMIT 100',
      ],
    ])('accepts %s', (input, expected) => {
      const r = validateAndNormalizeSql(input);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toBe(expected);
    });
  });

  describe('REJECT', () => {
    it.each([
      'DROP TABLE transactions',
      'SELECT * FROM transactions; DELETE FROM transactions',
      'SELECT * FROM transactions /* sneaky */ INTO outfile',
      'PRAGMA table_info(transactions)',
      "ATTACH DATABASE 'evil.db' AS evil",
      'SELECT * FROM bank_statements LIMIT 10',
      'SELECT * FROM settings LIMIT 10',
      'SELECT * FROM chat_messages LIMIT 10',
      '-- comment\nDELETE FROM transactions',
      "SELECT load_extension('evil.so') LIMIT 1",
      'INSERT INTO transactions VALUES (1)',
      'UPDATE transactions SET amount = 0',
      'CREATE TABLE x (a INT)',
      'SELECT * FROM transactions UNION SELECT * FROM bank_statements LIMIT 10',
    ])('rejects %s', input => {
      const r = validateAndNormalizeSql(input);
      expect(r.ok).toBe(false);
    });
  });

  describe('LIMIT injection / clamp', () => {
    it('adds LIMIT 500 when missing', () => {
      const r = validateAndNormalizeSql('SELECT * FROM transactions');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toBe('SELECT * FROM transactions LIMIT 500');
    });
    it('clamps LIMIT > 500 to 500', () => {
      const r = validateAndNormalizeSql('SELECT * FROM transactions LIMIT 9999');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toMatch(/LIMIT 500\s*$/);
    });
    it('preserves LIMIT under 500', () => {
      const r = validateAndNormalizeSql('SELECT * FROM transactions LIMIT 50');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toMatch(/LIMIT 50\s*$/);
    });
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să eșueze**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatSqlGuard.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementează `services/aiChatSqlGuard.ts`**

```typescript
const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'drop',
  'create',
  'alter',
  'replace',
  'vacuum',
  'reindex',
  'pragma',
  'attach',
  'detach',
  'load_extension',
];

const ALLOWED_TABLES = new Set(['transactions', 'expense_categories', 'financial_accounts']);

const FORBIDDEN_TABLES = ['bank_statements', 'settings', 'fx_rates', 'chat_messages'];

const MAX_LIMIT = 500;

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

function stripStringLiterals(sql: string): string {
  // Replace contents of '...' with empty string for keyword scanning
  return sql.replace(/'[^']*'/g, "''");
}

export function validateAndNormalizeSql(rawInput: string): GuardResult {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, reason: 'SQL gol' };

  // 1. Trebuie să înceapă cu SELECT sau WITH
  const lowered = trimmed.toLowerCase();
  if (!/^(select|with)\b/.test(lowered)) {
    return { ok: false, reason: 'Trebuie să înceapă cu SELECT sau WITH' };
  }

  // 2. Reject multi-statement (`;`) — fără punct și virgulă internal nici la final.
  if (trimmed.replace(/;\s*$/, '').includes(';')) {
    return { ok: false, reason: 'Multi-statement nu e permis' };
  }

  // 3. Reject comentarii
  if (/--/.test(trimmed) || /\/\*/.test(trimmed)) {
    return { ok: false, reason: 'Comentariile SQL nu sunt permise' };
  }

  // 4. Scanează keyword-uri interzise (după strip string literals)
  const stripped = stripStringLiterals(lowered);
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(stripped)) {
      return { ok: false, reason: `Keyword interzis: ${kw}` };
    }
  }

  // 5. Reject SELECT INTO
  if (/\binto\b/.test(stripped)) {
    return { ok: false, reason: 'SELECT INTO nu e permis' };
  }

  // 6. Verifică doar tabele din allowlist sunt referite
  // Acceptăm CTE prin WITH: numele după WITH ... AS sunt nume virtuale, nu tabele reale.
  // Strategy: extrage toate identificatorii care urmează după FROM sau JOIN și verifică să fie în allowlist
  // sau în lista de CTE-uri declarate.
  const cteNames = new Set<string>();
  const cteMatches = stripped.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\s*\(/g);
  for (const m of cteMatches) cteNames.add(m[1]);

  const tableMatches = stripped.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/g);
  for (const m of tableMatches) {
    const tbl = m[1];
    if (cteNames.has(tbl)) continue;
    if (FORBIDDEN_TABLES.includes(tbl)) {
      return { ok: false, reason: `Tabel interzis: ${tbl}` };
    }
    if (!ALLOWED_TABLES.has(tbl)) {
      return { ok: false, reason: `Tabel necunoscut sau neacceptat: ${tbl}` };
    }
  }

  // 7. Normalizează LIMIT
  const stmtNoSemi = trimmed.replace(/;\s*$/, '');
  const limitMatch = stmtNoSemi.match(/\blimit\s+(\d+)\s*$/i);
  let normalized: string;
  if (!limitMatch) {
    normalized = `${stmtNoSemi} LIMIT ${MAX_LIMIT}`;
  } else {
    const n = parseInt(limitMatch[1], 10);
    if (n > MAX_LIMIT) {
      normalized = stmtNoSemi.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${MAX_LIMIT}`);
    } else {
      normalized = stmtNoSemi;
    }
  }

  return { ok: true, sql: normalized };
}
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatSqlGuard.test.ts
```

Expected: PASS toate (≥25 cazuri).

- [ ] **Step 5: Commit**

```bash
cd /Users/ax/work/finante && git add services/aiChatSqlGuard.ts __tests__/unit/aiChatSqlGuard.test.ts && git commit -m "feat(aiChat): aiChatSqlGuard cu allowlist tabele și clamp LIMIT"
```

---

## Task 6: `services/aiChatTemplates.ts` — formattere răspuns determinist

**Files:**

- Create: `services/aiChatTemplates.ts`
- Test: `__tests__/unit/aiChatTemplates.test.ts`

- [ ] **Step 1: Scrie testele (failing)**

Creează `__tests__/unit/aiChatTemplates.test.ts`:

```typescript
import { formatResponse } from '@/services/aiChatTemplates';

const accountsLookup = new Map([
  ['acc-bt', { id: 'acc-bt', name: 'BT_curent_ron', type: 'bank' }],
  ['acc-cash', { id: 'acc-cash', name: 'Cash', type: 'cash' }],
]);
const categoriesLookup = new Map([
  ['cat-food', { id: 'cat-food', name: 'Mâncare' }],
  ['cat-home', { id: 'cat-home', name: 'Casă' }],
]);
const ctx = { accounts: accountsLookup, categories: categoriesLookup };

describe('formatResponse', () => {
  describe('search_merchant', () => {
    it('happy path with matches', () => {
      const rows = [
        {
          id: 't1',
          date: '2026-03-12',
          amount: -25.5,
          amount_ron: -25.5,
          merchant: 'MCDONALDS',
          account_id: 'acc-bt',
          category_id: 'cat-food',
          description: null,
        },
        {
          id: 't2',
          date: '2026-04-05',
          amount: -42.0,
          amount_ron: -42.0,
          merchant: 'MCDONALDS',
          account_id: 'acc-bt',
          category_id: 'cat-food',
          description: null,
        },
      ];
      const out = formatResponse(
        'search_merchant',
        rows,
        { merchant: 'MCDONALDS', account_id: 'acc-bt' },
        ctx
      );
      expect(out.text).toContain('2 tranzacții');
      expect(out.text).toContain('MCDONALDS');
      expect(out.text).toContain('BT_curent_ron');
      expect(out.text).toMatch(/67[,.]50.*RON/);
      expect(out.evidence).toHaveLength(2);
      expect(out.evidence[0].kind).toBe('transaction');
    });
    it('empty result', () => {
      const out = formatResponse('search_merchant', [], { merchant: 'PIZZAHUT' }, ctx);
      expect(out.text).toContain('Nu am găsit');
      expect(out.text).toContain('PIZZAHUT');
      expect(out.evidence).toEqual([]);
    });
    it('text reflects row sum exactly (anti-halucinare)', () => {
      const rows = [
        {
          id: 't1',
          date: '2026-03-01',
          amount: -10,
          amount_ron: -10,
          merchant: 'X',
          account_id: 'acc-bt',
          category_id: null,
          description: null,
        },
        {
          id: 't2',
          date: '2026-03-02',
          amount: -7.33,
          amount_ron: -7.33,
          merchant: 'X',
          account_id: 'acc-bt',
          category_id: null,
          description: null,
        },
        {
          id: 't3',
          date: '2026-03-03',
          amount: -2,
          amount_ron: -2,
          merchant: 'X',
          account_id: 'acc-bt',
          category_id: null,
          description: null,
        },
      ];
      const out = formatResponse('search_merchant', rows, { merchant: 'X' }, ctx);
      const m = out.text.match(/(\d+[,.]?\d*)\s+RON/);
      expect(m).not.toBeNull();
      const reported = parseFloat(m![1].replace(',', '.'));
      const actual = rows.reduce((s, r) => s + Math.abs(r.amount_ron), 0);
      expect(Math.abs(reported - actual)).toBeLessThan(0.01);
    });
  });

  describe('list_accounts', () => {
    it('happy path', () => {
      const rows = [
        {
          id: 'acc-bt',
          name: 'BT_curent_ron',
          type: 'bank',
          currency: 'RON',
          initial_balance: 1000,
        },
        { id: 'acc-cash', name: 'Cash', type: 'cash', currency: 'RON', initial_balance: 0 },
      ];
      const out = formatResponse('list_accounts', rows, {}, ctx);
      expect(out.text).toContain('2 conturi');
      expect(out.text).toContain('BT_curent_ron');
      expect(out.text).toContain('Cash');
      expect(out.evidence).toHaveLength(2);
      expect(out.evidence[0].kind).toBe('account');
    });
    it('empty', () => {
      const out = formatResponse('list_accounts', [], {}, ctx);
      expect(out.text).toContain('Nu ai niciun cont');
    });
  });

  describe('top_merchants', () => {
    it('happy path', () => {
      const rows = [
        { merchant: 'LIDL', total: -450, count: 12 },
        { merchant: 'KAUFLAND', total: -300, count: 8 },
        { merchant: 'MEGA', total: -150, count: 5 },
      ];
      const out = formatResponse('top_merchants', rows, {}, ctx);
      expect(out.text).toContain('LIDL');
      expect(out.text).toMatch(/450.*RON/);
      expect(out.evidence).toHaveLength(3);
      expect(out.evidence[0].kind).toBe('aggregate');
    });
    it('empty', () => {
      const out = formatResponse('top_merchants', [], {}, ctx);
      expect(out.text).toContain('Nu am găsit');
    });
  });

  describe('cannot_answer', () => {
    it('passes explanation through as the user-facing text', () => {
      const out = formatResponse(
        'cannot_answer',
        [],
        { explanation_short: 'Nu am date despre crypto.' },
        ctx
      );
      expect(out.text).toContain('Nu am date despre crypto');
      expect(out.evidence).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să eșueze**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatTemplates.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementează `services/aiChatTemplates.ts`**

```typescript
import type { ChatTemplate, EvidenceItem } from '@/types';

const RO_MONTHS_SHORT = [
  'ian',
  'feb',
  'mar',
  'apr',
  'mai',
  'iun',
  'iul',
  'aug',
  'sep',
  'oct',
  'noi',
  'dec',
];

function fmtRon(value: number): string {
  return (
    new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(Math.abs(value)) + ' RON'
  );
}

function fmtDate(iso: string): string {
  // iso: "2026-03-12" sau "2026-03-12T..."
  const [y, m, d] = iso
    .slice(0, 10)
    .split('-')
    .map(n => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  return `${d} ${RO_MONTHS_SHORT[m - 1]} ${y}`;
}

export interface CtxLookups {
  accounts: Map<string, { id: string; name: string; type: string }>;
  categories: Map<string, { id: string; name: string }>;
}

export interface FormattedResponse {
  text: string;
  evidence: EvidenceItem[];
}

type Row = Record<string, unknown>;

function nameAccount(ctx: CtxLookups, id: string | null | undefined): string {
  if (!id) return '—';
  return ctx.accounts.get(id)?.name ?? id;
}
function nameCategory(ctx: CtxLookups, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return ctx.categories.get(id)?.name ?? undefined;
}

export function formatResponse(
  template: ChatTemplate,
  rows: Row[],
  params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  switch (template) {
    case 'search_merchant':
      return formatSearchMerchant(rows, params, ctx);
    case 'top_merchants':
      return formatTopMerchants(rows, params, ctx);
    case 'monthly_total':
      return formatMonthlyTotal(rows, params, ctx);
    case 'category_evolution':
      return formatCategoryEvolution(rows, params, ctx);
    case 'period_compare':
      return formatPeriodCompare(rows, params, ctx);
    case 'list_accounts':
      return formatListAccounts(rows);
    case 'list_categories':
      return formatListCategories(rows);
    case 'raw_list':
      return formatRawList(rows, params, ctx);
    case 'cannot_answer':
      return {
        text:
          typeof params.explanation_short === 'string' && params.explanation_short.length > 0
            ? `Nu pot răspunde la asta: ${params.explanation_short}`
            : 'Nu pot răspunde la întrebarea ta cu datele actuale.',
        evidence: [],
      };
  }
}

function formatSearchMerchant(
  rows: Row[],
  params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  const merchant = String(params.merchant ?? '');
  const accountFilter = params.account_id ? nameAccount(ctx, String(params.account_id)) : undefined;
  if (rows.length === 0) {
    const where = accountFilter ? ` în ${accountFilter}` : '';
    return { text: `Nu am găsit tranzacții la **${merchant}**${where}.`, evidence: [] };
  }
  const total = rows.reduce((s, r) => s + Math.abs(Number(r.amount_ron) || 0), 0);
  const dates = rows.map(r => String(r.date)).sort();
  const where = accountFilter ? ` în **${accountFilter}**` : '';
  const evidence: EvidenceItem[] = rows.map(r => ({
    kind: 'transaction',
    id: String(r.id),
    date: fmtDate(String(r.date)),
    amount: Number(r.amount) || 0,
    merchant: String(r.merchant ?? ''),
    account: nameAccount(ctx, r.account_id as string | undefined),
    category: nameCategory(ctx, r.category_id as string | undefined),
  }));
  return {
    text: `Da, ai **${rows.length} tranzacții** la **${merchant}**${where}, total **${fmtRon(total)}**, între **${fmtDate(dates[0])}** și **${fmtDate(dates[dates.length - 1])}**.`,
    evidence,
  };
}

function formatTopMerchants(
  rows: Row[],
  _params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  if (rows.length === 0)
    return { text: 'Nu am găsit tranzacții pentru top merchants.', evidence: [] };
  const items = rows.slice(0, 5);
  const lines = items.map((r, i) => {
    const m = String(r.merchant ?? 'Necunoscut');
    const total = Math.abs(Number(r.total) || 0);
    const count = Number(r.count) || 0;
    return `${i + 1}. **${m}** — ${fmtRon(total)} (${count} tranz.)`;
  });
  const evidence: EvidenceItem[] = items.map(r => ({
    kind: 'aggregate',
    label: String(r.merchant ?? 'Necunoscut'),
    period: 'all',
    total: Math.abs(Number(r.total) || 0),
    count: Number(r.count) || 0,
  }));
  return { text: `Top ${items.length} merchants:\n${lines.join('\n')}`, evidence };
}

function formatMonthlyTotal(
  rows: Row[],
  params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  const month = String(params.month ?? '');
  if (rows.length === 0) {
    return { text: `În **${month}** nu există cheltuieli înregistrate.`, evidence: [] };
  }
  const total = rows.reduce((s, r) => s + Math.abs(Number(r.amount_ron) || 0), 0);
  const evidence: EvidenceItem[] = [
    { kind: 'aggregate', label: 'Total cheltuieli', period: month, total, count: rows.length },
  ];
  return {
    text: `În **${month}** ai cheltuit **${fmtRon(total)}** din **${rows.length} tranzacții**.`,
    evidence,
  };
}

function formatCategoryEvolution(
  rows: Row[],
  params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  const cat =
    nameCategory(ctx, params.category_id as string | undefined) ?? 'categorie necunoscută';
  if (rows.length === 0) return { text: `Nu există date pe categoria **${cat}**.`, evidence: [] };
  const series = rows.map(r => ({ ym: String(r.ym), total: Math.abs(Number(r.total) || 0) }));
  const total = series.reduce((s, p) => s + p.total, 0);
  const evidence: EvidenceItem[] = series.map(p => ({
    kind: 'aggregate',
    label: cat,
    period: p.ym,
    total: p.total,
    count: 0,
  }));
  const minP = series.reduce((a, b) => (a.total < b.total ? a : b));
  const maxP = series.reduce((a, b) => (a.total > b.total ? a : b));
  return {
    text: `Pe categoria **${cat}**: total **${fmtRon(total)}** pe ${series.length} luni. Minim: ${fmtRon(minP.total)} (${minP.ym}), maxim: ${fmtRon(maxP.total)} (${maxP.ym}).`,
    evidence,
  };
}

function formatPeriodCompare(
  rows: Row[],
  params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  const label = String(params.label ?? 'subiect');
  if (rows.length === 0)
    return { text: `Nu am date pentru a compara perioadele cerute pe **${label}**.`, evidence: [] };
  const lines: string[] = [];
  const evidence: EvidenceItem[] = [];
  for (const r of rows) {
    const period = String(r.period ?? '');
    const total = Math.abs(Number(r.total) || 0);
    const count = Number(r.count) || 0;
    lines.push(`**${period}**: ${fmtRon(total)} (${count} tranz.)`);
    evidence.push({ kind: 'aggregate', label, period, total, count });
  }
  return { text: `**${label}** — ${lines.join(' vs ')}.`, evidence };
}

function formatListAccounts(rows: Row[]): FormattedResponse {
  if (rows.length === 0) return { text: 'Nu ai niciun cont configurat.', evidence: [] };
  const lines = rows.map((r, i) => {
    const bal = Number(r.initial_balance) || 0;
    return `${i + 1}. **${r.name}** (${r.type}, ${r.currency}, sold inițial ${fmtRon(bal)})`;
  });
  const evidence: EvidenceItem[] = rows.map(r => ({
    kind: 'account',
    id: String(r.id),
    name: String(r.name ?? ''),
    type: String(r.type ?? ''),
  }));
  return { text: `Ai **${rows.length} conturi**:\n${lines.join('\n')}`, evidence };
}

function formatListCategories(rows: Row[]): FormattedResponse {
  if (rows.length === 0) return { text: 'Nu ai categorii.', evidence: [] };
  const lines = rows.map((r, i) => `${i + 1}. **${r.name}**`);
  const evidence: EvidenceItem[] = rows.map(r => ({
    kind: 'category',
    id: String(r.id),
    name: String(r.name ?? ''),
    parent: r.parent_id ? String(r.parent_id) : undefined,
  }));
  return { text: `Categorii (${rows.length}):\n${lines.join('\n')}`, evidence };
}

function formatRawList(
  rows: Row[],
  _params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  if (rows.length === 0) return { text: 'Nu am găsit tranzacții.', evidence: [] };
  const total = rows.reduce(
    (s, r) => s + Math.abs(Number(r.amount_ron) || Number(r.amount) || 0),
    0
  );
  const evidence: EvidenceItem[] = rows.slice(0, 20).map(r => ({
    kind: 'transaction',
    id: String(r.id),
    date: fmtDate(String(r.date)),
    amount: Number(r.amount) || 0,
    merchant: String(r.merchant ?? ''),
    account: nameAccount(ctx, r.account_id as string | undefined),
    category: nameCategory(ctx, r.category_id as string | undefined),
  }));
  return {
    text: `Am găsit **${rows.length} tranzacții**, total **${fmtRon(total)}**. Vezi Sursa pentru detalii.`,
    evidence,
  };
}
```

- [ ] **Step 4: Rulează testele — trebuie să treacă**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatTemplates.test.ts
```

Expected: PASS toate.

- [ ] **Step 5: Commit**

```bash
cd /Users/ax/work/finante && git add services/aiChatTemplates.ts __tests__/unit/aiChatTemplates.test.ts && git commit -m "feat(aiChat): aiChatTemplates pentru răspuns determinist"
```

---

## Task 7: `services/aiChatPrompt.ts` — system prompt + history compaction

**Files:**

- Create: `services/aiChatPrompt.ts`
- Test: `__tests__/unit/aiChatPrompt.test.ts`

- [ ] **Step 1: Scrie testul (failing)**

```typescript
import { buildSystemPrompt, buildMessages } from '@/services/aiChatPrompt';
import type { ChatPair } from '@/services/aiChatRepo';

describe('aiChatPrompt', () => {
  it('buildSystemPrompt conține schema cele 3 tabele', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('financial_accounts');
    expect(p).toContain('expense_categories');
    expect(p).toContain('transactions');
    expect(p).not.toContain('bank_statements'); // tabel exclus din prompt
    expect(p).not.toContain('chat_messages');
  });

  it('buildSystemPrompt cere JSON cu cele 9 valori valide pentru template', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('search_merchant');
    expect(p).toContain('cannot_answer');
    expect(p).toContain('LIMIT obligatoriu');
  });

  it('buildSystemPrompt include few-shot examples', () => {
    const p = buildSystemPrompt();
    // Verifică prezența unor exemple întrebări tipice
    expect(p.toLowerCase()).toContain('exemplu');
  });

  it('buildMessages compactează history la întrebări + explanationShort', () => {
    const pairs: ChatPair[] = [
      {
        user: { id: 'u1', role: 'user', content: 'Q1', createdAt: '' },
        assistant: {
          id: 'a1',
          role: 'assistant',
          content: 'TEXT BUBBLE LUNG',
          explanationShort: 'sumar a1',
          createdAt: '',
        },
      },
    ];
    const msgs = buildMessages(pairs, 'Q nouă');
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'Q1' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'sumar a1' });
    expect(msgs[2].content).not.toContain('TEXT BUBBLE LUNG');
    expect(msgs[3]).toEqual({ role: 'user', content: 'Q nouă' });
  });

  it('buildMessages folosește assistant.content când explanationShort lipsește', () => {
    const pairs: ChatPair[] = [
      {
        user: { id: 'u1', role: 'user', content: 'Q1', createdAt: '' },
        assistant: { id: 'a1', role: 'assistant', content: 'A1', createdAt: '' },
      },
    ];
    const msgs = buildMessages(pairs, 'Q2');
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'A1' });
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să eșueze**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatPrompt.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementează `services/aiChatPrompt.ts`**

```typescript
import type { AiMessage } from './aiProvider';
import type { ChatPair } from './aiChatRepo';

const SCHEMA_DESCRIPTION = `
financial_accounts(id, name, type, currency, initial_balance)
expense_categories(id, name, key, parent_id, icon, color, monthly_limit)
transactions(id, account_id, date, amount, currency, amount_ron,
             description, merchant, category_id, source,
             is_internal_transfer, is_refund, duplicate_of_id, notes)
`.trim();

const FEW_SHOT_EXAMPLES = `
Exemple:
Întrebare: "La ce bănci am cont?"
Răspuns: { "sql": "SELECT id, name, type, currency, initial_balance FROM financial_accounts WHERE archived = 0 ORDER BY name LIMIT 50", "template": "list_accounts", "params": {}, "explanation_short": "lista conturi" }

Întrebare: "În contul BT_curent_ron am cumpărat ceva de la MCDONALDS?"
Răspuns: { "sql": "SELECT t.id, t.date, t.amount, t.amount_ron, t.merchant, t.account_id, t.category_id, t.description FROM transactions t JOIN financial_accounts a ON a.id = t.account_id WHERE a.name = 'BT_curent_ron' AND UPPER(t.merchant) LIKE '%MCDONALDS%' AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 ORDER BY t.date DESC LIMIT 100", "template": "search_merchant", "params": { "merchant": "MCDONALDS", "account_id": null }, "explanation_short": "tranzacții McDonalds în BT_curent_ron" }

Întrebare: "Cum au evoluat cheltuielile cu întreținerea față de anul trecut?"
Răspuns: { "sql": "SELECT substr(date, 1, 7) AS ym, SUM(COALESCE(amount_ron, amount)) AS total FROM transactions WHERE category_id = (SELECT id FROM expense_categories WHERE key = 'home') AND amount < 0 AND duplicate_of_id IS NULL AND is_internal_transfer = 0 AND date >= date('now', '-24 months') GROUP BY ym ORDER BY ym ASC LIMIT 24", "template": "category_evolution", "params": { "category_id": null }, "explanation_short": "evoluție categorie casă 24 luni" }

Întrebare: "De unde cumpăr cea mai multă mâncare luna asta?"
Răspuns: { "sql": "SELECT merchant, SUM(COALESCE(amount_ron, amount)) AS total, COUNT(*) AS count FROM transactions WHERE category_id = (SELECT id FROM expense_categories WHERE key = 'food') AND amount < 0 AND duplicate_of_id IS NULL AND is_internal_transfer = 0 AND substr(date, 1, 7) = strftime('%Y-%m', 'now') GROUP BY merchant ORDER BY total ASC LIMIT 5", "template": "top_merchants", "params": { "category_id": null, "period": "current_month" }, "explanation_short": "top merchants mâncare luna curentă" }

Întrebare: "Câte zile au fost săptămâna trecută cu vânt puternic?"
Răspuns: { "sql": null, "template": "cannot_answer", "params": { "explanation_short": "nu am date despre vreme" }, "explanation_short": "nu am date despre vreme" }
`.trim();

export function buildSystemPrompt(): string {
  return `Ești un asistent care traduce întrebări în limba română despre finanțele personale ale utilizatorului într-un query SQL pe o bază SQLite locală.

Schema disponibilă (citești doar):
${SCHEMA_DESCRIPTION}

Reguli SQL:
- Generezi DOAR SELECT (sau WITH ... SELECT). Niciun INSERT/UPDATE/DELETE/PRAGMA/ATTACH/DROP.
- Excludem mereu: duplicate_of_id IS NULL AND is_internal_transfer = 0 (excepție: dacă utilizatorul cere explicit transferuri/duplicate).
- Cheltuielile sunt amount < 0; veniturile amount > 0.
- Pentru sume folosește COALESCE(amount_ron, amount).
- LIMIT obligatoriu, max 500.
- Folosește exclusiv tabelele: financial_accounts, expense_categories, transactions. Niciun alt tabel.

Răspunzi STRICT cu un JSON valid, fără text suplimentar:
{
  "sql": "<SELECT ... LIMIT N>" sau null,
  "template": "search_merchant" | "top_merchants" | "monthly_total" | "category_evolution" | "period_compare" | "list_accounts" | "list_categories" | "raw_list" | "cannot_answer",
  "params": { ... },
  "explanation_short": "<sumar 5-10 cuvinte despre răspuns>"
}

Dacă întrebarea nu poate fi mapată pe schemă, răspunzi cu template="cannot_answer", sql=null și explanation_short cu motivul.

${FEW_SHOT_EXAMPLES}`.trim();
}

export function buildMessages(history: ChatPair[], userQuestion: string): AiMessage[] {
  const msgs: AiMessage[] = [{ role: 'system', content: buildSystemPrompt() }];
  // history: cea mai recentă pereche e prima — re-ordinez cronologic
  const ordered = [...history].reverse();
  for (const p of ordered) {
    msgs.push({ role: 'user', content: p.user.content });
    msgs.push({
      role: 'assistant',
      content:
        p.assistant.explanationShort && p.assistant.explanationShort.length > 0
          ? p.assistant.explanationShort
          : p.assistant.content,
    });
  }
  msgs.push({ role: 'user', content: userQuestion });
  return msgs;
}
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChatPrompt.test.ts
```

Expected: PASS toate.

- [ ] **Step 5: Commit**

```bash
cd /Users/ax/work/finante && git add services/aiChatPrompt.ts __tests__/unit/aiChatPrompt.test.ts && git commit -m "feat(aiChat): aiChatPrompt cu schema + few-shot + history compaction"
```

---

## Task 8: `services/aiChat.ts` — orchestrator

**Files:**

- Create: `services/aiChat.ts`
- Test: `__tests__/unit/aiChat.test.ts`

- [ ] **Step 1: Scrie testul (failing)**

```typescript
import { askAssistant } from '@/services/aiChat';
import * as aiProvider from '@/services/aiProvider';
import * as repo from '@/services/aiChatRepo';
import * as accounts from '@/services/financialAccounts';
import * as categories from '@/services/categories';
import { db } from '@/services/db';

jest.mock('@/services/aiProvider');
jest.mock('@/services/aiChatRepo');
jest.mock('@/services/financialAccounts');
jest.mock('@/services/categories');

const sendAiRequestMock = aiProvider.sendAiRequest as jest.MockedFunction<
  typeof aiProvider.sendAiRequest
>;
const isAiLimitReachedMock = aiProvider.isAiLimitReached as jest.MockedFunction<
  typeof aiProvider.isAiLimitReached
>;
const recentPairsMock = repo.recentPairs as jest.MockedFunction<typeof repo.recentPairs>;
const appendMessageMock = repo.appendMessage as jest.MockedFunction<typeof repo.appendMessage>;

beforeEach(() => {
  jest.clearAllMocks();
  isAiLimitReachedMock.mockResolvedValue(false);
  recentPairsMock.mockResolvedValue([]);
  appendMessageMock.mockImplementation(async i => ({
    id: 'mock-id',
    createdAt: '2026-04-29T00:00:00Z',
    ...i,
  }));
  (accounts.getAccounts as jest.Mock).mockResolvedValue([]);
  (categories.getCategories as jest.Mock).mockResolvedValue([]);
});

describe('askAssistant', () => {
  it('happy path: SQL valid → ​format template → save user+assistant', async () => {
    sendAiRequestMock.mockResolvedValue(
      JSON.stringify({
        sql: 'SELECT * FROM transactions LIMIT 10',
        template: 'raw_list',
        params: {},
        explanation_short: 'lista',
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);

    const r = await askAssistant('listează tranzacții');
    expect(r.assistant.template).toBe('raw_list');
    expect(appendMessageMock).toHaveBeenCalledTimes(2); // user + assistant
  });

  it('cota atinsă: niciun call AI, mesaj system_error salvat', async () => {
    isAiLimitReachedMock.mockResolvedValue(true);
    const r = await askAssistant('ceva');
    expect(sendAiRequestMock).not.toHaveBeenCalled();
    expect(r.assistant.errorKind).toBe('quota_exhausted');
  });

  it('AI întoarce JSON invalid → retry o dată → succes', async () => {
    sendAiRequestMock.mockResolvedValueOnce('NOT JSON AT ALL').mockResolvedValueOnce(
      JSON.stringify({
        sql: 'SELECT * FROM transactions LIMIT 5',
        template: 'raw_list',
        params: {},
        explanation_short: 'ok',
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(2);
    expect(r.assistant.template).toBe('raw_list');
  });

  it('AI întoarce SQL respins → retry → succes', async () => {
    sendAiRequestMock
      .mockResolvedValueOnce(
        JSON.stringify({
          sql: 'DROP TABLE transactions',
          template: 'raw_list',
          params: {},
          explanation_short: 'bad',
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          sql: 'SELECT * FROM transactions LIMIT 5',
          template: 'raw_list',
          params: {},
          explanation_short: 'ok',
        })
      );
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(2);
    expect(r.assistant.template).toBe('raw_list');
  });

  it('cannot_answer: niciun retry, mesajul cu explanation', async () => {
    sendAiRequestMock.mockResolvedValue(
      JSON.stringify({
        sql: null,
        template: 'cannot_answer',
        params: { explanation_short: 'nu pot' },
        explanation_short: 'nu pot',
      })
    );
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(1);
    expect(r.assistant.template).toBe('cannot_answer');
    expect(r.assistant.content).toContain('nu pot');
  });

  it('retry-ul eșuează → mesaj user "nu pot răspunde, reformulează"', async () => {
    sendAiRequestMock.mockResolvedValue('still not json');
    const r = await askAssistant('Q');
    expect(sendAiRequestMock).toHaveBeenCalledTimes(2);
    expect(r.assistant.errorKind).toBe('invalid_sql');
    expect(r.assistant.content).toContain('reformulează');
  });
});
```

- [ ] **Step 2: Rulează testul — trebuie să eșueze**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChat.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementează `services/aiChat.ts`**

````typescript
import { z } from 'zod';

import { db } from './db';
import { sendAiRequest, isAiLimitReached, AiContextOverflowError } from './aiProvider';
import { appendMessage, recentPairs } from './aiChatRepo';
import { buildMessages } from './aiChatPrompt';
import { validateAndNormalizeSql } from './aiChatSqlGuard';
import { formatResponse, type CtxLookups } from './aiChatTemplates';
import { getAccounts } from './financialAccounts';
import { getCategories } from './categories';

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
  params: z.record(z.unknown()).default({}),
  explanation_short: z.string(),
});

const SQL_TIMEOUT_MS = 3000;
const MAX_HISTORY_PAIRS = 4;

export interface AskResult {
  user: ChatMessage;
  assistant: ChatMessage;
}

async function loadCtx(): Promise<CtxLookups> {
  const accs = await getAccounts({ includeArchived: false });
  const cats = await getCategories();
  return {
    accounts: new Map(accs.map(a => [a.id, { id: a.id, name: a.name, type: a.type }])),
    categories: new Map(cats.map(c => [c.id, { id: c.id, name: c.name }])),
  };
}

async function executeSqlReadOnly(sql: string): Promise<Record<string, unknown>[]> {
  // Defense in depth: chiar dacă guard-ul a trecut, forțăm read-only pe sesiunea curentă.
  await db.execAsync('PRAGMA query_only = 1;');
  try {
    const result = await Promise.race([
      db.getAllAsync<Record<string, unknown>>(sql),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SQL timeout')), SQL_TIMEOUT_MS)
      ),
    ]);
    return result;
  } finally {
    await db.execAsync('PRAGMA query_only = 0;').catch(() => undefined);
  }
}

function parseAiResponse(text: string): z.infer<typeof AiResponseSchema> | null {
  try {
    // Modelele uneori adaugă ```json ... ``` — strip
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
      break; // niciun retry pentru cannot_answer
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
      content: 'Nu pot răspunde la întrebare. Reformulează sau încearcă altă variantă.',
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
````

- [ ] **Step 4: Asigură că `db.execAsync` există și `getAccounts({ includeArchived })` are signatura așteptată**

```bash
cd /Users/ax/work/finante && grep -n "execAsync\|getAccounts" services/db.ts services/financialAccounts.ts | head -20
```

Verifică:

- `db.execAsync` e disponibil pe expo-sqlite (poți folosi `db.runAsync('PRAGMA query_only = 1')` ca alternativă dacă `execAsync` lipsește).
- `getAccounts` are signatura corectă; dacă nu, adaptează apelul.

Dacă `execAsync` nu există, înlocuiește în `aiChat.ts`:

```typescript
await db.runAsync('PRAGMA query_only = 1');
// ...
await db.runAsync('PRAGMA query_only = 0').catch(() => undefined);
```

- [ ] **Step 5: Rulează testul — trebuie să treacă**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChat.test.ts
```

Expected: PASS toate.

- [ ] **Step 6: Commit**

```bash
cd /Users/ax/work/finante && git add services/aiChat.ts __tests__/unit/aiChat.test.ts && git commit -m "feat(aiChat): orchestrator askAssistant cu retry + read-only execute"
```

---

## Task 9: Componenta `EvidenceList`

**Files:**

- Create: `components/EvidenceList.tsx`

- [ ] **Step 1: Implementare**

```typescript
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

import type { EvidenceItem } from '@/types';

interface Props {
  evidence: EvidenceItem[];
}

const INITIAL_VISIBLE = 10;

export function EvidenceList({ evidence }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [showAll, setShowAll] = useState(false);

  if (evidence.length === 0) return null;

  const visible = showAll ? evidence : evidence.slice(0, INITIAL_VISIBLE);
  const remaining = evidence.length - visible.length;

  const onPress = (item: EvidenceItem) => {
    if (item.kind === 'transaction') router.push(`/tranzactii/${item.id}` as never);
    else if (item.kind === 'account') router.push(`/conturi/${item.id}` as never);
  };

  return (
    <View style={[styles.container, { borderColor: C.border }]}>
      {visible.map((it, idx) => (
        <Pressable
          key={`${it.kind}-${'id' in it ? it.id : it.label}-${idx}`}
          onPress={() => onPress(it)}
          style={({ pressed }) => [
            styles.row,
            { borderBottomColor: C.border, backgroundColor: pressed ? C.primaryMuted : 'transparent' },
          ]}
        >
          <Text style={[styles.text, { color: C.text }]} numberOfLines={1}>
            {renderItem(it)}
          </Text>
          {(it.kind === 'transaction' || it.kind === 'account') && (
            <Ionicons name="chevron-forward" size={14} color={C.textSecondary} />
          )}
        </Pressable>
      ))}
      {remaining > 0 && (
        <Pressable onPress={() => setShowAll(true)} style={styles.row}>
          <Text style={[styles.more, { color: C.tint }]}>arată toate ({evidence.length})</Text>
        </Pressable>
      )}
    </View>
  );
}

function renderItem(it: EvidenceItem): string {
  switch (it.kind) {
    case 'transaction':
      return `${it.date} • ${it.merchant || '—'} • ${it.amount.toFixed(2)} • ${it.account}`;
    case 'account':
      return `${it.name} (${it.type})`;
    case 'category':
      return it.parent ? `${it.parent} / ${it.name}` : it.name;
    case 'aggregate':
      return `${it.label} • ${it.period} • ${it.total.toFixed(2)} (${it.count})`;
  }
}

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, marginTop: 8, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  text: { fontSize: 13, flex: 1 },
  more: { fontSize: 13, fontWeight: '500' },
});
```

- [ ] **Step 2: Type-check + lint**

```bash
cd /Users/ax/work/finante && npm run lint -- components/EvidenceList.tsx && npm run type-check
```

Expected: zero erori. Dacă `Colors[scheme].tint` sau `primaryMuted` nu există, ajustează la token-urile reale (cf. `constants/Colors.ts` + `theme/colors.ts`). Verifică:

```bash
cd /Users/ax/work/finante && cat constants/Colors.ts | head -50
```

- [ ] **Step 3: Commit**

```bash
cd /Users/ax/work/finante && git add components/EvidenceList.tsx && git commit -m "feat(ui): componentă EvidenceList cu deep-link tranzacții/conturi"
```

---

## Task 10: Componenta `ChatMessage`

**Files:**

- Create: `components/ChatMessage.tsx`

- [ ] **Step 1: Implementare**

```typescript
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { EvidenceList } from '@/components/EvidenceList';
import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';

import type { ChatMessage as ChatMessageType } from '@/types';

interface Props {
  message: ChatMessageType;
}

function renderBoldedText(text: string, color: string): React.ReactNode {
  // Markdown bold simplu: **text** → <Text bold>
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <Text key={i} style={{ fontWeight: '700', color }}>
          {p.slice(2, -2)}
        </Text>
      );
    }
    return (
      <Text key={i} style={{ color }}>
        {p}
      </Text>
    );
  });
}

export function ChatMessage({ message }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [open, setOpen] = useState(false);

  if (message.role === 'system_error') {
    return (
      <View style={[styles.errorBubble, { borderColor: statusColors.critical }]}>
        <Text style={{ color: statusColors.critical }}>{message.content}</Text>
      </View>
    );
  }

  const isUser = message.role === 'user';
  const bg = isUser ? C.primary : C.card;
  const fg = isUser ? '#ffffff' : C.text;

  return (
    <View style={[styles.row, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}>
      <View style={[styles.bubble, { backgroundColor: bg, alignSelf: isUser ? 'flex-end' : 'flex-start' }]}>
        <Text style={{ color: fg }}>{renderBoldedText(message.content, fg)}</Text>
        {!isUser && message.evidence && message.evidence.length > 0 && (
          <View>
            <Pressable onPress={() => setOpen(o => !o)} style={styles.evidenceToggle}>
              <Ionicons
                name={open ? 'chevron-down' : 'chevron-forward'}
                size={14}
                color={C.textSecondary}
              />
              <Text style={{ color: C.textSecondary, fontSize: 12, marginLeft: 4 }}>
                Sursa: {message.evidence.length}
              </Text>
            </Pressable>
            {open && <EvidenceList evidence={message.evidence} />}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 12 },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  errorBubble: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 6,
    backgroundColor: 'rgba(216, 76, 76, 0.08)',
  },
  evidenceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
});
```

- [ ] **Step 2: Type-check + lint**

```bash
cd /Users/ax/work/finante && npm run lint -- components/ChatMessage.tsx && npm run type-check
```

Expected: zero erori. Dacă `C.primary` lipsește, folosește `primary` din `@/theme/colors` direct.

- [ ] **Step 3: Commit**

```bash
cd /Users/ax/work/finante && git add components/ChatMessage.tsx && git commit -m "feat(ui): componentă ChatMessage cu bold parsing și collapsible evidence"
```

---

## Task 11: Mut Setări dintr-un tab într-o rută Stack

**Files:**

- Move: `app/(tabs)/setari.tsx` → `app/setari.tsx`
- Modify: `app/(tabs)/_layout.tsx` (eliminăm `<Tabs.Screen name="setari" ...>`)
- Modify: `app/(tabs)/index.tsx` (adăugăm `<Stack.Screen options={{ headerRight: ... }}>` cu icon ⚙️)

- [ ] **Step 1: Mut fișierul fizic**

```bash
cd /Users/ax/work/finante && git mv "app/(tabs)/setari.tsx" "app/setari.tsx"
```

- [ ] **Step 2: Verifică că rutele care navighează la `/setari` funcționează**

```bash
cd /Users/ax/work/finante && grep -rn "/setari" app/ components/ services/ hooks/ | grep -v node_modules
```

Toate referințele `router.push('/setari')` continuă să funcționeze pentru că Expo Router folosește filename routing și `/setari` rămâne valid (acum direct sub `app/`, nu sub `(tabs)`).

- [ ] **Step 3: Elimină `setari` din `_layout.tsx`**

În `app/(tabs)/_layout.tsx`, șterge blocul:

```tsx
<Tabs.Screen
  name="setari"
  options={{
    title: 'Setări',
    tabBarIcon: ({ color }) => <Ionicons name="settings" size={22} color={color} />,
  }}
/>
```

- [ ] **Step 4: Adaugă icon ⚙️ în header Sumar (`app/(tabs)/index.tsx`)**

În `app/(tabs)/index.tsx`, găsește unde se setează headerul (probabil în `<Stack.Screen options={{...}} />` la începutul return-ului) și adaugă `headerRight`:

```tsx
<Stack.Screen
  options={{
    title: 'Sumar',
    headerRight: () => (
      <Pressable onPress={() => router.push('/setari' as never)} style={{ marginRight: 12 }}>
        <Ionicons name="settings-outline" size={22} color={C.text} />
      </Pressable>
    ),
  }}
/>
```

Dacă fișierul nu folosește `<Stack.Screen>` (folosește direct opțiunile pe Tabs.Screen), adaugă în `_layout.tsx` la `<Tabs.Screen name="index" ...>`:

```tsx
<Tabs.Screen
  name="index"
  options={{
    title: 'Sumar',
    tabBarIcon: ({ color }) => <Ionicons name="pie-chart" size={22} color={color} />,
    headerRight: () => (
      <Pressable onPress={() => router.push('/setari' as never)} style={{ marginRight: 12 }}>
        <Ionicons name="settings-outline" size={22} color={palette.text} />
      </Pressable>
    ),
  }}
/>
```

(Plus import-uri: `Pressable` din `react-native`, `router` din `expo-router`.)

- [ ] **Step 5: Verifică rutarea manuală**

```bash
cd /Users/ax/work/finante && npm run type-check
```

Expected: zero erori.

```bash
cd /Users/ax/work/finante && npm start
```

În simulator: deschide Sumar → tap ⚙️ → trebuie să se deschidă Setări. Tap înapoi → revine la Sumar. Tab bar: 4 tab-uri (Sumar, Conturi, Tranzacții, Categorii) — Asistent încă lipsește, vom adăuga la Task 13.

- [ ] **Step 6: Commit**

```bash
cd /Users/ax/work/finante && git add app/(tabs)/_layout.tsx app/(tabs)/index.tsx app/setari.tsx && git commit -m "refactor(nav): mut Setări din tab în rută Stack accesibilă din header Sumar"
```

---

## Task 12: Ecranul `app/(tabs)/assistant.tsx`

**Files:**

- Create: `app/(tabs)/assistant.tsx`

- [ ] **Step 1: Implementare**

```typescript
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChatMessage } from '@/components/ChatMessage';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  AI_CONSENT_KEY,
  DAILY_AI_LIMIT,
  getAiConfig,
  getAiUsageToday,
  isAiLimitReached,
} from '@/services/aiProvider';
import { askAssistant } from '@/services/aiChat';
import { clearAll, listMessages } from '@/services/aiChatRepo';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ChatMessage as ChatMessageType } from '@/types';

const SUGGESTIONS = [
  'La ce bănci am cont?',
  'Top 5 merchants luna asta',
  'Cât am cheltuit pe Mâncare?',
  'Tranzacții la Lidl anul ăsta',
];

export default function AssistantScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [usage, setUsage] = useState<{ used: number; isBuiltin: boolean }>({ used: 0, isBuiltin: false });
  const [quotaReached, setQuotaReached] = useState(false);

  const reload = async () => {
    setMessages(await listMessages());
    const config = await getAiConfig();
    const consent = await AsyncStorage.getItem(AI_CONSENT_KEY);
    if (config.type === 'none' || consent !== 'true') {
      setAiAvailable({ ok: false, reason: 'consent_off' });
    } else {
      setAiAvailable({ ok: true });
    }
    if (config.type === 'builtin') {
      setUsage({ used: await getAiUsageToday(), isBuiltin: true });
      setQuotaReached(await isAiLimitReached());
    } else {
      setUsage({ used: 0, isBuiltin: false });
      setQuotaReached(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onSend = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || loading || quotaReached) return;
    setInput('');
    setLoading(true);
    try {
      await askAssistant(q);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Necunoscută');
    } finally {
      setLoading(false);
      await reload();
    }
  };

  const onClear = () =>
    Alert.alert('Șterge conversația?', 'Toate mesajele vor fi șterse. Ireversibil.', [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          await clearAll();
          await reload();
        },
      },
    ]);

  const renderHeaderRight = () => (
    <Pressable onPress={onClear} style={{ marginRight: 12 }}>
      <Ionicons name="trash-outline" size={20} color={C.text} />
    </Pressable>
  );

  if (aiAvailable && !aiAvailable.ok) {
    return (
      <View style={[styles.empty, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Asistent' }} />
        <Ionicons name="sparkles-outline" size={64} color={C.textSecondary} />
        <Text style={[styles.emptyText, { color: C.text }]}>
          Asistentul AI nu este activ.
        </Text>
        <Text style={[styles.emptySubtext, { color: C.textSecondary }]}>
          Activează-l din Setări → Asistent AI.
        </Text>
        <Pressable
          style={[styles.button, { backgroundColor: C.primary }]}
          onPress={() => router.push('/setari' as never)}
        >
          <Text style={styles.buttonText}>Mergi la Setări</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: C.background }]}
      keyboardVerticalOffset={88}
    >
      <Stack.Screen options={{ title: 'Asistent', headerRight: renderHeaderRight }} />
      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="sparkles" size={48} color={C.primary} />
          <Text style={[styles.emptyText, { color: C.text }]}>Întreabă orice despre finanțele tale.</Text>
          <Text style={[styles.emptySubtext, { color: C.textSecondary }]}>Exemple:</Text>
          <View style={styles.chipsWrap}>
            {SUGGESTIONS.map(s => (
              <Pressable
                key={s}
                onPress={() => onSend(s)}
                style={[styles.chip, { borderColor: C.border }]}
              >
                <Text style={[styles.chipText, { color: C.text }]}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={[...messages].reverse()}
          inverted
          keyExtractor={m => m.id}
          renderItem={({ item }) => <ChatMessage message={item} />}
          contentContainerStyle={{ paddingVertical: 12 }}
        />
      )}

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={{ color: C.textSecondary, marginLeft: 8 }}>Asistent gândește…</Text>
        </View>
      )}

      {usage.isBuiltin && (
        <Text
          style={[
            styles.quota,
            {
              color: quotaReached
                ? '#D84C4C'
                : usage.used >= DAILY_AI_LIMIT * 0.8
                  ? '#E8A53A'
                  : C.textSecondary,
            },
          ]}
        >
          {usage.used}/{DAILY_AI_LIMIT} azi
        </Text>
      )}

      {quotaReached && (
        <View style={[styles.banner, { backgroundColor: 'rgba(216,76,76,0.12)' }]}>
          <Text style={{ color: '#D84C4C', flex: 1 }}>
            Ai atins limita zilnică. Configurează cheia proprie din Setări.
          </Text>
          <Pressable onPress={() => router.push('/setari' as never)}>
            <Text style={{ color: '#D84C4C', fontWeight: '600' }}>Setări AI</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.inputRow, { borderTopColor: C.border, backgroundColor: C.card }]}>
        <TextInput
          style={[styles.input, { color: C.text }]}
          placeholder="Întreabă ceva..."
          placeholderTextColor={C.textSecondary}
          value={input}
          onChangeText={setInput}
          editable={!quotaReached && !loading}
          multiline
        />
        <Pressable
          style={[
            styles.sendBtn,
            {
              backgroundColor:
                input.trim() && !loading && !quotaReached ? C.primary : C.border,
            },
          ]}
          onPress={() => onSend()}
          disabled={!input.trim() || loading || quotaReached}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 16, marginTop: 16, textAlign: 'center' },
  emptySubtext: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, margin: 4 },
  chipText: { fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  button: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 16 },
  quota: { fontSize: 11, paddingHorizontal: 16, paddingVertical: 4, textAlign: 'right' },
  banner: { flexDirection: 'row', alignItems: 'center', padding: 12, marginHorizontal: 8, borderRadius: 8 },
});
```

- [ ] **Step 2: Type-check + lint**

```bash
cd /Users/ax/work/finante && npm run lint -- "app/(tabs)/assistant.tsx" && npm run type-check
```

Expected: zero erori. Dacă `C.primary` nu există în `Colors`, folosește `primary` din `@/theme/colors`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ax/work/finante && git add "app/(tabs)/assistant.tsx" && git commit -m "feat(ui): ecran tab Asistent (chat, empty state, cota, evidence)"
```

---

## Task 13: Adaugă tab-ul Asistent în `_layout.tsx`

**Files:**

- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Adaugă `<Tabs.Screen name="assistant" ...>` între `categorii` și `evolutie`**

```tsx
<Tabs.Screen
  name="assistant"
  options={{
    title: 'Asistent',
    tabBarIcon: ({ color }) => <Ionicons name="chatbubbles" size={22} color={color} />,
  }}
/>
```

Cele 5 tab-uri vizibile devin: Sumar, Conturi, Tranzacții, Categorii, Asistent.

- [ ] **Step 2: Verifică manual**

```bash
cd /Users/ax/work/finante && npm start
```

Deschide Sumar → header are ⚙️. Tap ⚙️ → Setări. Tab bar: 5 tab-uri, ultimul Asistent. Tap Asistent → empty state cu chips. Tap pe chip „La ce bănci am cont?" → primește răspuns. Tap „Sursa: N" → expand. Tap pe item → deep-link.

- [ ] **Step 3: Commit**

```bash
cd /Users/ax/work/finante && git add "app/(tabs)/_layout.tsx" && git commit -m "feat(nav): adaugă tab Asistent în tab bar"
```

---

## Task 14: Test integration end-to-end

**Files:**

- Create: `__tests__/unit/aiChat.integration.test.ts` (sau extinde `aiChat.test.ts`)

- [ ] **Step 1: Scrie test integration**

În `__tests__/unit/aiChat.test.ts`, adaugă un `describe` separat:

```typescript
describe('askAssistant integration — răspunde corect pentru toate exemplele user', () => {
  it.each([
    {
      q: 'La ce bănci am cont?',
      sql: 'SELECT id, name, type, currency, initial_balance FROM financial_accounts WHERE archived = 0 LIMIT 50',
      template: 'list_accounts',
      rows: [
        { id: 'a1', name: 'BT', type: 'bank', currency: 'RON', initial_balance: 100 },
        { id: 'a2', name: 'ING', type: 'bank', currency: 'RON', initial_balance: 200 },
      ],
      expectInText: ['2 conturi', 'BT', 'ING'],
    },
    {
      q: 'Tranzacții McDonalds în BT',
      sql: "SELECT * FROM transactions WHERE merchant LIKE '%MCD%' LIMIT 100",
      template: 'search_merchant',
      rows: [
        {
          id: 't1',
          date: '2026-03-12',
          amount: -25,
          amount_ron: -25,
          merchant: 'MCDONALDS',
          account_id: 'a1',
          category_id: null,
          description: null,
        },
      ],
      expectInText: ['1 tranzacții', 'MCDONALDS'],
    },
  ])('răspunde la: $q', async ({ q, sql, template, rows, expectInText }) => {
    sendAiRequestMock.mockResolvedValue(
      JSON.stringify({
        sql,
        template,
        params: { merchant: 'MCDONALDS' },
        explanation_short: 'x',
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const r = await askAssistant(q);
    for (const expected of expectInText) {
      expect(r.assistant.content).toContain(expected);
    }
  });
});
```

- [ ] **Step 2: Rulează testul**

```bash
cd /Users/ax/work/finante && npm test -- __tests__/unit/aiChat.test.ts
```

Expected: PASS toate.

- [ ] **Step 3: Commit**

```bash
cd /Users/ax/work/finante && git add __tests__/unit/aiChat.test.ts && git commit -m "test(aiChat): integration end-to-end pentru exemplele user-ului"
```

---

## Task 15: Update documentație și sync hooks

**Files:**

- Modify: `docs/IDEAS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `CLAUDE.md` (doar dacă apare convenție nouă — probabil nu)

- [ ] **Step 1: IDEAS.md — adaugă feature la status implementat**

În `docs/IDEAS.md`, după secțiunea „Funcții avansate", adaugă o secțiune nouă „Implementat":

```markdown
## Implementat (post-MVP fundație)

- **Asistent AI conversațional** — tab dedicat „Asistent" peste tab Setări (mutat în header Sumar).
  AI traduce întrebări în SQL SELECT (read-only, defense-in-depth via guard + PRAGMA query_only),
  app formează răspunsul prin template-uri locale (zero halucinare numerică).
  Spec: `docs/specs/2026-04-29-ai-chatbot-design.md`. Plan: `docs/plans/2026-04-29-ai-chatbot.md`.
```

Și actualizează data: `**Ultima actualizare:** 2026-04-29.`

- [ ] **Step 2: ARCHITECTURE.md — adaugă servicii noi în tabel**

În `docs/ARCHITECTURE.md`, în tabelul `services/`, adaugă:

```markdown
| `aiChat.ts` | orchestrator chat AI (SQL gen → guard → execute → format) |
| `aiChatPrompt.ts` | construire system prompt + history compaction |
| `aiChatSqlGuard.ts` | validare SQL allowlist + clamp LIMIT |
| `aiChatTemplates.ts` | template-uri formatare răspuns determinist |
| `aiChatRepo.ts` | CRUD pe tabel chat_messages |
```

Și adaugă în secțiunea „Schema SQLite":

```markdown
| `chat_messages` | istoric conversație Asistent AI |
```

Update data: `**Ultima actualizare:** 2026-04-29.`

- [ ] **Step 3: CLAUDE.md — verifică dacă apare convenție nouă**

Dacă nu apare nimic nou de notat (toate convențiile existente — services pure, RO, alias, etc.) — sări peste.

- [ ] **Step 4: Commit**

```bash
cd /Users/ax/work/finante && git add docs/IDEAS.md docs/ARCHITECTURE.md CLAUDE.md 2>/dev/null && git commit -m "docs: update IDEAS și ARCHITECTURE pentru Asistent AI"
```

---

## Task 16: Run final `npm run check` și fix tot ce eșuează

**Files:** —

- [ ] **Step 1: Rulează lanțul complet**

```bash
cd /Users/ax/work/finante && npm run check
```

Expected: PASS.

Posibile probleme:

- **knip** se plânge de import-uri/exports nefolosite — fix prin eliminare.
- **madge** detectează cicluri — refactor minor.
- **dep-cruise** semnalează că `services/aiChat*` importă din `components/`/`app/` — refactor: extrage tipurile în `types/chat.ts` (deja Task 3).
- **type-coverage <97%** — fix tipuri `unknown`/`any` rezidual.

Reorganizează commits pe categorii dacă apar fix-uri.

- [ ] **Step 2: Verificare manuală exemplele user-ului**

În simulator, cu DB demo (`services/demoData.ts` rulat), testează:

1. „La ce bănci am cont?" → răspuns + sursă cu lista conturilor.
2. „De unde cumpăr cea mai multă mâncare?" → top merchants pe categoria food.
3. „În contul BT_curent_ron am cumpărat ceva de la MCDONALDS?" → search_merchant cu filtru cont.
4. „Anul ăsta sau anul trecut am cumparat mai mult de la macdonands?" → period_compare.
5. „Cum au evoluat cheltuielile cu intretinerea fata de anul trecut?" → category_evolution.
6. Multi-turn: „Și luna trecută?" după întrebarea 4 — verifică că AI prinde context.
7. Buton ⋮ „Șterge conversația" → confirmă, lista se golește.
8. Empty state cu chips funcționează.

- [ ] **Step 3: Commit final dacă au rămas fix-uri**

```bash
cd /Users/ax/work/finante && git add -p && git commit -m "fix: rezolvări post npm run check"
```

---

## Self-review notes (deja aplicate la scriere)

**Spec coverage check:**

- ✅ Tab nou Asistent (Task 11-13).
- ✅ AI generează SQL + safeguards (Task 5, 8).
- ✅ Multi-turn cu fereastră 4 (Task 7, 8).
- ✅ Evidence collapsible (Task 9, 10).
- ✅ Persistare SQLite (Task 2, 4).
- ✅ Template-uri locale, zero halucinare (Task 6).
- ✅ Hard block la cota (Task 8, 12).
- ✅ Consent global (Task 12).
- ✅ Setări mutat din tab (Task 11).
- ✅ Documentație (Task 15).
- ✅ Tests pe toate layer-ele (Task 4-8, 14).

**Type consistency:**

- `ChatTemplate`, `EvidenceItem`, `ChatMessage` definite în Task 3, folosite consistent peste tot.
- `CtxLookups` consumate de `formatResponse` (Task 6) și produse în `aiChat.loadCtx` (Task 8).
- `AskResult` din Task 8 e tipul de return pentru `askAssistant` — compatibil cu UI care recheamă `listMessages` (nu folosește direct AskResult).

**Open verification points (rezolvate la implementare):**

- `db.execAsync` vs `db.runAsync` pentru PRAGMA — Task 8 step 4 verifică și ajustează.
- `getAccounts` signature — Task 8 step 4 verifică.
- `Colors[scheme].primary` vs `primary` from `@/theme/colors` — Task 9, 10, 12 verifică și adaptează.

---

**Plan complete și saved to `docs/plans/2026-04-29-ai-chatbot.md`.**
