# Sugestie alimentare transfer intern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizează feature-ul existent „sugestie alimentare cash" la trei tipuri de transferuri interne (cash, transfer la economii/depozit, retragere din economii/depozit) detectate automat din extrasul contului curent.

**Architecture:** Refactor `services/cashSuggestion.ts` → `services/internalTransferSuggestion.ts` cu un singur tip discriminant `TransferType = 'cash' | 'savings_out' | 'savings_in'`. Detecția se face cu trei regex separate (cash → savings_out → savings_in) pe `description + merchant` normalizat. `convertToTransfer` extins bidirecțional: sursă `amount < 0` (cash/savings_out) sau `amount > 0` (savings_in). Schema DB neschimbată — `cash_suggestion_dismissed` rămâne ca flag generic per-tx. Componente și rute renumite în paralel cu refactor-ul. Pre-existent: serviciul (`cashSuggestion.ts`), banner-ul, ecranul batch (`app/sugestie-cash/`), toggle-ul inline și hook-ul post-import.

**Tech Stack:** TypeScript strict, React Native + Expo Router v3, expo-sqlite, Jest cu mock-uri din `__tests__/setup.ts`, Ionicons, theme tokens via `@/constants/Colors` + `@/components/useColorScheme`.

**Spec source:** `docs/specs/2026-05-04-internal-transfer-suggestion-design.md`

---

## File Structure

**Servicii (logică pură):**

- `services/internalTransferSuggestion.ts` — NEW. Conține `TransferType`, `PendingTransferSuggestion`, `detectTransferType`, `listPendingTransferSuggestions`, `countPendingTransferSuggestions`, `dismissTransferSuggestion`, `convertToTransfer` (bidirecțional). Înlocuiește `services/cashSuggestion.ts`.

**Componente UI:**

- `components/TransferSuggestionBanner.tsx` — NEW (renames `CashSuggestionBanner.tsx`). Banner pe Sumar cu count + tap → `/sugestie-transfer/batch`.
- `components/InternalTransferToggle.tsx` — NEW (renames `CashWithdrawalToggle.tsx`). Toggle inline cu auto-detect bidirecțional și label adaptiv per tip.

**Rute:**

- `app/sugestie-transfer/_layout.tsx` — NEW (renames `app/sugestie-cash/_layout.tsx`).
- `app/sugestie-transfer/batch.tsx` — NEW (renames `app/sugestie-cash/batch.tsx`). Listă batch cu badge tip per rând și filtrare cont destinație pe tip detectat.

**Consumeri actualizați:**

- `app/(tabs)/index.tsx` — schimbă import banner.
- `app/tranzactii/[id].tsx` — schimbă import toggle, redenumește variabile state.
- `app/conturi/import.tsx` — schimbă URL post-import + import service.

**Teste:**

- `__tests__/unit/internalTransferSuggestion.test.ts` — NEW (înlocuiește `cashSuggestion.test.ts`). Acoperă `detectTransferType` (toate 3 tipuri + null cases) și CRUD list/count/dismiss.
- `__tests__/unit/internalTransferSuggestionFlow.test.ts` — NEW (înlocuiește `cashSuggestionFlow.test.ts`). Acoperă list → convert → dismiss.
- `__tests__/unit/internalTransferSuggestionFx.test.ts` — NEW (înlocuiește `cashSuggestionFx.test.ts`). Ramura FX non-RON.

**Docs:**

- `docs/IDEAS.md` — înlocuiește entry „cash" cu entry generalizat.
- `docs/ARCHITECTURE.md` — actualizează rândul services + bump dată.

---

## Task ordering rationale

1. **Service nou** ÎNAINTEA migrării consumerilor — se construiește pe lateral, fără a sparge ce există.
2. **Batch screen** ÎNAINTEA banner-ului — banner-ul navighează la batch; e nevoie ca ruta să existe la migrare.
3. **Hook post-import** după batch — același motiv.
4. **Banner** după batch.
5. **Toggle inline** independent — poate veni oricând după service.
6. **Ștergere service vechi + teste vechi** la finalul migrării.
7. **Docs sync** la final.
8. **`npm run check`** ca verificare globală.

Între task-uri, build-ul rămâne verde: testele vechi încă rulează pe serviciul vechi care încă există; testele noi rulează pe serviciul nou. Importurile sunt migrate progresiv.

---

## Task 1: Service — `internalTransferSuggestion.ts` cu detect + list + count + dismiss + convert bidirecțional

**Files:**

- Create: `services/internalTransferSuggestion.ts`
- Test: `__tests__/unit/internalTransferSuggestion.test.ts`
- Test: `__tests__/unit/internalTransferSuggestionFlow.test.ts`
- Test: `__tests__/unit/internalTransferSuggestionFx.test.ts`

- [ ] **Step 1: Scrie test pentru `detectTransferType`**

Creează `__tests__/unit/internalTransferSuggestion.test.ts` cu:

```typescript
import {
  detectTransferType,
  countPendingTransferSuggestions,
  dismissTransferSuggestion,
  listPendingTransferSuggestions,
  convertToTransfer,
} from '@/services/internalTransferSuggestion';
import { db } from '@/services/db';
import type { Transaction } from '@/types';

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    date: '2026-05-01',
    amount: -500,
    currency: 'RON',
    source: 'manual',
    is_internal_transfer: false,
    is_refund: false,
    cash_suggestion_dismissed: false,
    createdAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('detectTransferType — cash', () => {
  it.each([
    ['RETRAGERE NUMERAR ATM BCR BUCURESTI', null],
    ['retragere atm', null],
    ['bancomat OTP', null],
    ['atm transilvania', null],
    [null, 'ATM Revolut'],
    ['cash withdrawal', null],
    ['extragere numerar', null],
    ['Extrăgere Numerar', null],
  ])('detectează cash pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectTransferType(tx)).toBe('cash');
  });

  it('cash priority peste savings când ambele match', () => {
    const tx = makeTx({ description: 'retragere economii ATM' });
    expect(detectTransferType(tx)).toBe('cash');
  });
});

describe('detectTransferType — savings_out', () => {
  it.each([
    'transfer la economii',
    'transfer spre economii',
    'transfer catre depozit',
    'alimentare cont economii',
    'alimentare economii',
    'constituire depozit BCR 6M',
    'economisire automata',
    'Alimentare Economii',
    'Constituire Depozit',
  ])('detectează savings_out pe %p', description => {
    const tx = makeTx({ description, amount: -1000 });
    expect(detectTransferType(tx)).toBe('savings_out');
  });
});

describe('detectTransferType — savings_in', () => {
  it.each([
    'transfer din economii',
    'transfer de la economii',
    'transfer din depozit',
    'retragere economii',
    'retragere din economii',
    'lichidare depozit',
    'Lichidare Depozit BCR',
  ])('detectează savings_in pe %p', description => {
    const tx = makeTx({ description, amount: 1000 });
    expect(detectTransferType(tx)).toBe('savings_in');
  });

  it('savings_in nu match dacă amount e negativ', () => {
    const tx = makeTx({ description: 'transfer din economii', amount: -100 });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('cash savings_out nu match pentru amount > 0', () => {
    const tx = makeTx({ description: 'retragere atm', amount: 100 });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('dobanda lunara cont NU match savings_in', () => {
    const tx = makeTx({ description: 'dobanda lunara cont', amount: 50 });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('capitalizare dobanda NU match savings_in', () => {
    const tx = makeTx({ description: 'capitalizare dobanda', amount: 30 });
    expect(detectTransferType(tx)).toBeNull();
  });
});

describe('detectTransferType — null cases', () => {
  it.each([
    ['atmosferă restaurant', null],
    ['caratm SRL', null],
    ['cumpărare card MEGA IMAGE', null],
    [null, null],
    ['', ''],
  ])('returnează null pentru %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectTransferType(tx)).toBeNull();
  });

  it('returnează null pentru tranzacții transfer intern deja convertite', () => {
    const tx = makeTx({ is_internal_transfer: true, description: 'ATM BCR' });
    expect(detectTransferType(tx)).toBeNull();
  });
});

function rowFor(
  over: Partial<{
    id: string;
    account_id: string;
    date: string;
    amount: number;
    currency: string;
    description: string;
    merchant: string;
    source: string;
    is_internal_transfer: number;
    cash_suggestion_dismissed: number;
    duplicate_of_id: string | null;
  }>
) {
  return {
    id: over.id ?? 'tx-1',
    account_id: over.account_id ?? 'acc-bank',
    date: over.date ?? '2026-05-01',
    amount: over.amount ?? -500,
    currency: over.currency ?? 'RON',
    amount_ron: null,
    description: over.description ?? 'RETRAGERE ATM BCR',
    merchant: over.merchant ?? null,
    category_id: null,
    source: over.source ?? 'manual',
    statement_id: null,
    is_internal_transfer: over.is_internal_transfer ?? 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: over.duplicate_of_id ?? null,
    cash_suggestion_dismissed: over.cash_suggestion_dismissed ?? 0,
    notes: null,
    created_at: '2026-05-01T10:00:00.000Z',
  };
}

describe('listPendingTransferSuggestions / countPendingTransferSuggestions', () => {
  beforeEach(() => {
    (db.getAllAsync as jest.Mock).mockReset();
  });

  it('SQL exclude transfer/dismissed/duplicate, sortat date DESC, fără filtru pe semn amount', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await listPendingTransferSuggestions();
    const calls = (db.getAllAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toMatch(/is_internal_transfer\s*=\s*0/);
    expect(sql).toMatch(/cash_suggestion_dismissed\s*=\s*0/);
    expect(sql).toMatch(/duplicate_of_id IS NULL/);
    expect(sql).toMatch(/ORDER BY date DESC/);
    expect(sql).not.toMatch(/amount\s*<\s*0/);
    expect(params).toEqual(['-365 days']);
  });

  it('populează suggested_type pe fiecare rând returnat', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      rowFor({ id: 'a', amount: -100, description: 'ATM BCR' }),
      rowFor({ id: 'b', amount: -200, description: 'transfer la economii' }),
      rowFor({ id: 'c', amount: 300, description: 'lichidare depozit' }),
      rowFor({ id: 'd', description: 'cumpărare card MEGA' }),
    ]);
    const pending = await listPendingTransferSuggestions();
    expect(pending.map(p => ({ id: p.id, suggested_type: p.suggested_type }))).toEqual([
      { id: 'a', suggested_type: 'cash' },
      { id: 'b', suggested_type: 'savings_out' },
      { id: 'c', suggested_type: 'savings_in' },
    ]);
  });

  it('respectă limitul default (10) după filtrare', async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      rowFor({
        id: `tx-${i}`,
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      })
    );
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const pending = await listPendingTransferSuggestions();
    expect(pending).toHaveLength(10);
  });

  it('respectă limitul custom', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => rowFor({ id: `tx-${i}` }));
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);
    const pending = await listPendingTransferSuggestions({ limit: 3 });
    expect(pending).toHaveLength(3);
  });

  it('trece sinceDays custom în SQL ca `-N days`', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await listPendingTransferSuggestions({ sinceDays: 30 });
    const params = (db.getAllAsync as jest.Mock).mock.calls[0][1];
    expect(params).toEqual(['-30 days']);
  });

  it('countPendingTransferSuggestions întoarce numărul filtrat (cumulat pe toate tipurile)', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      rowFor({ id: 'a', amount: -100, description: 'ATM BCR' }),
      rowFor({ id: 'b', amount: -200, description: 'transfer la economii' }),
      rowFor({ id: 'c', amount: 300, description: 'lichidare depozit' }),
      rowFor({ id: 'd', description: 'cumpărare card MEGA' }),
    ]);
    expect(await countPendingTransferSuggestions()).toBe(3);
  });
});

describe('dismissTransferSuggestion', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
  });

  it('apelează UPDATE cu cash_suggestion_dismissed = 1 și id corect', async () => {
    await dismissTransferSuggestion('tx-123');
    expect(db.runAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = (db.runAsync as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/UPDATE transactions/);
    expect(sql).toMatch(/SET cash_suggestion_dismissed\s*=\s*1/);
    expect(sql).toMatch(/WHERE id\s*=\s*\?/);
    expect(params).toEqual(['tx-123']);
  });
});

describe('convertToTransfer — direcție outbound (amount < 0)', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  });

  it('happy path cash: actualizează sursa și inserează jumătate-cash legate reciproc', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-src',
          account_id: 'acc-bank',
          amount: -500,
          currency: 'RON',
          description: 'RETRAGERE ATM BCR',
          source: 'statement',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-cash', type: 'cash', currency: 'RON' });

    await convertToTransfer('tx-src', 'acc-cash');

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
    const calls = (db.runAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);

    const [updateSql, updateParams] = calls[0];
    expect(updateSql).toMatch(/UPDATE transactions/);
    expect(updateSql).toMatch(/is_internal_transfer\s*=\s*1/);
    expect(updateSql).toMatch(/cash_suggestion_dismissed\s*=\s*1/);
    expect(updateParams[1]).toBe('cat-sys-transfer');
    expect(updateParams[2]).toBe('tx-src');

    const [insertSql, insertParams] = calls[1];
    expect(insertSql).toMatch(/INSERT INTO transactions/);
    expect(insertParams[1]).toBe('acc-cash');
    expect(insertParams[3]).toBe(500); // amount inversat
    expect(insertParams[5]).toBe(500); // amount_ron pentru RON
  });

  it('happy path savings_out: target savings primește mirror pozitiv', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-src',
          amount: -1000,
          description: 'transfer la economii',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });

    await convertToTransfer('tx-src', 'acc-savings');

    const calls = (db.runAsync as jest.Mock).mock.calls;
    const insertParams = calls[1][1];
    expect(insertParams[1]).toBe('acc-savings');
    expect(insertParams[3]).toBe(1000); // mirror pozitiv
  });

  it('throw dacă sursa nu există', async () => {
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(null);
    await expect(convertToTransfer('tx-missing', 'acc-cash')).rejects.toThrow(/sursă/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă sursa e deja transfer intern', async () => {
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(
      rowFor({ id: 'tx-src', is_internal_transfer: 1 })
    );
    await expect(convertToTransfer('tx-src', 'acc-cash')).rejects.toThrow(/deja transfer/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target nu există', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src' }))
      .mockResolvedValueOnce(null);
    await expect(convertToTransfer('tx-src', 'acc-missing')).rejects.toThrow(/destinație/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target e cont curent (bank), nu cash/savings', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src' }))
      .mockResolvedValueOnce({ id: 'acc-bank2', type: 'bank', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-bank2')).rejects.toThrow(
      /cash|economii|savings/i
    );
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target e card', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src' }))
      .mockResolvedValueOnce({ id: 'acc-card', type: 'card', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-card')).rejects.toThrow(/cash|economii|savings/i);
  });

  it('throw dacă valutele nu se potrivesc', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src', currency: 'EUR', amount: -100 }))
      .mockResolvedValueOnce({ id: 'acc-cash-ron', type: 'cash', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-cash-ron')).rejects.toThrow(/valut[ăa]/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });
});

describe('convertToTransfer — direcție inbound (amount > 0, savings_in)', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  });

  it('happy path: target savings primește mirror NEGATIV (banii ies din economii)', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-src',
          amount: 800,
          description: 'lichidare depozit',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });

    await convertToTransfer('tx-src', 'acc-savings');

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
    const calls = (db.runAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    const insertParams = calls[1][1];
    expect(insertParams[1]).toBe('acc-savings'); // account_id
    expect(insertParams[3]).toBe(-800); // mirror NEGATIV
    expect(insertParams[5]).toBe(-800); // amount_ron RON
  });

  it('throw dacă target e cash (savings_in necesită savings)', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({ id: 'tx-src', amount: 500, description: 'lichidare depozit' })
      )
      .mockResolvedValueOnce({ id: 'acc-cash', type: 'cash', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-cash')).rejects.toThrow(/economii|savings/i);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('throw dacă target e bank', async () => {
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-src', amount: 500 }))
      .mockResolvedValueOnce({ id: 'acc-bank2', type: 'bank', currency: 'RON' });
    await expect(convertToTransfer('tx-src', 'acc-bank2')).rejects.toThrow(/economii|savings/i);
  });
});
```

- [ ] **Step 2: Rulează testul ca să confirmi că eșuează (modulul nu există încă)**

Run: `npx jest __tests__/unit/internalTransferSuggestion.test.ts`
Expected: FAIL — `Cannot find module '@/services/internalTransferSuggestion'`

- [ ] **Step 3: Implementează `services/internalTransferSuggestion.ts`**

Creează `services/internalTransferSuggestion.ts`:

```typescript
import { db, generateId } from './db';
import { getRateRon } from './fxRates';

import type { Transaction } from '@/types';

export type TransferType = 'cash' | 'savings_out' | 'savings_in';

const CASH_RE = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;
const SAVINGS_OUT_RE =
  /\b(transfer\s+(la|spre|catre)\s+(economii|depozit)|alimentare\s+(cont\s+)?economii|constituire\s+depozit|economisire)\b/i;
const SAVINGS_IN_RE =
  /\b(transfer\s+(din|de\s+la)\s+(economii|depozit)|retragere\s+(din\s+)?economii|lichidare\s+depozit)\b/i;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function detectTransferType(tx: Transaction): TransferType | null {
  if (tx.is_internal_transfer) return null;
  const haystack = normalize(`${tx.description ?? ''} ${tx.merchant ?? ''}`);
  if (tx.amount < 0) {
    if (CASH_RE.test(haystack)) return 'cash';
    if (SAVINGS_OUT_RE.test(haystack)) return 'savings_out';
    return null;
  }
  if (tx.amount > 0) {
    if (SAVINGS_IN_RE.test(haystack)) return 'savings_in';
    return null;
  }
  return null;
}

export interface PendingTransferSuggestion extends Transaction {
  suggested_type: TransferType;
}

type Row = {
  id: string;
  account_id: string | null;
  date: string;
  amount: number;
  currency: string;
  amount_ron: number | null;
  description: string | null;
  merchant: string | null;
  category_id: string | null;
  source: string;
  statement_id: string | null;
  is_internal_transfer: number;
  linked_transaction_id: string | null;
  is_refund: number;
  duplicate_of_id: string | null;
  cash_suggestion_dismissed: number;
  notes: string | null;
  created_at: string;
};

function rowToTx(r: Row): Transaction {
  return {
    id: r.id,
    account_id: r.account_id ?? undefined,
    date: r.date,
    amount: r.amount,
    currency: r.currency || 'RON',
    amount_ron: r.amount_ron ?? undefined,
    description: r.description ?? undefined,
    merchant: r.merchant ?? undefined,
    category_id: r.category_id ?? undefined,
    source: (r.source ?? 'manual') as Transaction['source'],
    statement_id: r.statement_id ?? undefined,
    is_internal_transfer: r.is_internal_transfer === 1,
    linked_transaction_id: r.linked_transaction_id ?? undefined,
    is_refund: r.is_refund === 1,
    duplicate_of_id: r.duplicate_of_id ?? undefined,
    cash_suggestion_dismissed: r.cash_suggestion_dismissed === 1,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

interface ListOptions {
  limit?: number;
  sinceDays?: number;
}

async function fetchCandidates(sinceDays: number): Promise<PendingTransferSuggestion[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM transactions
       WHERE is_internal_transfer = 0
         AND cash_suggestion_dismissed = 0
         AND duplicate_of_id IS NULL
         AND date >= date('now', ?)
       ORDER BY date DESC, created_at DESC`,
    [`-${sinceDays} days`]
  );
  const out: PendingTransferSuggestion[] = [];
  for (const r of rows) {
    const tx = rowToTx(r);
    const type = detectTransferType(tx);
    if (type) out.push({ ...tx, suggested_type: type });
  }
  return out;
}

export async function listPendingTransferSuggestions(
  opts: ListOptions = {}
): Promise<PendingTransferSuggestion[]> {
  const limit = opts.limit ?? 10;
  const sinceDays = opts.sinceDays ?? 365;
  const candidates = await fetchCandidates(sinceDays);
  return candidates.slice(0, limit);
}

export async function countPendingTransferSuggestions(opts: ListOptions = {}): Promise<number> {
  const sinceDays = opts.sinceDays ?? 365;
  const candidates = await fetchCandidates(sinceDays);
  return candidates.length;
}

export async function dismissTransferSuggestion(txId: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET cash_suggestion_dismissed = 1 WHERE id = ?', [txId]);
}

const TRANSFER_CATEGORY_ID = 'cat-sys-transfer';

export async function convertToTransfer(
  sourceTxId: string,
  targetAccountId: string
): Promise<void> {
  const sourceRow = await db.getFirstAsync<Row>('SELECT * FROM transactions WHERE id = ?', [
    sourceTxId,
  ]);
  if (!sourceRow) throw new Error('Tranzacția sursă nu există.');
  const source = rowToTx(sourceRow);
  if (source.is_internal_transfer) {
    throw new Error('Tranzacția este deja transfer intern.');
  }
  if (source.amount === 0) {
    throw new Error('Tranzacția are sumă zero, nu poate fi convertită.');
  }

  const target = await db.getFirstAsync<{
    id: string;
    type: string;
    currency: string;
  }>('SELECT id, type, currency FROM financial_accounts WHERE id = ?', [targetAccountId]);
  if (!target) throw new Error('Contul destinație nu există.');

  if (source.amount < 0) {
    if (target.type !== 'cash' && target.type !== 'savings') {
      throw new Error('Contul destinație trebuie să fie de tip cash sau economii.');
    }
  } else {
    if (target.type !== 'savings') {
      throw new Error('Pentru transferurile inbound, contul destinație trebuie să fie economii.');
    }
  }

  if (target.currency !== source.currency) {
    throw new Error(
      `Valuta nu se potrivește: sursa e ${source.currency}, contul destinație e ${target.currency}.`
    );
  }

  const pairId = generateId();
  const pairAmount = -source.amount;
  let pairAmountRon: number | null = source.currency === 'RON' ? pairAmount : null;
  if (source.currency !== 'RON') {
    try {
      const rate = await getRateRon(source.date, source.currency);
      pairAmountRon = pairAmount * rate;
    } catch {
      pairAmountRon = null;
    }
  }
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE transactions
         SET is_internal_transfer = 1,
             linked_transaction_id = ?,
             category_id = ?,
             cash_suggestion_dismissed = 1
         WHERE id = ?`,
      [pairId, TRANSFER_CATEGORY_ID, sourceTxId]
    );

    await db.runAsync(
      `INSERT INTO transactions
         (id, account_id, date, amount, currency, amount_ron, description, merchant,
          category_id, source, statement_id,
          is_internal_transfer, linked_transaction_id, is_refund, duplicate_of_id,
          cash_suggestion_dismissed, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, 0, NULL, 0, ?, ?)`,
      [
        pairId,
        targetAccountId,
        source.date,
        pairAmount,
        source.currency,
        pairAmountRon,
        source.description ?? null,
        source.merchant ?? null,
        TRANSFER_CATEGORY_ID,
        source.source,
        sourceTxId,
        source.notes ?? null,
        now,
      ]
    );
  });
}
```

- [ ] **Step 4: Rulează testul ca să confirmi că trece**

Run: `npx jest __tests__/unit/internalTransferSuggestion.test.ts`
Expected: PASS — toate testele verzi.

- [ ] **Step 5: Scrie test flow integrat**

Creează `__tests__/unit/internalTransferSuggestionFlow.test.ts`:

```typescript
import {
  convertToTransfer,
  countPendingTransferSuggestions,
  dismissTransferSuggestion,
  listPendingTransferSuggestions,
} from '@/services/internalTransferSuggestion';
import { db } from '@/services/db';

function makeRow(id: string, date: string, amount: number, description: string, currency = 'RON') {
  return {
    id,
    account_id: 'acc-bank',
    date,
    amount,
    currency,
    amount_ron: null,
    description,
    merchant: null,
    category_id: null,
    source: 'statement',
    statement_id: null,
    is_internal_transfer: 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: null,
    cash_suggestion_dismissed: 0,
    notes: null,
    created_at: '2026-05-01T10:00:00.000Z',
  };
}

describe('internal transfer suggestion flow', () => {
  beforeEach(() => {
    (db.getAllAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
  });

  it('list mixt (cash + savings_out + savings_in) → convert pe fiecare → 3 perechi atomice', async () => {
    const rows = [
      makeRow('tx-1', '2026-05-03', -100, 'RETRAGERE ATM 1'),
      makeRow('tx-2', '2026-05-02', -200, 'transfer la economii'),
      makeRow('tx-3', '2026-05-01', 300, 'lichidare depozit'),
    ];
    (db.getAllAsync as jest.Mock).mockResolvedValue(rows);

    const pending = await listPendingTransferSuggestions();
    expect(pending.map(p => ({ id: p.id, type: p.suggested_type }))).toEqual([
      { id: 'tx-1', type: 'cash' },
      { id: 'tx-2', type: 'savings_out' },
      { id: 'tx-3', type: 'savings_in' },
    ]);

    // tx-1: target cash
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rows[0])
      .mockResolvedValueOnce({ id: 'acc-cash', type: 'cash', currency: 'RON' });
    await convertToTransfer('tx-1', 'acc-cash');

    // tx-2: target savings (savings_out)
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rows[1])
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });
    await convertToTransfer('tx-2', 'acc-savings');

    // tx-3: target savings (savings_in, mirror negativ)
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rows[2])
      .mockResolvedValueOnce({ id: 'acc-savings', type: 'savings', currency: 'RON' });
    await convertToTransfer('tx-3', 'acc-savings');

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(3);
    expect((db.runAsync as jest.Mock).mock.calls).toHaveLength(6);

    const calls = (db.runAsync as jest.Mock).mock.calls;
    expect(calls[0][0]).toMatch(/UPDATE transactions/);
    expect(calls[1][0]).toMatch(/INSERT INTO transactions/);
    expect(calls[1][1][3]).toBe(100); // cash mirror pozitiv
    expect(calls[3][1][3]).toBe(200); // savings_out mirror pozitiv
    expect(calls[5][1][3]).toBe(-300); // savings_in mirror NEGATIV
  });

  it('dismiss → SQL filter exclude tranzacția pe interogarea următoare', async () => {
    const row = makeRow('tx-1', '2026-05-01', -500, 'RETRAGERE ATM');
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([row]);
    expect(await countPendingTransferSuggestions()).toBe(1);

    await dismissTransferSuggestion('tx-1');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('cash_suggestion_dismissed = 1'),
      ['tx-1']
    );

    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([]);
    expect(await countPendingTransferSuggestions()).toBe(0);
  });
});
```

- [ ] **Step 6: Rulează testul flow**

Run: `npx jest __tests__/unit/internalTransferSuggestionFlow.test.ts`
Expected: PASS.

- [ ] **Step 7: Scrie test pentru ramura FX non-RON**

Creează `__tests__/unit/internalTransferSuggestionFx.test.ts`:

```typescript
import { convertToTransfer } from '@/services/internalTransferSuggestion';
import { db } from '@/services/db';
import { getRateRon } from '@/services/fxRates';

jest.mock('@/services/fxRates', () => ({
  __esModule: true,
  getRateRon: jest.fn(),
}));

const mockGetRateRon = getRateRon as jest.Mock;

function rowFor(
  over: Partial<{
    id: string;
    account_id: string;
    date: string;
    amount: number;
    currency: string;
    description: string;
    merchant: string;
  }>
) {
  return {
    id: over.id ?? 'tx-1',
    account_id: over.account_id ?? 'acc-bank',
    date: over.date ?? '2026-05-01',
    amount: over.amount ?? -500,
    currency: over.currency ?? 'RON',
    amount_ron: null,
    description: over.description ?? 'RETRAGERE ATM BCR',
    merchant: over.merchant ?? null,
    category_id: null,
    source: 'manual',
    statement_id: null,
    is_internal_transfer: 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: null,
    cash_suggestion_dismissed: 0,
    notes: null,
    created_at: '2026-05-01T10:00:00.000Z',
  };
}

describe('convertToTransfer — ramură FX non-RON', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockReset();
    (db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    (db.getFirstAsync as jest.Mock).mockReset();
    (db.withTransactionAsync as jest.Mock).mockClear();
    (db.withTransactionAsync as jest.Mock).mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    });
    mockGetRateRon.mockReset();
  });

  it('cash EUR: pairAmountRon calculat din rate BNR', async () => {
    mockGetRateRon.mockResolvedValue(5);
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-eur',
          currency: 'EUR',
          amount: -100,
          description: 'ATM Revolut',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-cash-eur', type: 'cash', currency: 'EUR' });

    await convertToTransfer('tx-eur', 'acc-cash-eur');

    const insertParams = (db.runAsync as jest.Mock).mock.calls[1][1];
    expect(insertParams[3]).toBe(100);
    expect(insertParams[4]).toBe('EUR');
    expect(insertParams[5]).toBe(500); // 100 * 5
  });

  it('savings_in EUR: mirror NEGATIV cu pairAmountRon din rate', async () => {
    mockGetRateRon.mockResolvedValue(5);
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(
        rowFor({
          id: 'tx-eur',
          currency: 'EUR',
          amount: 100,
          description: 'lichidare depozit',
        })
      )
      .mockResolvedValueOnce({ id: 'acc-savings-eur', type: 'savings', currency: 'EUR' });

    await convertToTransfer('tx-eur', 'acc-savings-eur');

    const insertParams = (db.runAsync as jest.Mock).mock.calls[1][1];
    expect(insertParams[3]).toBe(-100);
    expect(insertParams[5]).toBe(-500); // -100 * 5
  });

  it('non-RON: pairAmountRon = null când fetch curs eșuează', async () => {
    mockGetRateRon.mockRejectedValue(new Error('rate fetch failed'));
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(rowFor({ id: 'tx-eur', currency: 'EUR', amount: -100 }))
      .mockResolvedValueOnce({ id: 'acc-cash-eur', type: 'cash', currency: 'EUR' });

    await convertToTransfer('tx-eur', 'acc-cash-eur');

    const insertParams = (db.runAsync as jest.Mock).mock.calls[1][1];
    expect(insertParams[5]).toBeNull();
  });
});
```

- [ ] **Step 8: Rulează testul FX**

Run: `npx jest __tests__/unit/internalTransferSuggestionFx.test.ts`
Expected: PASS.

- [ ] **Step 9: Rulează tot suite-ul (vechi + nou) ca să confirmi că nimic nu s-a stricat**

Run: `npm test`
Expected: PASS — atât testele vechi (`cashSuggestion*`) cât și cele noi (`internalTransferSuggestion*`).

- [ ] **Step 10: Type-check**

Run: `npm run type-check`
Expected: succes fără erori.

- [ ] **Step 11: Commit**

```bash
git add services/internalTransferSuggestion.ts __tests__/unit/internalTransferSuggestion.test.ts __tests__/unit/internalTransferSuggestionFlow.test.ts __tests__/unit/internalTransferSuggestionFx.test.ts
git commit -m "feat(transfer): serviciu generalizat sugestie transfer intern (cash + savings)"
```

---

## Task 2: Migrare ecran batch — folder rename + badge tip per rând + filtrare destinație

**Files:**

- Create: `app/sugestie-transfer/_layout.tsx`
- Create: `app/sugestie-transfer/batch.tsx`
- Delete: `app/sugestie-cash/_layout.tsx`
- Delete: `app/sugestie-cash/batch.tsx`

- [ ] **Step 1: Creează `app/sugestie-transfer/_layout.tsx`**

Conținut:

```tsx
import { Stack } from 'expo-router';

export default function SugestieTransferLayout() {
  return (
    <Stack>
      <Stack.Screen name="batch" options={{ title: 'Sugestie transfer intern' }} />
    </Stack>
  );
}
```

- [ ] **Step 2: Creează `app/sugestie-transfer/batch.tsx`**

Conținut:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import {
  convertToTransfer,
  dismissTransferSuggestion,
  listPendingTransferSuggestions,
  type PendingTransferSuggestion,
  type TransferType,
} from '@/services/internalTransferSuggestion';
import type { FinancialAccount } from '@/types';

interface RowState {
  tx: PendingTransferSuggestion;
  selected: boolean;
  targetAccountId: string | null;
}

const TYPE_LABEL: Record<TransferType, string> = {
  cash: 'Retragere cash',
  savings_out: 'Către economii',
  savings_in: 'Din economii',
};

const TYPE_ICON: Record<TransferType, keyof typeof Ionicons.glyphMap> = {
  cash: 'cash-outline',
  savings_out: 'arrow-up-circle-outline',
  savings_in: 'arrow-down-circle-outline',
};

function targetTypeFor(t: TransferType): FinancialAccount['type'] {
  return t === 'cash' ? 'cash' : 'savings';
}

function targetCreateLabel(t: TransferType, currency: string): string {
  return t === 'cash'
    ? `+ Creează cont Cash în ${currency}`
    : `+ Creează cont Economii în ${currency}`;
}

export default function SugestieTransferBatch() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const { accounts } = useFinancialAccounts();
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const pending = await listPendingTransferSuggestions();
      setRows(
        pending.map(tx => {
          const targetType = targetTypeFor(tx.suggested_type);
          const matching = accounts.filter(
            a => a.type === targetType && !a.archived && a.currency === tx.currency
          );
          const onlyOne = matching.length === 1 ? matching[0].id : null;
          return { tx, selected: true, targetAccountId: onlyOne };
        })
      );
    } finally {
      setLoading(false);
    }
  }, [accounts]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleSelect = (txId: string) =>
    setRows(prev => prev.map(r => (r.tx.id === txId ? { ...r, selected: !r.selected } : r)));

  const setTarget = (txId: string, accId: string) =>
    setRows(prev => prev.map(r => (r.tx.id === txId ? { ...r, targetAccountId: accId } : r)));

  const skipRow = async (txId: string) => {
    await dismissTransferSuggestion(txId);
    setRows(prev => prev.filter(r => r.tx.id !== txId));
  };

  const skipAll = async () => {
    setBusy(true);
    try {
      for (const r of rows) {
        await dismissTransferSuggestion(r.tx.id);
      }
      router.back();
    } catch (e) {
      await loadData();
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Skip a eșuat');
    } finally {
      setBusy(false);
    }
  };

  const confirmSelected = async () => {
    const selected = rows.filter(r => r.selected);
    const missingTarget = selected.find(r => !r.targetAccountId);
    if (missingTarget) {
      Alert.alert(
        'Cont destinație lipsă',
        'Alege un cont destinație pentru fiecare tranzacție bifată sau debifează rândurile fără destinație.'
      );
      return;
    }
    setBusy(true);
    try {
      for (const r of selected) {
        if (r.targetAccountId) {
          await convertToTransfer(r.tx.id, r.targetAccountId);
        }
      }
      router.back();
    } catch (e) {
      await loadData();
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Conversia a eșuat');
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = rows.filter(r => r.selected && r.targetAccountId).length;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Text style={{ color: C.textSecondary }}>Se încarcă...</Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Text style={{ color: C.textSecondary, textAlign: 'center', padding: 24 }}>
          Nu ai tranzacții cu sugestie de transfer intern. Înapoi.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.btn, { backgroundColor: C.primary }]}
        >
          <Text style={styles.btnText}>OK</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Text style={[styles.heading, { color: C.text }]}>
        {rows.length} {rows.length === 1 ? 'tranzacție detectată' : 'tranzacții detectate'}
      </Text>
      <Text style={[styles.subheading, { color: C.textSecondary }]}>
        Vrei să le aloci într-un cont propriu?
      </Text>

      <FlatList
        data={rows}
        keyExtractor={r => r.tx.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const targetType = targetTypeFor(item.tx.suggested_type);
          const matching = accounts.filter(
            a => a.type === targetType && !a.archived && a.currency === item.tx.currency
          );
          return (
            <View style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}>
              <Pressable onPress={() => toggleSelect(item.tx.id)} style={styles.rowHeader}>
                <Ionicons
                  name={item.selected ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={item.selected ? C.primary : C.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Ionicons
                      name={TYPE_ICON[item.tx.suggested_type]}
                      size={14}
                      color={C.primary}
                    />
                    <Text style={[styles.badge, { color: C.primary }]}>
                      {TYPE_LABEL[item.tx.suggested_type]}
                    </Text>
                  </View>
                  <Text style={[styles.rowTitle, { color: C.text }]} numberOfLines={1}>
                    {item.tx.description || item.tx.merchant || 'Tranzacție'}
                  </Text>
                  <Text style={[styles.rowMeta, { color: C.textSecondary }]}>
                    {Math.abs(item.tx.amount).toFixed(2)} {item.tx.currency} • {item.tx.date}
                  </Text>
                </View>
              </Pressable>

              {item.selected && (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.label, { color: C.textSecondary }]}>Cont destinație:</Text>
                  {matching.length === 0 ? (
                    <Pressable
                      style={[styles.btnSecondary, { borderColor: C.primary }]}
                      onPress={() =>
                        router.push({
                          pathname: '/conturi/add' as '/',
                          params: { type: targetType, currency: item.tx.currency },
                        })
                      }
                    >
                      <Text style={[styles.btnSecondaryText, { color: C.primary }]}>
                        {targetCreateLabel(item.tx.suggested_type, item.tx.currency)}
                      </Text>
                    </Pressable>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {matching.map(a => (
                          <Pressable
                            key={a.id}
                            onPress={() => setTarget(item.tx.id, a.id)}
                            style={[
                              styles.chip,
                              {
                                borderColor: item.targetAccountId === a.id ? C.primary : C.border,
                                backgroundColor:
                                  item.targetAccountId === a.id ? C.primary : 'transparent',
                              },
                            ]}
                          >
                            <Text
                              style={{
                                color: item.targetAccountId === a.id ? '#fff' : C.text,
                              }}
                            >
                              {a.name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>
              )}

              <Pressable onPress={() => void skipRow(item.tx.id)} style={styles.skipBtn}>
                <Text style={{ color: C.textSecondary, fontSize: 12 }}>
                  ✗ Skip această tranzacție
                </Text>
              </Pressable>
            </View>
          );
        }}
      />

      <View style={[styles.footer, { backgroundColor: C.background, borderTopColor: C.border }]}>
        <Pressable disabled={busy} onPress={() => router.back()} style={styles.btnGhost}>
          <Text style={{ color: C.textSecondary }}>Anulează</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => void skipAll()} style={styles.btnGhost}>
          <Text style={{ color: C.textSecondary }}>Skip toate</Text>
        </Pressable>
        <Pressable
          disabled={busy || selectedCount === 0}
          onPress={() => void confirmSelected()}
          style={[styles.btn, { backgroundColor: selectedCount === 0 ? C.border : C.primary }]}
        >
          <Text style={styles.btnText}>Confirmă ({selectedCount})</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16 },
  subheading: { fontSize: 14, paddingHorizontal: 16, marginBottom: 16 },
  row: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  badge: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowMeta: { fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  skipBtn: { marginTop: 8, alignSelf: 'flex-start' },
  footer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
  },
  btn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600' },
  btnGhost: { padding: 12, alignItems: 'center', justifyContent: 'center' },
  btnSecondary: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  btnSecondaryText: { fontWeight: '500' },
});
```

- [ ] **Step 3: Șterge folder-ul vechi `app/sugestie-cash`**

```bash
git rm app/sugestie-cash/_layout.tsx app/sugestie-cash/batch.tsx
```

- [ ] **Step 4: Update consumer `app/conturi/import.tsx` să folosească noua rută + serviciu**

Modifică `app/conturi/import.tsx`:

- Linia 28: schimbă `import { listPendingCashSuggestions } from '@/services/cashSuggestion';` în `import { listPendingTransferSuggestions } from '@/services/internalTransferSuggestion';`
- Linia 412: schimbă `await listPendingCashSuggestions({ limit: 10 });` în `await listPendingTransferSuggestions({ limit: 10 });`
- Linia 418: schimbă `pathname: '/sugestie-cash/batch' as '/',` în `pathname: '/sugestie-transfer/batch' as '/',`

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: succes (banner-ul + toggle-ul vechi încă referă serviciul vechi care încă există).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: succes pe fișierele noi.

- [ ] **Step 7: Rulează testele**

Run: `npm test`
Expected: PASS — niciun test pe ecranele de UI, deci niciun regres.

- [ ] **Step 8: Commit**

```bash
git add app/sugestie-transfer/_layout.tsx app/sugestie-transfer/batch.tsx app/conturi/import.tsx
git rm app/sugestie-cash/_layout.tsx app/sugestie-cash/batch.tsx
git commit -m "feat(sugestie-transfer): ecran batch generalizat cu badge tip + filtrare destinație"
```

---

## Task 3: Migrare banner — `TransferSuggestionBanner` cu copy generalizat

**Files:**

- Create: `components/TransferSuggestionBanner.tsx`
- Delete: `components/CashSuggestionBanner.tsx`
- Modify: `app/(tabs)/index.tsx:15` — schimbă import.

- [ ] **Step 1: Creează `components/TransferSuggestionBanner.tsx`**

Conținut:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { countPendingTransferSuggestions } from '@/services/internalTransferSuggestion';

export function TransferSuggestionBanner() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [count, setCount] = useState(0);
  const [hiddenForSession, setHiddenForSession] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      countPendingTransferSuggestions()
        .then(c => {
          if (active) setCount(c);
        })
        .catch(() => {
          if (active) setCount(0);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  if (count === 0 || hiddenForSession) return null;

  const noun = count === 1 ? 'tranzacție' : 'tranzacții';

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${count} ${noun} cu sugestie de transfer intern. Apasă pentru a le clasifica.`}
        style={styles.tappable}
        onPress={() =>
          router.push({
            pathname: '/sugestie-transfer/batch' as '/',
            params: { source: 'summary' },
          })
        }
      >
        <Ionicons name="swap-horizontal-outline" size={20} color={C.primary} />
        <Text style={[styles.text, { color: C.text }]} numberOfLines={2}>
          Ai {count} {noun} cu sugestie de transfer intern în ultimul an. Tap să le clasifici.
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Ascunde sugestia"
        hitSlop={12}
        onPress={() => setHiddenForSession(true)}
      >
        <Ionicons name="close" size={18} color={C.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  tappable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
```

- [ ] **Step 2: Update consumer `app/(tabs)/index.tsx`**

Modifică linia 15 din `app/(tabs)/index.tsx`:

- înainte: `import { CashSuggestionBanner } from '@/components/CashSuggestionBanner';`
- după: `import { TransferSuggestionBanner } from '@/components/TransferSuggestionBanner';`

Apoi în JSX (caută `<CashSuggestionBanner />`), înlocuiește cu `<TransferSuggestionBanner />`.

- [ ] **Step 3: Șterge fișierul vechi**

```bash
git rm components/CashSuggestionBanner.tsx
```

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: succes.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: succes.

- [ ] **Step 6: Commit**

```bash
git add components/TransferSuggestionBanner.tsx app/\(tabs\)/index.tsx
git rm components/CashSuggestionBanner.tsx
git commit -m "feat(banner): generalizare CashSuggestionBanner → TransferSuggestionBanner"
```

---

## Task 4: Migrare toggle inline — `InternalTransferToggle` cu auto-detect bidirecțional + label adaptiv

**Files:**

- Create: `components/InternalTransferToggle.tsx`
- Delete: `components/CashWithdrawalToggle.tsx`
- Modify: `app/tranzactii/[id].tsx` — rename state vars + import.

- [ ] **Step 1: Creează `components/InternalTransferToggle.tsx`**

Conținut:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { FinancialAccount } from '@/types';

export type DetectedTransferType = 'cash' | 'savings_out' | 'savings_in' | null;

interface Props {
  amount: number;
  description: string;
  merchant: string;
  currency: string;
  accounts: FinancialAccount[];
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  targetAccountId: string | null;
  onTargetChange: (id: string | null) => void;
  autoDetect: boolean;
  readOnly?: boolean;
}

const CASH_RE = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;
const SAVINGS_OUT_RE =
  /\b(transfer\s+(la|spre|catre)\s+(economii|depozit)|alimentare\s+(cont\s+)?economii|constituire\s+depozit|economisire)\b/i;
const SAVINGS_IN_RE =
  /\b(transfer\s+(din|de\s+la)\s+(economii|depozit)|retragere\s+(din\s+)?economii|lichidare\s+depozit)\b/i;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function detect(amount: number, description: string, merchant: string): DetectedTransferType {
  const haystack = normalize(`${description} ${merchant}`);
  if (amount < 0) {
    if (CASH_RE.test(haystack)) return 'cash';
    if (SAVINGS_OUT_RE.test(haystack)) return 'savings_out';
    return null;
  }
  if (amount > 0) {
    if (SAVINGS_IN_RE.test(haystack)) return 'savings_in';
    return null;
  }
  return null;
}

function effectiveType(detected: DetectedTransferType, amount: number): DetectedTransferType {
  if (detected) return detected;
  if (amount < 0) return 'cash';
  return null;
}

const TYPE_LABEL: Record<NonNullable<DetectedTransferType>, string> = {
  cash: 'Este retragere de cash din contul bancar',
  savings_out: 'Este transfer către cont de economii',
  savings_in: 'Este retragere din cont de economii',
};

function targetAccountTypeFor(t: NonNullable<DetectedTransferType>): FinancialAccount['type'] {
  return t === 'cash' ? 'cash' : 'savings';
}

function createBtnLabel(t: NonNullable<DetectedTransferType>, currency: string): string {
  return t === 'cash'
    ? `+ Creează cont Cash în ${currency}`
    : `+ Creează cont Economii în ${currency}`;
}

export function InternalTransferToggle(props: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const detected = detect(props.amount, props.description, props.merchant);
  const effective = effectiveType(detected, props.amount);

  const prevMatchRef = useRef<DetectedTransferType>(null);
  useEffect(() => {
    if (!props.autoDetect || props.readOnly) return;
    const prev = prevMatchRef.current;
    prevMatchRef.current = detected;
    if (!prev && detected) {
      props.onEnabledChange(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.amount, props.description, props.merchant, props.autoDetect]);

  if (!effective) return null;

  const targetType = targetAccountTypeFor(effective);
  const matchingAccounts = props.accounts.filter(
    a => a.type === targetType && !a.archived && a.currency === props.currency
  );

  return (
    <View style={styles.box}>
      <Pressable
        disabled={props.readOnly}
        onPress={() => props.onEnabledChange(!props.enabled)}
        style={styles.toggleRow}
      >
        <Ionicons
          name={props.enabled ? 'checkbox' : 'square-outline'}
          size={22}
          color={props.enabled ? C.primary : C.textSecondary}
        />
        <Text style={[styles.label, { color: C.text }]}>{TYPE_LABEL[effective]}</Text>
      </Pressable>

      {props.enabled && !props.readOnly && (
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.subLabel, { color: C.textSecondary }]}>Cont destinație:</Text>
          {matchingAccounts.length === 0 ? (
            <Pressable
              style={[styles.createBtn, { borderColor: C.primary }]}
              onPress={() =>
                router.push({
                  pathname: '/conturi/add' as '/',
                  params: { type: targetType, currency: props.currency },
                })
              }
            >
              <Text style={{ color: C.primary }}>{createBtnLabel(effective, props.currency)}</Text>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {matchingAccounts.map(a => (
                  <Pressable
                    key={a.id}
                    onPress={() => props.onTargetChange(a.id)}
                    style={[
                      styles.chip,
                      {
                        borderColor: props.targetAccountId === a.id ? C.primary : C.border,
                        backgroundColor: props.targetAccountId === a.id ? C.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ color: props.targetAccountId === a.id ? '#fff' : C.text }}>
                      {a.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: 16, paddingVertical: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontSize: 14, flex: 1 },
  subLabel: { fontSize: 12, marginBottom: 6 },
  createBtn: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});
```

- [ ] **Step 2: Update `app/tranzactii/[id].tsx`**

Citește fișierul mai întâi pentru context (Read tool), apoi aplică următoarele modificări:

- Linia 15: `import { CashWithdrawalToggle } from '@/components/CashWithdrawalToggle';` → `import { InternalTransferToggle } from '@/components/InternalTransferToggle';`
- Linia 24: `import { convertToTransfer } from '@/services/cashSuggestion';` → `import { convertToTransfer } from '@/services/internalTransferSuggestion';`
- Linia 88: `const [isCashWithdrawal, setIsCashWithdrawal] = useState(false);` → `const [isInternalTransfer, setIsInternalTransfer] = useState(false);`
- Linia 89: `const [cashTargetId, setCashTargetId] = useState<string | null>(null);` → `const [transferTargetId, setTransferTargetId] = useState<string | null>(null);`
- Linia 128: `isCashWithdrawal && !!cashTargetId && !isExistingTransfer && signedAmount < 0;` → `isInternalTransfer && !!transferTargetId && !isExistingTransfer;`

  _Notă:_ eliminăm `signedAmount < 0` deoarece serviciul nou acceptă și `amount > 0` (savings_in).

- Linia 164–165:

  ```tsx
  if (shouldConvert && txIdForConvert && cashTargetId) {
    await convertToTransfer(txIdForConvert, cashTargetId);
  ```

  →

  ```tsx
  if (shouldConvert && txIdForConvert && transferTargetId) {
    await convertToTransfer(txIdForConvert, transferTargetId);
  ```

- Linia 181: `if (isCashWithdrawal && !cashTargetId && !isExistingTransfer) {` → `if (isInternalTransfer && !transferTargetId && !isExistingTransfer) {`

- JSX (în jurul liniei 468):

  ```tsx
  <CashWithdrawalToggle
    ...
    enabled={isCashWithdrawal}
    onEnabledChange={setIsCashWithdrawal}
    targetAccountId={cashTargetId}
    onTargetChange={setCashTargetId}
    autoDetect={!isExistingTransfer}
    readOnly={isExistingTransfer}
  />
  ```

  →

  ```tsx
  <InternalTransferToggle
    ...
    enabled={isInternalTransfer}
    onEnabledChange={setIsInternalTransfer}
    targetAccountId={transferTargetId}
    onTargetChange={setTransferTargetId}
    autoDetect={!isExistingTransfer}
    readOnly={isExistingTransfer}
  />
  ```

  _Notă:_ păstrează prop-urile `amount`, `description`, `merchant`, `currency`, `accounts` care erau deja date — nu se schimbă numele lor.

  Pentru prop-ul `amount`, păstrează `signedForToggle` exact așa cum este (formularul calculează semnul corect bazat pe direcție).

- [ ] **Step 3: Verifică că alertul de confirmare validare e prezent pentru cazul fără target**

În `app/tranzactii/[id].tsx` în jurul liniei 181, alertul existent rămâne valid:

```tsx
if (isInternalTransfer && !transferTargetId && !isExistingTransfer) {
  Alert.alert(
    'Cont destinație lipsă',
    'Alege un cont propriu sau debifează opțiunea „transfer intern".'
  );
  return;
}
```

Actualizează textul mesajului dacă este orientat pe „cash" — schimbă în „transfer intern" / „cont propriu".

- [ ] **Step 4: Șterge fișierul vechi**

```bash
git rm components/CashWithdrawalToggle.tsx
```

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: succes.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: succes.

- [ ] **Step 7: Rulează testele**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/InternalTransferToggle.tsx app/tranzactii/\[id\].tsx
git rm components/CashWithdrawalToggle.tsx
git commit -m "feat(toggle): generalizare CashWithdrawalToggle → InternalTransferToggle bidirecțional"
```

---

## Task 5: Ștergere serviciu vechi `cashSuggestion.ts` + teste vechi

**Files:**

- Delete: `services/cashSuggestion.ts`
- Delete: `__tests__/unit/cashSuggestion.test.ts`
- Delete: `__tests__/unit/cashSuggestionFlow.test.ts`
- Delete: `__tests__/unit/cashSuggestionFx.test.ts`

- [ ] **Step 1: Verifică că nu mai există referințe la modulul vechi**

Run: `grep -rn "cashSuggestion" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v docs/specs | grep -v docs/plans`
Expected: doar referințe în `services/cashSuggestion.ts` și `__tests__/unit/cashSuggestion*.test.ts` (cele care urmează să fie șterse).

Dacă apare orice altă referință, oprește-te și migrează-o înainte de a continua.

- [ ] **Step 2: Șterge fișierele**

```bash
git rm services/cashSuggestion.ts \
       __tests__/unit/cashSuggestion.test.ts \
       __tests__/unit/cashSuggestionFlow.test.ts \
       __tests__/unit/cashSuggestionFx.test.ts
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: succes.

- [ ] **Step 4: Rulează testele**

Run: `npm test`
Expected: PASS — doar testele noi rulează acum.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(cashSuggestion): șterge serviciu vechi și teste, migrate complet la internalTransferSuggestion"
```

---

## Task 6: Sync docs — IDEAS și ARCHITECTURE

**Files:**

- Modify: `docs/IDEAS.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Citește IDEAS.md ca să găsești entry-ul cash existent**

Run: `grep -n "cash\|sugestie alimentare" docs/IDEAS.md | head -20`

Identifică secțiunea care vorbește despre „Sugestie alimentare cont cash la retragere".

- [ ] **Step 2: Înlocuiește entry-ul cu varianta generalizată**

În `docs/IDEAS.md`, înlocuiește titlul + descrierea entry-ului existent cu:

```markdown
### Sugestie alimentare transfer intern (cash + economii) ✅

**Status:** shipped 2026-05-04.

User importă doar contul curent. App-ul detectează automat trei tipuri de tranzacții care reprezintă transferuri către/dinspre conturi proprii neimportate și sugerează conversia în transfer intern:

- **Retragere cash** (amount < 0, regex `retragere|atm|bancomat|numerar`)
- **Transfer la economii / constituire depozit** (amount < 0, regex `transfer la/spre/catre economii|alimentare economii|constituire depozit|economisire`)
- **Retragere economii / lichidare depozit** (amount > 0, regex `transfer din/de la economii|retragere economii|lichidare depozit`)

Trei surface UX:

1. Banner pe Sumar cu count pending în ultimul an, dismiss pe sesiune.
2. Ecran batch post-import sau din banner — listă top 10, badge tip per rând (💵 / ⬆️ / ⬇️), filtrare cont destinație pe tip + valută.
3. Checkbox inline în formular tranzacție cu auto-detect edge-trigger și label adaptiv.

User confirmă întotdeauna. Schema neschimbată. Servicii: `services/internalTransferSuggestion.ts`. Componente: `components/TransferSuggestionBanner.tsx`, `components/InternalTransferToggle.tsx`. Rute: `app/sugestie-transfer/`.
```

Dacă în IDEAS exista entry-ul `Sugestie alimentare cont cash la retragere ✅`, șterge-l (a fost înlocuit).

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`**

În tabela de servicii (în jur de linia 43), modifică rândul:

- înainte: `| `cashSuggestion.ts`          | detectare retrageri + conversie în transfer intern către Cash |`
- după: `| `internalTransferSuggestion.ts` | detectare cash/savings_out/savings_in + conversie în transfer intern |`

Și actualizează data în antet (linia 4): `> **Ultima actualizare:** 2026-05-04.`

- [ ] **Step 4: Commit**

```bash
git add docs/IDEAS.md docs/ARCHITECTURE.md
git commit -m "docs: sync IDEAS și ARCHITECTURE după generalizare transfer intern"
```

---

## Task 7: Verificare globală — `npm run check`

**Files:** none (CI gate)

- [ ] **Step 1: Rulează lanțul complet de verificări**

Run: `npm run check`
Expected: succes pe toate etapele (lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit).

- [ ] **Step 2: Dacă `knip` raportează cod neutilizat**

Verifică output-ul. Probabil componenta veche sau exporturile vechi nu mai sunt referite — au fost deja șterse în Task 5. Dacă apar warning-uri valide, fixează-le. Dacă sunt false positives, evaluează context.

- [ ] **Step 3: Dacă `madge` sau `dep-cruise` raportează cicluri**

Citește mesajul. Cel mai probabil refactorul nu introduce cicluri (am respectat regula `services/` nu importă din `components/`). Dacă apar, fixează.

- [ ] **Step 4: Confirmă că nu există commit pending**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 5: Commit final dacă a fost necesară vreo corecție de la check**

```bash
git add <fișiere modificate>
git commit -m "chore: fix-up după npm run check"
```

Dacă nu au existat modificări, sari peste acest pas.

---
