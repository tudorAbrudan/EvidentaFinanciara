# Plan implementare — ștergere în lot tranzacții filtrate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaugă filtrare avansată (chip bar) pe ecranul Tranzacții și acțiune bulk delete cu pre-bifare/deselect, atomică în DB cu cleanup transferuri/duplicate și auto-purge statement-uri orfane.

**Architecture:** UI nou (`TransactionFilterBar` + ecran confirm), un câmp filtru nou în `TransactionFilter` (`absAmountRange`), o funcție backend nouă `bulkDeleteTransactions(ids)`, store in-memory pentru handoff IDs între ecrane.

**Tech Stack:** TypeScript strict, React Native + Expo Router, SQLite (`expo-sqlite`), Jest cu mock-ul existent pe `@/services/db`, theme tokens din `@/theme/colors`, `useColorScheme` din `@/components/useColorScheme`.

**Spec:** `docs/specs/2026-05-05-bulk-delete-transactions-design.md`

---

## Task 1: Extinde `TransactionFilter` cu `absAmountRange`

**Files:**

- Modify: `services/transactions.ts:50-65` (interface `TransactionFilter`) și `services/transactions.ts:87-94` (logică SQL în `getTransactions`)
- Test: `__tests__/unit/transactions.test.ts:205-236` (extins block-ul `describe('getTransactions filter flags')`)

- [ ] **Step 1: Scrie testele care eșuează**

În `__tests__/unit/transactions.test.ts`, în interiorul `describe('getTransactions filter flags', ...)`, adaugă:

```ts
it('absAmountRange {min, max} adds OR clause cu interval semnat și absolut', async () => {
  await getTransactions({ absAmountRange: { min: 100, max: 500 } });
  const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
  const params = (db.db.getAllAsync as jest.Mock).mock.calls[0][1] as number[];
  expect(sql).toMatch(/\(amount BETWEEN \? AND \?\) OR \(amount BETWEEN \? AND \?\)/);
  expect(params).toEqual([-500, -100, 100, 500]);
});

it('absAmountRange cu doar min adds "amount <= -min OR amount >= min"', async () => {
  await getTransactions({ absAmountRange: { min: 200 } });
  const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
  const params = (db.db.getAllAsync as jest.Mock).mock.calls[0][1] as number[];
  expect(sql).toMatch(/amount <= \? OR amount >= \?/);
  expect(params).toEqual([-200, 200]);
});

it('absAmountRange cu doar max adds "amount BETWEEN -max AND max"', async () => {
  await getTransactions({ absAmountRange: { max: 100 } });
  const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
  const params = (db.db.getAllAsync as jest.Mock).mock.calls[0][1] as number[];
  expect(sql).toMatch(/amount BETWEEN \? AND \?/);
  expect(params).toEqual([-100, 100]);
});

it('absAmountRange absent → no clause', async () => {
  await getTransactions({});
  const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
  expect(sql).not.toMatch(/BETWEEN/);
});
```

- [ ] **Step 2: Rulează testele și verifică că eșuează**

```
npm test -- transactions.test.ts
```

Așteptat: cele 4 teste noi eșuează (sql nu conține clauzele).

- [ ] **Step 3: Implementează `absAmountRange` în `services/transactions.ts`**

În `services/transactions.ts:50-65`, adaugă în interfață **înainte** de `}`:

```ts
  absAmountRange?: { min?: number; max?: number }; // valori absolute, prinde ambele semne
```

În `getTransactions`, după blocul `if (filter.maxAmount !== undefined)` (~linia 94), adaugă:

```ts
if (filter.absAmountRange) {
  const { min, max } = filter.absAmountRange;
  if (min !== undefined && max !== undefined) {
    where.push('((amount BETWEEN ? AND ?) OR (amount BETWEEN ? AND ?))');
    params.push(-max, -min, min, max);
  } else if (min !== undefined) {
    where.push('(amount <= ? OR amount >= ?)');
    params.push(-min, min);
  } else if (max !== undefined) {
    where.push('amount BETWEEN ? AND ?');
    params.push(-max, max);
  }
}
```

- [ ] **Step 4: Rulează testele**

```
npm test -- transactions.test.ts
```

Așteptat: toate trec.

- [ ] **Step 5: Type-check**

```
npm run type-check
```

Așteptat: 0 erori.

- [ ] **Step 6: Commit**

```bash
git add services/transactions.ts __tests__/unit/transactions.test.ts
git commit -m "feat(transactions): filtru absAmountRange (sumă în valori absolute)"
```

---

## Task 2: Funcție `bulkDeleteTransactions` cu cleanup atomic

**Files:**

- Modify: `services/transactions.ts` (adaugă funcția nouă undeva după `deleteTransaction`)
- Test: `__tests__/unit/transactions.test.ts` (block nou `describe('bulkDeleteTransactions', ...)`)

Mock-ul curent acoperă `runAsync`/`getAllAsync`/`getFirstAsync`. Adăugăm și `withTransactionAsync` în mock pentru această funcție.

- [ ] **Step 1: Extinde mock-ul DB cu `withTransactionAsync`**

În `__tests__/unit/transactions.test.ts`, modifică `jest.mock('@/services/db', ...)` (linia 11-19) astfel:

```ts
jest.mock('@/services/db', () => ({
  __esModule: true,
  db: {
    runAsync: jest.fn(),
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  },
  generateId: () => 'test-id',
}));
```

- [ ] **Step 2: Scrie testele pentru `bulkDeleteTransactions`**

În același fișier, după `describe('getTransactions filter flags', ...)`, adaugă:

```ts
import { bulkDeleteTransactions } from '@/services/transactions';

describe('bulkDeleteTransactions', () => {
  beforeEach(() => {
    (db.db.runAsync as jest.Mock).mockReset();
    (db.db.runAsync as jest.Mock).mockResolvedValue({ changes: 0 });
    (db.db.getAllAsync as jest.Mock).mockReset();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    (db.db.withTransactionAsync as jest.Mock).mockClear();
  });

  it('lista vidă → no-op, fără queries', async () => {
    const result = await bulkDeleteTransactions([]);
    expect(result).toEqual({ deletedCount: 0, statementsRemoved: 0 });
    expect((db.db.runAsync as jest.Mock).mock.calls).toHaveLength(0);
    expect((db.db.withTransactionAsync as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('rulează în db.withTransactionAsync (atomic)', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1']);
    expect((db.db.withTransactionAsync as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('emite UPDATE pentru a dezlega contraparte transfer intern', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls.map(c => c[0] as string);
    const found = calls.find(s =>
      /UPDATE transactions[\s\S]*is_internal_transfer = 0[\s\S]*linked_transaction_id IS NOT NULL/.test(
        s
      )
    );
    expect(found).toBeTruthy();
  });

  it('emite UPDATE pentru a dezmarca duplicate care pointează spre IDs ce se șterg', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls.map(c => c[0] as string);
    const found = calls.find(s => /UPDATE transactions SET duplicate_of_id = NULL/.test(s));
    expect(found).toBeTruthy();
  });

  it('emite DELETE FROM transactions cu IDs', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    await bulkDeleteTransactions(['t1', 't2']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    const deleteCall = calls.find(c => /DELETE FROM transactions WHERE id IN/.test(c[0] as string));
    expect(deleteCall).toBeTruthy();
    expect(deleteCall![1]).toEqual(['t1', 't2']);
  });

  it('auto-purge statement-uri orfane: șterge bank_statements ne-mai-referențiate', async () => {
    // Mock: lookup statement_id pentru IDs returnează 's1', 's2'.
    // După DELETE, getAllAsync pentru "statement_id IS NOT NULL" returnează doar 's2' (s1 e orfan).
    (db.db.getAllAsync as jest.Mock)
      .mockResolvedValueOnce([{ statement_id: 's1' }, { statement_id: 's2' }]) // pre-DELETE oldStatementIds
      .mockResolvedValueOnce([{ statement_id: 's2' }]); // post-DELETE statements still referenced
    (db.db.runAsync as jest.Mock).mockImplementation(async (sql: string) => {
      if (/DELETE FROM bank_statements/.test(sql)) return { changes: 1 };
      if (/DELETE FROM transactions/.test(sql)) return { changes: 2 };
      return { changes: 0 };
    });
    const result = await bulkDeleteTransactions(['t1', 't2']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    const purge = calls.find(c => /DELETE FROM bank_statements WHERE id IN/.test(c[0] as string));
    expect(purge).toBeTruthy();
    expect(purge![1]).toEqual(['s1']); // doar s1 e orfan
    expect(result.statementsRemoved).toBe(1);
  });

  it('NU emite DELETE bank_statements dacă niciun statement nu rămâne orfan', async () => {
    (db.db.getAllAsync as jest.Mock)
      .mockResolvedValueOnce([{ statement_id: 's1' }])
      .mockResolvedValueOnce([{ statement_id: 's1' }]); // s1 încă referențiat de alte tranzacții
    await bulkDeleteTransactions(['t1']);
    const calls = (db.db.runAsync as jest.Mock).mock.calls.map(c => c[0] as string);
    const purge = calls.find(s => /DELETE FROM bank_statements/.test(s));
    expect(purge).toBeFalsy();
  });

  it('chunking: 1500 IDs sparte în 3 batch-uri pentru DELETE', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    const ids = Array.from({ length: 1500 }, (_, i) => `id-${i}`);
    await bulkDeleteTransactions(ids);
    const calls = (db.db.runAsync as jest.Mock).mock.calls;
    const deleteCalls = calls.filter(c =>
      /DELETE FROM transactions WHERE id IN/.test(c[0] as string)
    );
    expect(deleteCalls).toHaveLength(3);
    expect((deleteCalls[0][1] as string[]).length).toBe(500);
    expect((deleteCalls[1][1] as string[]).length).toBe(500);
    expect((deleteCalls[2][1] as string[]).length).toBe(500);
  });

  it('returnează deletedCount = suma db.changes pe DELETE-uri', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
    (db.db.runAsync as jest.Mock).mockImplementation(async (sql: string) => {
      if (/DELETE FROM transactions/.test(sql)) return { changes: 3 };
      return { changes: 0 };
    });
    const result = await bulkDeleteTransactions(['t1', 't2', 't3']);
    expect(result.deletedCount).toBe(3);
  });
});
```

- [ ] **Step 3: Rulează testele și verifică că eșuează**

```
npm test -- transactions.test.ts
```

Așteptat: testele bulkDeleteTransactions eșuează cu `bulkDeleteTransactions is not exported`.

- [ ] **Step 4: Implementează `bulkDeleteTransactions` în `services/transactions.ts`**

Adaugă după funcția `deleteTransaction` (~linia 258):

```ts
const BULK_CHUNK = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Șterge multiple tranzacții într-o singură tranzacție DB, cu cleanup:
 *   1. Dezleagă transferuri interne — contraparte (linked_transaction_id IN ids)
 *      revine la tranzacție obișnuită.
 *   2. Dezmarchează duplicate care referă spre IDs ce se șterg.
 *   3. DELETE FROM transactions WHERE id IN ids (chunking la 500 — limita SQLite).
 *   4. Auto-purge bank_statements rămase fără tranzacții.
 *
 * Returnează numărul de rânduri șterse efectiv (db.changes) și numărul de
 * statement-uri auto-purgate.
 */
export async function bulkDeleteTransactions(
  ids: string[]
): Promise<{ deletedCount: number; statementsRemoved: number }> {
  if (ids.length === 0) return { deletedCount: 0, statementsRemoved: 0 };

  let deletedCount = 0;
  let statementsRemoved = 0;

  await db.withTransactionAsync(async () => {
    // 1. Determină statement-urile candidate la auto-purge — colectează DISTINCT
    //    statement_id-uri pentru tranzacțiile care urmează a fi șterse.
    const candidateStmtRows: { statement_id: string }[] = [];
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await db.getAllAsync<{ statement_id: string }>(
        `SELECT DISTINCT statement_id FROM transactions
          WHERE id IN (${placeholders}) AND statement_id IS NOT NULL`,
        chunk
      );
      candidateStmtRows.push(...rows);
    }
    const candidateStmtIds = Array.from(
      new Set(candidateStmtRows.map(r => r.statement_id).filter(Boolean))
    );

    // 2. Dezleagă transferuri interne (cealaltă jumătate)
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE transactions
            SET is_internal_transfer = 0, linked_transaction_id = NULL
          WHERE id IN (
            SELECT linked_transaction_id FROM transactions
             WHERE id IN (${placeholders}) AND linked_transaction_id IS NOT NULL
          )`,
        chunk
      );
    }

    // 3. Dezmarchează duplicate care pointează spre IDs ce se șterg
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE transactions SET duplicate_of_id = NULL
          WHERE duplicate_of_id IN (${placeholders})`,
        chunk
      );
    }

    // 4. DELETE FROM transactions
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      const res = await db.runAsync(
        `DELETE FROM transactions WHERE id IN (${placeholders})`,
        chunk
      );
      // expo-sqlite returnează { changes, lastInsertRowId }
      const changes = (res as unknown as { changes?: number })?.changes ?? 0;
      deletedCount += changes;
    }

    // 5. Auto-purge statement-uri orfane
    if (candidateStmtIds.length > 0) {
      // Statement-urile încă referențiate (după DELETE) — set-difference local.
      const stillReferencedRows: { statement_id: string }[] = [];
      for (const chunk of chunkArray(candidateStmtIds, BULK_CHUNK)) {
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await db.getAllAsync<{ statement_id: string }>(
          `SELECT DISTINCT statement_id FROM transactions
            WHERE statement_id IN (${placeholders})`,
          chunk
        );
        stillReferencedRows.push(...rows);
      }
      const stillReferenced = new Set(stillReferencedRows.map(r => r.statement_id));
      const orphanIds = candidateStmtIds.filter(id => !stillReferenced.has(id));
      if (orphanIds.length > 0) {
        for (const chunk of chunkArray(orphanIds, BULK_CHUNK)) {
          const placeholders = chunk.map(() => '?').join(',');
          const res = await db.runAsync(
            `DELETE FROM bank_statements WHERE id IN (${placeholders})`,
            chunk
          );
          const changes = (res as unknown as { changes?: number })?.changes ?? 0;
          statementsRemoved += changes;
        }
      }
    }
  });

  return { deletedCount, statementsRemoved };
}
```

- [ ] **Step 5: Rulează testele**

```
npm test -- transactions.test.ts
```

Așteptat: toate trec, inclusiv noile teste din block-ul `bulkDeleteTransactions`.

- [ ] **Step 6: Type-check**

```
npm run type-check
```

Așteptat: 0 erori.

- [ ] **Step 7: Commit**

```bash
git add services/transactions.ts __tests__/unit/transactions.test.ts
git commit -m "feat(transactions): bulkDeleteTransactions atomic cu cleanup transferuri/duplicate și auto-purge statement-uri"
```

---

## Task 3: Store in-memory pentru handoff IDs între ecrane

**Files:**

- Create: `services/bulkDeleteHandoff.ts`
- Test: `__tests__/unit/bulkDeleteHandoff.test.ts`

Modul mic, fără DB. Doar `set` / `consume`.

- [ ] **Step 1: Scrie testul**

Creează `__tests__/unit/bulkDeleteHandoff.test.ts`:

```ts
import { setBulkDeleteIds, consumeBulkDeleteIds } from '@/services/bulkDeleteHandoff';

describe('bulkDeleteHandoff', () => {
  it('set + consume returnează lista', () => {
    setBulkDeleteIds(['a', 'b', 'c']);
    expect(consumeBulkDeleteIds()).toEqual(['a', 'b', 'c']);
  });

  it('al doilea consume returnează null (one-shot)', () => {
    setBulkDeleteIds(['a']);
    consumeBulkDeleteIds();
    expect(consumeBulkDeleteIds()).toBeNull();
  });

  it('consume fără set anterior returnează null', () => {
    // Cleanup pentru izolare între teste — re-import resetează modul.
    consumeBulkDeleteIds(); // golește din testul anterior dacă a rămas
    expect(consumeBulkDeleteIds()).toBeNull();
  });
});
```

- [ ] **Step 2: Verifică că eșuează**

```
npm test -- bulkDeleteHandoff.test.ts
```

Așteptat: `Cannot find module '@/services/bulkDeleteHandoff'`.

- [ ] **Step 3: Implementează `services/bulkDeleteHandoff.ts`**

```ts
/**
 * Store in-memory pentru transmiterea listei de IDs între ecranul Tranzacții
 * (de unde se inițiază bulk delete) și ecranul de confirmare (`sterge-bulk`).
 *
 * Motiv: query string-ul în router e limitat (~2000 chars pe Android), iar
 * re-rezolvarea filtrului în ecranul de confirm ar introduce race condition.
 */

let pendingIds: string[] | null = null;

export function setBulkDeleteIds(ids: string[]): void {
  pendingIds = [...ids];
}

export function consumeBulkDeleteIds(): string[] | null {
  const out = pendingIds;
  pendingIds = null;
  return out;
}
```

- [ ] **Step 4: Rulează testul**

```
npm test -- bulkDeleteHandoff.test.ts
```

Așteptat: toate trec.

- [ ] **Step 5: Commit**

```bash
git add services/bulkDeleteHandoff.ts __tests__/unit/bulkDeleteHandoff.test.ts
git commit -m "feat(bulk-delete): store in-memory pentru handoff IDs între ecrane"
```

---

## Task 4: Componenta `TransactionFilterBar`

**Files:**

- Create: `components/TransactionFilterBar.tsx`

Componentă self-contained: chip bar cu 4 chip-uri (Cont, Perioadă, Descriere, Sumă) și bottom-sheets locale (folosind `Modal` din react-native pentru a evita o dependență nouă). State controlled de prop-uri (`value` + `onChange`).

- [ ] **Step 1: Creează componenta**

`components/TransactionFilterBar.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { FinancialAccount } from '@/types';
import type { TransactionFilter } from '@/services/transactions';

type Props = {
  value: TransactionFilter;
  onChange: (next: TransactionFilter) => void;
  accounts: FinancialAccount[];
};

type SheetKind = 'account' | 'period' | 'amount' | null;

type PeriodPreset =
  | { kind: 'all' }
  | { kind: 'thisMonth' }
  | { kind: 'lastMonth' }
  | { kind: 'last3Months' }
  | { kind: 'thisYear' }
  | { kind: 'custom'; from: string; to: string };

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetToRange(p: PeriodPreset): { fromDate?: string; toDate?: string } {
  const now = new Date();
  if (p.kind === 'all') return {};
  if (p.kind === 'thisMonth') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  if (p.kind === 'lastMonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  if (p.kind === 'last3Months') {
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  if (p.kind === 'thisYear') {
    const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now.getFullYear(), 11, 31);
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  return { fromDate: p.from, toDate: p.to };
}

function formatPeriodLabel(filter: TransactionFilter): string {
  if (!filter.fromDate && !filter.toDate) return 'Toate';
  if (filter.fromDate && filter.toDate) return `${filter.fromDate} → ${filter.toDate}`;
  if (filter.fromDate) return `≥ ${filter.fromDate}`;
  return `≤ ${filter.toDate}`;
}

function formatAmountLabel(r: TransactionFilter['absAmountRange']): string {
  if (!r) return '—';
  if (r.min !== undefined && r.max !== undefined) return `${r.min} – ${r.max}`;
  if (r.min !== undefined) return `≥ ${r.min}`;
  if (r.max !== undefined) return `≤ ${r.max}`;
  return '—';
}

function isAnyFilterActive(f: TransactionFilter): boolean {
  return Boolean(
    f.account_id || f.fromDate || f.toDate || (f.search && f.search.trim()) || f.absAmountRange
  );
}

export function TransactionFilterBar({ value, onChange, accounts }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [sheet, setSheet] = useState<SheetKind>(null);

  const accountLabel = useMemo(() => {
    if (!value.account_id) return 'Toate';
    return accounts.find(a => a.id === value.account_id)?.name ?? 'Toate';
  }, [accounts, value.account_id]);

  const chipStyle = (active: boolean) => ({
    backgroundColor: active ? C.tint : C.card,
    borderColor: active ? C.tint : C.border,
  });
  const chipText = (active: boolean) => ({ color: active ? C.background : C.text });

  function clearAll() {
    onChange({});
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background, borderColor: C.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Chip
          icon="wallet-outline"
          label={`Cont: ${accountLabel}`}
          active={Boolean(value.account_id)}
          onPress={() => setSheet('account')}
          onClear={
            value.account_id ? () => onChange({ ...value, account_id: undefined }) : undefined
          }
          style={chipStyle(Boolean(value.account_id))}
          textStyle={chipText(Boolean(value.account_id))}
        />
        <Chip
          icon="calendar-outline"
          label={`Per: ${formatPeriodLabel(value)}`}
          active={Boolean(value.fromDate || value.toDate)}
          onPress={() => setSheet('period')}
          onClear={
            value.fromDate || value.toDate
              ? () => onChange({ ...value, fromDate: undefined, toDate: undefined })
              : undefined
          }
          style={chipStyle(Boolean(value.fromDate || value.toDate))}
          textStyle={chipText(Boolean(value.fromDate || value.toDate))}
        />
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={16} color={C.textSecondary} />
          <TextInput
            placeholder="Descriere"
            placeholderTextColor={C.textSecondary}
            value={value.search ?? ''}
            onChangeText={s => onChange({ ...value, search: s.length > 0 ? s : undefined })}
            style={[styles.searchInput, { color: C.text }]}
          />
        </View>
        <Chip
          icon="cash-outline"
          label={`Sumă: ${formatAmountLabel(value.absAmountRange)}`}
          active={Boolean(value.absAmountRange)}
          onPress={() => setSheet('amount')}
          onClear={
            value.absAmountRange
              ? () => onChange({ ...value, absAmountRange: undefined })
              : undefined
          }
          style={chipStyle(Boolean(value.absAmountRange))}
          textStyle={chipText(Boolean(value.absAmountRange))}
        />
        {isAnyFilterActive(value) && (
          <Pressable onPress={clearAll} style={[styles.clearBtn, { borderColor: C.border }]}>
            <Text style={{ color: C.textSecondary }}>Curăță</Text>
          </Pressable>
        )}
      </ScrollView>

      {sheet === 'account' && (
        <AccountSheet
          accounts={accounts}
          selectedId={value.account_id}
          onSelect={id => {
            onChange({ ...value, account_id: id });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'period' && (
        <PeriodSheet
          value={value}
          onApply={range => {
            onChange({ ...value, ...range });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'amount' && (
        <AmountSheet
          value={value.absAmountRange}
          onApply={r => {
            onChange({ ...value, absAmountRange: r });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}

function Chip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  onClear?: () => void;
  style: { backgroundColor: string; borderColor: string };
  textStyle: { color: string };
}) {
  return (
    <Pressable onPress={props.onPress} style={[styles.chip, props.style]}>
      <Ionicons name={props.icon} size={14} color={props.textStyle.color} />
      <Text style={[styles.chipLabel, props.textStyle]} numberOfLines={1}>
        {props.label}
      </Text>
      {props.onClear && (
        <Pressable hitSlop={8} onPress={props.onClear}>
          <Ionicons name="close" size={14} color={props.textStyle.color} />
        </Pressable>
      )}
    </Pressable>
  );
}

function AccountSheet({
  accounts,
  selectedId,
  onSelect,
  onClose,
}: {
  accounts: FinancialAccount[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  onClose: () => void;
}) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <Text style={[styles.sheetTitle, { color: C.text }]}>Cont</Text>
        <Pressable
          onPress={() => onSelect(undefined)}
          style={[styles.sheetRow, { borderBottomColor: C.border }]}
        >
          <Text style={{ color: C.text }}>Toate conturile</Text>
          {!selectedId && <Ionicons name="checkmark" size={18} color={C.tint} />}
        </Pressable>
        {accounts.map(a => (
          <Pressable
            key={a.id}
            onPress={() => onSelect(a.id)}
            style={[styles.sheetRow, { borderBottomColor: C.border }]}
          >
            <Text style={{ color: C.text }}>{a.name}</Text>
            {selectedId === a.id && <Ionicons name="checkmark" size={18} color={C.tint} />}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

function PeriodSheet({
  value,
  onApply,
  onClose,
}: {
  value: TransactionFilter;
  onApply: (range: { fromDate?: string; toDate?: string }) => void;
  onClose: () => void;
}) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [customFrom, setCustomFrom] = useState(value.fromDate ?? '');
  const [customTo, setCustomTo] = useState(value.toDate ?? '');

  const presets: { label: string; preset: PeriodPreset }[] = [
    { label: 'Toate', preset: { kind: 'all' } },
    { label: 'Luna asta', preset: { kind: 'thisMonth' } },
    { label: 'Luna trecută', preset: { kind: 'lastMonth' } },
    { label: 'Ultimele 3 luni', preset: { kind: 'last3Months' } },
    { label: 'An curent', preset: { kind: 'thisYear' } },
  ];

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <Text style={[styles.sheetTitle, { color: C.text }]}>Perioadă</Text>
        {presets.map(p => (
          <Pressable
            key={p.label}
            onPress={() => onApply(presetToRange(p.preset))}
            style={[styles.sheetRow, { borderBottomColor: C.border }]}
          >
            <Text style={{ color: C.text }}>{p.label}</Text>
          </Pressable>
        ))}
        <Text style={[styles.sheetSubTitle, { color: C.textSecondary }]}>
          Interval custom (YYYY-MM-DD)
        </Text>
        <View style={styles.amountInputs}>
          <TextInput
            placeholder="De la"
            placeholderTextColor={C.textSecondary}
            value={customFrom}
            onChangeText={setCustomFrom}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
          <TextInput
            placeholder="Până la"
            placeholderTextColor={C.textSecondary}
            value={customTo}
            onChangeText={setCustomTo}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
        </View>
        <Pressable
          onPress={() =>
            onApply({
              fromDate: customFrom || undefined,
              toDate: customTo || undefined,
            })
          }
          style={[styles.applyBtn, { backgroundColor: C.tint }]}
        >
          <Text style={{ color: C.background, fontWeight: '600' }}>Aplică interval</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function AmountSheet({
  value,
  onApply,
  onClose,
}: {
  value: TransactionFilter['absAmountRange'];
  onApply: (range: TransactionFilter['absAmountRange']) => void;
  onClose: () => void;
}) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [minStr, setMinStr] = useState(value?.min !== undefined ? String(value.min) : '');
  const [maxStr, setMaxStr] = useState(value?.max !== undefined ? String(value.max) : '');

  function apply() {
    const min = minStr.trim() === '' ? undefined : Number(minStr);
    const max = maxStr.trim() === '' ? undefined : Number(maxStr);
    if (min === undefined && max === undefined) {
      onApply(undefined);
      return;
    }
    onApply({ min, max });
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <Text style={[styles.sheetTitle, { color: C.text }]}>Sumă (valori absolute)</Text>
        <View style={styles.amountInputs}>
          <TextInput
            placeholder="Min"
            placeholderTextColor={C.textSecondary}
            keyboardType="numeric"
            value={minStr}
            onChangeText={setMinStr}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
          <TextInput
            placeholder="Max"
            placeholderTextColor={C.textSecondary}
            keyboardType="numeric"
            value={maxStr}
            onChangeText={setMaxStr}
            style={[styles.amountInput, { color: C.text, borderColor: C.border }]}
          />
        </View>
        <Pressable onPress={apply} style={[styles.applyBtn, { backgroundColor: C.tint }]}>
          <Text style={{ color: C.background, fontWeight: '600' }}>Aplică</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { gap: 6, alignItems: 'center', paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipLabel: { fontSize: 13, maxWidth: 160 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    minWidth: 140,
  },
  searchInput: { flex: 1, paddingVertical: 4, fontSize: 13 },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
  },
  sheetTitle: { fontSize: 16, fontWeight: '600' },
  sheetSubTitle: { fontSize: 12, marginTop: 8 },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  amountInputs: { flexDirection: 'row', gap: 8 },
  amountInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  applyBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
});

export default TransactionFilterBar;
```

- [ ] **Step 2: Type-check**

```
npm run type-check
```

Așteptat: 0 erori.

- [ ] **Step 3: Lint**

```
npm run lint -- components/TransactionFilterBar.tsx
```

Așteptat: 0 erori, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add components/TransactionFilterBar.tsx
git commit -m "feat(filter-bar): chip bar tranzacții (cont, perioadă, descriere, sumă)"
```

---

## Task 5: Ecran de confirmare `app/tranzactii/sterge-bulk.tsx`

**Files:**

- Create: `app/tranzactii/sterge-bulk.tsx`

Ecran care:

- consumă IDs de la handoff store la mount;
- preîncarcă tranzacțiile (`getTransactions` cu filtru implicit „toate IDs", dar tx-urile pot fi încărcate individual cu `getTransaction` în paralel);
- afișează listă cu checkbox pre-bifat;
- la „Șterge" → `Alert.alert` confirm → `bulkDeleteTransactions` → router.back.

- [ ] **Step 1: Creează ecranul**

`app/tranzactii/sterge-bulk.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';

import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { consumeBulkDeleteIds } from '@/services/bulkDeleteHandoff';
import { bulkDeleteTransactions, getTransaction } from '@/services/transactions';
import { statusColors } from '@/theme/colors';
import type { Transaction } from '@/types';

export default function StergeBulkScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const { accounts } = useFinancialAccounts();
  const { categories } = useCategories();

  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const ids = consumeBulkDeleteIds();
    if (!ids || ids.length === 0) {
      setExpired(true);
      setTxs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const loaded = await Promise.all(ids.map(id => getTransaction(id)));
      if (cancelled) return;
      const ok = loaded.filter((t): t is Transaction => t !== null);
      setTxs(ok);
      setSelected(new Set(ok.map(t => t.id)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const counters = useMemo(() => {
    if (!txs) return { count: 0, sumAbs: 0, transfers: 0, fromStatement: 0 };
    let sumAbs = 0;
    let transfers = 0;
    let fromStatement = 0;
    for (const t of txs) {
      if (!selected.has(t.id)) continue;
      sumAbs += Math.abs(t.amount);
      if (t.is_internal_transfer) transfers += 1;
      if (t.statement_id) fromStatement += 1;
    }
    return { count: selected.size, sumAbs, transfers, fromStatement };
  }, [txs, selected]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmDelete() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    Alert.alert(
      `Ștergi ${ids.length} tranzacții?`,
      'Această acțiune e ireversibilă. Pentru tranzacțiile care fac parte din transferuri interne, contrapartida va deveni tranzacție obișnuită. Marcajul de duplicat se va anula. Statement-urile rămase fără tranzacții se vor șterge automat.',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const res = await bulkDeleteTransactions(ids);
              Alert.alert(
                'Gata',
                `${res.deletedCount} tranzacții șterse${
                  res.statementsRemoved > 0
                    ? ` · ${res.statementsRemoved} extras${res.statementsRemoved === 1 ? '' : 'e'} eliminat${
                        res.statementsRemoved === 1 ? '' : 'e'
                      }`
                    : ''
                }.`,
                [{ text: 'OK', onPress: () => router.back() }]
              );
            } catch (e) {
              Alert.alert('Eroare', 'Ștergerea a eșuat. Încearcă din nou.');
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  if (expired) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Confirmă ștergerea' }} />
        <Text style={{ color: C.textSecondary, textAlign: 'center', padding: 24 }}>
          Sesiunea de ștergere a expirat. Întoarce-te la Tranzacții și încearcă din nou.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.fallbackBtn, { backgroundColor: C.tint }]}
        >
          <Text style={{ color: C.background }}>Înapoi</Text>
        </Pressable>
      </View>
    );
  }

  if (txs === null) {
    return (
      <View style={[styles.center, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Confirmă ștergerea' }} />
        <ActivityIndicator color={C.tint} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: 'Confirmă ștergerea' }} />

      <View style={[styles.summary, { borderBottomColor: C.border }]}>
        <Text style={[styles.summaryTitle, { color: C.text }]}>
          {counters.count} selectate · sumă {counters.sumAbs.toFixed(2)}
        </Text>
        <Text style={[styles.summarySub, { color: C.textSecondary }]}>
          {counters.transfers > 0 && `${counters.transfers} transferuri interne · `}
          {counters.fromStatement > 0 && `${counters.fromStatement} din extrase`}
        </Text>
      </View>

      <FlatList
        data={txs}
        keyExtractor={t => t.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => {
          const checked = selected.has(item.id);
          const account = item.account_id ? accountById.get(item.account_id) : undefined;
          const category = item.category_id ? categoryById.get(item.category_id) : undefined;
          const amountColor = item.amount >= 0 ? statusColors.ok : C.text;
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={22}
                color={checked ? C.tint : C.textSecondary}
              />
              <View style={styles.rowMain}>
                <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                  {item.merchant || item.description || 'Tranzacție'}
                </Text>
                <Text style={[styles.subtitle, { color: C.textSecondary }]} numberOfLines={1}>
                  {item.date}
                  {account ? ` • ${account.name}` : ''}
                  {category ? ` • ${category.name}` : ''}
                </Text>
              </View>
              <Text style={[styles.amount, { color: amountColor }]}>
                {item.amount.toFixed(2)} {item.currency}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ color: C.textSecondary }}>Niciuna de afișat.</Text>
          </View>
        }
      />

      <BottomActionBar>
        <Pressable
          onPress={() => router.back()}
          style={[styles.btnSecondary, { borderColor: C.border }]}
        >
          <Text style={{ color: C.text }}>Anulează</Text>
        </Pressable>
        <Pressable
          disabled={selected.size === 0 || deleting}
          onPress={confirmDelete}
          style={[
            styles.btnPrimary,
            {
              backgroundColor: statusColors.bad,
              opacity: selected.size === 0 || deleting ? 0.5 : 1,
            },
          ]}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>
            {deleting ? 'Se șterge...' : `Șterge ${selected.size} tranzacții`}
          </Text>
        </Pressable>
      </BottomActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  summaryTitle: { fontSize: 14, fontWeight: '600' },
  summarySub: { fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 12 },
  amount: { fontSize: 15, fontWeight: '600' },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  btnPrimary: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  fallbackBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
});
```

- [ ] **Step 2: Type-check**

```
npm run type-check
```

Așteptat: 0 erori.

- [ ] **Step 3: Lint**

```
npm run lint -- app/tranzactii/sterge-bulk.tsx
```

Așteptat: 0 erori, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add app/tranzactii/sterge-bulk.tsx
git commit -m "feat(tranzactii): ecran confirmare bulk delete cu pre-bifare și deselect"
```

---

## Task 6: Integrare în `app/tranzactii/index.tsx` și `_layout.tsx`

**Files:**

- Modify: `app/tranzactii/_layout.tsx` (înregistrează ecran nou)
- Modify: `app/tranzactii/index.tsx` (adaugă filter bar + buton „Șterge filtrate")

- [ ] **Step 1: Adaugă rută în `_layout.tsx`**

Înlocuiește conținutul lui `app/tranzactii/_layout.tsx` cu:

```tsx
import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TranzactiiLayout() {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTitleStyle: { color: palette.text },
        headerTintColor: palette.tint,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Tranzacții' }} />
      <Stack.Screen name="[id]" options={{ title: 'Tranzacție', presentation: 'modal' }} />
      <Stack.Screen name="sterge-bulk" options={{ title: 'Confirmă ștergerea' }} />
    </Stack>
  );
}
```

- [ ] **Step 2: Modifică `app/tranzactii/index.tsx`**

Înlocuiește conținutul cu:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';

import { TransactionFilterBar } from '@/components/TransactionFilterBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { useTransactions } from '@/hooks/useTransactions';
import { setBulkDeleteIds } from '@/services/bulkDeleteHandoff';
import type { TransactionFilter } from '@/services/transactions';
import { statusColors } from '@/theme/colors';

function isAnyActive(f: TransactionFilter): boolean {
  return Boolean(
    f.account_id || f.fromDate || f.toDate || (f.search && f.search.trim()) || f.absAmountRange
  );
}

export default function TransactionsList() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [filter, setFilter] = useState<TransactionFilter>({});

  const { transactions, loading } = useTransactions(filter);
  const { accounts } = useFinancialAccounts();
  const { categories } = useCategories();

  const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const showBulkDelete = isAnyActive(filter) && transactions.length > 0;

  function startBulkDelete() {
    setBulkDeleteIds(transactions.map(t => t.id));
    router.push('/tranzactii/sterge-bulk');
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen
        options={{
          title: 'Tranzacții',
          headerRight: () =>
            showBulkDelete ? (
              <Pressable onPress={startBulkDelete} hitSlop={8} style={styles.headerBtn}>
                <Ionicons name="trash-outline" size={20} color={statusColors.bad} />
                <Text style={[styles.headerBtnText, { color: statusColors.bad }]}>
                  Șterge filtrate
                </Text>
              </Pressable>
            ) : null,
        }}
      />

      <TransactionFilterBar value={filter} onChange={setFilter} accounts={accounts} />

      {loading && transactions.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingBottom: 96 }}
          renderItem={({ item }) => {
            const account = item.account_id ? accountById.get(item.account_id) : undefined;
            const category = item.category_id ? categoryById.get(item.category_id) : undefined;
            const amountColor = item.amount >= 0 ? statusColors.ok : C.text;
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/tranzactii/[id]',
                    params: { id: item.id },
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={styles.rowMain}>
                  <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
                    {item.merchant || item.description || 'Tranzacție'}
                  </Text>
                  <Text style={[styles.subtitle, { color: C.textSecondary }]} numberOfLines={1}>
                    {item.date}
                    {account ? ` • ${account.name}` : ''}
                    {category ? ` • ${category.name}` : ''}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: amountColor }]}>
                  {item.amount.toFixed(2)} {item.currency}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: C.textSecondary }}>
                {isAnyActive(filter)
                  ? 'Niciun rezultat pentru filtrele selectate.'
                  : 'Nicio tranzacție.'}
              </Text>
            </View>
          }
        />
      )}
      <Pressable
        onPress={() => router.push({ pathname: '/tranzactii/[id]', params: { id: 'new' } })}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: C.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 24, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 12 },
  amount: { fontSize: 15, fontWeight: '600', marginLeft: 8 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
  headerBtnText: { fontSize: 13, fontWeight: '500' },
});
```

> **Notă:** păstrăm exact stilurile vechi pentru rândurile listei, FAB-ul și empty state-ul. Singura schimbare e: adaugă filter bar, header right, mesaj empty diferit la filtru activ.

- [ ] **Step 3: Type-check**

```
npm run type-check
```

Așteptat: 0 erori.

- [ ] **Step 4: Lint**

```
npm run lint -- app/tranzactii/index.tsx app/tranzactii/_layout.tsx
```

Așteptat: 0 erori, 0 warnings.

- [ ] **Step 5: Smoke test manual în simulator**

Pornește dev server:

```
npm start
```

Apoi în simulator:

1. **Scenariu 1 — filtrare cont + perioadă:** Tranzacții → tap chip „Cont" → alege un cont. Tap chip „Perioadă" → „Luna asta". Verifică lista se reduce. Apare buton „Șterge filtrate" în header.
2. **Scenariu 2 — bulk delete cu deselect:** Tap „Șterge filtrate" → apare ecranul cu lista pre-bifată. Tap pe un rând → checkbox toggle. Counter live se actualizează. Tap „Șterge N tranzacții" → confirm dialog → „Șterge". Verifică toast „Gata" + revine la listă cu filtrele păstrate.
3. **Scenariu 3 — auto-purge statement:** Importă un extras (orice cont). Filtrează cont + perioadă acoperă-tot statementul. Bulk delete tot. Du-te la `Conturi → contul respectiv → Istoric extrase` — verifică că statement-ul a dispărut.
4. **Scenariu 4 — transfer intern dezlegat:** Creează manual două tranzacții opuse (ex. -500 cont A, +500 cont B), leagă-le ca transfer intern. Filtrează după cont A. Bulk delete tranzacția -500. Verifică că tranzacția +500 din cont B a redevenit obișnuită (în formularul ei, checkbox transfer intern nemarcat).
5. **Scenariu 5 — fără rezultate:** Filtru cu termeni care nu există (ex. descriere „xyzzy"). Empty state „Niciun rezultat pentru filtrele selectate." Buton „Șterge filtrate" ascuns.

- [ ] **Step 6: Rulează lanțul complet**

```
npm run check
```

Așteptat: tot lanțul (lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit) trece.

- [ ] **Step 7: Commit**

```bash
git add app/tranzactii/index.tsx app/tranzactii/_layout.tsx
git commit -m "feat(tranzactii): bară filtre + acțiune bulk delete pe tranzacții filtrate"
```

---

## Task 7: Update IDEAS.md cu status „Implementat"

**Files:**

- Modify: `docs/IDEAS.md` (secțiunea „Implementat (post-MVP fundație)")

- [ ] **Step 1: Adaugă entry-ul în IDEAS.md**

În `docs/IDEAS.md`, în secțiunea `## Implementat (post-MVP fundație)`, **înainte** de entry-ul „Sugestie transfer intern" (cel mai recent), adaugă:

```markdown
- **Ștergere în lot tranzacții filtrate** (2026-05-05) — bară de filtre pe ecranul Tranzacții (cont, perioadă, descriere, sumă în valori absolute) + acțiune „Șterge filtrate" cu ecran de confirmare cu pre-bifare. Backend: `bulkDeleteTransactions(ids)` în `services/transactions.ts` rulează atomic într-o `withTransactionAsync` cu cleanup transferuri interne (contraparte devine tranzacție obișnuită), dezmarcare duplicate, DELETE chunked la 500 IDs și auto-purge `bank_statements` rămase fără tranzacții. Filtru nou `absAmountRange` adăugat în `TransactionFilter`. Handoff IDs între ecrane prin store in-memory `services/bulkDeleteHandoff.ts`. Spec: `docs/specs/2026-05-05-bulk-delete-transactions-design.md`. Plan: `docs/plans/2026-05-05-bulk-delete-transactions.md`.
```

- [ ] **Step 2: Update marcaj „Ultima actualizare"**

În `docs/IDEAS.md`, modifică:

```markdown
**Ultima actualizare:** 2026-05-04.
```

în:

```markdown
**Ultima actualizare:** 2026-05-05.
```

- [ ] **Step 3: Commit**

```bash
git add docs/IDEAS.md
git commit -m "docs(ideas): marchez ștergere bulk tranzacții filtrate ca implementat"
```

---

## Self-review

Verificări post-plan:

- ✅ Spec coverage: fiecare secțiune din spec are task corespunzător.
  - Filtre v1 (4 chip-uri): Task 4
  - `bulkDeleteTransactions` cu cleanup atomic: Task 2
  - `absAmountRange`: Task 1
  - Store handoff: Task 3
  - Confirm screen + pre-bifare: Task 5
  - Integrare ecran Tranzacții + layout: Task 6
  - Auto-purge statement-uri orfane: testat în Task 2, smoke în Task 6
  - Edge cases: chunking 1500, lista vidă, IDs inexistente — testate în Task 2; expired session — în Task 5.
- ✅ Placeholder scan: nicio TBD/TODO; cod complet în fiecare task.
- ✅ Type consistency: `TransactionFilter.absAmountRange` declarat în Task 1 e folosit identic în Task 4 și Task 6. `bulkDeleteTransactions(ids)` semnătura e identică în Task 2 (declarație) și Task 5 (consum). `setBulkDeleteIds`/`consumeBulkDeleteIds` apar în Task 3 și se folosesc în Task 5/6.
- ✅ Frequent commits: 1 commit per task; 7 commits total.
- ✅ TDD: backend (Task 1, 2, 3) cu test→fail→implement→pass; UI (Task 4, 5, 6) cu type-check + lint + smoke.
