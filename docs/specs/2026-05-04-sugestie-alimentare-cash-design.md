# Sugestie alimentare cont cash la retragere

**Data:** 2026-05-04
**Status:** aprobat, urmează plan de implementare
**Aria afectată:** `services/cashSuggestion.ts` (nou), `services/db.ts` (migrație + index), `services/bankStatements.ts` (post-import hook), formular tranzacție (`app/tranzactii/add.tsx`, `[id].tsx`), `app/(tabs)/index.tsx` (banner Sumar), `app/sugestie-cash/batch.tsx` (nou), `components/CashSuggestionBanner.tsx` (nou).

## Context și motivație

Schema curentă are `FinancialAccountType = 'cash'` și mecanism complet de transfer intern (`is_internal_transfer` + `linked_transaction_id`). Practic vorbind însă:

- Retragerile de la ATM apar ca debit pe contul bancar și **nu** sunt reflectate în soldul niciunui cont cash. Banii dispar din bancă fără să apară undeva ca disponibili.
- Cheltuielile cash făcute ulterior (cumpărături, bacșiș, taxi) trebuie introduse manual pe contul cash, dar utilizatorul nu are vizibilitate că „are 500 RON disponibili în portofel" pe care să-i decrementeze.
- Soluția corectă e ca retragerea ATM să fie modelată ca **transfer intern**: jumătate-debit pe banca, jumătate-credit pe contul cash. Mecanismul există în schemă, dar nu e descoperit/utilizat de useri.

Feature-ul detectează automat retragerile (regex pe descriere/merchant) și sugerează utilizatorului să le convertească în transferuri interne către un cont cash. User-ul confirmă, app-ul nu auto-aplică.

## Decizie

Folosim mecanismul existent `is_internal_transfer` (Abordarea 1 din brainstorm). Adăugăm:

1. Modul nou `services/cashSuggestion.ts` cu logică pură: detecție, listare pending, conversie atomică, dismiss.
2. Un câmp boolean nou `cash_suggestion_dismissed` pe `transactions` + un index parțial pentru query-ul bannerului.
3. Trei surface-uri UI care toate cheamă același modul:
   - **Post-import:** ecran batch cu listă + checkbox-uri (`app/sugestie-cash/batch.tsx?source=import`).
   - **Adăugare manuală:** checkbox inline în formular cu auto-detect pe descriere.
   - **Banner Sumar:** card discret cu count, tap → același ecran batch.

Retragerile mai vechi de 365 zile sunt out-of-scope. Bannerul Sumar afișează un count, ecranul batch afișează maxim 10 retrageri sortate `date DESC`. Pe măsură ce userul rezolvă/dismiss-uiește, urcă altele din rezerva de un an.

## Modulul `services/cashSuggestion.ts`

API public:

```ts
export function detectCashWithdrawal(tx: Transaction): boolean;

export function listPendingCashSuggestions(opts?: {
  limit?: number; // default 10
  sinceDays?: number; // default 365
}): Promise<Transaction[]>;

export function countPendingCashSuggestions(): Promise<number>;

export function convertToTransfer(sourceTxId: string, targetCashAccountId: string): Promise<void>;

export function dismissCashSuggestion(txId: string): Promise<void>;
```

### `detectCashWithdrawal`

Regex unic, normalizare diacritice, granițe de cuvânt:

```ts
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

Reguli:

- Numai tranzacții negative (debite).
- Numai cu `is_internal_transfer = false`.
- Caută în `description` ȘI `merchant` (BT pune în description, OTP poate pune în merchant).
- Granițele `\b` evită „atmosferă" / „caratm" / „numerăm".

### `listPendingCashSuggestions`

Query SQL fără LIMIT (indexul parțial face scanarea ieftină):

```sql
SELECT *
FROM transactions
WHERE amount < 0
  AND is_internal_transfer = 0
  AND cash_suggestion_dismissed = 0
  AND duplicate_of_id IS NULL
  AND date >= date('now', '-365 days')
ORDER BY date DESC
```

Filtrarea regex se face în memorie după query (regex în SQLite ar complica), apoi `slice(0, limit)` la default 10. **Important:** dacă am pune `LIMIT N` în SQL, retragerile mai vechi de top-N cheltuieli ar fi omise când există multe debituri non-retragere recente — query-ul trebuie să livreze toți candidații din window, regex filtrează, apoi tăiem.

### `countPendingCashSuggestions`

Returnează count-ul **total** după filtrare regex (nu plafonat la limit) — folosit de banner. La fel: query SQL cu condițiile + filtrare regex în memorie. Pentru DB sub 10k tranzacții acceptabil, cu indexul parțial scanează doar candidații.

### `convertToTransfer`

Atomic în `db.withTransactionAsync`:

1. Verifică sursa: există, `amount < 0`, `is_internal_transfer = 0` — altfel throw.
2. Verifică ținta: există, e cont cash, aceeași valută ca sursa — altfel throw.
3. Update sursă: `is_internal_transfer = 1`, `category_id = 'cat-sys-transfer'`, `cash_suggestion_dismissed = 1`.
4. Insert pereche pe contul cash: `amount = -sursa.amount` (pozitivă), aceeași dată/valută/`amount_ron` recalculat, `is_internal_transfer = 1`, `category_id = 'cat-sys-transfer'`.
5. Update reciproc `linked_transaction_id` pe ambele.

### `dismissCashSuggestion`

`UPDATE transactions SET cash_suggestion_dismissed = 1 WHERE id = ?`. Idempotent.

## Schema & migrație

```sql
ALTER TABLE transactions
ADD COLUMN cash_suggestion_dismissed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_transactions_cash_pending
  ON transactions(date DESC)
  WHERE is_internal_transfer = 0
    AND cash_suggestion_dismissed = 0
    AND amount < 0;
```

- Default 0 → safe pentru rândurile existente.
- Index parțial — scanează doar candidați.
- Migrație nouă în lista din `services/db.ts` cu next version number.
- Manifest hash backup actualizat. Test: backup pre-migrație → restore → coloana primește 0.

## UX surface-uri

### A) Post-import — ecran batch

`app/sugestie-cash/batch.tsx?source=import&statementId=…`

Trigger: după `bankStatements.importStatement(...)` sau `importCsv(...)`, dacă `listPendingCashSuggestions({ limit: 10 })` returnează >0 retrageri din statement-ul curent → navigare automată către ecran batch.

Layout:

```
N retrageri detectate
Vrei să le aloci în contul Cash?

☑ ATM BCR · 500 RON · 02 mai
   → Cont destinație: [Portofel ▾]
   [✗ Skip această retragere]

☑ retragere numerar OTP · 200 RON · 28 apr
   → Cont destinație: [Portofel ▾]

[Anulează]                    [Confirmă (3)]
[Skip toate]
```

- Checkbox bifat default; dropdown cont destinație preselectat dacă există un singur cont cash potrivit ca valută.
- „Skip pe rând" / „Skip toate" → `dismissCashSuggestion` pentru selecție.
- Closing fără acțiune → retragerile rămân pending (apar în banner).
- Currency mismatch: dropdown gol → buton inline „➕ Creează cont Cash în [VALUTĂ]".

### B) Adăugare manuală — inline în formular

În `app/tranzactii/add.tsx` și `app/tranzactii/[id].tsx`, sub câmpul „Sumă" (apare doar când amount < 0):

```
[ ] Este retragere de cash din contul bancar
    └─ Cont destinație: [— alege —]
```

- Checkbox auto-marcat live când `detectCashWithdrawal(currentForm)` = true (re-evaluat la fiecare modificare a description/merchant).
- Userul poate debifa (override).
- Dacă bifat și nu există cont cash în valuta selectată → buton inline „➕ Creează cont Cash în [VALUTĂ]" → modal rapid (nume + culoare default), apoi continuă.
- La submit: `convertToTransfer` în loc de insert simplu (atomic).
- La edit pe o tranzacție deja transfer: checkbox bifat read-only, sau buton secundar „Desfă transferul".

### C) Banner Sumar

`components/CashSuggestionBanner.tsx` în `app/(tabs)/index.tsx`, sub header-ul de sold:

```
💵 Ai 7 retrageri de cash neclasificate în ultimul an.
   [Clasifică-le →]      [✗]
```

- Render condiționat pe `countPendingCashSuggestions() > 0`.
- Tap pe card sau pe „Clasifică-le" → `app/sugestie-cash/batch.tsx?source=summary`.
- Tap pe „✗" → ascundere doar pentru sesiunea curentă (state local component, nu DB). Reapare la deschiderea următoare a app-ului dacă încă mai sunt pending.

## Edge cases

| #   | Scenariu                                      | Comportament                                                                                              |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Currency mismatch                             | Dropdown filtrat pe valută; gol ⇒ buton „Creează cont". `convertToTransfer` validează defensive.          |
| 2   | Userul șterge una din jumătățile transferului | Comportament existent păstrat (fără cascadă). Jumătatea-bancară ștearsă ⇒ nu mai apare ca sugestie.       |
| 3   | Editare sumă pe o jumătate post-conversie     | Nu sincronizăm (out of scope, păstrăm comportamentul existent al transferurilor manuale).                 |
| 4   | Niciun cont cash + user nu vrea să creeze     | „Skip" pe banner ⇒ `cash_suggestion_dismissed = 1`. Nu forțăm.                                            |
| 5   | User șterge cuvântul „ATM" din descriere      | Tranzacția dispare din pending la următoarea evaluare (regex devine false). Conversia deja făcută rămâne. |
| 6   | Import duplicate                              | `duplicate_of_id IS NOT NULL` exclus în query.                                                            |
| 7   | Cash advance pe card de credit                | Tratat identic — sursa e cardul, destinația e cash. Comisionul (linie separată) rămâne cheltuială.        |
| 8   | Eroare în mijlocul `convertToTransfer`        | `db.withTransactionAsync` ⇒ rollback complet, fără state parțial.                                         |
| 9   | DB cu 10k tranzacții                          | Cu indexul parțial, query <5ms. Cache nu e necesar.                                                       |
| 10  | Backup pre-migrație restaurat                 | Toate retragerile vechi devin pending la prima deschidere. User poate „Skip toate" în 2 tap-uri.          |

## Invariante (testate ca aserțiuni)

- ∀ tx cu `is_internal_transfer = 1`: există exact o pereche cu `linked_transaction_id` reciproc.
- ∀ pereche: `tx.amount + pair.amount = 0` ȘI `tx.currency = pair.currency`.
- ∀ tx în `listPendingCashSuggestions`: `amount < 0`, `is_internal_transfer = 0`, `cash_suggestion_dismissed = 0`, `duplicate_of_id IS NULL`, `date >= today - 365 days`.

## Comisionul de retragere — out of scope

Multe bănci taxează retragerile (5–15 RON). Apar pe linie separată („Comision retragere ATM"). Sugestia transferă **fix suma retragerii** — comisionul rămâne tranzacție separată cu categoria normală bancară. Auto-categorizarea comisioanelor poate fi un feature separat.

## Testare

### Unitare (Jest)

`__tests__/unit/cashSuggestion.test.ts`:

- `detectCashWithdrawal` — 12+ cazuri:
  - Match pozitiv: „RETRAGERE NUMERAR ATM BCR", „bancomat OTP", „atm transilvania", „cash withdrawal Revolut", „extragere numerar".
  - Match negativ: „atmosferă restaurant", „caratm SRL", descriere goală, merchant gol, sumă pozitivă, deja transfer.
- `listPendingCashSuggestions` (cu fixture DB):
  - Exclude pozitive, transferuri, dismissed, duplicate, mai vechi de 365 zile.
  - Sortare `date DESC`, respectă `limit` 10.
- `countPendingCashSuggestions` — count complet, nu plafonat.
- `convertToTransfer`:
  - Happy path → 2 tranzacții legate, `is_internal_transfer = 1`, `category_id = 'cat-sys-transfer'`.
  - Currency mismatch → throw, DB neschimbat.
  - Target inexistent / cont non-cash → throw.
  - Sursa deja transfer → throw cu mesaj clar.
  - Rollback la eroare în mijloc → state pre-call.
- `dismissCashSuggestion` — set flag, idempotent.

`__tests__/unit/cashSuggestionMigration.test.ts`:

- Coloana adăugată cu default 0.
- Backup pre-migrație → restore → coloana 0 pe rânduri vechi.
- Index parțial există post-migrație.
- Hash manifest backup actualizat.

### Integrare

`__tests__/unit/cashSuggestionFlow.test.ts`:

- Import statement cu retrageri ⇒ `listPendingCashSuggestions` returnează retragerile.
- Convertire batch a 3 retrageri ⇒ 6 tranzacții, 3 perechi legate.
- Dismiss + reimport același statement ⇒ retragerea dismiss-uită rămâne dismiss-uită.

### Manuale (checklist înainte de merge)

- [ ] Import PDF BT cu 5 retrageri → ecran batch → confirm 3, skip 2 → solduri corecte pe ambele conturi.
- [ ] Adaug manual cu „ATM BCR" → checkbox auto-bifat → save → transfer creat.
- [ ] Tranzacție „atmosferă restaurant" → checkbox NU se bifează.
- [ ] Edit pe retragere existentă → schimb descriere în „Cumpărătură" → checkbox se debifează.
- [ ] Sumar arată banner cu count corect → tap → ecran batch.
- [ ] Banner X (dismiss session) → restart app → banner reapare.
- [ ] 0 conturi cash → adaug retragere → bifez → buton „Creează cont Cash" inline → creez → continui flow.
- [ ] EUR retragere, doar cont cash RON → dropdown gol + buton „Creează cont Cash în EUR".
- [ ] Backup pre-migrație → restore → app deschide ok, retragerile vechi pot fi clasificate.

**Coverage target:** `services/cashSuggestion.ts` la 100%. UI surface-urile la coverage normal.

## Out of scope (poate intra ca features separate)

- Auto-categorizare comisioane retragere ATM.
- Sincronizare automată sumă/dată între jumătățile unui transfer la edit.
- Configurare din Setări a window-ului de scanare (default 365 zile).
- Detecție retrageri pe sumă rotundă fără cuvânt-cheie (ex. „BCR 500 RON" la sfârșit de zi).
