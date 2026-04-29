# Extragere Finanțe în proiect nou — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mut hub-ul „Gestiune financiară" dintr-un DOSAR într-un proiect Expo independent la `/Users/ax/work/finante`. DOSAR rămâne aplicație de documente + auto curat (fără concept de cont/tranzacție/categorie). Proiectul nou e free-standing — propria sa schemă SQLite, propriul backup, propriul AI provider, propriul app lock.

**Architecture:**
- **Două proiecte separate, fără monorepo.** Codul partajat (theme, AI provider, app lock, paterne DB/backup) se duplică deliberat. Acceptăm drift-ul ca preț pentru simplitate operațională.
- **DOSAR păstrează `documents.metadata.amount`** (deja există ca informație pe bonuri/facturi/abonamente) — fără concept de tranzacție. Pierde butoanele „Adaugă ca cheltuială" / „Adaugă tranzacție".
- **`fuel_records.account_id` și auto-creare-tranzacție dispar din DOSAR.** Câmpul `price` (deja pe alimentare) rămâne și e suficient pentru calculul de consum. Userul care vrea să tracheze cheltuiala cu mașina ca buget o face manual în Finanțe.
- **Migrare DB DOSAR:** drop tabele financial_accounts / expense_categories / transactions / bank_statements / fx_rates. Coloanele `documents.financial_account_id` și `fuel_records.account_id` sunt scoase prin recreate-via-temp-table (SQLite nu suportă DROP COLUMN simplu).

**Tech Stack:**
- Ambele proiecte: React Native + Expo (TypeScript), expo-sqlite, expo-router, expo-file-system, expo-secure-store, expo-local-authentication.
- Finanțe în plus: expo-document-picker pentru import extras (PDF/CSV), `@react-native-ml-kit/text-recognition` (OCR existent în DOSAR pentru PDF parsing), Mistral/OpenAI provider pentru AI vision/text mapping.
- Test: Jest pentru servicii.

**Convenții repo (DOSAR):**
- Path-urile din plan sunt relative la `/Users/ax/work/documents/`.
- Working dir pentru `npm`: `app/`.
- TS strict, fără `any`, texte UI în română.
- `useColorScheme` se importă **doar** din `@/components/useColorScheme`.
- Zero culori hardcodate (folosește paleta din `@/theme/colors`).
- Spec referință conversațională: discuția 2026-04-25 cu utilizatorul în care s-au confirmat deciziile A=două proiecte, B=`amount` rămâne pe bonuri DOSAR, C=fuel pierde auto-tranzacția.

---

## Task 0: Pregătire și safety net

> **Context starea reală la 2026-04-26:** working tree-ul DOSAR conține tot hub-ul financiar **necomis** — 9 servicii noi (`financialAccounts.ts`, `categories.ts`, `bankStatements.ts`, `bankStatementParser.ts`, `bankStatementPdfParser.ts`, `aiStatementMapper.ts`, `aiStatementVisionMapper.ts`, `fxRates.ts`, `financeHubMigration.ts`), 4 hooks noi (`useTransactions`, `useCategories`, `useFinancialAccounts`, `useMonthlyAnalysis`), 9 ecrane noi sub `entitati/financiar/` și `entitati/cont/`, ecran `entitati/categorii.tsx`, 5 teste noi, plus 33 fișiere modificate (db.ts, types/index.ts, backup.ts, fuel.ts, chatbot.ts, appKnowledge.ts, OnboardingWizard, Home, Setări etc.). Tag-ul git pre-extract trebuie să cuprindă această stare, altfel rollback-ul e inutil.
> **De asemenea în working tree (NU finanțe — RĂMÂN în DOSAR):** `app/(tabs)/entitati/fuel-stats.tsx`, `components/FuelConsumptionChart.tsx`, `docs/gestiune-auto.html`. Sunt feature de gestiune auto/consum, separate de extragere.

**Files:**
- Read: niciunul (commit + tag + sanity check)

- [ ] **Step 1: Verifică starea curentă DOSAR**

```bash
cd /Users/ax/work/documents/app
npm run type-check
npm run lint
npm test
```

Expected: toate pass. Dacă pică ceva, oprește planul și raportează.

- [ ] **Step 2: Stage și comit lucrul finanțe în lucru ca snapshot**

```bash
cd /Users/ax/work/documents
git status
git add -A
git commit -m "chore: snapshot finance hub work-in-progress before extraction"
git log -1 --oneline
```

Expected: un commit cu ~50 fișiere (33 modified + ~25 untracked). Acesta e baseline-ul real din care extragem.

> **De ce în loc de stash:** stash-ul ar pierde untracked cu `-u` doar dacă explicit, și planul are 14 task-uri — riscul de stash drop accidental e prea mare. Un commit normal e auditat în git log.

- [ ] **Step 3: Tag git pentru rollback**

```bash
cd /Users/ax/work/documents
git tag pre-finance-extract -m "Snapshot înainte de extragere hub finanțe în proiect separat"
git log -1 --oneline
```

Expected: tag creat pe commit-ul de la Step 2. Dacă vreodată extragere eșuează, `git reset --hard pre-finance-extract` restaurează totul.

- [ ] **Step 4: Verifică că `/Users/ax/work/finante` nu există**

```bash
ls /Users/ax/work/finante 2>/dev/null && echo "EXISTĂ — oprește" || echo "OK — pot scaffold"
```

Expected: `OK — pot scaffold`. Dacă există, redenumește-l (`finante.bak`) sau confirmă cu utilizatorul ce vrea.

---

## Task 1: Scaffold proiect Finanțe (creare structură de bază)

**Files:**
- Create: `/Users/ax/work/finante/` (proiect nou Expo TS)

- [ ] **Step 1: Generează template Expo + TypeScript**

```bash
cd /Users/ax/work
npx create-expo-app@latest finante --template blank-typescript
cd finante
```

Expected: folder `finante/` cu structură minimă Expo. Verifică `app.json`, `package.json`, `tsconfig.json` create.

- [ ] **Step 2: Instalează dependențele runtime de bază (același set ca DOSAR)**

```bash
cd /Users/ax/work/finante
npx expo install expo-sqlite expo-file-system expo-secure-store expo-local-authentication expo-document-picker expo-sharing expo-router expo-haptics expo-notifications expo-image-picker @expo/vector-icons
```

Expected: dependențele instalate fără erori. Versiunile sunt aliniate cu Expo SDK-ul curent al template-ului.

- [ ] **Step 3: Instalează dependențele AI / OCR**

```bash
cd /Users/ax/work/finante
npm install @react-native-ml-kit/text-recognition
```

Expected: instalat. (Dacă SDK-ul Expo curent nu suportă ML Kit fără prebuild, notează — îl rulăm doar după prebuild în Task 3.)

- [ ] **Step 4: Configurează `tsconfig.json` (paths)**

Editează `/Users/ax/work/finante/tsconfig.json` și adaugă:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

Expected: aliasul `@/` rezolvă din rădăcina proiectului (la fel ca DOSAR).

- [ ] **Step 5: Configurează `app.json` cu nume + bundle identifier propriu**

Editează `/Users/ax/work/finante/app.json`:

```json
{
  "expo": {
    "name": "Finanțe",
    "slug": "finante",
    "scheme": "finante",
    "version": "0.1.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "ios": {
      "bundleIdentifier": "ro.tabrudan.finante",
      "supportsTablet": false
    },
    "android": {
      "package": "ro.tabrudan.finante"
    },
    "plugins": ["expo-router", "expo-sqlite", "expo-secure-store"]
  }
}
```

Expected: bundle identifier diferit de DOSAR. Aplicațiile vor coexista pe device.

- [ ] **Step 6: Inițializează Expo Router (rooting în `app/`)**

```bash
cd /Users/ax/work/finante
mkdir -p app
```

Creează `/Users/ax/work/finante/app/_layout.tsx` minimal:

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Creează `/Users/ax/work/finante/app/index.tsx`:

```tsx
import { Text, View } from 'react-native';

export default function Home() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Finanțe — în construcție</Text>
    </View>
  );
}
```

Expected: o pagină home placeholder.

- [ ] **Step 7: Smoke test pornire**

```bash
cd /Users/ax/work/finante
npx expo start --ios
```

Expected: simulator pornește, vezi „Finanțe — în construcție". Cmd+C oprește.

- [ ] **Step 8: Commit inițial pe Finanțe**

```bash
cd /Users/ax/work/finante
git init
git add -A
git commit -m "chore: scaffold Expo TS project"
```

Expected: primul commit în `/Users/ax/work/finante/.git/`.

---

## Task 2: Copiere infrastructură partajată (theme, app lock, AI provider) în Finanțe

**Files (DOSAR → Finanțe, copiate verbatim sau cu adaptări minore):**
- Copy: `theme/` întreg (colors, spacing)
- Copy: `constants/Theme.ts`, `constants/Colors.ts`
- Copy: `components/Themed.tsx`, `components/useColorScheme.ts`, `components/useColorScheme.web.ts` (dacă există), `components/AppLockScreen.tsx`
- Copy: `hooks/useAppLock.ts`
- Copy: `services/aiProvider.ts`, `services/providerSettings.ts`, `services/mistralProvider.ts`, `services/openaiProvider.ts` (numele exacte se descoperă în DOSAR la pasul 1)

- [ ] **Step 1: Inventariază fișierele de copiat din DOSAR**

```bash
ls /Users/ax/work/documents/app/theme/
ls /Users/ax/work/documents/app/constants/
ls /Users/ax/work/documents/app/components/ | grep -E "Themed|useColorScheme|AppLock"
ls /Users/ax/work/documents/app/services/ | grep -E "aiProvider|providerSettings|mistralProvider|openaiProvider|chatbot"
ls /Users/ax/work/documents/app/hooks/ | grep -E "useAppLock|useColorScheme"
```

Expected: notezi numele fișierelor exacte. Dacă lipsesc unele (ex. `mistralProvider.ts`), foloseți doar ce există.

- [ ] **Step 2: Copiază `theme/`**

```bash
mkdir -p /Users/ax/work/finante/theme
cp -R /Users/ax/work/documents/app/theme/. /Users/ax/work/finante/theme/
```

Expected: `theme/colors.ts`, `theme/spacing.ts` (sau ce există) copiate.

- [ ] **Step 3: Copiază `constants/`**

```bash
mkdir -p /Users/ax/work/finante/constants
cp /Users/ax/work/documents/app/constants/Theme.ts /Users/ax/work/finante/constants/
cp /Users/ax/work/documents/app/constants/Colors.ts /Users/ax/work/finante/constants/
```

Expected: două fișiere copiate. NU copia `AppLinks.ts` (e specific DOSAR, link-urile la docs DOSAR).

- [ ] **Step 4: Copiază componentele de bază**

```bash
mkdir -p /Users/ax/work/finante/components
cp /Users/ax/work/documents/app/components/Themed.tsx /Users/ax/work/finante/components/
cp /Users/ax/work/documents/app/components/useColorScheme.ts /Users/ax/work/finante/components/
cp /Users/ax/work/documents/app/components/AppLockScreen.tsx /Users/ax/work/finante/components/
```

Expected: trei fișiere copiate. Verifică imports — toate trebuie să rezolve la fișiere copiate sau la pachete deja instalate.

- [ ] **Step 5: Copiază hook-ul AppLock**

```bash
mkdir -p /Users/ax/work/finante/hooks
cp /Users/ax/work/documents/app/hooks/useAppLock.ts /Users/ax/work/finante/hooks/
```

Expected: copiat.

- [ ] **Step 6: Copiază AI provider**

```bash
mkdir -p /Users/ax/work/finante/services
cp /Users/ax/work/documents/app/services/aiProvider.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/providerSettings.ts /Users/ax/work/finante/services/ 2>/dev/null || true
# Adaugă orice alt fișier provider găsit la Step 1
```

Expected: aiProvider.ts și fișierele lui de suport copiate.

- [ ] **Step 7: Rezolvă imports rupte**

```bash
cd /Users/ax/work/finante
npx tsc --noEmit
```

Expected: erorile rămase indică ce mai trebuie copiat sau adaptat (probabil referințe la `localModel`, la chatbot DOSAR-specific etc.). **Nu** copia chatbot.ts în întregime încă — o să-l reconstruim cu knowledge propriu pentru Finanțe în Task 5.

- [ ] **Step 8: Editează `app/_layout.tsx` cu app lock + theme**

Înlocuiește conținutul actual al `/Users/ax/work/finante/app/_layout.tsx` cu structura din DOSAR (verifică `app/_layout.tsx` din DOSAR pentru forma exactă: ThemeProvider + AppLockScreen wrapper + Stack). Copiază mecanismul, adaptează doar titlurile/string-urile vizibile (ex. „Bună! Finanțe e blocat").

```bash
cat /Users/ax/work/documents/app/app/_layout.tsx
```

Apoi adaptează în Finanțe: scoate orice referință la documents/entities care nu există încă; păstrează theme + app lock.

- [ ] **Step 9: Smoke test**

```bash
cd /Users/ax/work/finante
npx expo start --ios
```

Expected: app pornește, prompt biometric/PIN apare la pornire (sau bypass dacă nu e setat). Tema light/dark răspunde la setare sistem.

- [ ] **Step 10: Commit**

```bash
cd /Users/ax/work/finante
git add -A
git commit -m "feat: copy theme, app lock, AI provider from DOSAR"
```

---

## Task 3: Schema SQLite curată în Finanțe (doar finanțe, fără reziduuri DOSAR)

**Files:**
- Create: `/Users/ax/work/finante/services/db.ts`

- [ ] **Step 1: Creează `services/db.ts` cu schema doar pentru finanțe**

Creează `/Users/ax/work/finante/services/db.ts` (NU copia `db.ts` din DOSAR — are tot DOSAR-ul în el):

```typescript
import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('finante.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS financial_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'bank',
    currency TEXT NOT NULL DEFAULT 'RON',
    initial_balance REAL NOT NULL DEFAULT 0,
    initial_balance_date TEXT,
    iban TEXT,
    bank_name TEXT,
    color TEXT,
    icon TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    key TEXT,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    parent_id TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    monthly_limit REAL,
    display_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

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
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_statements (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    file_path TEXT,
    file_hash TEXT,
    imported_at TEXT NOT NULL,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    total_inflow REAL NOT NULL DEFAULT 0,
    total_outflow REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fx_rates (
    pair TEXT PRIMARY KEY,
    rate REAL NOT NULL,
    fetched_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_fa_archived ON financial_accounts(archived);
  CREATE INDEX IF NOT EXISTS idx_cat_system ON expense_categories(is_system, archived);
  CREATE INDEX IF NOT EXISTS idx_cat_parent ON expense_categories(parent_id);
  CREATE INDEX IF NOT EXISTS idx_cat_order ON expense_categories(display_order);
  CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_tx_statement ON transactions(statement_id);
  CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(linked_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_bs_account_period ON bank_statements(account_id, period_to DESC);
`);

// Seed categorii sistem (idempotent)
try {
  db.execSync(`
    INSERT OR IGNORE INTO expense_categories
      (id, key, name, icon, color, is_system, display_order, created_at)
    VALUES
      ('cat-sys-food',          'food',          'Mâncare',      'fast-food',             '#F2994A', 1,  0,  datetime('now')),
      ('cat-sys-transport',     'transport',     'Transport',    'bus',                   '#56CCF2', 1,  1,  datetime('now')),
      ('cat-sys-utilities',     'utilities',     'Utilități',    'flash',                 '#F2C94C', 1,  2,  datetime('now')),
      ('cat-sys-health',        'health',        'Sănătate',     'medkit',                '#EB5757', 1,  3,  datetime('now')),
      ('cat-sys-vehicle',       'vehicle',       'Mașină',       'car-sport',             '#2D9CDB', 1,  4,  datetime('now')),
      ('cat-sys-home',          'home',          'Casă',         'home',                  '#BB6BD9', 1,  5,  datetime('now')),
      ('cat-sys-entertainment', 'entertainment', 'Distracție',   'happy',                 '#F2C94C', 1,  6,  datetime('now')),
      ('cat-sys-subscriptions', 'subscriptions', 'Abonamente',   'repeat',                '#6FCF97', 1,  7,  datetime('now')),
      ('cat-sys-shopping',      'shopping',      'Cumpărături',  'bag-handle',            '#F2994A', 1,  8,  datetime('now')),
      ('cat-sys-education',     'education',     'Educație',     'school',                '#27AE60', 1,  9,  datetime('now')),
      ('cat-sys-travel',        'travel',        'Călătorii',    'airplane',              '#56CCF2', 1,  10, datetime('now')),
      ('cat-sys-income',        'income',        'Venituri',     'cash',                  '#27AE60', 1,  11, datetime('now')),
      ('cat-sys-transfer',      'transfer',      'Transfer',     'swap-horizontal',       '#828282', 1,  12, datetime('now')),
      ('cat-sys-other',         'other',         'Alte',         'ellipsis-horizontal',   '#9F9F9F', 1,  99, datetime('now'))
  `);
} catch {
  // seed deja aplicat
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
```

> **Diferențe față de schema DOSAR:** scoasă coloana `transactions.fuel_record_id` (nu mai există fuel records aici) și `transactions.source_document_id` (Finanțe nu cunoaște documente DOSAR). Scoase și index-urile aferente.

- [ ] **Step 2: Verifică tip-check**

```bash
cd /Users/ax/work/finante
npx tsc --noEmit
```

Expected: `services/db.ts` nu produce erori.

- [ ] **Step 3: Smoke test runtime (deschide DB-ul)**

Editează temporar `app/index.tsx`:

```tsx
import { Text, View } from 'react-native';
import { db } from '@/services/db';

export default function Home() {
  const cats = db.getAllSync<{ name: string }>('SELECT name FROM expense_categories ORDER BY display_order');
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <Text>Categorii sistem: {cats.length}</Text>
      <Text>{cats.map(c => c.name).join(', ')}</Text>
    </View>
  );
}
```

Pornește app: `npx expo start --ios`. Expected: vezi „Categorii sistem: 14" cu lista. Asta confirmă schema + seed.

- [ ] **Step 4: Reverteaz `app/index.tsx` la placeholder**

Restaurează conținutul de la Task 1 Step 6.

- [ ] **Step 5: Commit**

```bash
cd /Users/ax/work/finante
git add -A
git commit -m "feat: SQLite schema with finance tables only"
```

---

## Task 4: Copiere servicii financiare în Finanțe

**Files (DOSAR → Finanțe, copiate cu mici adaptări de import):**
- Copy: `services/transactions.ts`, `services/financialAccounts.ts`, `services/categories.ts`
- Copy: `services/bankStatements.ts`, `services/bankStatementParser.ts`, `services/bankStatementPdfParser.ts`
- Copy: `services/aiStatementMapper.ts`, `services/aiStatementVisionMapper.ts`
- Copy: `services/fxRates.ts`
- Copy: `services/pdfOcr.ts`, `services/ocr.ts` (dependențe pentru parsing extras)
- Adaptează: import-uri către `@/types`, `@/services/db`, `@/services/aiProvider`. **Scoate orice referință la `fuel_record_id` și `source_document_id`** (nu există în Finanțe).

- [ ] **Step 1: Copiază blocul de servicii financiare**

```bash
cp /Users/ax/work/documents/app/services/transactions.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/financialAccounts.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/categories.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/bankStatements.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/bankStatementParser.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/bankStatementPdfParser.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/aiStatementMapper.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/aiStatementVisionMapper.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/fxRates.ts /Users/ax/work/finante/services/
cp /Users/ax/work/documents/app/services/pdfOcr.ts /Users/ax/work/finante/services/ 2>/dev/null || true
cp /Users/ax/work/documents/app/services/ocr.ts /Users/ax/work/finante/services/ 2>/dev/null || true
```

Expected: 9-11 fișiere copiate.

- [ ] **Step 2: Creează `types/index.ts` în Finanțe (extragere selectivă)**

Creează `/Users/ax/work/finante/types/index.ts` cu DOAR tipurile financiare. Copiază din `/Users/ax/work/documents/app/types/index.ts`:
- `FinancialAccountType`, `FinancialAccount`, `FINANCIAL_ACCOUNT_TYPE_LABELS`
- `CategoryKey`, `ExpenseCategory`
- `TransactionSource` (modificat: scoate `'fuel'` și `'ocr'` dacă vrei minimalism — sau lasă-le, sunt inerte)
- `Transaction` (modificat: scoate `fuel_record_id` și `source_document_id`)
- `BankStatement`

Pentru `Transaction`, formatul nou:

```typescript
export type TransactionSource = 'manual' | 'statement' | 'ocr';

export interface Transaction {
  id: string;
  account_id?: string;
  date: string;
  amount: number;
  currency: string;
  amount_ron?: number;
  description?: string;
  merchant?: string;
  category_id?: string;
  source: TransactionSource;
  statement_id?: string;
  is_internal_transfer: boolean;
  linked_transaction_id?: string;
  is_refund: boolean;
  duplicate_of_id?: string;
  notes?: string;
  createdAt: string;
}
```

- [ ] **Step 3: Adaptează `services/transactions.ts` pentru a scoate referințele la fuel/document**

Editează `/Users/ax/work/finante/services/transactions.ts`:
- Caută toate aparițiile `fuel_record_id` → șterge complet (interfețe, INSERT, UPDATE, WHERE).
- Caută toate aparițiile `source_document_id` → șterge complet.
- Caută `getTransactionForDocument` → șterge funcția.
- Caută `createOrUpdateTransactionForFuel` (dacă există ca export) → șterge.
- Caută importuri din `@/services/fuel` → șterge.

Comandă pentru a vedea unde sunt referințele:

```bash
cd /Users/ax/work/finante
grep -nE "fuel_record_id|source_document_id|getTransactionForDocument|fromFuel|fromDocument" services/transactions.ts
```

Expected: după editare, `grep` returnează zero rezultate.

- [ ] **Step 4: Adaptează `services/aiStatementVisionMapper.ts` și `aiStatementMapper.ts`**

Verifică că nu importă din `@/services/documents` sau `@/services/entities` (DOSAR-specific). Dacă da, șterge ramurile aferente — în Finanțe lucrează doar cu cont + tranzacție.

```bash
cd /Users/ax/work/finante
grep -nE "@/services/(documents|entities|fuel|maintenance|vehicleStatus)" services/*.ts
```

Expected: zero rezultate. Dacă apar, deschide fișierul și taie codul mort.

- [ ] **Step 5: Type-check Finanțe**

```bash
cd /Users/ax/work/finante
npx tsc --noEmit
```

Expected: erorile rămase indică imports lipsă (probabil `chatbot.ts`, `appKnowledge.ts`, `documents.ts`). Le rezolvăm prin adaptare la Step 6.

- [ ] **Step 6: Adaptează AI provider pentru extras (chatbot context Finanțe)**

Creează `/Users/ax/work/finante/services/appKnowledge.ts` minimalist (fără DOSAR — referă DOAR finanțe):

```typescript
export function buildAppKnowledge(): string {
  return `Ești asistentul aplicației „Finanțe" — app mobilă locală pentru gestiunea cheltuielilor și veniturilor. Răspunzi în română, concis.

**Entități:** Conturi financiare (bancar, cash, card de credit, economii, investiții, altele), Categorii de cheltuieli (sistem + custom), Tranzacții (cheltuieli/venituri/transferuri), Extrase bancare importate.

**Funcții principale:**
- Adaugă tranzacții manuale (cheltuieli sau venituri) pe oricare cont
- Importă extrase bancare PDF (BT, ING, Revolut, OTP) sau CSV — parsare locală cu fallback la AI dacă rezultatul e gol
- Detectare automată duplicate la importuri repetate
- Detectare automată transferuri interne între conturi proprii (excluse din analitice)
- Sumar lunar pe categorii cu bare procentuale și sume cheltuite
- Evoluție trend pe 3/6/12 luni per categorie
- Limite lunare per categorie cu alertă la depășire
- Multi-currency cu curs de schimb cached zilnic
- Backup JSON al tuturor datelor în iCloud Drive / Google Drive

**Reguli:**
- Bazează-te DOAR pe datele utilizatorului transmise mai jos; nu inventa cifre.
- Când menționezi o tranzacție specifică, include ID-ul în format [TX:xxx].
- Pentru date sensibile (CVV, parole) nu există câmp dedicat — recomandă utilizatorului să nu le scrie în descriere.`;
}
```

- [ ] **Step 7: Type-check final**

```bash
cd /Users/ax/work/finante
npx tsc --noEmit
```

Expected: zero erori. Dacă rămân, rezolvă-le punctual (probabil mai sunt importuri către `@/services/chatbot` în vreun ecran de copiat ulterior — momentan nu avem ecrane copiate, deci nu ar trebui).

- [ ] **Step 8: Commit**

```bash
cd /Users/ax/work/finante
git add -A
git commit -m "feat: copy finance services and adapt for standalone use"
```

---

## Task 5: Copiere hooks + ecrane financiare în Finanțe

**Files:**
- Copy: `hooks/useTransactions.ts`, `hooks/useCategories.ts`, `hooks/useFinancialAccounts.ts`, `hooks/useMonthlyAnalysis.ts`, `hooks/useCategoryTransactions.ts`
- Copy: ecrane din `app/(tabs)/entitati/financiar/` și `app/(tabs)/entitati/cont/` → restructurare în Finanțe ca tab-uri proprii

- [ ] **Step 1: Copiază hook-urile**

```bash
cp /Users/ax/work/documents/app/hooks/useTransactions.ts /Users/ax/work/finante/hooks/
cp /Users/ax/work/documents/app/hooks/useCategories.ts /Users/ax/work/finante/hooks/
cp /Users/ax/work/documents/app/hooks/useFinancialAccounts.ts /Users/ax/work/finante/hooks/
cp /Users/ax/work/documents/app/hooks/useMonthlyAnalysis.ts /Users/ax/work/finante/hooks/
cp /Users/ax/work/documents/app/hooks/useCategoryTransactions.ts /Users/ax/work/finante/hooks/
```

Expected: 5 hooks copiate.

- [ ] **Step 2: Curăță importurile în hooks**

```bash
cd /Users/ax/work/finante
grep -lE "@/services/(fuel|documents|entities|chatbot)" hooks/*.ts
```

Expected: dacă vreun hook importă servicii inexistente, deschide-l și șterge ramurile.

- [ ] **Step 3: Decide structura de tab-uri Finanțe**

Structura propusă (mai plată decât DOSAR — nu mai e un sub-feature):

```
app/
├── _layout.tsx               # root + app lock + theme
├── index.tsx                 # redirect → /(tabs)
└── (tabs)/
    ├── _layout.tsx           # bottom tabs: Sumar / Conturi / Tranzacții / Categorii / Setări
    ├── index.tsx             # = fostul „financiar/index" (sumar lunar + top categorii)
    ├── evolutie.tsx          # = fostul „financiar/evolutie"
    ├── conturi/
    │   ├── index.tsx         # = fostul „financiar/conturi"
    │   ├── [id].tsx
    │   ├── add.tsx
    │   ├── edit.tsx
    │   └── import.tsx
    ├── tranzactii/
    │   ├── index.tsx         # listă globală
    │   └── [id].tsx          # = fostul „cont/tranzactie" (formular)
    ├── categorii.tsx         # = fostul „entitati/categorii"
    └── setari.tsx            # backup/restore + AI provider + app lock
```

- [ ] **Step 4: Creează `app/(tabs)/_layout.tsx` cu Tabs**

```tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TabLayout() {
  const scheme = useColorScheme() ?? 'light';
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: Colors[scheme].tint }}>
      <Tabs.Screen name="index" options={{ title: 'Sumar', tabBarIcon: ({ color }) => <Ionicons name="pie-chart" size={22} color={color} /> }} />
      <Tabs.Screen name="conturi" options={{ title: 'Conturi', tabBarIcon: ({ color }) => <Ionicons name="wallet" size={22} color={color} /> }} />
      <Tabs.Screen name="tranzactii" options={{ title: 'Tranzacții', tabBarIcon: ({ color }) => <Ionicons name="list" size={22} color={color} /> }} />
      <Tabs.Screen name="categorii" options={{ title: 'Categorii', tabBarIcon: ({ color }) => <Ionicons name="pricetags" size={22} color={color} /> }} />
      <Tabs.Screen name="setari" options={{ title: 'Setări', tabBarIcon: ({ color }) => <Ionicons name="settings" size={22} color={color} /> }} />
      <Tabs.Screen name="evolutie" options={{ href: null }} />
    </Tabs>
  );
}
```

Expected: layout funcțional. `evolutie` ascuns din tab bar (deschis ca push).

- [ ] **Step 5: Mut ecranele financiare**

```bash
mkdir -p /Users/ax/work/finante/app/\(tabs\)/conturi
mkdir -p /Users/ax/work/finante/app/\(tabs\)/tranzactii

# Sumar (fost financiar/index)
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/financiar/index.tsx /Users/ax/work/finante/app/\(tabs\)/index.tsx

# Evoluție
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/financiar/evolutie.tsx /Users/ax/work/finante/app/\(tabs\)/evolutie.tsx

# Conturi (NOTĂ: include financiar/_layout.tsx și cont/_layout.tsx — pe care nu le copiem,
# pentru că Finanțe folosește alt layout din Tabs definit în Step 4)
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/financiar/conturi.tsx /Users/ax/work/finante/app/\(tabs\)/conturi/index.tsx
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/cont/\[id\].tsx /Users/ax/work/finante/app/\(tabs\)/conturi/\[id\].tsx
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/cont/add.tsx /Users/ax/work/finante/app/\(tabs\)/conturi/add.tsx
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/cont/edit.tsx /Users/ax/work/finante/app/\(tabs\)/conturi/edit.tsx
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/cont/import.tsx /Users/ax/work/finante/app/\(tabs\)/conturi/import.tsx

# Tranzacții (formular)
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/cont/tranzactie.tsx /Users/ax/work/finante/app/\(tabs\)/tranzactii/\[id\].tsx

# Categorii
cp /Users/ax/work/documents/app/app/\(tabs\)/entitati/categorii.tsx /Users/ax/work/finante/app/\(tabs\)/categorii.tsx

# Pagină marketing (opțional — site de prezentare Finanțe)
mkdir -p /Users/ax/work/finante/docs
cp /Users/ax/work/documents/app/docs/gestiune-financiara.html /Users/ax/work/finante/docs/index.html 2>/dev/null || true
```

Expected: 9 ecrane copiate + 1 pagină de docs (dacă există). **Layout-urile `financiar/_layout.tsx` și `cont/_layout.tsx` NU se copiază** — Finanțe folosește alt layout (Tabs creat la Step 4), iar layout-urile vechi sunt sub-context DOSAR (header „Înapoi la entități" etc.) care nu mai are sens aici.

> **NOTĂ ce RĂMÂNE în DOSAR (NU se copiază în Finanțe):**
> - `app/(tabs)/entitati/fuel-stats.tsx` — statistici de consum (auto)
> - `components/FuelConsumptionChart.tsx` — grafic consum (auto)
> - `docs/gestiune-auto.html` — pagină marketing auto
> Toate sunt feature de gestiune auto/consum, distincte de finanțe.

- [ ] **Step 6: Creează `app/(tabs)/tranzactii/index.tsx` (listă globală)**

Acest ecran nu există în DOSAR (acolo tranzacțiile se vedeau doar în context de cont sau de hub). Pentru Finanțe e util să avem listă globală cu filtre. Forma minimă:

```tsx
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTransactions } from '@/hooks/useTransactions';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TransactionsList() {
  const scheme = useColorScheme() ?? 'light';
  const { transactions, loading } = useTransactions({});
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: Colors[scheme].background }}>
      <FlatList
        data={transactions}
        keyExtractor={t => t.id}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => router.push(`/tranzactii/${item.id}`)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: Colors[scheme].border }}>
            <Text style={{ color: Colors[scheme].text }}>{item.date} — {item.description ?? '(fără descriere)'} — {item.amount.toFixed(2)} {item.currency}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ color: Colors[scheme].textSecondary }}>{loading ? 'Se încarcă…' : 'Niciun tranzacție.'}</Text>}
      />
      <TouchableOpacity onPress={() => router.push('/tranzactii/new')} style={{ position: 'absolute', bottom: 24, right: 24, backgroundColor: Colors[scheme].tint, padding: 16, borderRadius: 32 }}>
        <Text style={{ color: 'white' }}>+ Tranzacție</Text>
      </TouchableOpacity>
    </View>
  );
}
```

Expected: listă funcțională simplă. Va fi rafinată ulterior; aici doar valorificarea hook-ului.

- [ ] **Step 7: Curăță rute moarte în ecranele copiate**

În toate ecranele copiate, caută referințe la rute DOSAR (de ex. `/(tabs)/entitati/...`, `/(tabs)/documente/...`):

```bash
cd /Users/ax/work/finante
grep -rnE "router\.(push|replace).*\((tabs)/(entitati|documente|expirari|setari|index|chat|shared)" app/
```

Expected: pentru fiecare match, înlocuiește cu calea echivalentă în Finanțe (sau șterge butonul dacă nu are sens — ex. nu există ecran „documente" aici). Câteva substituții uzuale:
- `/(tabs)/entitati/financiar` → `/(tabs)`
- `/(tabs)/entitati/financiar/conturi` → `/(tabs)/conturi`
- `/(tabs)/entitati/cont/${id}` → `/(tabs)/conturi/${id}`
- `/(tabs)/entitati/cont/tranzactie` → `/(tabs)/tranzactii/[id]` (sau formular nou)
- `/(tabs)/entitati/categorii` → `/(tabs)/categorii`

- [ ] **Step 8: Curăță referințe la Document → tranzacție**

```bash
cd /Users/ax/work/finante
grep -rnE "source_document_id|getTransactionForDocument|prefill_amount|fromDocument" app/ services/ hooks/
```

Expected: pentru fiecare match, deschide fișierul și șterge codul. În `tranzactii/[id].tsx`, secțiunea care citea `params.source_document_id` și prefill din document **dispare** — formularul rămâne pur tranzacție.

- [ ] **Step 9: Type-check + smoke test**

```bash
cd /Users/ax/work/finante
npx tsc --noEmit
npx expo start --ios
```

Expected: zero erori TS. App pornește, navigarea Sumar/Conturi/Tranzacții/Categorii/Setări funcționează. Adaugă manual un cont, adaugă o tranzacție, vezi-o în listă și în sumar.

- [ ] **Step 10: Commit**

```bash
cd /Users/ax/work/finante
git add -A
git commit -m "feat: copy finance hooks and screens, restructure as standalone tabs"
```

---

## Task 6: Backup/restore în Finanțe

**Files:**
- Create: `/Users/ax/work/finante/services/backup.ts`
- Modify: `/Users/ax/work/finante/app/(tabs)/setari.tsx`

- [ ] **Step 1: Creează `services/backup.ts` minimalist**

NU copia `backup.ts` din DOSAR — are 1028 linii cu entități DOSAR. Scrie unul nou doar pentru Finanțe (~200 linii):

```typescript
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { db } from './db';
import * as financialAccounts from './financialAccounts';
import * as categories from './categories';
import * as transactions from './transactions';
import * as bankStatements from './bankStatements';

const BACKUP_VERSION = 1;

export interface BackupPayload {
  version: number;
  exported_at: string;
  app: 'finante';
  financialAccounts: unknown[];
  expenseCategories: unknown[];
  transactions: unknown[];
  bankStatements: unknown[];
}

export async function exportBackup(): Promise<string> {
  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    app: 'finante',
    financialAccounts: await financialAccounts.getFinancialAccounts(true),
    expenseCategories: await categories.getCategories(true),
    transactions: await transactions.getTransactions({}),
    bankStatements: await bankStatements.getBankStatements(),
  };
  const path = `${FileSystem.documentDirectory}backup-finante-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path);
  }
  return path;
}

export async function importBackup(path: string): Promise<{ imported: number; errors: string[] }> {
  const text = await FileSystem.readAsStringAsync(path);
  const payload = JSON.parse(text) as BackupPayload;
  if (payload.app !== 'finante' || payload.version !== BACKUP_VERSION) {
    throw new Error('Format backup neacceptat (alt app sau versiune diferită).');
  }

  const errors: string[] = [];
  let imported = 0;

  // Conturi
  for (const a of payload.financialAccounts as Array<Record<string, unknown>>) {
    try {
      await financialAccounts.createFinancialAccount({
        name: a.name as string,
        type: (a.type as 'bank') ?? 'bank',
        currency: (a.currency as string) ?? 'RON',
        initial_balance: (a.initial_balance as number) ?? 0,
        iban: a.iban as string | undefined,
        bank_name: a.bank_name as string | undefined,
        color: a.color as string | undefined,
        icon: a.icon as string | undefined,
        notes: a.notes as string | undefined,
      });
      imported++;
    } catch (e) {
      errors.push(`Cont „${a.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // (similar pentru categorii custom, tranzacții, extrase — copiate din backup.ts DOSAR
  //  fără maparea entităților DOSAR; puneti merchantul, datele, sumele așa cum sunt)

  return { imported, errors };
}
```

> **Notă:** completează blocurile pentru `expenseCategories` (skip cele cu `is_system=true`, deja seed-ate), `transactions` (cu remap `account_id`, `category_id` din ID-uri vechi în ID-uri noi prin `Map`-uri ca în DOSAR), `bankStatements`. Logica de remap copiat-o din `/Users/ax/work/documents/app/services/backup.ts` liniile ~600–800 (secțiunile financialAccounts, expenseCategories, transactions, bankStatements), simplificată să nu refere documente/entități DOSAR.

- [ ] **Step 2: Creează `app/(tabs)/setari.tsx` minimalist**

Editează `/Users/ax/work/finante/app/(tabs)/setari.tsx`:

```tsx
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { exportBackup, importBackup } from '@/services/backup';

export default function Settings() {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];

  async function onExport() {
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('Eroare backup', e instanceof Error ? e.message : 'Eroare necunoscută');
    }
  }

  async function onImport() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
    if (res.canceled) return;
    try {
      const result = await importBackup(res.assets[0].uri);
      Alert.alert('Backup importat', `Importat: ${result.imported}. Erori: ${result.errors.length}.`);
    } catch (e) {
      Alert.alert('Eroare import', e instanceof Error ? e.message : 'Eroare necunoscută');
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: palette.background }}>
      <Text style={{ fontSize: 20, fontWeight: '600', color: palette.text, marginBottom: 16 }}>Setări</Text>
      <TouchableOpacity onPress={onExport} style={{ padding: 16, backgroundColor: palette.tint, borderRadius: 8, marginBottom: 12 }}>
        <Text style={{ color: 'white' }}>Export backup</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onImport} style={{ padding: 16, backgroundColor: palette.card, borderRadius: 8 }}>
        <Text style={{ color: palette.text }}>Import backup</Text>
      </TouchableOpacity>
    </View>
  );
}
```

Expected: ecran setări minimal cu export/import. AI provider settings le adaugi ulterior dacă e nevoie (deocamdată merge default Mistral / OpenAI deja în `aiProvider.ts`).

- [ ] **Step 3: Smoke test**

```bash
cd /Users/ax/work/finante
npx expo start --ios
```

Adaugă cont + tranzacție → Setări → Export backup → verifică în Files că JSON-ul s-a creat. Apoi șterge app, reinstalează, Import backup, verifică că datele revin.

- [ ] **Step 4: Commit**

```bash
cd /Users/ax/work/finante
git add -A
git commit -m "feat: backup/restore for finance project"
```

---

## Task 7: Copiere teste relevante în Finanțe

**Files:**
- Copy: 5 fișiere de unit test din DOSAR

- [ ] **Step 1: Configurează Jest în Finanțe**

```bash
cd /Users/ax/work/finante
npm install --save-dev jest @types/jest babel-jest jest-expo @testing-library/react-native
```

Adaugă în `package.json`:

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo"
  }
}
```

Expected: `npm test` rulează (zero teste). Crează `jest.config.js` doar dacă presetul nu e suficient.

- [ ] **Step 2: Copiază fișierele de test**

```bash
mkdir -p /Users/ax/work/finante/__tests__/unit
cp /Users/ax/work/documents/app/__tests__/unit/transactions.test.ts /Users/ax/work/finante/__tests__/unit/
cp /Users/ax/work/documents/app/__tests__/unit/financialAccounts.test.ts /Users/ax/work/finante/__tests__/unit/
cp /Users/ax/work/documents/app/__tests__/unit/categories.test.ts /Users/ax/work/finante/__tests__/unit/
cp /Users/ax/work/documents/app/__tests__/unit/bankStatementParser.test.ts /Users/ax/work/finante/__tests__/unit/
cp /Users/ax/work/documents/app/__tests__/unit/bankStatementPdfParser.test.ts /Users/ax/work/finante/__tests__/unit/
cp /Users/ax/work/documents/app/__tests__/unit/aiStatementVisionMapper.test.ts /Users/ax/work/finante/__tests__/unit/
cp /Users/ax/work/documents/app/__tests__/unit/useCategoryTransactions.test.ts /Users/ax/work/finante/__tests__/unit/
cp -R /Users/ax/work/documents/app/__mocks__ /Users/ax/work/finante/ 2>/dev/null || true
```

Expected: ~7 fișiere copiate.

- [ ] **Step 3: Curăță testele de referințe la fuel/document**

```bash
cd /Users/ax/work/finante
grep -lE "fuel_record_id|source_document_id|getTransactionForDocument" __tests__/unit/*.ts
```

Expected: pentru fiecare match, deschide fișierul și șterge `it(...)` sau `describe(...)`-ul aferent. Dacă elimini ultimul `it` dintr-un `describe`, șterge și `describe`-ul gol.

- [ ] **Step 4: Rulează testele**

```bash
cd /Users/ax/work/finante
npm test
```

Expected: toate testele rămase trec. Dacă pică pe imports lipsă (de ex. mock-uri din DOSAR), fie copiezi mock-ul, fie ștergi testul afectat.

- [ ] **Step 5: Commit**

```bash
cd /Users/ax/work/finante
git add -A
git commit -m "test: copy unit tests for finance services"
```

---

## Task 8: Smoke test integral Finanțe (gate înainte de a atinge DOSAR)

**Files:**
- Read: niciunul (pur validare manuală)

- [ ] **Step 1: Type-check + lint + tests pe Finanțe**

```bash
cd /Users/ax/work/finante
npx tsc --noEmit
npm test
```

Expected: zero erori, toate testele pass.

- [ ] **Step 2: Smoke test manual pe simulator iOS**

```bash
cd /Users/ax/work/finante
npx expo start --ios
```

Verifică:
- [ ] App pornește, app lock se setează (PIN/biometric).
- [ ] Tab Sumar afișează „nicio tranzacție" inițial.
- [ ] Tab Conturi → adaugă cont nou („Test BT", RON, sold inițial 1000).
- [ ] Deschide cont → Adaugă tranzacție manuală (cheltuială 50 RON, categoria Mâncare, descriere „test").
- [ ] Sumar — cheltuielile lunii apar -50, top categorii arată Mâncare.
- [ ] Tab Tranzacții (lista globală) — apare tranzacția.
- [ ] Tab Categorii — vezi cele 14 sistem.
- [ ] Setări → Export backup → JSON-ul se descarcă în Files.
- [ ] Șterge app de pe simulator, reinstalează (`Cmd+Shift+H` → ține apăsat → X), pornește din nou, Setări → Import backup → datele revin.

Expected: toate cele de mai sus trec. Dacă pică, **oprește planul și rezolvă în Finanțe** înainte de a continua. **Nu** atinge DOSAR până nu trece smoke-test-ul.

- [ ] **Step 3: Test import extras CSV (sample)**

Crează un fișier `~/test-extras.csv` cu 3-5 rânduri reale de tranzacții (BT format simplu):

```csv
Data,Descriere,Suma
2026-04-01,Lidl,-87.50
2026-04-02,Salariu,5000.00
2026-04-03,Petrom,-180.00
```

În app: Conturi → cont creat → Import extras → alege fișierul. Expected: 3 tranzacții apar în listă, transferul intern (dacă e cazul) e detectat.

- [ ] **Step 4: Test import extras AI (opțional, dacă ai API key)**

În Setări → AI provider → adaugă cheia Mistral / OpenAI. La import, alege „Trimite la AI". Expected: răspunde cu mapping de tranzacții.

- [ ] **Step 5: Commit „milestone smoke OK"**

```bash
cd /Users/ax/work/finante
git tag v0.1.0-smoke -m "Finanțe rulează standalone cu date reale, înainte de curățarea DOSAR"
```

> **Gate critic:** dacă pasul ăsta nu e verde, **nu trece la Task 9**. Tot ce urmează e curățare DOSAR — un drum cu o singură direcție. Dacă Finanțe nu e funcțional, restaurarea DOSAR-ului din `pre-finance-extract` e singura opțiune.

---

## Task 9: Decuplare `fuel.ts` în DOSAR (scoate auto-tranzacția)

> **Notă context:** după snapshot-ul de la Task 0 Step 2, `services/fuel.ts` are ~490 linii (a crescut de la ~330 prin extensii cu `currency`, `fuel_type`, `station`, `pump_number`, plus tot syncFuelTransaction). Liniile referite în pașii de mai jos sunt aproximative — folosește grep ca să găsești blocurile.

**Files:**
- Modify: `/Users/ax/work/documents/app/services/fuel.ts`
- Modify: `/Users/ax/work/documents/app/types/index.ts` (interface FuelRecord — scoate `account_id`; `currency`, `fuel_type`, `station`, `pump_number` rămân)
- Modify: `/Users/ax/work/documents/app/services/db.ts` (recreate fuel_records fără `account_id`; index `idx_fuel_records_station` pe `station` rămâne)
- Modify: `/Users/ax/work/documents/app/app/(tabs)/entitati/fuel.tsx` (scoate UI-ul de selectare cont)
- Verify (NU șterge): `app/(tabs)/entitati/fuel-stats.tsx`, `components/FuelConsumptionChart.tsx` — sunt pentru auto, dar verifică să nu refere `account_id` sau `transactions`.

- [ ] **Step 1: Verifică toate punctele de cuplaj**

```bash
cd /Users/ax/work/documents/app
grep -nE "account_id|syncFuelTransaction|fuel_record_id" services/fuel.ts types/index.ts services/db.ts app/\(tabs\)/entitati/fuel.tsx
```

Expected: notezi liniile care trebuie atinse.

- [ ] **Step 2: Editează `services/fuel.ts` — șterge `syncFuelTransaction`**

Deschide `/Users/ax/work/documents/app/services/fuel.ts`. Șterge complet:
- Întreaga funcție `syncFuelTransaction` (liniile ~120–196).
- Funcția `getVehicleName` (liniile ~198–204) — e folosită doar de `syncFuelTransaction`, devine moartă.
- Importurile sale (`getCategoryByKey`, `generateId` dacă nu mai e folosit).
- Apelul `syncFuelTransaction` din `insertFuelRecord` (liniile ~252–257) și din `updateFuelRecord` (liniile ~322–330).
- Linia `await db.runAsync('DELETE FROM transactions WHERE fuel_record_id = ?', [id]);` din `deleteFuelRecord` (linia ~264).

Apoi șterge orice referire la `account_id`:
- Din interface `FuelRecord` (liniile ~21, ~38).
- Din `AddFuelRecordInput` (linia ~86).
- Din `UpdateFuelRecordInput` (linia ~278).
- Din `INSERT INTO fuel_records` (`account_id` din coloane și `?` din values + parametrul aferent).
- Din `UPDATE fuel_records` (blocul `if (fields.account_id !== undefined)`).
- Din construcția obiectului return (linia ~239).

```bash
cd /Users/ax/work/documents/app
grep -nE "account_id|syncFuelTransaction|fuel_record_id" services/fuel.ts
```

Expected: zero rezultate.

- [ ] **Step 3: Editează `types/index.ts` — scoate `account_id` din `FuelRecord`**

Caută în `/Users/ax/work/documents/app/types/index.ts` interface-ul `FuelRecord` (sau echivalent). Șterge câmpul `account_id`.

```bash
cd /Users/ax/work/documents/app
grep -nE "account_id" types/index.ts
```

Expected: zero (sau doar referințe la `FinancialAccount.iban` etc., neavând legătură cu fuel).

- [ ] **Step 4: Editează `services/db.ts` — recreate `fuel_records` fără `account_id`**

În `/Users/ax/work/documents/app/services/db.ts`, modifică migrația de fuel_records (liniile ~553–620). Schimbă condiția `needsRecreate` să detecteze și prezența `account_id`:

```typescript
const needsRecreate =
  (vehicleCol !== undefined && vehicleCol.notnull === 1) ||
  cols.some(c => c.name === 'account_id'); // legacy din extragere finanțe

if (needsRecreate) {
  db.execSync(`
    CREATE TABLE fuel_records_v2 (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT,
      date TEXT NOT NULL,
      liters REAL,
      km_total INTEGER,
      price REAL,
      currency TEXT NOT NULL DEFAULT 'RON',
      fuel_type TEXT,
      is_full INTEGER NOT NULL DEFAULT 1,
      station TEXT,
      pump_number TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO fuel_records_v2 (id, vehicle_id, date, liters, km_total, price, currency, fuel_type, is_full, station, pump_number, created_at)
    SELECT id, vehicle_id, date, liters, km_total, price,
           COALESCE(currency, 'RON'),
           fuel_type, COALESCE(is_full, 1), station, pump_number, created_at
    FROM fuel_records;
    DROP TABLE fuel_records;
    ALTER TABLE fuel_records_v2 RENAME TO fuel_records;
  `);
}
```

De asemenea șterge index-ul `idx_fuel_records_account` (linia ~616) și `ALTER TABLE fuel_records ADD COLUMN account_id` (linia ~590).

- [ ] **Step 5: Editează `app/(tabs)/entitati/fuel.tsx` — scoate UI-ul de cont**

```bash
cd /Users/ax/work/documents/app
grep -nE "account_id|financialAccounts|FinancialAccount" app/\(tabs\)/entitati/fuel.tsx
```

Pentru fiecare match, șterge:
- Importurile către `@/services/financialAccounts` și `@/hooks/useFinancialAccounts` (acestea oricum dispar la Task 12).
- State-ul pentru `selectedAccountId`.
- Render-ul de selector de cont.
- Pasarea lui `account_id` în `addFuelRecord` / `updateFuelRecord`.

Expected după editare: `grep` returnează zero. Ecranul rămâne funcțional cu data, vehicul, litri, km, preț, fuel type, pump — fără cont.

- [ ] **Step 6: Update teste fuel**

```bash
cd /Users/ax/work/documents/app
ls __tests__/unit/ | grep -i fuel
```

Dacă există `fuel.test.ts`, deschide-l și șterge testele care asertau crearea de tranzacții la insert. Cele care testează doar inserarea fuel record + calculul de consum rămân.

- [ ] **Step 7: Type-check + test**

```bash
cd /Users/ax/work/documents/app
npx tsc --noEmit
npm test
```

Expected: erorile rămase sunt doar la fișierele care încă fac referire la finanțe (transactions.ts etc.) — le rezolvăm în Task 10–11. Dar testele pentru `fuel` și pentru orice nu folosește finanțe trebuie să treacă.

> **Atenție:** ai erori TS multe în acest moment. NU rula type-check ca gate aici. Doar verifică că `fuel.ts`, `fuel.tsx` și testele lor nu au erori de structură.

- [ ] **Step 8: Commit (chiar dacă proiectul e încă rupt)**

```bash
cd /Users/ax/work/documents
git add app/services/fuel.ts app/types/index.ts app/services/db.ts app/app/\(tabs\)/entitati/fuel.tsx app/__tests__/unit/fuel.test.ts 2>/dev/null
git commit -m "refactor(fuel): drop auto-transaction creation and account_id"
```

---

## Task 10: Șterge ecranele financiare din DOSAR

**Files:**
- Delete: `app/(tabs)/entitati/financiar/` (tot folderul)
- Delete: `app/(tabs)/entitati/cont/` (tot folderul)
- Delete: `app/(tabs)/entitati/categorii.tsx`

- [ ] **Step 1: Șterge folderele**

```bash
cd /Users/ax/work/documents/app
rm -rf app/\(tabs\)/entitati/financiar
rm -rf app/\(tabs\)/entitati/cont
rm app/\(tabs\)/entitati/categorii.tsx
```

Expected: 9+ fișiere șterse.

- [ ] **Step 2: Verifică rute moarte rămase**

```bash
cd /Users/ax/work/documents/app
grep -rnE "/\(tabs\)/entitati/(financiar|cont|categorii)|entitati/cont/tranzactie" app/ components/ --include="*.tsx" --include="*.ts"
```

Expected: notezi unde rămân. Toate vor fi rezolvate la Task 11.

- [ ] **Step 3: Commit**

```bash
cd /Users/ax/work/documents
git add -A
git commit -m "refactor: remove finance screens from DOSAR"
```

---

## Task 11: Curățare UI DOSAR (Home, Onboarding, Setări, Document detail, alte fișiere)

**Files:**
- Modify: `app/(tabs)/index.tsx` (Home — scoate cardul FINANCIAR)
- Modify: `components/OnboardingWizard.tsx` (scoate pasul EXPENSES)
- Modify: `app/(tabs)/setari.tsx` (scoate toggle + categorii + link FINANCE_AI_IMPORT_URL)
- Modify: `app/(tabs)/documente/[id].tsx` (scoate butoane „Adaugă ca cheltuială" / „Adaugă tranzacție")
- Modify: `app/(tabs)/documente/add.tsx` (verifică referințe finance — probabil prefill_amount)
- Modify: `app/(tabs)/documente/edit.tsx` (verifică — modificat în WIP, posibil cuplaj cu cont)
- Modify: `app/(tabs)/entitati/_layout.tsx` (verifică — listă tipuri de entități, scoate `financial_account`)
- Modify: `app/(tabs)/entitati/add.tsx` (verifică — selector tip entitate)
- Modify: `app/(tabs)/entitati/index.tsx` (verifică — listă entități pe categorie)
- Modify: `app/(tabs)/expirari.tsx` (verifică — modificat în WIP, posibil cuplaj cu tranzacții abonament)
- Modify: `app/(tabs)/chat.tsx` (verifică — context chatbot, posibil pasare `financeHubActive`)
- Modify: `app/(tabs)/_layout.tsx` (verifică — bottom tabs, posibil tab Financiar)
- Modify: `hooks/useEntities.ts` (verifică — include `financial_account` ca tip)
- Modify: `hooks/useVisibilitySettings.ts` (verifică — toggle vizibilitate `financial_account`)
- Modify: `services/aiProvider.ts` (verifică — modificat în WIP, posibil pasare context finanțe)
- Modify: `services/aiOcrMapper.ts` (verifică — modificat în WIP, posibil mapare amount → tranzacție)
- Modify: `services/ocr.ts` (verifică — modificat în WIP, posibil parsing extras)
- Modify: `services/documents.ts` (verifică — modificat în WIP, posibil sincronizare cu transactions)
- Modify: `__tests__/setup.ts`, `__tests__/smoke/services.test.ts`, `__tests__/unit/fuel.test.ts` (mock-uri DB + smoke + fuel — scoate finanțe)
- Modify: `scripts/update-site.js` (scoate generare conținut pentru finanțe)
- Modify: `docs/index.html`, `docs/support.html` (scoate mențiuni de finanțe)
- Delete: `docs/gestiune-financiara.html` (deja copiat în Finanțe la Task 5)
- Modify: `constants/AppLinks.ts` (șterge FINANCE_AI_IMPORT_URL)
- Modify: `README.md` (modificat în WIP, scoate mențiuni hub finanțe)

> **Pentru fiecare fișier de tip „verifică"**, pattern-ul este:
> ```bash
> grep -nE "financial_account|FinancialAccount|transaction|tranzac|expense_categor|ExpenseCategor|cont/tranzactie|entitati/financiar|entitati/cont" <fișier>
> ```
> Pentru fiecare match: șterge import-ul/state-ul/JSX-ul aferent. Dacă fișierul nu are match (modificat doar pentru altceva, ex. fix de tema), lasă-l așa.

- [ ] **Step 1: Curăță `app/(tabs)/index.tsx`**

```bash
cd /Users/ax/work/documents/app
grep -nE "financeHubActive|FINANCIAR|financialAccounts|monthlyTotals|entitati/financiar|cont/tranzactie" app/\(tabs\)/index.tsx
```

Pentru fiecare match (estimat liniile ~284, ~357–373, ~518–586):
- Șterge `const financeHubActive = ...`.
- Șterge memo-ul / state-ul `monthlyTotals` și hook-ul aferent (`useMonthlyAnalysis`, `useFinancialAccounts`).
- Șterge blocul JSX de la `{/* ── Financiar ── */}` până la închiderea cardului.
- Șterge butonul de „Tranzacție rapidă".

Verifică:
```bash
grep -nE "financeHubActive|financiar|monthlyTotals" app/\(tabs\)/index.tsx
```

Expected: zero.

- [ ] **Step 2: Curăță `components/OnboardingWizard.tsx`**

```bash
cd /Users/ax/work/documents/app
grep -nE "EXPENSES|expensesEnabled|Cheltuieli generale|ExpenseCategory|financialAccounts|Evidență cheltuieli" components/OnboardingWizard.tsx
```

Șterge pasul EXPENSES complet:
- Constanta `const EXPENSES = 4` (linia ~49); reindexează pașii ulteriori.
- Case-urile `case EXPENSES` (liniile ~103, ~132).
- State-urile `expensesEnabled`, `systemCategories`.
- Logica de `EXPENSES` în array-ul `steps` (linia ~188).
- Blocul de creare automată „Cheltuieli generale" (liniile ~270–290).
- Render JSX `{step === EXPENSES && ...}` (liniile ~579–636).
- Linia din summary „Evidență cheltuieli" (~1010).
- Item-ul din EntityType array `'financial_account'` din `expensesEnabled ? ... : ...` (linia ~274).
- Importul `import type { ExpenseCategory } from '@/types';`.

Verifică:
```bash
grep -nE "EXPENSES|expensesEnabled|Cheltuieli generale|financialAccounts" components/OnboardingWizard.tsx
```

Expected: zero.

- [ ] **Step 3: Curăță `app/(tabs)/setari.tsx`**

```bash
cd /Users/ax/work/documents/app
grep -nE "financial_account|FINANCE_AI_IMPORT_URL|Gestiune financiară|expense_categories|expenseCategories|tranzactii" app/\(tabs\)/setari.tsx
```

Șterge:
- Importul `FINANCE_AI_IMPORT_URL` din `@/constants/AppLinks`.
- Linia `financial_account: 'Gestiune financiară'` din maparea `ENTITY_TYPE_LABELS` locală (~linia 60).
- Întregul bloc de „dezactivează gestiunea financiară" cu Alert (~liniile 427–470).
- Orice secțiune UI legată de hub financiar / gestionare categorii / link „cum import extras".

Verifică:
```bash
grep -nE "financial_account|FINANCE_AI_IMPORT_URL|Gestiune financiară" app/\(tabs\)/setari.tsx
```

Expected: zero.

- [ ] **Step 4: Curăță `app/(tabs)/documente/[id].tsx`**

```bash
cd /Users/ax/work/documents/app
grep -nE "getTransactionForDocument|existingTx|cont/tranzactie|prefill_amount|Adaugă ca cheltuială|Adaugă tranzacție|Vezi tranzacția" app/\(tabs\)/documente/\[id\].tsx
```

Șterge:
- Importul `import { getTransactionForDocument } from '@/services/transactions';`.
- Importul `Transaction` din `@/types` (dacă era folosit doar aici — verifică restul fișierului).
- State-ul `existingTx`.
- Apelul `getTransactionForDocument(id)`.
- Tot blocul JSX cu butoanele „Adaugă ca cheltuială" / „Vezi tranzacția" (liniile ~1215–1265).
- Logica `amountRaw`, `cleaned`, `amountNum`, `hasAmount` (dacă era folosită doar pentru tranzacție).

> **ATENȚIE:** `doc.metadata.amount` rămâne afișat ca info pe document (decizia B). Nu șterge afișarea sumei dacă există în alt context — doar butonul „Adaugă tranzacție". Verifică cu atenție.

Verifică:
```bash
grep -nE "getTransactionForDocument|existingTx|cont/tranzactie|prefill_amount" app/\(tabs\)/documente/\[id\].tsx
```

Expected: zero.

- [ ] **Step 5: Curăță `app/(tabs)/documente/add.tsx`**

```bash
cd /Users/ax/work/documents/app
grep -nE "financial_account|account_id|tranzactie|prefill_amount" app/\(tabs\)/documente/add.tsx
```

Pentru fiecare match (probabil legarea documentului de un cont la save), șterge. Câmpul `metadata.amount` rămâne — DOSAR îl tratează doar ca informație.

- [ ] **Step 6: Curăță `constants/AppLinks.ts`**

```bash
cd /Users/ax/work/documents/app
grep -n "FINANCE_AI_IMPORT_URL" constants/AppLinks.ts
```

Șterge linia cu constanta.

- [ ] **Step 6b: Curăță restul fișierelor modificate cu cuplaj finanțe**

Pentru fiecare fișier din lista de mai jos, rulează grep-ul și șterge codul finanțe:

```bash
cd /Users/ax/work/documents/app
for f in app/\(tabs\)/documente/edit.tsx \
         app/\(tabs\)/entitati/_layout.tsx \
         app/\(tabs\)/entitati/add.tsx \
         app/\(tabs\)/entitati/index.tsx \
         app/\(tabs\)/expirari.tsx \
         app/\(tabs\)/chat.tsx \
         app/\(tabs\)/_layout.tsx \
         hooks/useEntities.ts \
         hooks/useVisibilitySettings.ts \
         services/aiProvider.ts \
         services/aiOcrMapper.ts \
         services/ocr.ts \
         services/documents.ts; do
  echo "=== $f ==="
  grep -nE "financial_account|FinancialAccount|@/services/(transactions|categories|financialAccounts|bankStatements|fxRates)|@/hooks/(useTransactions|useCategories|useFinancialAccounts|useMonthlyAnalysis)|cont/tranzactie|entitati/financiar|entitati/cont|expense_categor|ExpenseCategor|prefill_amount|getTransactionForDocument|financeHubActive" "$f" 2>/dev/null
done
```

Pentru fiecare match: deschide fișierul și șterge linia/blocul aferent. La final:
```bash
grep -rnE "financial_account|FinancialAccount|@/services/(transactions|categories|financialAccounts|bankStatements|fxRates)|@/hooks/(useTransactions|useCategories|useFinancialAccounts|useMonthlyAnalysis)" \
  app/ components/ hooks/ services/ --include="*.ts" --include="*.tsx" | grep -v __tests__
```

Expected: zero rezultate (în afara de fișierele care vor fi șterse la Task 12).

- [ ] **Step 6c: Curăță tests setup + smoke**

```bash
cd /Users/ax/work/documents/app
grep -nE "financial_account|FinancialAccount|categories|transactions|bankStatement|expense_categor" \
  __tests__/setup.ts __tests__/smoke/services.test.ts __tests__/unit/fuel.test.ts
```

Pentru fiecare match: editează fișierul și șterge mock-urile / aserțiunile financiare.

- [ ] **Step 6d: Curăță site-ul de prezentare (`docs/`)**

```bash
cd /Users/ax/work/documents/app
grep -nE "financ|tranzac|cheltuieli|venit|extras bancar|categorie|hub" docs/index.html docs/support.html
```

Pentru fiecare match: editează HTML-ul, scoate secțiunile finanțe. **Nu** atinge `docs/gestiune-auto.html` — rămâne.

```bash
grep -nE "financ|tranzac|cheltuieli|gestiune-financiara" scripts/update-site.js
```

Editează `scripts/update-site.js`: șterge orice marker / categorie HTML care injectează conținut financiar.

Apoi șterge pagina dedicată finanțe din DOSAR (e deja în Finanțe după Task 5):
```bash
rm /Users/ax/work/documents/app/docs/gestiune-financiara.html
```

- [ ] **Step 6e: Curăță `README.md`**

```bash
cd /Users/ax/work/documents/app
grep -nE "financ|tranzac|cheltuieli|hub" README.md
```

Pentru fiecare match: editează README-ul, scoate mențiunea (sau adaugă „Pentru gestiunea cheltuielilor, vezi proiectul separat Finanțe la `/Users/ax/work/finante/`.").

- [ ] **Step 7: Type-check (NU lint încă, sunt prea multe imports rupte)**

```bash
cd /Users/ax/work/documents/app
npx tsc --noEmit 2>&1 | head -50
```

Expected: erorile rămase trebuie să fie DOAR la imports către servicii care vor fi șterse la Task 12. Dacă vezi erori în `index.tsx`, `OnboardingWizard.tsx`, `setari.tsx`, `documente/[id].tsx` — sunt curățări incomplete; revino.

- [ ] **Step 8: Commit**

```bash
cd /Users/ax/work/documents
git add -A
git commit -m "refactor: strip finance UI from DOSAR (home, onboarding, settings, doc detail)"
```

---

## Task 12: Șterge servicii și hooks financiare din DOSAR

**Files:**
- Delete servicii: `transactions.ts`, `financialAccounts.ts`, `categories.ts`, `bankStatements.ts`, `bankStatementParser.ts`, `bankStatementPdfParser.ts`, `aiStatementMapper.ts`, `aiStatementVisionMapper.ts`, `fxRates.ts`, `financeHubMigration.ts`
- Delete hooks: `useTransactions.ts`, `useCategories.ts`, `useFinancialAccounts.ts`, `useMonthlyAnalysis.ts`, `useCategoryTransactions.ts`
- Delete teste: `transactions.test.ts`, `financialAccounts.test.ts`, `categories.test.ts`, `bankStatementParser.test.ts`, `bankStatementPdfParser.test.ts`, `aiStatementVisionMapper.test.ts`, `useCategoryTransactions.test.ts`

- [ ] **Step 1: Confirmă că nimic nu mai folosește serviciile**

```bash
cd /Users/ax/work/documents/app
grep -rlE "@/services/(transactions|financialAccounts|categories|bankStatements|bankStatementParser|bankStatementPdfParser|aiStatementMapper|aiStatementVisionMapper|fxRates|financeHubMigration)" services/ hooks/ app/ components/ --include="*.ts" --include="*.tsx" | grep -v __tests__
```

Expected: zero rezultate. Dacă apar fișiere, sunt cuplaje rămase din Task 11 — întoarce-te.

> **Excepție:** `services/backup.ts` încă referă `financialAccounts`, `categories` — îl curățăm la Task 13.

- [ ] **Step 2: Confirmă că nimic nu mai folosește hooks**

```bash
cd /Users/ax/work/documents/app
grep -rlE "@/hooks/(useTransactions|useCategories|useFinancialAccounts|useMonthlyAnalysis|useCategoryTransactions)" services/ hooks/ app/ components/ --include="*.ts" --include="*.tsx" | grep -v __tests__
```

Expected: zero rezultate.

- [ ] **Step 3: Șterge serviciile**

```bash
cd /Users/ax/work/documents/app
rm services/transactions.ts
rm services/financialAccounts.ts
rm services/categories.ts
rm services/bankStatements.ts
rm services/bankStatementParser.ts
rm services/bankStatementPdfParser.ts
rm services/aiStatementMapper.ts
rm services/aiStatementVisionMapper.ts
rm services/fxRates.ts
rm services/financeHubMigration.ts
```

Expected: 10 fișiere șterse.

- [ ] **Step 4: Șterge hook-urile**

```bash
cd /Users/ax/work/documents/app
rm hooks/useTransactions.ts
rm hooks/useCategories.ts
rm hooks/useFinancialAccounts.ts
rm hooks/useMonthlyAnalysis.ts
rm hooks/useCategoryTransactions.ts
```

Expected: 5 fișiere șterse.

- [ ] **Step 5: Șterge testele**

```bash
cd /Users/ax/work/documents/app
rm __tests__/unit/transactions.test.ts
rm __tests__/unit/financialAccounts.test.ts
rm __tests__/unit/categories.test.ts
rm __tests__/unit/bankStatementParser.test.ts
rm __tests__/unit/bankStatementPdfParser.test.ts
rm __tests__/unit/aiStatementVisionMapper.test.ts
rm __tests__/unit/useCategoryTransactions.test.ts
```

Expected: 7 fișiere șterse.

- [ ] **Step 6: Commit**

```bash
cd /Users/ax/work/documents
git add -A
git commit -m "refactor: delete finance services, hooks, and tests from DOSAR"
```

---

## Task 13: Curățare `backup.ts` și `chatbot.ts` / `appKnowledge.ts` în DOSAR

**Files:**
- Modify: `services/backup.ts` (scoate financial entities din export/import)
- Modify: `services/chatbot.ts` (scoate parametrul `financeHubActive`, secțiunea `=== DATE FINANCIARE ===` etc.)
- Modify: `services/appKnowledge.ts` (scoate `FINANCE_KNOWLEDGE`, `FINANCE_DISABLED_NOTICE`, parametrul `financeHubActive`)
- Modify: `types/index.ts` (scoate tipurile financiare + `'financial_account'` din `EntityType`)

- [ ] **Step 1: Curăță `services/backup.ts`**

```bash
cd /Users/ax/work/documents/app
grep -nE "financialAccounts|categories\.|bankStatements|FinancialAccount|ExpenseCategory|Transaction|financial_account|expense_categor" services/backup.ts | head -40
```

Pentru fiecare match:
- Șterge importurile către serviciile șterse.
- Șterge import-urile de tipuri (`FinancialAccount`, `ExpenseCategory`, `Transaction`, `BankStatement`, `TransactionSource`, `FinancialAccountType`).
- Șterge câmpurile din payload-ul de export (`financialAccounts`, `expenseCategories`, `transactions`, `bankStatements`).
- Șterge ramurile de la import (~liniile 426–760 pe varianta DOSAR — secțiunile aferente).
- Șterge `financialAccountMap`, `categoryMap`, etc.
- Șterge linia `else if (entityType === 'financial_account') newId = financialAccountMap.get(oldId);` (linia ~666).

Verifică:
```bash
grep -nE "financialAccounts|categories\.|bankStatements|FinancialAccount|ExpenseCategory|financial_account" services/backup.ts
```

Expected: zero.

- [ ] **Step 2: Curăță `services/chatbot.ts`**

```bash
cd /Users/ax/work/documents/app
grep -nE "financeHubActive|FINANCE_KNOWLEDGE|DATE FINANCIARE|transaction|financial|tranzac|categor" services/chatbot.ts | head -40
```

Pentru fiecare match:
- Scoate parametrul `financeHubActive` din funcțiile care îl primesc; default-ul devine fără knowledge financiar.
- Șterge orice secțiune care construiește contextul financiar (`=== DATE FINANCIARE ===`, etc.).
- Șterge importurile către `getTransactions`, `getFinancialAccounts`, etc.

- [ ] **Step 3: Curăță `services/appKnowledge.ts`**

Editează `/Users/ax/work/documents/app/services/appKnowledge.ts`:

```typescript
import { DOCUMENT_TYPE_LABELS } from '@/types';

const DOC_CATEGORIES: { label: string; types: string[] }[] = [
  // ... (PĂSTREAZĂ tot, inclusiv categoria 'Financiare' care grupează factură, bon, abonament — sunt documente DOSAR, nu finanțe-app)
];

function buildDocTypesList(): string {
  // ... (păstrează identic)
}

export function buildAppKnowledge(): string {
  return `Ești asistentul aplicației „Dosar" — app mobilă locală (fără cloud) pentru documente personale. Răspunzi în română, concis.

**Entități:** Persoane, Vehicule, Proprietăți, Carduri bancare (fără CVV), Animale, Firme/PFA.

**Tipuri de documente:**
${buildDocTypesList()}

**Funcții:** scanare + OCR on-device, notificări expirare, remindere în calendar iOS, backup iCloud/Drive, blocare Face ID/PIN, detecție automată duplicate, câmp „Notă privată" per document pentru date sensibile (CVV/PIN/parole) care NU ajunge niciodată la AI, reminder mentenanță vehicule (km sau timp) cu sincronizare calendar.

## Gestiune auto

Vezi secțiunea „Vehicule" și „Mentenanță vehicule" mai jos. Pe scurt: dosar complet per mașină (talon, RCA, ITP, CASCO, vignetă, revizie), alimentări cu calcul consum „plin la plin", mentenanță programată cu prag dual km/luni, sincronizare opțională în Calendar iOS.

**Date despre vehicule disponibile la cerere:** când utilizatorul întreabă despre carburant, consum, kilometraj, alimentări, benzinărie, mentenanțe, service, revizii sau pragurile lor — primești în context o secțiune „=== DATE VEHICULE ===" cu sumare relevante. Pentru detalii pe un anumit vehicul, sugerează utilizatorului să folosească @mențiune.

## Vehicule

(... păstrează secțiunea identic din originalul fișierului, fără modificări ...)

## Mentenanță vehicule

(... păstrează secțiunea identic ...)

## Reguli

- Nu recomanda alte aplicații pentru documente — explică întotdeauna cum se face în Dosar.
- Document inexistent predefinit → folosește „Altele" sau tip personalizat.
- Pentru date strict sensibile (CVV card, PIN, parole) → recomandă câmpul „Notă privată" din ecranul documentului. Este separat de „Notă" normal și NU ajunge la AI.
- Bazează-te doar pe datele utilizatorului de mai jos; nu inventa.
- Când menționezi un document specific, include ID-ul în format [ID:xxx].
- NU ai acces la conținutul „Notă privată" al niciunui document.`;
}
```

> **Cheia:** scos parametrul `financeHubActive`; scoasă `FINANCE_KNOWLEDGE`, `FINANCE_DISABLED_NOTICE`, „Conturi financiare" din lista de entități, mențiunile de tranzacții la alimentări. Păstrate „Vehicule", „Mentenanță vehicule" identic.

- [ ] **Step 4: Curăță `types/index.ts`**

```bash
cd /Users/ax/work/documents/app
grep -nE "FinancialAccount|ExpenseCategory|Transaction|BankStatement|CategoryKey|TransactionSource|financial_account" types/index.ts
```

Șterge:
- `FinancialAccountType` și `FinancialAccount` și `FINANCIAL_ACCOUNT_TYPE_LABELS` (liniile ~100–131).
- `CategoryKey` și `ExpenseCategory` (liniile ~133–161).
- `TransactionSource` și `Transaction` (liniile ~163–207).
- `BankStatement` (liniile ~209–222).
- Orice `'financial_account'` din `EntityType` union (caută separat: `grep -n "EntityType" types/index.ts`).

Verifică:
```bash
grep -nE "FinancialAccount|ExpenseCategory|Transaction|BankStatement|financial_account" types/index.ts
```

Expected: zero.

- [ ] **Step 5: Curăță `services/db.ts`**

```bash
cd /Users/ax/work/documents/app
grep -nE "financial_accounts|expense_categories|transactions|bank_statements|fx_rates|financial_account_id|cat-sys-" services/db.ts | head -30
```

Editează `/Users/ax/work/documents/app/services/db.ts`:
- Șterge blocul `CREATE TABLE IF NOT EXISTS financial_accounts ... bank_statements` și toate index-urile aferente (liniile ~431–511).
- Șterge migrația `ALTER TABLE transactions ADD COLUMN source_document_id` (liniile ~513–525).
- Șterge seed-ul de categorii sistem (liniile ~527–551).
- Șterge tabelul `fx_rates` (liniile ~626 etc.).
- Șterge `ALTER TABLE documents ADD COLUMN financial_account_id` (liniile ~200–212) — coloana rămâne în DB-urile existente, dar nu mai e adăugată proactiv. Adaugă o migrație de drop coloană (recreate `documents` fără `financial_account_id`):

```typescript
// Migrare drop financial_account_id după extragerea hub-ului în proiect separat
try {
  const docCols = db.getAllSync<{ name: string }>("PRAGMA table_info('documents')");
  if (docCols.some(c => c.name === 'financial_account_id')) {
    // Recreate without financial_account_id
    db.execSync(`
      CREATE TABLE documents_v2 AS SELECT
        id, name, type, file_path, issue_date, expiry_date, notes, private_notes,
        person_id, property_id, vehicle_id, card_id, animal_id, company_id,
        is_shared, created_at, updated_at, metadata, custom_type_id
      FROM documents;
      DROP TABLE documents;
      ALTER TABLE documents_v2 RENAME TO documents;
    `);
    // Recreate index-uri pentru documents
    db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_person ON documents(person_id)');
    db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_property ON documents(property_id)');
    db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_vehicle ON documents(vehicle_id)');
    db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_card ON documents(card_id)');
    db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_animal ON documents(animal_id)');
    db.execSync('CREATE INDEX IF NOT EXISTS idx_docs_company ON documents(company_id)');
  }
} catch (e) {
  // best-effort
  // eslint-disable-next-line no-console
  console.warn('[db] migrare drop financial_account_id:', e);
}
```

> **ATENȚIE:** lista de coloane din `SELECT` trebuie să fie EXACT cele care există în `documents` (verifică cu `grep -nE "CREATE TABLE IF NOT EXISTS documents" services/db.ts -A 20`). Dacă diferă, ajustează.

- Adaugă o migrație de drop a tabelelor financiare orfane (în cazul în care DB existentă le mai conține):

```typescript
try {
  db.execSync('DROP TABLE IF EXISTS financial_accounts');
  db.execSync('DROP TABLE IF EXISTS expense_categories');
  db.execSync('DROP TABLE IF EXISTS transactions');
  db.execSync('DROP TABLE IF EXISTS bank_statements');
  db.execSync('DROP TABLE IF EXISTS fx_rates');
} catch (e) {
  // best-effort cleanup
}
```

- [ ] **Step 6: Type-check final**

```bash
cd /Users/ax/work/documents/app
npx tsc --noEmit
```

Expected: **zero erori**. Dacă apar, sunt referințe orfane încă neînlăturate — rezolvă-le punctual.

- [ ] **Step 7: Lint**

```bash
cd /Users/ax/work/documents/app
npm run lint
```

Expected: zero erori. Eventuale warnings sunt OK; erori — nu.

- [ ] **Step 8: Test**

```bash
cd /Users/ax/work/documents/app
npm test
```

Expected: toate testele rămase trec.

- [ ] **Step 9: Commit**

```bash
cd /Users/ax/work/documents
git add -A
git commit -m "refactor: drop finance types, schema, and AI knowledge from DOSAR"
```

---

## Task 14: Validare integrală DOSAR + commit final

**Files:**
- Read: niciunul (validare completă)

- [ ] **Step 1: Type-check + lint + test**

```bash
cd /Users/ax/work/documents/app
npm run type-check
npm run lint
npm test
```

Expected: toate verde.

- [ ] **Step 2: Smoke test pe simulator iOS**

```bash
cd /Users/ax/work/documents/app
npx expo start --ios --clear
```

Verifică:
- [ ] App pornește, app lock funcționează.
- [ ] Onboarding (la prima pornire pe simulator nou): are pașii Persoane, Proprietăți, Vehicule, Carduri, Animale, Firme — **NU** are pasul „Evidență cheltuieli". Numărul de pași afișat în UI e corect.
- [ ] Home: nu mai e cardul „FINANCIAR" / „Cheltuieli luna asta". Doar expirări, entități, acțiuni rapide.
- [ ] Entități: nu mai apare „Gestiune financiară" în lista de tipuri. Doar Persoane, Proprietăți, Vehicule, Carduri, Animale, Firme.
- [ ] Vehicul → adaugă o alimentare (data, litri, km, preț, fuel type) → consumul se calculează. **NU** e selector de cont. **NU** apare nicăieri tranzacția.
- [ ] Document detail (deschide un bon de cumpărături sau factură): se afișează `metadata.amount` ca info (dacă e setat), dar **NU** mai apare butonul „Adaugă ca cheltuială" / „Adaugă tranzacție" / „Vezi tranzacția".
- [ ] Setări: nu mai e toggle „Gestiune financiară". Nu mai e link „Cum import extras la AI".
- [ ] Setări → Backup → exportă JSON → deschide-l într-un text editor → verifică că NU conține câmpurile `financialAccounts`, `expenseCategories`, `transactions`, `bankStatements`. Doar `persons`, `properties`, `vehicles`, `cards`, `animals`, `companies`, `documents`, `customDocumentTypes`, `entityOrder`, `chatThreads`, `vehicleMaintenanceTasks`, `fuelRecords`.
- [ ] Setări → Restore: alege un backup vechi (care AVEA secțiuni financiare). Restore-ul ar trebui să le ignore silently (nu să crape). Datele non-financiare se importă normal.
- [ ] Chatbot: întreabă „cât am cheltuit luna asta?" → AI răspunde că nu cunoaște finanțe (sau redirectează spre „Finanțe"). NU să răspundă cu date inventate.

- [ ] **Step 3: Test cu DB existent (migrare drop coloane/tabele)**

Pentru a verifica migrația:
- Dacă ai un DB de pe device-ul tău din înainte de extragere, instalează app-ul nou pe acel device, deschide-l. App ar trebui să pornească fără să crape; tabelele financiare să fie drop-uite la pornire; coloana `financial_account_id` din `documents` și `account_id` din `fuel_records` să dispară.
- Pe simulator nou (DB curat), totul merge default.

- [ ] **Step 4: Commit final**

```bash
cd /Users/ax/work/documents
git status
git tag post-finance-extract -m "DOSAR curat după extragerea hub-ului finanțe în proiect separat"
git log --oneline -10
```

Expected: tag creat, log curat.

- [ ] **Step 5: README în ambele proiecte**

Editează `/Users/ax/work/documents/app/README.md` (dacă e cazul) — scoate orice mențiune de „Gestiune financiară" / „Hub financiar" / „Tranzacții".

Creează `/Users/ax/work/finante/README.md` minimalist:

```markdown
# Finanțe — gestiune cheltuieli & venituri

Aplicație mobilă (React Native + Expo) pentru evidența cheltuielilor, veniturilor și tranzacțiilor pe categorii și conturi. AI-powered import de extrase bancare (PDF/CSV).

## Arhitectură

- **Local-first:** SQLite pe device, fără backend, fără cont online.
- **Backup:** JSON la iCloud Drive / Google Drive prin `expo-sharing`.
- **App lock:** Face ID / Touch ID / PIN.
- **AI provider:** Mistral / OpenAI configurabili (cheia rămâne local).

## Comenzi

```bash
npm start
npm run ios
npm run type-check
npm test
```

## Origine

Extras din proiectul [Dosar](../documents/) la 2026-04-25 ca aplicație separată; vezi planul `docs/superpowers/plans/2026-04-25-extragere-finante-proiect-nou.md` din DOSAR pentru context complet.
```

Commit-ul de README:

```bash
cd /Users/ax/work/finante
git add README.md
git commit -m "docs: README"
```

---

## Self-Review

**Spec coverage:**
- ✅ Decizia A (două proiecte separate) → Task 1 scaffold + Task 2-7 copiere fără monorepo
- ✅ Decizia B (`metadata.amount` rămâne pe bonuri DOSAR) → Task 11 Step 4 explicit nu șterge afișarea sumei, doar butonul de tranzacție
- ✅ Decizia C (fuel pierde auto-tranzacția) → Task 9 complet
- ✅ Gate de smoke test înainte de a atinge DOSAR → Task 8 explicit
- ✅ Migrare DB DOSAR (drop tabele + coloane orfane) → Task 13 Step 5
- ✅ Backup DOSAR scos de finanțe → Task 13 Step 1
- ✅ Knowledge AI DOSAR scos de finanțe → Task 13 Step 3
- ✅ Onboarding fără pas EXPENSES → Task 11 Step 2

**Placeholder scan:**
- Task 6 Step 1 are `// (similar pentru categorii custom, tranzacții, extrase ...)` — risc de placeholder. **Justificare:** copiem logică din `backup.ts` DOSAR liniile ~600–800 cu adaptări mecanice (scoate `documentEntityMap`, păstrează `categoryMap`/`accountMap`). Pentru un agent care execută planul, indicația e suficient de specifică (linii sursă concrete + ce să scoată). Acceptat.
- Task 11 Step 5 (`documente/add.tsx`) zice „pentru fiecare match, șterge" — nu am liniile exacte (nu le-am citit). **Justificare:** este step de tip „grep apoi rezolvă" — pattern-ul e clar și fișierul e mic; risc minim. Dacă agent-ul găsește 0 match-uri, OK; dacă găsește, le rezolvă. Acceptat.

**Type consistency:**
- `Transaction` în Finanțe nu are `fuel_record_id` și `source_document_id`; `Transaction` din DOSAR e șters complet. ✅
- `FuelRecord` în DOSAR pierde `account_id`. ✅
- `Document` în DOSAR pierde `financial_account_id` (prin migrare DB) — TS interface-ul nu îl avea explicit (era doar coloană SQLite via `metadata`?), verifică la implementare cu `grep "financial_account_id" types/index.ts`. Dacă apare, șterge.
- `EntityType` în DOSAR pierde `'financial_account'` ✅

**Gaps identificate:**
- Niciuna critică. Planul e executabil end-to-end.

---

## Execution Handoff

Plan complet și salvat la `app/docs/superpowers/plans/2026-04-25-extragere-finante-proiect-nou.md`. Două opțiuni de execuție:

**1. Subagent-Driven (recomandat)** — dispatch un subagent fresh per task, review între task-uri, iterație rapidă. Bună pentru planuri lungi cum e ăsta (14 task-uri, ~2-3 zile de lucru efectiv).

**2. Inline Execution** — execut task-urile în această sesiune cu executing-plans, batch cu checkpoints. Mai lent pe context, dar totul vizibil în conversație.

Ce abordare alegi?
