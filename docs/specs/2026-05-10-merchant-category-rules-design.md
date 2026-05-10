# Învățare locală merchant → categorie

**Data:** 2026-05-10
**Status:** spec aprobat (idee #11 din IDEAS, brainstorming consolidat în conversație)

## Problemă

User-ul corectează manual categoria pentru o tranzacție (ex. setează „Lidl" → „Mâncare"). La import-ul următor, aceeași tranzacție „Lidl" apare iar necategorizată — userul trebuie să refacă mapingul. Frustrant și repetitiv.

App-ul deja are categorize automat din regex (`suggestCategory`) și AI (cota built-in 20/zi), dar amândouă sunt generice — nu reflectă preferințele specifice ale userului. Învățarea locală face app-ul să devină „al tău".

## Obiectiv

Persistă maparea `merchant → categorie` ca **regulă** în SQLite. La fiecare tranzacție nouă fără categorie, dacă merchant-ul match o regulă existentă, atribuie categoria automat și marchează vizibil că a fost „învățată".

## Non-obiective (out of scope)

- **Gestiune reguli în Setări** (listă, edit, delete individual). Poate apărea ulterior. Pentru MVP: regulile se update când userul re-categorizează manual; nu există UI dedicat.
- **Fuzzy matching** pe merchant (ex. „LIDL #182 BUC" vs „Lidl"). MVP: match exact pe normalizare (lowercase + trim + diacritice strip). Dacă apar inconsistente, evaluăm normalizare mai agresivă post-launch.
- **Aplicare la descriere** când merchant lipsește. MVP: regulile cer merchant non-vid; tranzacții cu merchant gol nu beneficiază.
- **Vot multi-categorie pe acelaș merchant.** MVP: last-write-wins (regula stochează cea mai recentă atribuire manuală). `occurrences` se incrementează ca informație, nu se folosește la decizie.

## Arhitectură

### Schemă

Tabel nou `merchant_category_rules`:

```sql
CREATE TABLE IF NOT EXISTS merchant_category_rules (
  merchant_normalized TEXT PRIMARY KEY,
  merchant_display TEXT NOT NULL,
  category_id TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcr_category ON merchant_category_rules(category_id);
```

- `merchant_normalized` — cheia (lowercase + diacritice strip + trim) pentru match deterministic
- `merchant_display` — varianta cu majuscule originale (pentru afișare ulterioară în Setări, dacă apare)
- `occurrences` — câte tranzacții cu acest merchant au primit această categorie (incrementat la fiecare upsert; informativ)
- `ON DELETE CASCADE` — dacă userul șterge o categorie custom, regulile asociate dispar (sigur, nu rămân orfane)

Coloană nouă pe `transactions`:

```sql
ALTER TABLE transactions ADD COLUMN category_learned INTEGER NOT NULL DEFAULT 0;
```

- `category_learned = 1` → categoria a fost atribuită automat dintr-o regulă învățată
- `category_learned = 0` → categoria e setată altfel (manual, regex parser, AI, sau lipsește)
- La modificare manuală a categoriei → resetează la `0` (devine sursă de adevăr pentru viitoarele reguli)

### Service nou: `services/merchantCategoryRules.ts`

API:

```ts
export interface MerchantRule {
  merchant_normalized: string;
  merchant_display: string;
  category_id: string;
  occurrences: number;
}

export function normalizeMerchant(raw: string): string;

export async function upsertRule(merchantDisplay: string, categoryId: string): Promise<void>;

export async function getRuleForMerchant(merchantRaw: string): Promise<MerchantRule | null>;

export async function listRules(): Promise<MerchantRule[]>;

export async function deleteRule(merchantNormalized: string): Promise<void>;
```

`normalizeMerchant`:

- `s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()`
- Reutilizează aceeași strategie ca în `internalTransferSuggestion.ts`.

`upsertRule`:

- Dacă regula există pe `merchant_normalized` → UPDATE category_id, increment occurrences, refresh updated_at.
- Dacă nu există → INSERT cu occurrences=1.

`getRuleForMerchant`:

- Returnează regula pentru merchant normalizat, sau null.

### Hook în `services/transactions.ts`

**La `updateTransaction`**: dacă input-ul setează `category_id` (non-null) și tranzacția are `merchant` non-vid:

1. UPSERT regulă (merchant → category_id).
2. Setează `category_learned = 0` (e modificare manuală, nu mai e „învățată").

Dacă input-ul setează `category_id = null` (uncategorize manual): NU șterge regula. Userul poate vrea doar să elibereze tranzacția temporar; regula rămâne. Pentru ștergere reală, expune mai târziu UI dedicat.

**La `createTransaction`**: dacă input-ul nu are `category_id` (sau e null) și merchant non-vid:

1. Caută regulă pe merchant.
2. Dacă există → atribuie `category_id` din regulă, setează `category_learned = 1`, increment occurrences pe regulă.

`createTransaction` e apelat și din parser-ul de extras și din quick-add. În ambele cazuri, dacă apelantul a determinat deja category_id (regex, AI, etc.), regula NU se aplică (pentru a nu suprascrie semnal explicit).

### Funcție batch retroactivă

`applyRulesToUncategorized(): Promise<{ updated: number }>`

- Iterează `SELECT id, merchant FROM transactions WHERE category_id IS NULL AND merchant IS NOT NULL`.
- Pentru fiecare, caută regulă; dacă există, UPDATE category_id + category_learned=1.
- Apelată automat după `importBackup` (categorizează tranzacțiile vechi cu reguli noi) și după fiecare import nou de extras (în coada de post-procesare).

### UI

- **Badge „învățat"** pe item-ul de tranzacție (atât în lista `app/tranzactii/index.tsx` cât și în detalii `app/tranzactii/[id].tsx`): icon mic (`sparkles-outline` sau `bookmark-outline`) lângă numele categoriei. Tooltip / accesibilitate label: „Categorie atribuită automat din istoric".
- Badge folosește `Colors[scheme].textSecondary` (subtil, nu agresiv).
- **Comportament**: când userul deschide tranzacția și schimbă categoria din UI, hook-ul `updateTransaction` rezolvă restul (resetare `category_learned`, upsert regulă).

## Backup compatibility

`services/backup.ts` payload curent (v1) include: financial_accounts, expense_categories, transactions, bank_statements, fx_rates.

**Adaug** la export:

- `merchantCategoryRules: MerchantRule[]`

**Bump versiune** la 2. Reading:

- v1 backup → import normal, fără reguli (lista goală).
- v2 backup → restore reguli + transactions cu category_learned.

`coloana category_learned` se serializează în `transactions` (Transaction type). v1 backup-uri import: lipsește câmpul → default 0.

## Manifest hash

`buildCanonicalManifest` se aplică pe payload. Schimbare la payload (rule list nouă, câmp nou) modifică hash-ul automat — nu e nevoie de update manual la `manifestHash.ts`.

## Teste

`__tests__/unit/merchantCategoryRules.test.ts`:

1. `normalizeMerchant` — cazuri: diacritice, majuscule, spații.
2. `upsertRule` — INSERT pe merchant nou, UPDATE pe merchant existent (incrementare occurrences, schimbare category).
3. `getRuleForMerchant` — match pe variante de scriere (case, diacritice).
4. `applyRulesToUncategorized` — populezi tranzacții fără categorie + reguli, ruli funcția, verifici că au primit category_id + category_learned=1.

`__tests__/unit/transactions.test.ts` (extindere existent): 5. `updateTransaction` cu category_id schimbat → verifică upsert rule + reset category_learned. 6. `createTransaction` cu input.category_id absent + merchant cu regulă existentă → verifică apply automat + category_learned=1. 7. `createTransaction` cu input.category_id explicit → regula NU se aplică, category_learned=0.

`__tests__/unit/db.test.ts`: 8. Schema include tabelul `merchant_category_rules` cu PK pe merchant_normalized. 9. Coloana `category_learned` există pe `transactions`.

## Migrare incrementală (idempotent)

În `services/db.ts`, înainte de blocul `execSync` cu CREATE TABLE-uri:

```ts
try {
  db.execSync(`ALTER TABLE transactions ADD COLUMN category_learned INTEGER NOT NULL DEFAULT 0`);
} catch {
  // tabela nu există încă (fresh install) sau coloana există deja
}
```

Tabelul `merchant_category_rules` se adaugă în blocul principal `execSync` cu `CREATE TABLE IF NOT EXISTS` — sigur pe fresh install și no-op pe install existent.

## Riscuri

- **Surprize la import:** dacă userul a marcat „Lidl" → „Mâncare" și apoi dintr-o eroare schimbă o tranzacție Lidl la „Cumpărături", toate tranzacțiile Lidl viitoare devin „Cumpărături". Mitigation: badge vizibil + posibilitatea de override manual rapid; pe termen lung, UI Setări pentru gestiune reguli.
- **Conflict regex parser vs regulă:** parserul aplică `suggestCategory` (regex generic) la import; regula nu se mai aplică pe tranzacția respectivă. Asta e _feature_, nu _bug_: userul vede category_id setat de regex, dacă schimbă manual, regula învață noua mapare.

## Workflow

1. Plan implementare: `docs/plans/2026-05-09-merchant-category-rules.md`
2. Schema migration + service + tests.
3. Hook în transactions.ts (createTransaction + updateTransaction).
4. UI badge.
5. Backup v2 + tests round-trip.
6. Update IDEAS.md (mut #11 în Implementat).
