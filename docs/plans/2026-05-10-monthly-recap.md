# Plan implementare — Mini-recap lunar

**Spec:** `docs/specs/2026-05-10-monthly-recap-design.md`

## Pași

1. **`services/monthlyRecap.ts`** — funcții pure + DB:
   - `previousMonthYM(today)` — utilitar pentru luna trecută.
   - `buildRecapSummary(monthlyTotals, breakdown, prevTotals?, highlightInsight?)` — pură, returnează `MonthlyRecap | null` (null dacă < 5 tranzacții). Top 3 categorii.
   - `buildRecap(month)` — orchestrează `getMonthlyTotals`, `getCategoryBreakdown`, `computeMonthlyInsights`.
   - `shouldShowRecap()` — comparare AsyncStorage vs current month - 1.
   - `markRecapShown(month)`.

2. **`__tests__/unit/monthlyRecap.test.ts`** — `buildRecapSummary` cu fixture-uri + `previousMonthYM`.

3. **`components/MonthlyRecapModal.tsx`** — Modal cu card, listă top categorii, buton OK.

4. **Wire în `app/(tabs)/index.tsx`** — state `recap`, useEffect on mount: `shouldShowRecap` → `buildRecap` → setRecap. Modal afișat când `recap !== null`.

5. **IDEAS.md** — mut #22 în Implementat.

6. **Commit** + sync docs.
