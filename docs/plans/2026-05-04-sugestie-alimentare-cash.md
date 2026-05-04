# Plan implementare — sugestie alimentare cont cash

> **Pentru worker agentic:** Sub-skill recomandat: `superpowers:executing-plans` (inline) sau `superpowers:subagent-driven-development`. Pașii folosesc checkbox (`- [ ]`).

**Goal:** Detectează retragerile ATM (regex pe descriere/merchant) și sugerează utilizatorului să le convertească în transferuri interne către contul Cash. Trei surface-uri UX (post-import, formular tranzacție, banner Sumar) folosesc același modul.

**Architecture:** Modul nou pur `services/cashSuggestion.ts` cu detecție, listare pending, conversie atomică, dismiss. Un câmp boolean nou `cash_suggestion_dismissed` pe `transactions` cu index parțial. Conversia reutilizează mecanismul existent `is_internal_transfer` + `linked_transaction_id`. UI-urile cheamă același modul.

**Tech Stack:** TypeScript strict, expo-sqlite, React Native, Expo Router v3, Jest.

**Spec:** `docs/specs/2026-05-04-sugestie-alimentare-cash-design.md`

---

## File Structure (după implementare)

```
services/
├── cashSuggestion.ts                 ← NOU (logică pură + DB)
└── db.ts                             ← schemă + index nou

types/
└── index.ts                          ← câmp nou pe Transaction

app/
├── (tabs)/index.tsx                  ← Sumar: include CashSuggestionBanner
├── tranzactii/add.tsx                ← checkbox inline
├── tranzactii/[id].tsx               ← checkbox inline (edit + add)
├── conturi/import.tsx                ← hook post-import
└── sugestie-cash/
    ├── _layout.tsx                   ← NOU
    └── batch.tsx                     ← NOU (ecran batch)

components/
└── CashSuggestionBanner.tsx         ← NOU

__tests__/unit/
├── cashSuggestion.test.ts           ← NOU (detectie + list + count + convert + dismiss)
└── cashSuggestionFlow.test.ts       ← NOU (integrare)
```

---

## Task 1: Schemă DB + tip Transaction

**Files:**

- Modify: `services/db.ts:45-63` (CREATE TABLE transactions), `:100-111` (indexuri)
- Modify: `types/index.ts:89-107` (interface Transaction)
- Modify: `services/transactions.ts:6-46` (Row + mapRow)

DB-ul nu folosește migrații numerotate; folosim pattern-ul try/catch existent (vezi seed-ul de la linia 114): `CREATE TABLE IF NOT EXISTS` pentru DB-uri noi + `ALTER TABLE` într-un try/catch separat pentru DB-uri existente.

- [ ] **Step 1: Adaugă coloana în CREATE TABLE (DB-uri noi)**

În `services/db.ts`, modifică blocul CREATE TABLE transactions ca să includă noul câmp înainte de `created_at`:

```ts
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RON',
    amount_ron REAL,
    description TEXT,
    merchant TEXT,
    category_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    statement_id TEXT,
    is_internal_transfer INTEGER NOT NULL DEFAULT 0,
    linked_transaction_id TEXT,
    is_refund INTEGER NOT NULL DEFAULT 0,
    duplicate_of_id TEXT,
    notes TEXT,
    cash_suggestion_dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
```

- [ ] **Step 2: Adaugă indexul parțial**

Adaugă în lista de indexuri (după `idx_tx_transfer`):

```ts
  CREATE INDEX IF NOT EXISTS idx_tx_cash_pending
    ON transactions(date DESC)
    WHERE is_internal_transfer = 0
      AND cash_suggestion_dismissed = 0
      AND amount < 0;
```

- [ ] **Step 3: Adaugă bloc ALTER pentru DB-uri existente**

După blocul de seed (după `} catch { /* seed deja aplicat */ }` la linia ~136), adaugă:

```ts
try {
  db.execSync(
    `ALTER TABLE transactions ADD COLUMN cash_suggestion_dismissed INTEGER NOT NULL DEFAULT 0`
  );
} catch {
  // coloana există deja
}
```

- [ ] **Step 4: Adaugă câmpul în `Transaction`**

În `types/index.ts`, adaugă în `interface Transaction` (după `duplicate_of_id?`):

```ts
  duplicate_of_id?: string;
  cash_suggestion_dismissed: boolean;
  notes?: string;
```

- [ ] **Step 5: Adaugă câmpul în Row + mapRow**

În `services/transactions.ts`, adaugă în `type Row` (după `duplicate_of_id`):

```ts
duplicate_of_id: string | null;
cash_suggestion_dismissed: number;
notes: string | null;
```

În `mapRow`, adaugă (după `duplicate_of_id`):

```ts
    duplicate_of_id: r.duplicate_of_id ?? undefined,
    cash_suggestion_dismissed: r.cash_suggestion_dismissed === 1,
    notes: r.notes ?? undefined,
```

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: PASS (zero erori).

- [ ] **Step 7: Commit**

```bash
git add services/db.ts types/index.ts services/transactions.ts
git commit -m "feat(db): câmp cash_suggestion_dismissed + index parțial pe transactions"
```

---

## Task 2: `detectCashWithdrawal` (funcție pură)

**Files:**

- Create: `services/cashSuggestion.ts`
- Test: `__tests__/unit/cashSuggestion.test.ts`

- [ ] **Step 1: Scrie testul (failing)**

Creează `__tests__/unit/cashSuggestion.test.ts`:

```ts
import { detectCashWithdrawal } from '@/services/cashSuggestion';

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

describe('detectCashWithdrawal', () => {
  it.each([
    ['RETRAGERE NUMERAR ATM BCR BUCURESTI', null],
    ['retragere atm', null],
    ['bancomat OTP', null],
    ['atm transilvania', null],
    [null, 'ATM Revolut'],
    ['cash withdrawal', null],
    ['extragere numerar', null],
    ['Extrăgere Numerar', null], // diacritice normalizate
  ])('detectează match pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectCashWithdrawal(tx)).toBe(true);
  });

  it.each([
    ['atmosferă restaurant', null],
    ['caratm SRL', null],
    ['cumpărare card MEGA IMAGE', null],
    [null, null], // gol
    ['', ''],
  ])('NU match pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });

  it('returnează false pentru tranzacții pozitive', () => {
    const tx = makeTx({ amount: 500, description: 'RETRAGERE ATM' });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });

  it('returnează false pentru transferuri interne (deja convertite)', () => {
    const tx = makeTx({ is_internal_transfer: true, description: 'ATM BCR' });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });
});
```

- [ ] **Step 2: Rulează testul (verifică că eșuează)**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: FAIL cu „Cannot find module '@/services/cashSuggestion'".

- [ ] **Step 3: Scrie implementarea minimă**

Creează `services/cashSuggestion.ts`:

```ts
import type { Transaction } from '@/types';

const CASH_WITHDRAWAL_REGEX = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function detectCashWithdrawal(tx: Transaction): boolean {
  if (tx.amount >= 0) return false;
  if (tx.is_internal_transfer) return false;
  const haystack = normalize(`${tx.description ?? ''} ${tx.merchant ?? ''}`);
  return CASH_WITHDRAWAL_REGEX.test(haystack);
}
```

- [ ] **Step 4: Rulează testul (verifică că trece)**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: PASS, toate cele 14 cazuri verzi.

- [ ] **Step 5: Commit**

```bash
git add services/cashSuggestion.ts __tests__/unit/cashSuggestion.test.ts
git commit -m "feat(cash-suggestion): detectCashWithdrawal cu regex și normalizare diacritice"
```

---

## Task 3: `listPendingCashSuggestions` + `countPendingCashSuggestions`

**Files:**

- Modify: `services/cashSuggestion.ts`
- Modify: `__tests__/unit/cashSuggestion.test.ts`

Query SQL fără `LIMIT` (indexul parțial face scanarea ieftină); regex filtrează în memorie; apoi `slice(0, limit)`. Asta evită omiterea retragerilor mai vechi când există multe debituri non-retragere recente.

- [ ] **Step 1: Adaugă teste**

Adaugă în `__tests__/unit/cashSuggestion.test.ts`, ÎNAINTE de descrierile existente:

```ts
import { db, generateId } from '@/services/db';
import { createTransaction } from '@/services/transactions';
import {
  countPendingCashSuggestions,
  detectCashWithdrawal,
  listPendingCashSuggestions,
} from '@/services/cashSuggestion';

beforeEach(async () => {
  await db.runAsync('DELETE FROM transactions');
});

describe('listPendingCashSuggestions / countPendingCashSuggestions', () => {
  async function seed(over: Partial<Parameters<typeof createTransaction>[0]>) {
    return createTransaction({
      account_id: 'acc-bank',
      date: '2026-05-01',
      amount: -500,
      currency: 'RON',
      description: 'RETRAGERE ATM BCR',
      source: 'manual',
      ...over,
    });
  }

  it('returnează retragerile candidate sortate date DESC', async () => {
    await seed({ date: '2026-04-10', description: 'ATM BCR' });
    await seed({ date: '2026-05-02', description: 'bancomat OTP' });
    await seed({ date: '2026-04-20', description: 'cumpărare card' }); // nu e retragere

    const pending = await listPendingCashSuggestions();
    expect(pending.map(p => p.date)).toEqual(['2026-05-02', '2026-04-10']);
  });

  it('exclude tranzacții pozitive', async () => {
    await seed({ amount: 500, description: 'RETRAGERE' });
    expect(await listPendingCashSuggestions()).toEqual([]);
  });

  it('exclude transferuri interne (is_internal_transfer = 1)', async () => {
    const tx = await seed({});
    await db.runAsync('UPDATE transactions SET is_internal_transfer = 1 WHERE id = ?', [tx.id]);
    expect(await listPendingCashSuggestions()).toEqual([]);
  });

  it('exclude tranzacții dismissed', async () => {
    const tx = await seed({});
    await db.runAsync('UPDATE transactions SET cash_suggestion_dismissed = 1 WHERE id = ?', [
      tx.id,
    ]);
    expect(await listPendingCashSuggestions()).toEqual([]);
  });

  it('exclude duplicate', async () => {
    const orig = await seed({});
    const dup = await seed({});
    await db.runAsync('UPDATE transactions SET duplicate_of_id = ? WHERE id = ?', [
      orig.id,
      dup.id,
    ]);
    const pending = await listPendingCashSuggestions();
    expect(pending.map(p => p.id)).toEqual([orig.id]);
  });

  it('exclude tranzacții mai vechi de 365 zile', async () => {
    await seed({ date: '2024-01-01', description: 'ATM vechi' });
    await seed({ date: '2026-05-02', description: 'ATM nou' });
    const pending = await listPendingCashSuggestions();
    expect(pending.map(p => p.description)).toEqual(['ATM nou']);
  });

  it('respectă limitul (default 10)', async () => {
    for (let i = 0; i < 15; i += 1) {
      await seed({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, description: `ATM ${i}` });
    }
    const pending = await listPendingCashSuggestions();
    expect(pending).toHaveLength(10);
  });

  it('respectă limitul custom', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seed({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, description: `ATM ${i}` });
    }
    const pending = await listPendingCashSuggestions({ limit: 3 });
    expect(pending).toHaveLength(3);
  });

  it('countPendingCashSuggestions întoarce count complet (nu plafonat)', async () => {
    for (let i = 0; i < 15; i += 1) {
      await seed({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, description: `ATM ${i}` });
    }
    expect(await countPendingCashSuggestions()).toBe(15);
  });
});
```

- [ ] **Step 2: Rulează testele (eșuează)**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: FAIL — funcțiile nu există.

- [ ] **Step 3: Implementează listPendingCashSuggestions și countPendingCashSuggestions**

În `services/cashSuggestion.ts`, adaugă la sfârșit:

```ts
import { db } from './db';

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

async function fetchCandidates(sinceDays: number): Promise<Transaction[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM transactions
       WHERE amount < 0
         AND is_internal_transfer = 0
         AND cash_suggestion_dismissed = 0
         AND duplicate_of_id IS NULL
         AND date >= date('now', ?)
       ORDER BY date DESC, created_at DESC`,
    [`-${sinceDays} days`]
  );
  return rows.map(rowToTx).filter(detectCashWithdrawal);
}

export async function listPendingCashSuggestions(opts: ListOptions = {}): Promise<Transaction[]> {
  const limit = opts.limit ?? 10;
  const sinceDays = opts.sinceDays ?? 365;
  const candidates = await fetchCandidates(sinceDays);
  return candidates.slice(0, limit);
}

export async function countPendingCashSuggestions(opts: ListOptions = {}): Promise<number> {
  const sinceDays = opts.sinceDays ?? 365;
  const candidates = await fetchCandidates(sinceDays);
  return candidates.length;
}
```

- [ ] **Step 4: Rulează testele (verifică)**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: toate cele 8 cazuri noi PASS, plus cele 14 vechi.

- [ ] **Step 5: Commit**

```bash
git add services/cashSuggestion.ts __tests__/unit/cashSuggestion.test.ts
git commit -m "feat(cash-suggestion): list și count retrageri pending în ultimul an"
```

---

## Task 4: `dismissCashSuggestion`

**Files:**

- Modify: `services/cashSuggestion.ts`
- Modify: `__tests__/unit/cashSuggestion.test.ts`

- [ ] **Step 1: Adaugă teste**

Adaugă în `__tests__/unit/cashSuggestion.test.ts`:

```ts
import { dismissCashSuggestion } from '@/services/cashSuggestion';

describe('dismissCashSuggestion', () => {
  it('marchează tranzacția ca dismissed și o exclude din listă', async () => {
    const tx = await createTransaction({
      account_id: 'acc-bank',
      date: '2026-05-01',
      amount: -500,
      description: 'ATM BCR',
      source: 'manual',
    });

    await dismissCashSuggestion(tx.id);

    const pending = await listPendingCashSuggestions();
    expect(pending).toEqual([]);
  });

  it('e idempotent (a doua oară nu strică)', async () => {
    const tx = await createTransaction({
      account_id: 'acc-bank',
      date: '2026-05-01',
      amount: -500,
      description: 'ATM BCR',
      source: 'manual',
    });

    await dismissCashSuggestion(tx.id);
    await dismissCashSuggestion(tx.id);

    expect(await countPendingCashSuggestions()).toBe(0);
  });
});
```

- [ ] **Step 2: Rulează testele (eșuează)**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: FAIL — funcția nu există.

- [ ] **Step 3: Implementează**

Adaugă în `services/cashSuggestion.ts`:

```ts
export async function dismissCashSuggestion(txId: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET cash_suggestion_dismissed = 1 WHERE id = ?', [txId]);
}
```

- [ ] **Step 4: Rulează testele**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: PASS toate.

- [ ] **Step 5: Commit**

```bash
git add services/cashSuggestion.ts __tests__/unit/cashSuggestion.test.ts
git commit -m "feat(cash-suggestion): dismissCashSuggestion (idempotent)"
```

---

## Task 5: `convertToTransfer`

**Files:**

- Modify: `services/cashSuggestion.ts`
- Modify: `__tests__/unit/cashSuggestion.test.ts`

Atomic: validează → update sursă (`is_internal_transfer = 1`, `category_id = 'cat-sys-transfer'`, `cash_suggestion_dismissed = 1`) → insert pereche pe contul cash → update `linked_transaction_id` reciproc.

- [ ] **Step 1: Adaugă teste**

Adaugă în `__tests__/unit/cashSuggestion.test.ts`:

```ts
import { convertToTransfer } from '@/services/cashSuggestion';
import { createFinancialAccount } from '@/services/financialAccounts';
import { getTransaction } from '@/services/transactions';

describe('convertToTransfer', () => {
  beforeEach(async () => {
    await db.runAsync('DELETE FROM financial_accounts');
  });

  it('happy path: convertește sursa și creează jumătatea-cash legate reciproc', async () => {
    const bank = await createFinancialAccount({
      name: 'BCR Curent',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const wallet = await createFinancialAccount({
      name: 'Portofel',
      type: 'cash',
      currency: 'RON',
      initial_balance: 0,
    });
    const source = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: -500,
      description: 'RETRAGERE ATM BCR',
      source: 'statement',
    });

    await convertToTransfer(source.id, wallet.id);

    const updated = await getTransaction(source.id);
    expect(updated?.is_internal_transfer).toBe(true);
    expect(updated?.category_id).toBe('cat-sys-transfer');
    expect(updated?.cash_suggestion_dismissed).toBe(true);
    expect(updated?.linked_transaction_id).toBeDefined();

    const pair = await getTransaction(updated!.linked_transaction_id!);
    expect(pair?.account_id).toBe(wallet.id);
    expect(pair?.amount).toBe(500);
    expect(pair?.currency).toBe('RON');
    expect(pair?.is_internal_transfer).toBe(true);
    expect(pair?.category_id).toBe('cat-sys-transfer');
    expect(pair?.linked_transaction_id).toBe(source.id);
    expect(pair?.date).toBe('2026-05-01');
  });

  it('throw dacă sursa e deja transfer', async () => {
    const bank = await createFinancialAccount({
      name: 'BCR',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const wallet = await createFinancialAccount({
      name: 'Portofel',
      type: 'cash',
      currency: 'RON',
      initial_balance: 0,
    });
    const source = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: -500,
      description: 'ATM',
      is_internal_transfer: true,
      source: 'manual',
    });

    await expect(convertToTransfer(source.id, wallet.id)).rejects.toThrow(/deja transfer/);
  });

  it('throw dacă target nu e cont cash', async () => {
    const bank = await createFinancialAccount({
      name: 'BCR',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const otherBank = await createFinancialAccount({
      name: 'ING',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const source = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: -500,
      description: 'ATM',
      source: 'manual',
    });

    await expect(convertToTransfer(source.id, otherBank.id)).rejects.toThrow(/cont cash/);
  });

  it('throw dacă valutele nu se potrivesc', async () => {
    const bank = await createFinancialAccount({
      name: 'Revolut',
      type: 'bank',
      currency: 'EUR',
      initial_balance: 0,
    });
    const wallet = await createFinancialAccount({
      name: 'Portofel RON',
      type: 'cash',
      currency: 'RON',
      initial_balance: 0,
    });
    const source = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: -100,
      currency: 'EUR',
      description: 'ATM Revolut',
      source: 'manual',
    });

    await expect(convertToTransfer(source.id, wallet.id)).rejects.toThrow(/valut[ăa]/i);
  });

  it('throw dacă target nu există', async () => {
    const bank = await createFinancialAccount({
      name: 'BCR',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const source = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: -500,
      description: 'ATM',
      source: 'manual',
    });

    await expect(convertToTransfer(source.id, 'cont-inexistent')).rejects.toThrow();
  });

  it('throw dacă sursa nu există', async () => {
    const wallet = await createFinancialAccount({
      name: 'Portofel',
      type: 'cash',
      currency: 'RON',
      initial_balance: 0,
    });
    await expect(convertToTransfer('tx-inexistent', wallet.id)).rejects.toThrow();
  });

  it('throw dacă sursa e venit (amount > 0)', async () => {
    const bank = await createFinancialAccount({
      name: 'BCR',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const wallet = await createFinancialAccount({
      name: 'Portofel',
      type: 'cash',
      currency: 'RON',
      initial_balance: 0,
    });
    const source = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: 500,
      description: 'incasare',
      source: 'manual',
    });
    await expect(convertToTransfer(source.id, wallet.id)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rulează testele (eșuează)**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: FAIL.

- [ ] **Step 3: Implementează**

Adaugă în `services/cashSuggestion.ts`:

```ts
import { generateId } from './db';
import { getRateRon } from './fxRates';

import type { FinancialAccount } from '@/types';

const TRANSFER_CATEGORY_ID = 'cat-sys-transfer';

export async function convertToTransfer(
  sourceTxId: string,
  targetCashAccountId: string
): Promise<void> {
  const sourceRow = await db.getFirstAsync<Row>('SELECT * FROM transactions WHERE id = ?', [
    sourceTxId,
  ]);
  if (!sourceRow) throw new Error('Tranzacția sursă nu există.');
  const source = rowToTx(sourceRow);
  if (source.amount >= 0) {
    throw new Error('Doar tranzacțiile negative (debituri) pot fi convertite în retragere cash.');
  }
  if (source.is_internal_transfer) {
    throw new Error('Tranzacția este deja transfer intern.');
  }

  const target = await db.getFirstAsync<{
    id: string;
    type: string;
    currency: string;
  }>('SELECT id, type, currency FROM financial_accounts WHERE id = ?', [targetCashAccountId]);
  if (!target) throw new Error('Contul cash destinație nu există.');
  if (target.type !== 'cash') throw new Error('Contul destinație nu e de tip cont cash.');
  if (target.currency !== source.currency) {
    throw new Error(
      `Valuta nu se potrivește: sursa e ${source.currency}, contul cash e ${target.currency}.`
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
        targetCashAccountId,
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

- [ ] **Step 4: Rulează testele**

Run: `npm test -- --testPathPattern=cashSuggestion`
Expected: PASS toate (cele 7 noi + cele dinainte).

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/cashSuggestion.ts __tests__/unit/cashSuggestion.test.ts
git commit -m "feat(cash-suggestion): convertToTransfer atomic cu validări complete"
```

---

## Task 6: Test integrare flow complet

**Files:**

- Create: `__tests__/unit/cashSuggestionFlow.test.ts`

Acoperă fluxul end-to-end peste cele 4 funcții publice (fără UI): seed → list → convert → dismiss → re-list.

- [ ] **Step 1: Scrie testul**

Creează `__tests__/unit/cashSuggestionFlow.test.ts`:

```ts
import {
  convertToTransfer,
  countPendingCashSuggestions,
  dismissCashSuggestion,
  listPendingCashSuggestions,
} from '@/services/cashSuggestion';
import { db } from '@/services/db';
import { createFinancialAccount } from '@/services/financialAccounts';
import { createTransaction } from '@/services/transactions';

beforeEach(async () => {
  await db.runAsync('DELETE FROM transactions');
  await db.runAsync('DELETE FROM financial_accounts');
});

describe('cash suggestion flow', () => {
  it('convertirea în lot a 3 retrageri produce 6 tranzacții (3 perechi)', async () => {
    const bank = await createFinancialAccount({
      name: 'BCR',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const wallet = await createFinancialAccount({
      name: 'Portofel',
      type: 'cash',
      currency: 'RON',
      initial_balance: 0,
    });

    for (let i = 1; i <= 3; i += 1) {
      await createTransaction({
        account_id: bank.id,
        date: `2026-05-0${i}`,
        amount: -100 * i,
        description: `RETRAGERE ATM ${i}`,
        source: 'statement',
      });
    }

    const pending = await listPendingCashSuggestions();
    expect(pending).toHaveLength(3);

    for (const tx of pending) {
      await convertToTransfer(tx.id, wallet.id);
    }

    const all = await db.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions'
    );
    expect(all[0].count).toBe(6);

    expect(await countPendingCashSuggestions()).toBe(0);
  });

  it('dismiss → reimport același statement → retragerea rămâne dismiss-uită', async () => {
    const bank = await createFinancialAccount({
      name: 'BCR',
      type: 'bank',
      currency: 'RON',
      initial_balance: 0,
    });
    const tx = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: -500,
      description: 'RETRAGERE ATM',
      source: 'statement',
    });

    await dismissCashSuggestion(tx.id);

    // simulează reimport: o tranzacție duplicat marcată ca atare
    const dup = await createTransaction({
      account_id: bank.id,
      date: '2026-05-01',
      amount: -500,
      description: 'RETRAGERE ATM',
      source: 'statement',
    });
    await db.runAsync('UPDATE transactions SET duplicate_of_id = ? WHERE id = ?', [tx.id, dup.id]);

    expect(await countPendingCashSuggestions()).toBe(0);
  });
});
```

- [ ] **Step 2: Rulează testul**

Run: `npm test -- --testPathPattern=cashSuggestionFlow`
Expected: PASS ambele.

- [ ] **Step 3: Commit**

```bash
git add __tests__/unit/cashSuggestionFlow.test.ts
git commit -m "test(cash-suggestion): flow integrare batch convert + dismiss"
```

---

## Task 7: Banner Sumar (`CashSuggestionBanner.tsx`)

**Files:**

- Create: `components/CashSuggestionBanner.tsx`
- Modify: `app/(tabs)/index.tsx`

Render condiționat pe `count > 0`. Tap → navighează la `/sugestie-cash/batch?source=summary`. „X" ascunde doar pentru sesiune (state local component).

- [ ] **Step 1: Creează componenta**

`components/CashSuggestionBanner.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { countPendingCashSuggestions } from '@/services/cashSuggestion';

export function CashSuggestionBanner() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [count, setCount] = useState(0);
  const [hiddenForSession, setHiddenForSession] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      countPendingCashSuggestions()
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

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable
        style={styles.tappable}
        onPress={() =>
          router.push({ pathname: '/sugestie-cash/batch', params: { source: 'summary' } })
        }
      >
        <Ionicons name="cash-outline" size={20} color={C.primary} />
        <Text style={[styles.text, { color: C.text }]} numberOfLines={2}>
          Ai {count} {count === 1 ? 'retragere' : 'retrageri'} de cash{' '}
          {count === 1 ? 'neclasificată' : 'neclasificate'} în ultimul an. Tap să le clasifici.
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
    marginHorizontal: 16,
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

- [ ] **Step 2: Integrează în Sumar**

În `app/(tabs)/index.tsx`, importă componenta și adaug-o sub header-ul de sold (înainte de listele de cont/tranzacție). Adaugă lângă import-uri:

```tsx
import { CashSuggestionBanner } from '@/components/CashSuggestionBanner';
```

Inserează `<CashSuggestionBanner />` în JSX, sub cardul de sold total. Locația exactă: imediat după view-ul „balance card" și înainte de listele de drill-down.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/CashSuggestionBanner.tsx app/(tabs)/index.tsx
git commit -m "feat(sumar): banner sugestie alimentare cash cu dismiss pe sesiune"
```

---

## Task 8: Ecran batch (`app/sugestie-cash/batch.tsx`)

**Files:**

- Create: `app/sugestie-cash/_layout.tsx`
- Create: `app/sugestie-cash/batch.tsx`

Listă scrollabilă cu cele 10 retrageri pending. Fiecare rând: checkbox bifat default, sumă/dată/descriere, dropdown cont destinație, „Skip pe rând". Footer: „Confirmă (N)" / „Skip toate" / „Anulează".

- [ ] **Step 1: Creează layout**

`app/sugestie-cash/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function SugestieCashLayout() {
  return (
    <Stack>
      <Stack.Screen name="batch" options={{ title: 'Sugestie cash' }} />
    </Stack>
  );
}
```

- [ ] **Step 2: Creează ecranul batch**

`app/sugestie-cash/batch.tsx`:

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
  dismissCashSuggestion,
  listPendingCashSuggestions,
} from '@/services/cashSuggestion';

import type { Transaction } from '@/types';

interface RowState {
  tx: Transaction;
  selected: boolean;
  targetAccountId: string | null;
}

export default function CashSuggestionBatch() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const { accounts } = useFinancialAccounts();
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    const pending = await listPendingCashSuggestions();
    const cashAccounts = accounts.filter(a => a.type === 'cash' && !a.archived);
    setRows(
      pending.map(tx => {
        const matchByCurrency = cashAccounts.filter(a => a.currency === tx.currency);
        const onlyOne = matchByCurrency.length === 1 ? matchByCurrency[0].id : null;
        return { tx, selected: true, targetAccountId: onlyOne };
      })
    );
    setLoading(false);
  }, [accounts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleSelect = (txId: string) =>
    setRows(prev => prev.map(r => (r.tx.id === txId ? { ...r, selected: !r.selected } : r)));

  const setTarget = (txId: string, accId: string) =>
    setRows(prev => prev.map(r => (r.tx.id === txId ? { ...r, targetAccountId: accId } : r)));

  const skipRow = async (txId: string) => {
    await dismissCashSuggestion(txId);
    setRows(prev => prev.filter(r => r.tx.id !== txId));
  };

  const skipAll = async () => {
    setBusy(true);
    try {
      for (const r of rows) {
        await dismissCashSuggestion(r.tx.id);
      }
      router.back();
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
        'Alege un cont cash destinație pentru fiecare retragere bifată sau debifează rândurile fără destinație.'
      );
      return;
    }
    setBusy(true);
    try {
      for (const r of selected) {
        await convertToTransfer(r.tx.id, r.targetAccountId!);
      }
      router.back();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Conversia a eșuat');
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = rows.filter(r => r.selected && r.targetAccountId).length;
  const cashAccounts = accounts.filter(a => a.type === 'cash' && !a.archived);

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
          Nu ai retrageri de cash neclasificate. Înapoi.
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
        {rows.length} {rows.length === 1 ? 'retragere detectată' : 'retrageri detectate'}
      </Text>
      <Text style={[styles.subheading, { color: C.textSecondary }]}>
        Vrei să le aloci într-un cont Cash?
      </Text>

      <FlatList
        data={rows}
        keyExtractor={r => r.tx.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const matching = cashAccounts.filter(a => a.currency === item.tx.currency);
          return (
            <View style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}>
              <Pressable onPress={() => toggleSelect(item.tx.id)} style={styles.rowHeader}>
                <Ionicons
                  name={item.selected ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={item.selected ? C.primary : C.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: C.text }]} numberOfLines={1}>
                    {item.tx.description || item.tx.merchant || 'Retragere'}
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
                          pathname: '/conturi/add',
                          params: { type: 'cash', currency: item.tx.currency },
                        })
                      }
                    >
                      <Text style={[styles.btnSecondaryText, { color: C.primary }]}>
                        + Creează cont Cash în {item.tx.currency}
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

              <Pressable onPress={() => skipRow(item.tx.id)} style={styles.skipBtn}>
                <Text style={{ color: C.textSecondary, fontSize: 12 }}>
                  ✗ Skip această retragere
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
        <Pressable disabled={busy} onPress={skipAll} style={styles.btnGhost}>
          <Text style={{ color: C.textSecondary }}>Skip toate</Text>
        </Pressable>
        <Pressable
          disabled={busy || selectedCount === 0}
          onPress={confirmSelected}
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

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run: `npm start` (app rulează în Expo Go).

- Navighează la `/sugestie-cash/batch?source=summary`. Empty state apare („Nu ai retrageri").
- Adaugă manual o tranzacție cu descrierea „RETRAGERE ATM BCR" și amount -500 RON.
- Re-navighează → vezi rândul. Bifa, dropdown contul cash, „Confirmă". Verifică în lista de tranzacții că e marcată ca transfer și că pe contul cash e o intrare nouă de +500.

- [ ] **Step 5: Commit**

```bash
git add app/sugestie-cash/_layout.tsx app/sugestie-cash/batch.tsx
git commit -m "feat(sugestie-cash): ecran batch cu listă, checkbox-uri, dropdown destinație"
```

---

## Task 9: Hook post-import

**Files:**

- Modify: `app/conturi/import.tsx:409` (după detecția duplicatelor)

După importul terminat și după detectarea transferurilor + duplicatelor, dacă `listPendingCashSuggestions({ limit: 10 })` filtrată pe statement-ul curent are >0, navigăm către ecranul batch.

- [ ] **Step 1: Importă funcția în `app/conturi/import.tsx`**

Adaugă în lista de import-uri:

```tsx
import { listPendingCashSuggestions } from '@/services/cashSuggestion';
```

- [ ] **Step 2: Adaugă logica de hook după duplicate detection**

În `app/conturi/import.tsx`, după blocul `try { ... duplicates ... } catch {}` (în jur de linia 408), înainte de `setImportedCount(rows.length)`:

```tsx
try {
  const pending = await listPendingCashSuggestions({ limit: 10 });
  // Filtrează la cele din statement-ul tocmai importat
  const fromThisStatement = pending.filter(p => p.statement_id === stmtId);
  if (fromThisStatement.length > 0) {
    setImportedCount(rows.length);
    setImporting(false);
    router.replace({
      pathname: '/sugestie-cash/batch',
      params: { source: 'import', statementId: stmtId },
    });
    return;
  }
} catch {
  // failure în detecție nu blochează importul
}
```

Asigură-te că `router` e deja importat (probabil este, din folosirea altor `router.push`).

- [ ] **Step 3: Manual smoke test**

Run: `npm start`.

- Importă un PDF/CSV care include cel puțin o retragere („retragere ATM" în descriere).
- După importul terminat, ar trebui să te ducă automat la ecranul batch.

- [ ] **Step 4: Commit**

```bash
git add app/conturi/import.tsx
git commit -m "feat(import): redirect către ecran sugestie cash dacă statement-ul are retrageri"
```

---

## Task 10: Inline checkbox în formular tranzacție

**Files:**

- Modify: `app/tranzactii/add.tsx`
- Modify: `app/tranzactii/[id].tsx`

Pentru tranzacții noi (`add.tsx`) și edit (`[id].tsx`), când amount < 0:

- Auto-detect bazat pe descriere/merchant: dacă match regex, checkbox-ul se bifează default.
- User poate debifa.
- Când e bifat, apare dropdown-ul cont cash destinație (filtrat pe valută).
- La submit, dacă bifat: apelează `convertToTransfer` în loc de `createTransaction` simplu.
- La edit pe tranzacție deja transfer (`is_internal_transfer = true`): checkbox e bifat și dezactivat.

> Notă pentru implementator: ambele formulare au structură similară, dar nu sunt 100% identice. Pentru fiecare, identifică zona JSX cu câmpul „Sumă" și „Descriere" și inserează blocul nou imediat după. Folosește hook-ul `useFinancialAccounts` care e deja folosit. Nu duplica logica — extrage într-un mic component intern dacă o folosești în ambele fișiere.

- [ ] **Step 1: Creează component partajat `CashWithdrawalToggle`**

Creează `components/CashWithdrawalToggle.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

import type { FinancialAccount } from '@/types';

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

const CASH_WITHDRAWAL_REGEX = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function CashWithdrawalToggle(props: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const cashAccounts = props.accounts.filter(
    a => a.type === 'cash' && !a.archived && a.currency === props.currency
  );

  // Auto-detect: când prop-ul autoDetect e true și textul match-uiește, bifează
  useEffect(() => {
    if (!props.autoDetect || props.readOnly) return;
    if (props.amount >= 0) return;
    const haystack = normalize(`${props.description} ${props.merchant}`);
    const matches = CASH_WITHDRAWAL_REGEX.test(haystack);
    if (matches !== props.enabled) {
      props.onEnabledChange(matches);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.amount, props.description, props.merchant, props.autoDetect]);

  if (props.amount >= 0) return null;

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
        <Text style={[styles.label, { color: C.text }]}>
          Este retragere de cash din contul bancar
        </Text>
      </Pressable>

      {props.enabled && !props.readOnly && (
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.subLabel, { color: C.textSecondary }]}>Cont destinație:</Text>
          {cashAccounts.length === 0 ? (
            <Pressable
              style={[styles.createBtn, { borderColor: C.primary }]}
              onPress={() =>
                router.push({
                  pathname: '/conturi/add',
                  params: { type: 'cash', currency: props.currency },
                })
              }
            >
              <Text style={{ color: C.primary }}>+ Creează cont Cash în {props.currency}</Text>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {cashAccounts.map(a => (
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

- [ ] **Step 2: Integrează în `app/tranzactii/add.tsx`**

Identifică în `add.tsx` zona unde se renderează câmpurile de Sumă/Descriere/Merchant, și state-ul componentei (probabil `useState` pe `amount`, `description`, `merchant`, `currency`). Adaugă:

```tsx
import { CashWithdrawalToggle } from '@/components/CashWithdrawalToggle';
import { convertToTransfer } from '@/services/cashSuggestion';
```

State nou (lângă alte useState):

```tsx
const [isCashWithdrawal, setIsCashWithdrawal] = useState(false);
const [cashTargetId, setCashTargetId] = useState<string | null>(null);
```

JSX nou (după câmpul Descriere/Merchant, înainte de butoane):

```tsx
<CashWithdrawalToggle
  amount={Number(amount) || 0}
  description={description}
  merchant={merchant}
  currency={currency}
  accounts={accounts}
  enabled={isCashWithdrawal}
  onEnabledChange={setIsCashWithdrawal}
  targetAccountId={cashTargetId}
  onTargetChange={setCashTargetId}
  autoDetect
/>
```

În handler-ul de submit (probabil `handleSave`), modifică:

```tsx
if (isCashWithdrawal && cashTargetId) {
  // creează tranzacția normal, apoi convertește
  const tx = await createTransaction({
    /* … câmpurile existente … */
  });
  await convertToTransfer(tx.id, cashTargetId);
} else if (isCashWithdrawal && !cashTargetId) {
  Alert.alert('Cont destinație lipsă', 'Alege un cont cash sau debifează „este retragere".');
  return;
} else {
  await createTransaction({
    /* … câmpurile existente … */
  });
}
```

- [ ] **Step 3: Integrează în `app/tranzactii/[id].tsx` (edit)**

Aceeași logică, plus state inițial:

```tsx
const [isCashWithdrawal, setIsCashWithdrawal] = useState(tx?.is_internal_transfer ?? false);
const [cashTargetId, setCashTargetId] = useState<string | null>(null);
```

Și în `<CashWithdrawalToggle ... readOnly={tx?.is_internal_transfer ?? false} autoDetect={!tx?.is_internal_transfer} />` ca să nu permită modificarea pentru tranzacții deja transferuri.

> În handler-ul de save, păstrează comportamentul existent — pentru edit pe tranzacție care nu era transfer, dacă userul bifează acum, apelează `convertToTransfer` după `updateTransaction`. Pentru tranzacții deja transfer, nu permite schimbare prin acest checkbox (read-only).

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: zero erori.

- [ ] **Step 6: Manual smoke test**

Run: `npm start`.

- Adaugă tranzacție cu descriere „ATM BCR" → checkbox bifat automat.
- Schimbă descriere la „cumpărătură" → checkbox debifat automat.
- Bifează manual + alege cont cash + save → vezi că s-a creat transferul.
- Edit pe o tranzacție deja transfer → vezi că checkbox-ul e bifat read-only.

- [ ] **Step 7: Commit**

```bash
git add components/CashWithdrawalToggle.tsx app/tranzactii/add.tsx app/tranzactii/[id].tsx
git commit -m "feat(tranzactii): checkbox inline retragere cash în formular cu auto-detect"
```

---

## Task 11: Update docs și IDEAS.md

**Files:**

- Modify: `docs/IDEAS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `CLAUDE.md` (dacă apar convenții noi)

- [ ] **Step 1: Adaugă în „Implementat" în `docs/IDEAS.md`**

În secțiunea „## Implementat", după ultimul item, adaugă:

```markdown
- **Sugestie alimentare cont cash la retragere** (2026-05-04) — detectează retragerile (regex `retragere|atm|bancomat|cash withdrawal|numerar|extragere`) și sugerează conversia în transfer intern către contul Cash, folosind mecanismul existent `is_internal_transfer` + `linked_transaction_id`. Trei surface-uri: post-import (ecran batch), formular tranzacție (checkbox inline cu auto-detect), banner Sumar. Schemă: nou câmp `cash_suggestion_dismissed` + index parțial pentru pending. Window: ultimul an, top 10 sortate `date DESC`. Spec: `docs/specs/2026-05-04-sugestie-alimentare-cash-design.md`. Plan: `docs/plans/2026-05-04-sugestie-alimentare-cash.md`.
```

- [ ] **Step 2: Adaugă mențiune în `docs/ARCHITECTURE.md`**

Verifică dacă `docs/ARCHITECTURE.md` are secțiune despre `services/`. Dacă da, adaugă o linie despre `cashSuggestion.ts`. Dacă nu, sari acest pas.

- [ ] **Step 3: `npm run check` pe tot lanțul**

Run: `npm run check`
Expected: PASS pe lint, type-check, type-coverage, test, knip, madge, dep-cruise, audit.

Dacă apar erori knip/madge/dep-cruise, fixează-le (probabil import circular sau export neutilizat din `cashSuggestion.ts` neexportat încă în barrel).

- [ ] **Step 4: Commit final**

```bash
git add docs/IDEAS.md docs/ARCHITECTURE.md
git commit -m "docs: actualizare IDEAS și ARCHITECTURE după sugestie alimentare cash"
```

---

## Verificare finală (înainte de PR/merge)

Bifează manual fiecare punct înainte de a marca feature-ul ca done:

- [ ] `npm run check` PASS pe tot.
- [ ] Coverage `services/cashSuggestion.ts` ≥ 95% (verificat în output Jest).
- [ ] Manual: import PDF cu retrageri → ecran batch → confirm câteva → solduri corecte pe ambele conturi.
- [ ] Manual: tranzacție „atmosferă restaurant" → checkbox NU se bifează.
- [ ] Manual: 0 conturi cash → adaug retragere → bifez → buton creează cont apare.
- [ ] Manual: EUR retragere + doar cont cash RON → buton creează cont EUR apare.
- [ ] Manual: banner Sumar X (dismiss session) → restart app → reapare.
- [ ] Manual: backup pre-migrație → restore → app deschide ok.

---

## Out of scope (recordat în spec, NU implementa aici)

- Auto-categorizare comisioane retragere ATM.
- Sincronizare automată sumă/dată între jumătățile unui transfer la edit.
- Configurare din Setări a window-ului de scanare.
- Detecție retrageri pe sumă rotundă fără cuvânt-cheie.
