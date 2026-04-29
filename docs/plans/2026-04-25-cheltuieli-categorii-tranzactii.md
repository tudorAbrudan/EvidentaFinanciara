# Tranzacții expandabile pe categorii — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** În ecranul Gestiune financiară, fiecare bară din "Cheltuieli pe categorii" devine expandabilă; sub ea se afișează tranzacțiile categoriei, cu tap pe rând = edit complet și tap pe pastila de categorie = picker rapid pentru recategorizare.

**Architecture:** Modificări concentrate într-un singur ecran (`app/(tabs)/entitati/financiar/index.tsx`), un hook nou (`hooks/useCategoryTransactions.ts`) și extindere minoră a `services/transactions.ts` cu două flag-uri noi de filtru. Niciun tabel SQLite nou, nicio migrare.

**Tech Stack:** React Native + Expo, TypeScript, expo-sqlite, Expo Router. Teste cu Jest (servicii) + verificare manuală pe simulator (UI).

**Spec referință:** `app/docs/superpowers/specs/2026-04-25-cheltuieli-categorii-tranzactii-design.md`

**Convenții repo:**
- Working dir pentru comenzi npm: `app/` (de exemplu `cd app && npm test`).
- Path-urile din plan sunt relative la repo root (`/Users/ax/work/documents/`).
- TS strict, fără `any`, texte UI în română.
- `useColorScheme` se importă **doar** din `@/components/useColorScheme`.
- Zero culori hardcodate; folosește `Colors[scheme]` și `primary`/`statusColors` din `@/theme/colors`.

---

## Task 1: Extinde `TransactionFilter` cu `uncategorized` și `onlyExpenses`

**Files:**
- Modify: `app/services/transactions.ts` (interface `TransactionFilter` la linia ~51, funcția `getTransactions` la linia ~66)
- Test: `app/__tests__/unit/transactions.test.ts`

- [ ] **Step 1: Citește contextul actual**

Read `app/services/transactions.ts` linii 51–119 ca să vezi forma exactă a `TransactionFilter` și a funcției `getTransactions` (cum construiește `where[]` și `params[]`).

- [ ] **Step 2: Scrie testele care eșuează**

Adaugă în `app/__tests__/unit/transactions.test.ts`, la finalul fișierului (după ultimul `describe`):

```typescript
describe('getTransactions filter flags', () => {
  beforeEach(() => {
    (db.db.getAllAsync as jest.Mock).mockReset();
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([]);
  });

  it('uncategorized=true adds "category_id IS NULL" to WHERE', async () => {
    const { getTransactions } = await import('@/services/transactions');
    await getTransactions({ uncategorized: true });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/category_id IS NULL/);
  });

  it('onlyExpenses=true adds "amount < 0" to WHERE', async () => {
    const { getTransactions } = await import('@/services/transactions');
    await getTransactions({ onlyExpenses: true });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/amount < 0/);
  });

  it('uncategorized + onlyExpenses both applied', async () => {
    const { getTransactions } = await import('@/services/transactions');
    await getTransactions({ uncategorized: true, onlyExpenses: true });
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/category_id IS NULL/);
    expect(sql).toMatch(/amount < 0/);
  });

  it('default call (no flags) does NOT include the new clauses', async () => {
    const { getTransactions } = await import('@/services/transactions');
    await getTransactions({});
    const sql = (db.db.getAllAsync as jest.Mock).mock.calls[0][0] as string;
    expect(sql).not.toMatch(/category_id IS NULL/);
    expect(sql).not.toMatch(/amount < 0/);
  });
});
```

- [ ] **Step 3: Rulează testele și confirmă că pică**

```bash
cd app && npx jest __tests__/unit/transactions.test.ts -t "filter flags"
```

Expected: 4 teste FAIL (TypeScript va da și erori pentru proprietăți inexistente `uncategorized` și `onlyExpenses`, sau testele rulează și pică pe asserturile `toMatch`).

- [ ] **Step 4: Extinde `TransactionFilter`**

În `app/services/transactions.ts`, modifică interfața `TransactionFilter` (în jur de linia 51) — adaugă **exact** la final, înainte de `}`:

```typescript
export interface TransactionFilter {
  account_id?: string;
  category_id?: string;
  fromDate?: string; // YYYY-MM-DD inclusiv
  toDate?: string; // YYYY-MM-DD inclusiv
  search?: string; // în description / merchant
  minAmount?: number;
  maxAmount?: number;
  excludeDuplicates?: boolean; // default true
  excludeTransfers?: boolean; // default false (UI listă) — true pentru analitice
  source?: TransactionSource;
  limit?: number;
  offset?: number;
  uncategorized?: boolean; // filtru pe category_id IS NULL
  onlyExpenses?: boolean; // filtru pe amount < 0
}
```

- [ ] **Step 5: Aplică flag-urile în `getTransactions`**

În `app/services/transactions.ts`, în corpul lui `getTransactions`, adaugă **imediat după** blocul `if (filter.excludeTransfers === true)` (în jurul liniei 108) și **înainte de** `const whereSql = …`:

```typescript
  if (filter.uncategorized === true) {
    where.push('category_id IS NULL');
  }
  if (filter.onlyExpenses === true) {
    where.push('amount < 0');
  }
```

- [ ] **Step 6: Rulează testele și confirmă că trec**

```bash
cd app && npx jest __tests__/unit/transactions.test.ts -t "filter flags"
```

Expected: 4 teste PASS.

- [ ] **Step 7: Type check + lint**

```bash
cd app && npm run type-check && npm run lint
```

Expected: 0 erori.

- [ ] **Step 8: Commit**

```bash
git add app/services/transactions.ts app/__tests__/unit/transactions.test.ts
git commit -m "feat(transactions): add uncategorized and onlyExpenses filters"
```

---

## Task 2: Hook `useCategoryTransactions`

**Files:**
- Create: `app/hooks/useCategoryTransactions.ts`
- Test: `app/__tests__/unit/useCategoryTransactions.test.ts`

- [ ] **Step 1: Citește pattern-ul existent**

Read `app/hooks/useMonthlyAnalysis.ts` și `app/hooks/useTransactions.ts` ca să folosești același stil (loading/error/refresh, useEffect pe deps).

- [ ] **Step 2: Scrie testele care eșuează**

Create `app/__tests__/unit/useCategoryTransactions.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/services/transactions', () => ({
  __esModule: true,
  getTransactions: jest.fn(),
}));

import * as txService from '@/services/transactions';
import { useCategoryTransactions } from '@/hooks/useCategoryTransactions';

describe('useCategoryTransactions', () => {
  beforeEach(() => {
    (txService.getTransactions as jest.Mock).mockReset();
    (txService.getTransactions as jest.Mock).mockResolvedValue([]);
  });

  it('does NOT fetch when categoryKey is null', async () => {
    renderHook(() => useCategoryTransactions('2026-04', null));
    await new Promise(r => setTimeout(r, 10));
    expect(txService.getTransactions).not.toHaveBeenCalled();
  });

  it('fetches with uncategorized=true when categoryKey is "__uncat__"', async () => {
    renderHook(() => useCategoryTransactions('2026-04', '__uncat__'));
    await waitFor(() => expect(txService.getTransactions).toHaveBeenCalled());
    const arg = (txService.getTransactions as jest.Mock).mock.calls[0][0];
    expect(arg.uncategorized).toBe(true);
    expect(arg.category_id).toBeUndefined();
    expect(arg.fromDate).toBe('2026-04-01');
    expect(arg.toDate).toBe('2026-04-31');
    expect(arg.onlyExpenses).toBe(true);
    expect(arg.excludeDuplicates).toBe(true);
    expect(arg.excludeTransfers).toBe(true);
  });

  it('fetches with category_id when categoryKey is a real id', async () => {
    renderHook(() => useCategoryTransactions('2026-04', 'cat-abc'));
    await waitFor(() => expect(txService.getTransactions).toHaveBeenCalled());
    const arg = (txService.getTransactions as jest.Mock).mock.calls[0][0];
    expect(arg.category_id).toBe('cat-abc');
    expect(arg.uncategorized).toBeUndefined();
  });

  it('passes accountId through when set', async () => {
    renderHook(() => useCategoryTransactions('2026-04', 'cat-abc', 'acc-1'));
    await waitFor(() => expect(txService.getTransactions).toHaveBeenCalled());
    const arg = (txService.getTransactions as jest.Mock).mock.calls[0][0];
    expect(arg.account_id).toBe('acc-1');
  });

  it('refetches when categoryKey changes', async () => {
    const { rerender } = renderHook(
      ({ key }: { key: string | null }) => useCategoryTransactions('2026-04', key),
      { initialProps: { key: 'cat-abc' as string | null } }
    );
    await waitFor(() =>
      expect((txService.getTransactions as jest.Mock).mock.calls.length).toBe(1)
    );
    rerender({ key: 'cat-xyz' });
    await waitFor(() =>
      expect((txService.getTransactions as jest.Mock).mock.calls.length).toBe(2)
    );
  });

  it('exposes error message in Romanian on failure', async () => {
    (txService.getTransactions as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useCategoryTransactions('2026-04', 'cat-abc'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toContain('boom');
  });
});
```

- [ ] **Step 3: Rulează testele și confirmă că pică**

```bash
cd app && npx jest __tests__/unit/useCategoryTransactions.test.ts
```

Expected: FAIL — modulul `@/hooks/useCategoryTransactions` nu există.

- [ ] **Step 4: Verifică dependențele de testare**

```bash
cd app && npm ls @testing-library/react-native 2>/dev/null
```

Dacă lipsește, instalează:

```bash
cd app && npm install --save-dev @testing-library/react-native
```

(Probabil deja există — în repo se folosesc `renderHook`-style tests în alte locuri. Dacă comanda `npx jest` din Step 3 a rulat fără eroare „cannot find module @testing-library/react-native", e deja instalat.)

- [ ] **Step 5: Implementează hook-ul**

Create `app/hooks/useCategoryTransactions.ts`:

```typescript
import { useEffect, useState, useCallback } from 'react';
import * as tx from '@/services/transactions';
import type { Transaction } from '@/types';

/**
 * Sentinel pentru categoria „Necategorizat" (tranzacții fără category_id).
 * Folosit de UI când utilizatorul expandează rândul „Necategorizat" din breakdown.
 */
export const UNCATEGORIZED_KEY = '__uncat__';

/**
 * Încarcă tranzacțiile dintr-o categorie pentru o lună dată.
 *
 * `categoryKey` interpretare:
 *   - `null`              → hook dezactivat, nu face fetch (loading=false, transactions=[]).
 *   - `UNCATEGORIZED_KEY` → fetch tranzacții fără categorie (`category_id IS NULL`).
 *   - alt string          → fetch tranzacții cu acel `category_id`.
 *
 * Filtrele aplicate sunt aliniate cu `getCategoryBreakdown`:
 * doar cheltuieli (`amount < 0`), exclude transferuri interne și duplicate.
 */
export function useCategoryTransactions(
  yearMonth: string,
  categoryKey: string | null,
  accountId?: string
) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (categoryKey === null) {
      setTransactions([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const filter: tx.TransactionFilter = {
        account_id: accountId,
        fromDate: `${yearMonth}-01`,
        toDate: `${yearMonth}-31`,
        excludeDuplicates: true,
        excludeTransfers: true,
        onlyExpenses: true,
      };
      if (categoryKey === UNCATEGORIZED_KEY) {
        filter.uncategorized = true;
      } else {
        filter.category_id = categoryKey;
      }
      const list = await tx.getTransactions(filter);
      setTransactions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu s-a putut încărca lista');
    } finally {
      setLoading(false);
    }
  }, [yearMonth, categoryKey, accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { transactions, loading, error, refresh };
}
```

- [ ] **Step 6: Rulează testele și confirmă că trec**

```bash
cd app && npx jest __tests__/unit/useCategoryTransactions.test.ts
```

Expected: 6 teste PASS.

- [ ] **Step 7: Type check + lint**

```bash
cd app && npm run type-check && npm run lint
```

Expected: 0 erori.

- [ ] **Step 8: Commit**

```bash
git add app/hooks/useCategoryTransactions.ts app/__tests__/unit/useCategoryTransactions.test.ts
git commit -m "feat(hooks): add useCategoryTransactions for expanded category lists"
```

---

## Task 3: State `expandedCatKey` în `FinanciarHubScreen` + chevron pe `CategoryRow`

**Files:**
- Modify: `app/app/(tabs)/entitati/financiar/index.tsx`

- [ ] **Step 1: Adaugă import-ul pentru sentinel**

În `app/app/(tabs)/entitati/financiar/index.tsx`, în lista de imports din top, modifică linia care importă din `@/services/transactions`:

```typescript
import { formatYearMonth } from '@/services/transactions';
```

→ devine:

```typescript
import { formatYearMonth } from '@/services/transactions';
import { UNCATEGORIZED_KEY } from '@/hooks/useCategoryTransactions';
```

- [ ] **Step 2: Adaugă state-ul `expandedCatKey`**

În corpul lui `FinanciarHubScreen`, după linia `const [accountFilter, setAccountFilter] = useState<string | undefined>(undefined);`, adaugă:

```typescript
  const [expandedCatKey, setExpandedCatKey] = useState<string | null>(null);
```

- [ ] **Step 3: Adaugă auto-collapse când se schimbă luna sau contul**

Imediat după linia adăugată la Step 2, adaugă:

```typescript
  // Schimbarea filtrelor (lună sau cont) invalidează lista expandată.
  useEffect(() => {
    setExpandedCatKey(null);
  }, [yearMonth, accountFilter]);
```

Asigură-te că `useEffect` este importat sus din `react` (probabil deja e — verifică).

- [ ] **Step 4: Modifică `CategoryRow` pentru a fi `Pressable` cu chevron**

Înlocuiește definiția curentă a `CategoryRow` (în partea de jos a fișierului, în jurul liniei 426) cu:

```typescript
function CategoryRow({
  item,
  expanded,
  onPress,
  C,
}: {
  item: import('@/services/transactions').CategoryBreakdownItem;
  expanded: boolean;
  onPress: () => void;
  C: typeof Colors.light;
}) {
  const barColor = item.color || primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.catRow, pressed && { opacity: 0.85 }]}
    >
      <RNView style={styles.catTopRow}>
        <RNView style={styles.catLabelWrap}>
          <RNView style={[styles.catDot, { backgroundColor: barColor }]} />
          <RNText style={[styles.catName, { color: C.text }]} numberOfLines={1}>
            {item.category_name}
          </RNText>
        </RNView>
        <RNView style={styles.catRightWrap}>
          <RNText style={[styles.catAmount, { color: C.text }]}>
            {Math.round(item.total_ron).toLocaleString('ro-RO')} RON
          </RNText>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={C.textSecondary}
            style={{ marginLeft: 6 }}
          />
        </RNView>
      </RNView>
      <RNView style={[styles.catBarBg, { backgroundColor: `${C.border}80` }]}>
        <RNView
          style={[
            styles.catBarFill,
            {
              backgroundColor: barColor,
              width: `${Math.max(2, Math.min(100, item.percentage))}%`,
            },
          ]}
        />
      </RNView>
      <RNText style={[styles.catMeta, { color: C.textSecondary }]}>
        {item.percentage.toFixed(1)}% • {item.transaction_count}{' '}
        {item.transaction_count === 1 ? 'tranzacție' : 'tranzacții'}
      </RNText>
    </Pressable>
  );
}
```

- [ ] **Step 5: Adaugă stilul `catRightWrap`**

În `StyleSheet.create({ ... })` la finalul fișierului, lângă `catTopRow`, adaugă:

```typescript
  catRightWrap: { flexDirection: 'row', alignItems: 'center' },
```

- [ ] **Step 6: Conectează `expandedCatKey` cu `CategoryRow` în randare**

Găsește blocul (în jur de linia 332):

```tsx
{breakdown.map((item, idx) => (
  <CategoryRow key={`${item.category_id ?? 'none'}-${idx}`} item={item} C={C} />
))}
```

Înlocuiește cu:

```tsx
{breakdown.map((item, idx) => {
  const key = item.category_id ?? UNCATEGORIZED_KEY;
  const expanded = expandedCatKey === key;
  return (
    <RNView key={`${key}-${idx}`}>
      <CategoryRow
        item={item}
        expanded={expanded}
        onPress={() => setExpandedCatKey(prev => (prev === key ? null : key))}
        C={C}
      />
    </RNView>
  );
})}
```

- [ ] **Step 7: Type check**

```bash
cd app && npm run type-check
```

Expected: 0 erori.

- [ ] **Step 8: Commit**

```bash
git add app/app/\(tabs\)/entitati/financiar/index.tsx
git commit -m "feat(financiar): make category rows expandable with chevron"
```

---

## Task 4: Render lista expandată sub categoria deschisă + ascunde "Tranzacții recente"

**Files:**
- Modify: `app/app/(tabs)/entitati/financiar/index.tsx`

- [ ] **Step 1: Importă hook-ul + tipuri**

În imports, adaugă lângă `UNCATEGORIZED_KEY`:

```typescript
import { useCategoryTransactions, UNCATEGORIZED_KEY } from '@/hooks/useCategoryTransactions';
```

(Înlocuiește linia adăugată la Task 3 Step 1.)

- [ ] **Step 2: Apelează hook-ul în `FinanciarHubScreen`**

În corpul componentei, după `const { analysis, loading, refresh } = useMonthlyAnalysis(...)` (în jurul liniei 59), adaugă:

```typescript
  const {
    transactions: expandedTxs,
    loading: expandedLoading,
    error: expandedError,
    refresh: refreshExpanded,
  } = useCategoryTransactions(yearMonth, expandedCatKey, accountFilter);
```

- [ ] **Step 3: Asigură-te că `useFocusEffect` re-fetchează și lista expandată**

Modifică `useFocusEffect` existent:

```typescript
  useFocusEffect(
    useCallback(() => {
      refreshAccounts();
      refresh();
    }, [])
  );
```

→ devine:

```typescript
  useFocusEffect(
    useCallback(() => {
      refreshAccounts();
      refresh();
      refreshExpanded();
    }, [refreshExpanded])
  );
```

- [ ] **Step 4: Randează lista expandată sub categorie**

Găsește blocul `breakdown.map(...)` din Task 3 Step 6 și extinde-l:

```tsx
{breakdown.map((item, idx) => {
  const key = item.category_id ?? UNCATEGORIZED_KEY;
  const expanded = expandedCatKey === key;
  return (
    <RNView key={`${key}-${idx}`}>
      <CategoryRow
        item={item}
        expanded={expanded}
        onPress={() => setExpandedCatKey(prev => (prev === key ? null : key))}
        C={C}
      />
      {expanded && (
        <CategoryTransactionsList
          loading={expandedLoading}
          error={expandedError}
          transactions={expandedTxs}
          categoryMap={categoryMap}
          C={C}
          onRetry={refreshExpanded}
        />
      )}
    </RNView>
  );
})}
```

- [ ] **Step 5: Definește componenta `CategoryTransactionsList`**

Imediat înainte de `function CategoryRow(...)` (în partea de jos a fișierului), adaugă:

```typescript
function CategoryTransactionsList({
  loading,
  error,
  transactions,
  categoryMap,
  C,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  transactions: Transaction[];
  categoryMap: Map<string, { name: string; icon?: string }>;
  C: typeof Colors.light;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <RNView style={styles.expandedLoading}>
        <RNText style={{ color: C.textSecondary, fontSize: 12 }}>Se încarcă…</RNText>
      </RNView>
    );
  }
  if (error) {
    return (
      <RNView style={styles.expandedError}>
        <RNText style={{ color: statusColors.critical, fontSize: 12, marginBottom: 6 }}>
          Nu s-a putut încărca lista
        </RNText>
        <Pressable onPress={onRetry} hitSlop={8}>
          <RNText style={{ color: primary, fontSize: 12, fontWeight: '600' }}>Reîncearcă</RNText>
        </Pressable>
      </RNView>
    );
  }
  if (transactions.length === 0) {
    return (
      <RNView style={styles.expandedEmpty}>
        <RNText style={{ color: C.textSecondary, fontSize: 12 }}>
          Nicio tranzacție în această categorie.
        </RNText>
      </RNView>
    );
  }
  return (
    <RNView style={styles.expandedList}>
      {transactions.map(t => (
        <TransactionRow
          key={t.id}
          tx={t}
          categoryName={t.category_id ? categoryMap.get(t.category_id)?.name : undefined}
          C={C}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/entitati/cont/tranzactie',
              params: { id: t.id },
            })
          }
        />
      ))}
    </RNView>
  );
}
```

- [ ] **Step 6: Adaugă stilurile noi**

În `StyleSheet.create({ ... })` la finalul fișierului, adaugă:

```typescript
  expandedList: { paddingTop: 8, paddingBottom: 4, gap: 4 },
  expandedLoading: { paddingVertical: 12, alignItems: 'center' },
  expandedError: { paddingVertical: 12, alignItems: 'center' },
  expandedEmpty: { paddingVertical: 12, alignItems: 'center' },
```

- [ ] **Step 7: Ascunde "Tranzacții recente" când e o categorie expandată**

Găsește secțiunea (în jurul liniei 339):

```tsx
{/* Recent transactions */}
<RNView style={styles.txHeader}>
```

Și înfășoară TOT blocul „Recent transactions" (de la `{/* Recent transactions */}` până la sfârșitul `recent.map(...)` inclusiv `)}`) cu un guard:

```tsx
{expandedCatKey === null && (
  <>
    {/* Recent transactions */}
    <RNView style={styles.txHeader}>
      ...existing code...
    </RNView>
    ...existing code (recent.length === 0 block, recent.map block)...
  </>
)}
```

Asigură-te că pune închide corect cu `</>` și `)}` la finalul blocului ascuns.

- [ ] **Step 8: Type check + lint**

```bash
cd app && npm run type-check && npm run lint
```

Expected: 0 erori.

- [ ] **Step 9: Verificare manuală pe simulator (gate)**

```bash
cd app && npm start
```

Apoi pe simulator iOS:
1. Navighează la Gestiune financiară.
2. Alege o lună cu tranzacții (sau adaugă manual).
3. Verifică:
   - [ ] Fiecare bară din "Cheltuieli pe categorii" are chevron ▶ la dreapta.
   - [ ] Tap pe o bară → chevron devine ▼ și apar tranzacțiile sub bară.
   - [ ] Tap din nou → se închide.
   - [ ] Tap pe altă categorie → se închide cea anterioară, se deschide noua.
   - [ ] Cât timp e o categorie expandată, secțiunea "Tranzacții recente" (de jos) NU se vede.
   - [ ] La închiderea categoriei, "Tranzacții recente" reapare.
   - [ ] Tap pe o tranzacție din lista expandată → deschide ecranul existent de edit.
   - [ ] Înapoi din edit → ecranul reîncarcă (totaluri, breakdown, lista expandată).
   - [ ] Schimbă luna → categoria expandată se închide automat.
   - [ ] Schimbă filtrul de cont → categoria expandată se închide automat.
   - [ ] Test pe dark mode + light mode (Setări → Aspect).

- [ ] **Step 10: Commit**

```bash
git add app/app/\(tabs\)/entitati/financiar/index.tsx
git commit -m "feat(financiar): expand transactions list under selected category"
```

---

## Task 5: `CategoryQuickPickerModal` (bottom-sheet pentru recategorizare rapidă)

**Files:**
- Modify: `app/app/(tabs)/entitati/financiar/index.tsx`

- [ ] **Step 1: Importă `Modal` din react-native**

În imports din top, modifică:

```typescript
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  View as RNView,
  Text as RNText,
} from 'react-native';
```

→ devine:

```typescript
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  View as RNView,
  Text as RNText,
  Modal,
} from 'react-native';
```

- [ ] **Step 2: Importă `ExpenseCategory`**

În imports din top:

```typescript
import type { Transaction } from '@/types';
```

→ devine:

```typescript
import type { Transaction, ExpenseCategory } from '@/types';
```

- [ ] **Step 3: Definește componenta picker**

În partea de jos a fișierului, după `CategoryTransactionsList` (înainte de `CategoryRow`), adaugă:

```typescript
function CategoryQuickPickerModal({
  visible,
  categories,
  currentCategoryId,
  onPick,
  onClose,
  C,
}: {
  visible: boolean;
  categories: ExpenseCategory[];
  currentCategoryId: string | null;
  onPick: (categoryId: string | null) => void;
  onClose: () => void;
  C: typeof Colors.light;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.pickerSheet, { backgroundColor: C.card }]}
          onPress={() => {}}
        >
          <RNView style={styles.pickerHeader}>
            <RNText style={[styles.pickerTitle, { color: C.text }]}>
              Schimbă categoria
            </RNText>
            <Pressable onPress={onClose} hitSlop={8}>
              <RNText style={{ color: primary, fontSize: 14, fontWeight: '600' }}>
                Anulează
              </RNText>
            </Pressable>
          </RNView>
          <ScrollView style={{ maxHeight: 420 }}>
            {categories.map(cat => {
              const isCurrent = cat.id === currentCategoryId;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => onPick(cat.id)}
                  style={({ pressed }) => [
                    styles.pickerItem,
                    { borderBottomColor: C.border },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <RNView
                    style={[
                      styles.pickerDot,
                      { backgroundColor: cat.color || primary },
                    ]}
                  />
                  <RNText style={[styles.pickerItemText, { color: C.text }]}>
                    {cat.name}
                  </RNText>
                  {isCurrent && (
                    <Ionicons name="checkmark" size={18} color={primary} />
                  )}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => onPick(null)}
              style={({ pressed }) => [
                styles.pickerItem,
                { borderBottomColor: C.border, borderTopWidth: 1, borderTopColor: C.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <RNView style={[styles.pickerDot, { backgroundColor: C.textSecondary }]} />
              <RNText style={[styles.pickerItemText, { color: C.text }]}>
                Necategorizat
              </RNText>
              {currentCategoryId === null && (
                <Ionicons name="checkmark" size={18} color={primary} />
              )}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

- [ ] **Step 4: Adaugă stilurile picker-ului**

În `StyleSheet.create({ ... })`:

```typescript
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 24,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700' },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerDot: { width: 12, height: 12, borderRadius: 6 },
  pickerItemText: { flex: 1, fontSize: 14, fontWeight: '500' },
```

- [ ] **Step 5: Type check**

```bash
cd app && npm run type-check
```

Expected: 0 erori. (Componenta nu e încă folosită — Task 6 o conectează.)

- [ ] **Step 6: Commit**

```bash
git add app/app/\(tabs\)/entitati/financiar/index.tsx
git commit -m "feat(financiar): add CategoryQuickPickerModal component"
```

---

## Task 6: Tap pe pastila categorie din rândul expandat → deschide picker → updateTransaction

**Files:**
- Modify: `app/app/(tabs)/entitati/financiar/index.tsx`

- [ ] **Step 1: Importă `updateTransaction`**

În imports:

```typescript
import { formatYearMonth } from '@/services/transactions';
```

→ devine:

```typescript
import { formatYearMonth, updateTransaction } from '@/services/transactions';
```

- [ ] **Step 2: Adaugă state pentru picker**

În `FinanciarHubScreen`, după `useState` pentru `expandedCatKey`:

```typescript
  const [pickerTxId, setPickerTxId] = useState<string | null>(null);
  const [pickerSaving, setPickerSaving] = useState(false);
```

- [ ] **Step 3: Definește handler-ul de schimbare categorie**

În `FinanciarHubScreen`, înainte de `return`:

```typescript
  const handleCategoryPick = useCallback(
    async (newCategoryId: string | null) => {
      if (!pickerTxId) return;
      setPickerSaving(true);
      try {
        await updateTransaction(pickerTxId, { category_id: newCategoryId });
        setPickerTxId(null);
        await Promise.all([refresh(), refreshExpanded()]);
      } catch (e) {
        Alert.alert(
          'Nu s-a putut schimba categoria',
          e instanceof Error ? e.message : 'Eroare necunoscută'
        );
      } finally {
        setPickerSaving(false);
      }
    },
    [pickerTxId, refresh, refreshExpanded]
  );
```

Asigură-te că `useCallback` e importat din `react`.

- [ ] **Step 4: Detectează auto-collapse după mutare (categoria devine goală)**

În `FinanciarHubScreen`, după blocul de `useFocusEffect`, adaugă:

```typescript
  useEffect(() => {
    if (expandedCatKey === null) return;
    const stillExists = breakdown.some(
      b => (b.category_id ?? UNCATEGORIZED_KEY) === expandedCatKey
    );
    if (!stillExists && !loading) {
      setExpandedCatKey(null);
    }
  }, [breakdown, expandedCatKey, loading]);
```

- [ ] **Step 5: Înlocuiește `TransactionRow` în lista expandată cu o variantă cu pastilă pressabilă**

În `CategoryTransactionsList`, schimbă blocul `transactions.map(...)`:

```tsx
{transactions.map(t => (
  <TransactionRow
    key={t.id}
    tx={t}
    categoryName={t.category_id ? categoryMap.get(t.category_id)?.name : undefined}
    C={C}
    onPress={() =>
      router.push({
        pathname: '/(tabs)/entitati/cont/tranzactie',
        params: { id: t.id },
      })
    }
  />
))}
```

→ devine:

```tsx
{transactions.map(t => (
  <ExpandedTransactionRow
    key={t.id}
    tx={t}
    categoryName={
      (t.category_id && categoryMap.get(t.category_id)?.name) || 'Necategorizat'
    }
    C={C}
    onPress={() =>
      router.push({
        pathname: '/(tabs)/entitati/cont/tranzactie',
        params: { id: t.id },
      })
    }
    onCategoryPress={() => onCategoryEdit(t.id)}
  />
))}
```

Și extinde props-urile lui `CategoryTransactionsList`:

```typescript
function CategoryTransactionsList({
  loading,
  error,
  transactions,
  categoryMap,
  C,
  onRetry,
  onCategoryEdit,
}: {
  loading: boolean;
  error: string | null;
  transactions: Transaction[];
  categoryMap: Map<string, { name: string; icon?: string }>;
  C: typeof Colors.light;
  onRetry: () => void;
  onCategoryEdit: (txId: string) => void;
}) {
```

- [ ] **Step 6: Definește `ExpandedTransactionRow`**

În partea de jos a fișierului, după `TransactionRow`:

```typescript
function ExpandedTransactionRow({
  tx,
  categoryName,
  C,
  onPress,
  onCategoryPress,
}: {
  tx: Transaction;
  categoryName: string;
  C: typeof Colors.light;
  onPress: () => void;
  onCategoryPress: () => void;
}) {
  const isPositive = tx.amount >= 0;
  const color = tx.is_internal_transfer
    ? C.textSecondary
    : isPositive
      ? statusColors.ok
      : statusColors.critical;
  const sign = isPositive ? '+' : '';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.txRow,
        { backgroundColor: C.card, shadowColor: C.cardShadow },
        pressed && { opacity: 0.9 },
      ]}
    >
      <RNView style={{ flex: 1 }}>
        <RNText style={[styles.txTitle, { color: C.text }]} numberOfLines={1}>
          {tx.merchant ||
            tx.description ||
            (tx.is_internal_transfer ? 'Transfer intern' : 'Tranzacție')}
        </RNText>
        <RNView style={styles.txExpandedSubRow}>
          <RNText style={[styles.txSub, { color: C.textSecondary }]}>{tx.date}</RNText>
          <Pressable
            onPress={onCategoryPress}
            hitSlop={6}
            style={({ pressed }) => [
              styles.txCategoryPill,
              { backgroundColor: `${primary}22`, borderColor: `${primary}55` },
              pressed && { opacity: 0.7 },
            ]}
          >
            <RNText style={[styles.txCategoryPillText, { color: primary }]} numberOfLines={1}>
              {categoryName}
            </RNText>
          </Pressable>
        </RNView>
      </RNView>
      <RNText style={[styles.txAmount, { color }]}>
        {sign}
        {tx.amount.toFixed(2)} {tx.currency}
      </RNText>
    </Pressable>
  );
}
```

- [ ] **Step 7: Adaugă stilurile pentru pastilă**

În `StyleSheet.create({ ... })`:

```typescript
  txExpandedSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  txCategoryPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 180,
  },
  txCategoryPillText: { fontSize: 11, fontWeight: '600' },
```

- [ ] **Step 8: Conectează picker-ul în randare**

Pasează `onCategoryEdit` la `CategoryTransactionsList`:

```tsx
{expanded && (
  <CategoryTransactionsList
    loading={expandedLoading}
    error={expandedError}
    transactions={expandedTxs}
    categoryMap={categoryMap}
    C={C}
    onRetry={refreshExpanded}
    onCategoryEdit={txId => setPickerTxId(txId)}
  />
)}
```

Apoi randează modalul în jurul liniei finale a `return`-ului din `FinanciarHubScreen`, **imediat înainte de `</RNView>` final**:

```tsx
      <CategoryQuickPickerModal
        visible={pickerTxId !== null}
        categories={categories}
        currentCategoryId={
          pickerTxId
            ? (expandedTxs.find(t => t.id === pickerTxId)?.category_id ?? null)
            : null
        }
        onPick={handleCategoryPick}
        onClose={() => !pickerSaving && setPickerTxId(null)}
        C={C}
      />
    </RNView>
  );
}
```

- [ ] **Step 9: Type check + lint**

```bash
cd app && npm run type-check && npm run lint
```

Expected: 0 erori.

- [ ] **Step 10: Verificare manuală pe simulator**

```bash
cd app && npm start
```

Pe simulator:
- [ ] Expand o categorie cu tranzacții.
- [ ] Pe un rând, vezi pastila cu numele categoriei (sau "Necategorizat" pentru tranzacțiile fără categorie).
- [ ] Tap pe pastilă → se deschide bottom-sheet cu lista de categorii + "Necategorizat" jos.
- [ ] Categoria curentă are bifă ✓ în dreapta.
- [ ] Tap pe altă categorie → modalul se închide, lista expandată se reîncarcă, bara categoriei vechi scade (transaction_count -= 1) iar bara categoriei noi crește.
- [ ] Dacă mut ultima tranzacție din categoria expandată → categoria expandată dispare din breakdown și `expandedCatKey` se resetează la `null` (UI revine la "Tranzacții recente").
- [ ] Tap pe pastila "Necategorizat" în picker → tranzacția devine fără categorie.
- [ ] Tap pe corpul rândului (nu pastilă) → deschide editorul existent (verifică că pastila nu ascunde tap-ul restului).
- [ ] Tap pe backdrop → închide modalul fără a salva.
- [ ] Tap pe "Anulează" → identic.
- [ ] Test pe dark mode.

- [ ] **Step 11: Commit**

```bash
git add app/app/\(tabs\)/entitati/financiar/index.tsx
git commit -m "feat(financiar): quick category picker on transaction pill"
```

---

## Task 7: Verificare finală + lessons

**Files:**
- (No code changes; verification only)

- [ ] **Step 1: Rulează testele complete**

```bash
cd app && npm test
```

Expected: toate pass (inclusiv noile teste din Task 1 și Task 2).

- [ ] **Step 2: Type check + lint final**

```bash
cd app && npm run type-check && npm run lint
```

Expected: 0 erori, 0 warnings.

- [ ] **Step 3: Test scenarii reale end-to-end pe simulator**

```bash
cd app && npm start
```

Scenarii:
- [ ] **Scenariul "Necategorizat după import"**: importează un extras (sau creează manual 5 tranzacții fără categorie) → deschide Gestiune financiară → expand "Necategorizat" → tap pe pastilă → mut fiecare la o categorie diferită → confirmă că la final categoria "Necategorizat" dispare din breakdown.
- [ ] **Scenariul "Schimbare lună cu categorie expandată"**: expand "Mâncare" → schimbă luna → confirmă că se închide automat categoria și apare "Tranzacții recente".
- [ ] **Scenariul "Schimbare cont cu categorie expandată"**: expand o categorie → tap pe alt chip cont → confirmă auto-collapse.
- [ ] **Scenariul "Eroare la update"**: opțional, testează doar dacă ai cum să forțezi o eroare. Verifică Alert-ul în română.
- [ ] **Theme**: rulează scenariile pe Light și Dark.

- [ ] **Step 4: (opțional) Notează lecție în lessons**

Dacă ai întâlnit o problemă non-trivială (de ex. comportament neașteptat la `Modal` slide-up pe iOS, performance issue la categorii cu 100+ tranzacții), adaugă o intrare scurtă în `app/.claude/lessons.md`:

```markdown
## YYYY-MM-DD — [Titlu scurt]
**Ce s-a întâmplat:** ...
**Cauză:** ...
**Regulă:** ...
```

- [ ] **Step 5: Final commit (dacă au mai apărut fix-uri în testare)**

```bash
git status
# dacă sunt modificări:
git add -A
git commit -m "fix(financiar): adjustments after manual QA"
```

---

## Out of scope (Faza 2)

- Multi-select bulk (long-press pe rând → selecție multiplă → "Mută în categoria…").
- Paginare în lista expandată.
- Drag-and-drop între categorii.
- Editare inline a sumei/datei direct din lista expandată.
- Filtrare/sortare în interiorul listei expandate.
