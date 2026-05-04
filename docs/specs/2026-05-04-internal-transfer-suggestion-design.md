# Sugestie alimentare transfer intern — design

> **Data:** 2026-05-04
> **Status:** validat conversațional, plan în pregătire.
> **Predecesor:** `docs/specs/2026-05-04-sugestie-alimentare-cash-design.md` (cash-only). Generalizăm.

## Problemă

User importă doar extrasul contului curent. Transferurile interne către conturi proprii **neimportate** (cash, economii, depozit la termen) apar ca:

- **Outbound** (sold curent scade): „transfer la economii", „constituire depozit", „retragere ATM".
- **Inbound** (sold curent crește): „transfer din economii", „lichidare depozit".

Fără mirror în contul destinație, app-ul nu poate distinge între transfer și cheltuială/venit real → rapoarte poluate, sold net fals.

Feature-ul `cashSuggestion` shipped pe 2026-05-04 acoperă doar cazul `cash`. Generalizăm pentru savings + depozit.

## Scope

Detectare automată + sugestie de conversie în transfer intern pentru trei tipuri de mișcări:

| Tip           | Direcție | Sursa pe curent | Mirror în destinație      |
| ------------- | -------- | --------------- | ------------------------- |
| `cash`        | outbound | `amount < 0`    | `+amount` în cont cash    |
| `savings_out` | outbound | `amount < 0`    | `+amount` în cont savings |
| `savings_in`  | inbound  | `amount > 0`    | `-amount` în cont savings |

**Depozitele la termen = savings** (același `FinancialAccountType: 'savings'`). User decide la creare contul cum se cheamă („Depozit BCR 6M" vs „Cont economii ING").

Trei surface-uri UX, identice cu featurea cash actuală:

1. **Banner pe Sumar** cu count pending în ultimul an, dismiss pe sesiune.
2. **Ecran batch** post-import sau din banner — listă top 10, checkbox bifat default, dropdown destinație filtrat pe tip + valută.
3. **Checkbox inline în formular tranzacție** cu auto-detect edge-trigger (uncheck manual respectat).

User confirmă întotdeauna. Nicio auto-aplicare.

## Detecție

Regex-uri separate per tip, aplicate pe `description + merchant` normalizate (NFD + strip diacritice):

```ts
const CASH_RE = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;
const SAVINGS_OUT_RE =
  /\b(transfer\s+(la|spre|catre)\s+(economii|depozit)|alimentare\s+(cont\s+)?economii|constituire\s+depozit|economisire)\b/i;
const SAVINGS_IN_RE =
  /\b(transfer\s+(din|de\s+la)\s+(economii|depozit)|retragere\s+(din\s+)?economii|lichidare\s+depozit)\b/i;
```

Funcția `detectTransferType(tx): 'cash' | 'savings_out' | 'savings_in' | null` testează în ordine cash → savings_out → savings_in (prioritate la cash, deci „retragere cash din contul de economii" — edge case extrem — match-uiește cash). Returnează `null` dacă nimic nu match-uiește sau dacă tranzacția e deja transfer.

**Constrângere de direcție:**

- `cash` și `savings_out` se aplică doar pentru `amount < 0`.
- `savings_in` se aplică doar pentru `amount > 0`.

Dobânzile pe economii/depozit (income, fără cuvinte din `SAVINGS_IN_RE`) NU declanșează sugestia. Confirmat manual că texte tipice — „dobanda lunara cont", „capitalizare dobanda" — nu match-uiesc.

## Arhitectură

**Refactor `services/cashSuggestion.ts` → `services/internalTransferSuggestion.ts`** într-un singur commit dedicat înainte de feature work. Generalizare:

```ts
export type TransferType = 'cash' | 'savings_out' | 'savings_in';

export function detectTransferType(tx: Transaction): TransferType | null;

export interface PendingTransferSuggestion extends Transaction {
  suggested_type: TransferType;
}

export function listPendingTransferSuggestions(opts?: {
  limit?: number;
  sinceDays?: number;
}): Promise<PendingTransferSuggestion[]>;

export function countPendingTransferSuggestions(opts?: { sinceDays?: number }): Promise<number>;

export function dismissTransferSuggestion(txId: string): Promise<void>;

export function convertToTransfer(sourceTxId: string, targetAccountId: string): Promise<void>;
```

`convertToTransfer` este extins să accepte ambele direcții:

- Sursă `amount < 0`: mirror are `amount = -source.amount` (pozitiv) în target. (existing)
- Sursă `amount > 0`: mirror are `amount = -source.amount` (negativ) în target. (NEW)

Validări:

- Source există și nu e deja transfer (existing).
- Target există, nu e archived, currency match (existing).
- Target type ∈ `{cash, savings}` — restricție pentru a păstra semantica „cont propriu separat" și a evita ambiguități (e.g. transfer la card = bani datorați, alt model). Rule of thumb: target.type trebuie să se potrivească cu suggested_type-ul calculat la sursă.
  - `cash` → target.type === 'cash'
  - `savings_out` / `savings_in` → target.type === 'savings'

Atomicitate: `db.withTransactionAsync` (existing).

**Schema neschimbată.** `cash_suggestion_dismissed` column rămâne (semantica e per-tx flag, valid pentru orice tip de sugestie). Index parțial `idx_tx_cash_pending` rămâne. Renumirea coloanei (la `transfer_suggestion_dismissed`) e follow-up cosmetic, nu blocant.

## UX

### Banner pe Sumar

`components/CashSuggestionBanner.tsx` → `components/TransferSuggestionBanner.tsx`. Text:

> Ai {count} {tranzacție/tranzacții} cu sugestie de transfer intern în ultimul an. Tap să le clasifici.

Tap → `/sugestie-transfer/batch?source=summary`. X dismiss pe sesiune (state local).

### Ecran batch

`app/sugestie-cash/` → `app/sugestie-transfer/`. Per-rând afișează badge tip:

- `cash`: 💵 „Retragere cash"
- `savings_out`: ⬆️ „Către economii"
- `savings_in`: ⬇️ „Din economii"

(Folosim Ionicons existing — `cash-outline`, `arrow-up-circle`, `arrow-down-circle` cu culori distincte.)

Dropdown destinație filtrează pe tipul corect:

- `cash` → conturi cu `type === 'cash'` și currency match.
- `savings_out` / `savings_in` → conturi cu `type === 'savings'` și currency match.

Buton „+ Creează cont" redirectează la `/conturi/add` cu params `type=cash` sau `type=savings`, currency.

Footer: Confirmă (N) / Skip toate / Anulează (existing).

### Checkbox inline în formular tranzacție

`components/CashWithdrawalToggle.tsx` → `components/InternalTransferToggle.tsx`. Label adaptiv pe tipul detectat:

- `cash` → „Este retragere de cash din contul bancar"
- `savings_out` → „Este transfer către cont de economii"
- `savings_in` → „Este retragere din cont de economii"

Dropdown filtrează pe tipul detectat. Auto-detect edge-trigger pe regex match (păstrat). User poate debifa manual; uncheck respectat la edits ulterioare.

Pentru `amount > 0` (income), toggle-ul afișează DOAR dacă match-uiește `savings_in` regex. Altfel rămâne ascuns (nu poluăm UI-ul de venit cu opțiunea).

### Hook post-import

`app/conturi/import.tsx` rămâne, doar URL-ul se schimbă: `/sugestie-cash/batch` → `/sugestie-transfer/batch`.

## Routing

Renumire folder + path:

- `app/sugestie-cash/_layout.tsx` → `app/sugestie-transfer/_layout.tsx`
- `app/sugestie-cash/batch.tsx` → `app/sugestie-transfer/batch.tsx`

Toate `router.push/replace`-urile în feature actualizate.

## Teste

Mută + extinde `__tests__/unit/cashSuggestion*.test.ts` → `internalTransferSuggestion*.test.ts`:

- `detectTransferType` — toate 3 tipuri + null cases + diacritice + word boundaries.
- `listPendingTransferSuggestions` — populează `suggested_type` per row.
- `convertToTransfer` cu sursă negativă (cash + savings_out) și cu sursă pozitivă (savings_in).
- Validare target type per tip de sugestie.
- FX rate happy + failure pentru ambele direcții.

Coverage ≥ 95% pe `services/internalTransferSuggestion.ts`.

## Edge cases

| Scenariu                                                            | Comportament                                                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User are doar cont savings RON, tranzacție savings_out în EUR       | Buton „+ Creează cont Economii în EUR"                                                                                                                              |
| User n-are niciun cont savings                                      | Buton „+ Creează cont Economii"                                                                                                                                     |
| Tranzacție match-uiește 2 regex-uri (e.g. „retragere economii ATM") | Cash câștigă (testat primul). Acceptabil practic.                                                                                                                   |
| Comision bancar (e.g. „comision constituire depozit")               | Match savings_out; user debifează manual.                                                                                                                           |
| Dobândă pe depozit                                                  | Nu match savings_in; income normal.                                                                                                                                 |
| Restore din backup pre-feature                                      | Coloana `cash_suggestion_dismissed` există deja; tranzacții existente vor apărea în pending dacă match savings (acum că regex e mai larg). User poate dismiss bulk. |

## Migration path

- Existing `cash_suggestion_dismissed = 1` rows rămân dismiss-uite.
- Existing tranzacții care match savings regex dar nu cash vor apărea acum ca pending (anterior nu match-uiau cash regex-ul, deci nu erau în listă). Așteptat și dorit.

## Out of scope

- Obiective de economisire / tracking progres (idee #23 din IDEAS).
- Auto-creare cont savings din import.
- Refactor schemă (rename `cash_suggestion_dismissed`).
- Tipuri suplimentare de transfer (card de credit, investiții, etc.) — adăugabile separat după acest fundament.
