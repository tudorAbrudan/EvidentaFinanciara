# Ștergere în lot tranzacții filtrate — design

> **Data:** 2026-05-05
> **Status:** validat conversațional, plan în pregătire.

## Problemă

Scenariu recurent: utilizatorul importă un extras în contul greșit (selectează „BT Curent" în loc de „ING Curent" sau invers). Azi, soluția e fie ștergere tranzacție cu tranzacție din formular, fie ștergerea statement-ului din `app/conturi/[id].tsx`. Ștergerea statement-ului acoperă doar cazul „extras importat în cont greșit", nu și „vreau să șterg tot ce e între aprilie–mai pe contul X" (ex. mai multe statement-uri suprapuse, tranzacții manuale eronate).

Lipsește o cale generică de a filtra tranzacții și a le șterge în lot, cu confirmare clară.

## Scope

Feature unic: filtrare avansată pe ecranul Tranzacții + acțiune bulk delete cu pre-bifare și posibilitate de deselectare.

**Filtre expuse în v1** (chip bar mereu vizibilă):

| Chip          | Mecanism                                                                                                    | Default |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| **Cont**      | bottom sheet single-select cu lista conturilor + „Toate conturile"                                          | „Toate" |
| **Perioadă**  | bottom sheet cu preset-uri („Luna asta", „Luna trecută", „Ultimele 3 luni", „An curent", „Interval custom") | „Toate" |
| **Descriere** | input text — search în `description` și `merchant`, debounce 200ms                                          | gol     |
| **Sumă**      | bottom sheet cu două input-uri (min, max), valori absolute                                                  | „—"     |

Restul filtrelor existente în `TransactionFilter` (categorie, sursă, doar cheltuieli, duplicate) NU sunt expuse în v1 — se adaugă cu același pattern dacă apare nevoie.

**Out of scope:**

- Soft delete / undo. Tranzacțiile sunt ireversibile (ca azi). Backup ZIP rămâne safety net.
- Bulk edit (mutare în alt cont, schimbare categorie). Doar ștergere.
- Export, share, alte acțiuni „bulk".

## Arhitectură

### Componente noi

- **`components/TransactionFilterBar.tsx`** — bară de chip-uri cu state local pentru filtru. Primește `value: TransactionFilter` și `onChange(filter)`. Self-contained UI; toate bottom sheet-urile sunt locale componentei.
- **`app/tranzactii/sterge-bulk.tsx`** — ecran de confirmare cu listă pre-bifată și buton final.
- **`services/transactions.ts` → `bulkDeleteTransactions(ids)`** — funcție atomică DB.

### Componente modificate

- **`app/tranzactii/index.tsx`** — adaugi `TransactionFilterBar` sus, propaghi filtrul în `useTransactions(filter)`, adaugi buton „Șterge filtrate" în header când există ≥ 1 filtru activ și ≥ 1 rezultat. Tap → push la `sterge-bulk` (mecanismul de transmitere IDs descris mai jos). Buton text exact pentru v1; când vor apărea alte acțiuni bulk (export etc.), se refactorizează în meniu „Acțiuni".
- **`app/tranzactii/_layout.tsx`** — înregistrezi rută `sterge-bulk` ca Stack.Screen (header default, titlu „Confirmă ștergerea", swipe back permis).
- **`services/transactions.ts` → `TransactionFilter`** — adaugi câmp opțional `absAmountRange?: { min?: number; max?: number }`. În `getTransactions`, dacă e setat, adaugi clauza `(amount BETWEEN -max AND -min OR amount BETWEEN min AND max)` cu valori non-negative interpolate.

### Flow UX bulk delete

1. User aplică filtre — lista de jos se reîmprospătează imediat (debounce pe text).
2. Buton „Șterge filtrate" devine vizibil. Tap → setează IDs în store-ul de handoff și push `app/tranzactii/sterge-bulk.tsx`.
3. Ecranul de confirm:
   - Header: „Confirmă ștergerea" + subtitlu live „N selectate · sumă absolută totală · K transferuri interne · M din extrase bancare".
   - Listă FlatList. Fiecare rând: checkbox (pre-bifat), data, merchant/descriere, cont, categorie, sumă. Tap = toggle.
   - BottomActionBar: „Anulează" / „Șterge N tranzacții" (destructive, disabled la N=0).
4. Tap pe „Șterge" → dialog `Alert.alert`:
   - Title: „Ștergi N tranzacții?"
   - Body: descriere consecințe (vezi „Mecanism cleanup" mai jos).
   - Butoane: „Anulează" / „Șterge" (destructive).
5. Confirm → `bulkDeleteTransactions(selectedIds)` → toast „N tranzacții șterse" + back la listă cu filtrele păstrate.

### Transmiterea ID-urilor între ecrane

ID-urile ar putea fi multe (sute). Trei opțiuni:

- **Query params** (router.push cu `ids` joined cu virgulă) — simplu, dar limita URL-ului pe Android e ~2000 caractere → cap ~80 IDs UUID. Nesatisfăcător.
- **Re-rezolvare în ecranul de confirm primind `TransactionFilter` ca query** — risc de race condition între ce a văzut user-ul filtrat și ce se șterge dacă DB se modifică între timp.
- **Store global temporar** (singleton in-memory, ex. `services/bulkDeleteHandoff.ts` cu `set(ids)`/`consume()`) — sigur, fără race, fără limită de mărime.

**Decizie:** store global temporar. La tap pe „Șterge filtrate", `app/tranzactii/index.tsx` apelează `setBulkDeleteIds(ids)` apoi `router.push('/tranzactii/sterge-bulk')`. Ecranul de confirm la mount face `consume()` (citește + golește). Dacă consumul returnează empty (refresh la rută, deep-link), ecranul afișează error state „Sesiunea de bulk delete a expirat. Întoarce-te la Tranzacții."

## Mecanism cleanup în `bulkDeleteTransactions`

Toate într-o `db.withTransactionAsync`:

1. **Calculează `oldStatementIds`** — set de `statement_id` distincte pentru tranzacțiile care urmează a fi șterse (excluzând `NULL`).
2. **Dezleagă transferuri interne** — pentru tranzacțiile cu `linked_transaction_id IN ids`, contraparte devine tranzacție obișnuită:
   ```sql
   UPDATE transactions
      SET is_internal_transfer = 0, linked_transaction_id = NULL
    WHERE id IN (SELECT linked_transaction_id FROM transactions
                  WHERE id IN (...) AND linked_transaction_id IS NOT NULL);
   ```
3. **Dezmarchează duplicate** — tranzacțiile care marchează ca duplicat tranzacții ce urmează a fi șterse:
   ```sql
   UPDATE transactions SET duplicate_of_id = NULL
    WHERE duplicate_of_id IN (...);
   ```
4. **DELETE** propriu-zis: `DELETE FROM transactions WHERE id IN (...)`.
5. **Auto-purge statement-uri orfane**:
   ```sql
   DELETE FROM bank_statements
    WHERE id IN (oldStatementIds)
      AND id NOT IN (SELECT DISTINCT statement_id FROM transactions
                      WHERE statement_id IS NOT NULL);
   ```
6. Return `{ deletedCount, statementsRemoved }`.

### Chunking pentru `IN (...)`

SQLite `SQLITE_MAX_VARIABLE_NUMBER` = 999. Pentru lists > 500 IDs, sparge în batch-uri de 500. Toate batch-urile în aceeași `withTransactionAsync` ca să rămână atomic.

## Filtru `absAmountRange` — semantică

```ts
// in getTransactions
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

Câmpurile `minAmount`/`maxAmount` semnate rămân neatinse (folosite de cod existent).

## Edge cases

| Caz                                                           | Comportament                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Filtru fără rezultate                                         | Empty state „Niciun rezultat pentru filtrele selectate." Buton „Șterge filtrate" ascuns.  |
| 0 bifate pe ecranul de confirm                                | Buton „Șterge" disabled.                                                                  |
| > 500 tranzacții selectate                                    | Chunking automat în `bulkDeleteTransactions`. UI fără limit hard.                         |
| IDs care nu mai există între deschiderea ecranului și confirm | `DELETE` ignoră IDs inexistente. Counter afișat = `db.changes`, nu lungimea listei input. |
| Eroare în `withTransactionAsync`                              | Rollback automat. Toast „Ștergerea a eșuat. Încearcă din nou." + log.                     |
| Back/swipe în mijlocul flow-ului                              | Anulează — niciun side-effect până la tap pe „Șterge" în dialog.                          |
| Refresh ecran de confirm (consum store gol)                   | Error state cu CTA „Înapoi la Tranzacții".                                                |

## Testing

### Unit (`__tests__/unit/transactions.test.ts`, extins)

- `bulkDeleteTransactions([])` → `{deletedCount: 0, statementsRemoved: 0}`, no-op.
- `bulkDeleteTransactions` cu transfer intern în lot → contraparte rămâne fără `is_internal_transfer` și `linked_transaction_id`.
- `bulkDeleteTransactions` cu o tranzacție marcată duplicat de alta → originalul rămâne, marcajul scos pe ce nu se șterge.
- `bulkDeleteTransactions` lăsând un `statement_id` cu 0 tranzacții → statement-ul auto-șters.
- `bulkDeleteTransactions` lăsând un `statement_id` cu tranzacții rămase → statement-ul rămâne intact.
- `bulkDeleteTransactions` cu 1500 IDs → toate șterse (validează chunking).
- `getTransactions({absAmountRange: {min: 100, max: 500}})` → cheltuieli în [-500, -100] și venituri în [100, 500].
- `getTransactions({absAmountRange: {min: 0, max: 100}})` → tranzacții cu `|amount| ≤ 100`.
- `getTransactions({absAmountRange: {min: 200}})` → `|amount| ≥ 200`.

### Manual (smoke în simulator)

- Import în cont greșit → bulk delete cu filtru cont+perioadă → reimport în cont corect → tranzacțiile sunt acolo.
- Filtru descriere („LIDL") → bulk delete N → solduri conturi corecte.
- Bulk delete cu transferuri interne incluse → contraparte devine tranzacție obișnuită.

## Decizii cheie și rationale

- **Filtrul-bar mereu vizibil (vs. modal)** — permite iterare rapidă pe filtre uitându-te la lista de jos. Esențial pentru bulk delete sigur. Investiție pentru viitor (export, tag-uri din IDEAS).
- **Pre-bifare totală + deselect (vs. select-from-zero)** — utilizatorul a aplicat deja filtre, intenția e clară. Pre-bifarea reflectă că „filtrul = ce vreau să șterg".
- **Auto-purge doar la `0 tranzacții rămase` în statement (vs. recalculare counters)** — minimizează cod, cazul „cont greșit" e curat (statement șters, file_hash dispare, reimport curat). Counters divergente la ștergeri parțiale e cost mic.
- **Fără undo / soft delete** — extinde drastic scope-ul. Backup ZIP e safety net-ul existent. Re-importul de extras readuce tranzacțiile lipsă curat (cele rămase devin marcate duplicat, vizibile ca azi).
- **Sumă în valori absolute** — match-uiește mental modelul utilizatorului („între 200 și 500"). Implementare cu OR pe interval semnat și absolut.
- **Store in-memory pentru handoff IDs** — evită limita query string pe Android și race condition de re-rezolvare a filtrului.

## Bibliografie

- Cleanup pattern preluat din `services/bankStatements.ts:56` (`deleteBankStatement(true)`) — aceleași 3 cleanup-uri (transferuri, duplicate, delete) într-o tranzacție DB.
- `TransactionFilter` în `services/transactions.ts:50` — extins cu `absAmountRange`.
- Re-import behavior: `findDuplicateCandidates` în `services/transactions.ts:343` rulat de `app/conturi/import.tsx` post-import marchează tranzacțiile re-create ca duplicat ale celor existente.
