# Plan implementare — Învățare merchant → categorie

**Spec:** `docs/specs/2026-05-10-merchant-category-rules-design.md`

## Pași

### 1. Schemă DB

Fișier: `services/db.ts`.

- Adaugă block ALTER înainte de execSync principal (după ALTER `cash_suggestion_dismissed`):
  ```ts
  try {
    db.execSync(`ALTER TABLE transactions ADD COLUMN category_learned INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // tabela nu există încă (fresh install) sau coloana există deja
  }
  ```
- În execSync principal, adaugă tabel `merchant_category_rules` (CREATE TABLE IF NOT EXISTS) + index `idx_mcr_category`.

### 2. Service `services/merchantCategoryRules.ts`

Funcții pure peste `db`:

- `normalizeMerchant(raw: string): string`
- `upsertRule(merchantDisplay: string, categoryId: string): Promise<void>`
- `getRuleForMerchant(merchantRaw: string): Promise<MerchantRule | null>`
- `applyRulesToUncategorized(): Promise<{ updated: number }>`
- `listRules(): Promise<MerchantRule[]>`
- `deleteRule(merchantNormalized: string): Promise<void>`

### 3. Tests `__tests__/unit/merchantCategoryRules.test.ts`

Test-pairing obligatoriu (Husky blochează altfel). Acoperă:

- `normalizeMerchant` cu diacritice/case/spații.
- `upsertRule` insert + update (occurrences ++, category_id schimbat, updated_at refresh).
- `getRuleForMerchant` cu variante de scriere.
- `listRules` ordering.
- `deleteRule`.
- `applyRulesToUncategorized` end-to-end.

### 4. Tipuri în `types/index.ts`

- Adaugă `category_learned?: boolean` la `Transaction`.
- (Optional) Tipul `MerchantRule` exportat din service.

### 5. Hook în `services/transactions.ts`

- `mapRowToTransaction` (sau echivalent): expune `category_learned` în obiectul Transaction returnat.
- `createTransaction`: după validări, dacă `input.category_id` lipsește și merchant non-vid → `getRuleForMerchant` → dacă există, atribuie `category_id` din regulă, set `category_learned=1`, increment occurrences pe regulă (apel `upsertRule` cu aceeași categorie ca să mărească contorul) sau o funcție dedicată `incrementOccurrence()`.
- `updateTransaction`: după UPDATE, dacă `input.category_id` a fost trimis non-null și tranzacția are merchant non-vid → `upsertRule` + UPDATE `category_learned=0` pe rândul curent.

Atenție: `updateTransaction` actualizează doar coloanele primite. Dacă `category_id` apare în input, am setat manual → trebuie și `category_learned=0`. Adaug coloana în lista `push(...)`.

### 6. UI Badge

Localizez componenta de listă tranzacții (probabil `components/TransactionListItem.tsx` sau echivalent în `app/tranzactii/index.tsx`) și ecranul detalii (`app/tranzactii/[id].tsx`).

- Adaug Ionicons `sparkles-outline` lângă numele categoriei când `tx.category_learned`.
- Tinte: `Colors[scheme].textSecondary`.
- Accessibility label: „Categorie atribuită automat din istoric".

### 7. Backup v2

Fișier: `services/backup.ts`.

- Bump `BACKUP_VERSION = 2`.
- În `BackupPayload`, adaugă `merchantCategoryRules: MerchantRule[]`.
- În `exportBackup`, populezi din `listRules()`.
- În `importBackup`:
  - Dacă `version === 1` → skip rules (lista goală).
  - Dacă `version === 2` → `INSERT OR REPLACE` în `merchant_category_rules` cu rândurile din payload.
  - După import transactions, apelează `applyRulesToUncategorized()` (best-effort, nu blochează importul) — categorizează retroactiv tranzacțiile vechi.

### 8. Tests adiționale

- `__tests__/unit/transactions.test.ts`: extindere cu cazuri 5-7 din spec.
- `__tests__/unit/db.test.ts`: cazuri 8-9 din spec.
- `__tests__/unit/backup.test.ts` (dacă există) sau nou: round-trip v2 cu reguli + tranzacții cu category_learned.

### 9. IDEAS.md

Mut #11 din pre-launch în Implementat cu detalii (data, fișiere noi, comportament).

### 10. Commit

Mesaj: `feat(categorize): învățare locală merchant → categorie`.
Body: schimbare schemă (+1 tabel, +1 coloană), backup v2, hook în create/update, badge UI, tests.

## Risc / verificare

- **Existing transactions după ALTER:** coloana `category_learned` primește default 0 — corect (nu sunt „învățate").
- **Pre-commit:** test-pairing va cere test pentru `merchantCategoryRules.ts`. Cover.
- **Tests CI (`npm run check`):** lint + type-check + tests trebuie verzi.
- **Manual test pe simulator:** import demo data → editează manual o tranzacție Lidl → adaugă altă tranzacție Lidl → verifică auto-categorize + badge.
