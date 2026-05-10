# Plan implementare — Detectare tranzacții recurente

**Spec:** `docs/specs/2026-05-10-recurring-detection-design.md`

## Pași

1. **`services/recurring.ts`** — `buildRecurringSeries` (pură, primește listă de tx + today) + `detectRecurringSeries` (orchestrează SQL pe ultimele 6 luni). Reutilizează `normalizeMerchant` din `merchantCategoryRules`.
2. **`__tests__/unit/recurring.test.ts`** — focus pe `buildRecurringSeries` cu fixture-uri.
3. **`components/RecurringSummary.tsx`** — render cu max 5 series afișate, status badge.
4. **Wire în `app/(tabs)/index.tsx`** — useEffect, state `recurringSeries`.
5. **IDEAS.md** — mut #9 în Implementat.
6. **Commit** + docs sync (ARCHITECTURE + landing).

## Funcția pură expusă

```ts
buildRecurringSeries(
  txs: TxLite[],
  today: string
): RecurringSeries[]
```

`TxLite = { merchant: string; amount_ron: number; date: string; category_id?: string; category_name?: string }`.

## Median calculation

Helper local `median(values: number[])`. Sortez, returnez middle (sau medie a două medii pentru length par).

## Praguri

- `AMOUNT_TOLERANCE = 0.10` (±10%).
- `MIN_CADENCE_DAYS = 25`, `MAX_CADENCE_DAYS = 35` (lunar).
- `MIN_OCCURRENCES = 3`.
- `MAX_AGE_ACTIVE_DAYS = 35`.
- `MAX_AGE_MISSING_DAYS = 70`.
- `MAX_DISPLAY = 5` (UI).
