# Plan implementare — Insights lunari pe Sumar

**Spec:** `docs/specs/2026-05-10-monthly-insights-design.md`

## Pași

1. **`services/insights.ts`** — funcția `computeMonthlyInsights(currentMonth, accountId?)`. Folosește `getCategoryBreakdown` pe luna curentă + 3 luni anterioare. Construiește map (categoryId → expenseRon) per lună. Comparare cu media ultimelor 3 luni. Filtrare praguri (≥ 20% relativ + ≥ 100 RON absolut pentru categorii). Output sortat cu cap 3.
2. **`__tests__/unit/insights.test.ts`** — mock `db` + `getCategoryBreakdown` indirect (sau testează logica direct cu funcție pură separată). Decis: extrag logica de comparație într-o funcție pură testabilă, expusă (`buildInsightsFromBreakdowns`), care primește current + previous 3 breakdowns. `computeMonthlyInsights` orchestrează DB calls.
3. **`components/InsightsCard.tsx`** — render listă cu icon + text. Acceptă `insights: MonthlyInsight[]` prop și `colors` pentru theme.
4. **Hook în Sumar** (`app/(tabs)/index.tsx`) — useEffect care apelează `computeMonthlyInsights` la load și la schimbare lună. State: `insights, loadingInsights`. Inserat în render după monthBar, înainte de chip-uri.
5. **IDEAS.md** — mut #10 în Implementat.

## Funcție pură expusă pentru test

```ts
buildInsightsFromBreakdowns(
  currentMonth: string,
  current: CategoryBreakdownItem[],
  previousMonths: CategoryBreakdownItem[][]
): MonthlyInsight[]
```

Logica de comparare e izolată; teste unitare pe ea fără mock DB.
