# Re-analiză extras + categorizare AI — design

Data: 2026-06-06
Status: aprobat (brainstorming)

## Problemă

La import, încadrarea tranzacțiilor (semn venit/cheltuială + categorie) are gap-uri:

1. **Semn greșit** — surse AI/OCR pot clasifica o „Incasare" (credit) ca debit. Ex. real: „Incasare OP - canal electronic" 26.400 RON apărea ca cheltuială.
2. **Categorie lipsă** — categorizarea se bazează pe o listă statică de keyword-uri (`suggestCategory`). Magazine locale (SAFEWAY, BONAS, IL CAFFE, AIRAM) și lanțuri ce ratau regex-ul (MEGAIMAGE, EON, POLARIS MEDICAL) rămân „Fără categorie".
3. **Nicio cale de reparare** — corecțiile se aplică doar la momentul importului. Nu există buton de re-analiză; singura opțiune e ștergerea importului „cu tranzacții" + re-import (distructiv).

Deja livrat (commit separat): `applyDirectionHint` (guard determinist de semn pe toate căile de import) + fixuri regex keyword (MEGAIMAGE, EON, E-BLOC, POLARIS MEDICAL, CTP, olx/sportano/ZOOCENTER).

## Decizii (din brainstorming)

- Categorizarea folosește **AI**, cu fallback pe keyword-uri.
- Re-analiza **suprascrie tot, automat** (fără preview), dar respectă **regulile merchant învățate**.
- Re-analiza **nu re-importă PDF** — re-rulează pe `merchant`/`description`/`amount` deja stocate.

## Motor de categorizare (precedență)

Contextul diferă între import și re-analiză (la import AI-ul citește extrasul brut și
dă categoria inline; la re-analiză avem doar `merchant`/`description` stocate), deci
precedența diferă ușor:

- **La import (AI text/vision):** categorie AI validă din mapper → fallback `suggestCategory`.
  Regulile merchant existente se aplică nemodificat (comportament curent), pe urmă.
- **La re-analiză:** `merchantCategoryRules.getRuleForMerchant` (regulă învățată, `category_learned = 1`)
  → `suggestCategory` (`category_learned = 0`) → **AI batch** pentru ce rămâne neîncadrat (`category_learned = 0`).

Transferurile interne (`is_internal_transfer = 1`) sunt excluse în ambele cazuri — nu au categorie.

## Componenta A — categorie AI la import (fără apel suplimentar)

`services/aiStatementMapper.ts` + `services/aiStatementVisionMapper.ts`:

- Extind schema răspuns cu câmp opțional `category` (enum din `CategoryKey`):
  ```
  { "rows": [ { date, amount, currency, description, merchant, category? } ] }
  ```
- Prompt RO: instruiesc modelul să aleagă categoria dintr-o listă fixă (cele 14 `CategoryKey`), sau să o omită dacă e neclar.
- La parse: dacă `category` e un `CategoryKey` valid → folosesc; altfel fallback pe `suggestCategory`. Validare strictă; categorie invalidă = ignorată, nu eroare.
- Zero apeluri AI suplimentare (categoria vine în răspunsul deja cerut).
- `aiSchemas.ts`: adaug `category` (opțional, validat contra enum) în `StatementResponseSchema`.

CSV și PDF-euristic rămân keyword-only (nu au strat AI). Userul poate folosi „Re-analizează" pentru AI.

## Componenta B — `categorizeTransactionsWithAi` (apel batch)

Nou: `services/aiCategoryMapper.ts`.

```
categorizeTransactionsWithAi(
  items: { id: string; merchant?: string; description?: string }[]
): Promise<Map<string /* id */, CategoryKey>>
```

- Un singur apel AI pentru toată lista (cap 100 items/apel; peste → chunk-uri).
- Prompt RO: listă numerotată `{id, merchant, description}` → cere `{id, category}` cu category ∈ `CategoryKey`.
- Schema răspuns: `{ results: [ { id, category } ] }`, validată. Id necunoscut sau categorie invalidă = ignorat.
- Respectă consent + cotă: dacă lipsesc, **nu apelează** — întoarce Map gol (caller-ul păstrează rezultatele keyword). Fără excepție brută.
- Sanitizare anti-injection identică cu mapper-ele existente.

## Componenta C — `reanalyzeStatement`

Nou în `services/transactions.ts`:

```
reanalyzeStatement(
  statementId: string,
  opts: { useAi: boolean }
): Promise<{ updated: number; signFlipped: number; aiUsed: number }>
```

Pași:

1. Încarcă tranzacțiile cu `statement_id = ?` și `is_internal_transfer = 0`.
2. Pentru fiecare: recalculează **semnul** via `applyDirectionHint` pe `{description, merchant, amount}`.
3. Categorie: regulă merchant → keyword. Strânge cele rămase neîncadrate.
4. Dacă `useAi` și sunt neîncadrate → `categorizeTransactionsWithAi`.
5. `CategoryKey` → `category_id` via `getCategoryByKey`.
6. Bulk update într-o tranzacție DB: `category_id`, `category_learned`, `amount`, `amount_ron` (recalculat dacă semnul s-a schimbat și currency = RON).
7. Întoarce statistici pentru mesajul UI.

## Componenta D — buton „Re-analizează" (UI)

`app/conturi/[id].tsx`, pe fiecare rând de extras (lângă „Șterge importul"):

- Acțiune „Re-analizează" → confirmare („Recalculează semnul și categoria pentru N tranzacții. Corecțiile manuale care nu sunt reguli salvate se pierd.").
- Dacă AI consent on → `AiPreflightDialog` înainte de apel (trimitem merchant/description la AI).
- Dacă consent off → rulează doar keyword + semn, mesaj că AI e dezactivat.
- La final: alertă „N tranzacții actualizate (M semn corectat, K prin AI)" + refresh liste.

## Erori & limite

- Cotă AI epuizată / consent off → degradare grațioasă la keyword + semn.
- Cap 100 items/apel AI; peste → chunk-uri secvențiale.
- `applyDirectionHint` flipează doar pe markeri neechivoci (un singur tip prezent) — nu strică sume corecte.

## Testare

- `aiStatementMapper` / `aiStatementVisionMapper`: snapshot cu `category` AI valid + fallback la keyword pe categorie invalidă/lipsă.
- `aiCategoryMapper`: mock provider (fără API real); schema validă, id/categorie invalidă ignorate, Map gol fără consent.
- `reanalyzeStatement`: suprascrie categoria, flipează semnul „Incasare", respectă regula merchant, skip transfer intern, fără AI când `useAi=false`.
- `applyDirectionHint`: deja acoperit (8 teste).

## Non-scope

- Fără preview/diff la re-analiză (decis: overwrite automat).
- Fără re-import din PDF.
- Fără re-analiză pe tot contul deodată (doar per-extras în v1).
