# Insights lunari pe Sumar

**Data:** 2026-05-10
**Status:** spec aprobat (idee #10 din IDEAS, brainstorming în conversație)

## Problemă

Userul vede pe Sumar totalul lunii și breakdown-ul pe categorii, dar nu i se spune _ce e diferit_ față de obișnuit. App-ul rămâne pasiv. Pârghia „aplicația vorbește prima" — în loc să sape userul, _îi spunem_.

## Obiectiv

Generează 0–3 propoziții narative scurte în română despre cheltuielile lunii curente vs media ultimelor 3 luni, afișate într-un card pe ecranul Sumar. **Local**, fără AI, deterministic.

## Reguli de detecție

Compară luna curentă cu media ultimelor 3 luni (excluzând luna curentă). Pentru fiecare comparație:

- **Total general:** abate ≥ 20% în absolut și ≥ 20% în relativ → insight.
- **Pe categorie:** abate ≥ 20% în relativ ȘI categoria are sumă absolută ≥ 100 RON luna curentă (filtru zgomot) → insight candidat.

Exclud transferurile interne (`is_internal_transfer = 0`) și duplicatele (`duplicate_of_id IS NULL`). Folosesc `amount_ron` (cu fallback la `amount`) pentru consistență multi-currency.

## Selecție și ordine

- Max **3 insights** afișate.
- Ordine: cele cu cel mai mare delta absolut (RON) primii.
- Total general (dacă apare) e mereu primul.

## API

`services/insights.ts`:

```ts
export type InsightSeverity = 'positive' | 'warning' | 'neutral';

export interface MonthlyInsight {
  id: string; // 'total' sau 'cat:<id>'
  type: 'total_change' | 'category_change';
  severity: InsightSeverity;
  message: string; // RO, sub 140 chars
  delta_ron: number; // pozitiv = mai mult cheltuit luna asta
  delta_pct: number; // 100 = +100%
  category_id?: string;
}

export async function computeMonthlyInsights(
  currentMonth: string, // YYYY-MM
  accountId?: string
): Promise<MonthlyInsight[]>;
```

## UI

`components/InsightsCard.tsx`:

- Card cu header „Ce e diferit luna asta?" + max 3 row-uri.
- Fiecare row: icon (sparkles/trend-up/trend-down) + mesajul.
- Severity → culoare:
  - `warning` (cheltuieli crescute): `statusColors.critical`
  - `positive` (cheltuieli scăzute): `statusColors.ok`
  - `neutral`: `Colors[scheme].textSecondary`
- Empty state: dacă 0 insights → cardul nu se afișează deloc.

Inserat pe Sumar (`app/(tabs)/index.tsx`) după monthBar și înainte de chip-uri.

## Severity logic

- **`category_change` cheltuieli ↑** (delta_ron > 0): warning.
- **`category_change` cheltuieli ↓** (delta_ron < 0): positive.
- **`total_change`**: same logic pe expense total.

## Mesaje (template-uri RO)

- Total ↑: `Cheltuiești cu X% mai mult luna asta — Y RON peste media ultimelor 3 luni.`
- Total ↓: `Cheltuiești cu X% mai puțin luna asta — Y RON sub media ultimelor 3 luni.`
- Categorie ↑: `Mai mult la <Categorie>: +X% (≈ Y RON peste media).`
- Categorie ↓: `Mai puțin la <Categorie>: −X% (≈ Y RON sub media).`

X = `Math.round(|delta_pct|)`, Y = `Math.round(|delta_ron|)`.

## Teste

`__tests__/unit/insights.test.ts`:

- Calculul deltaPct + deltaRon e corect.
- Filtru sub 100 RON: categorie cu cheltuieli mici nu generează insight.
- Filtru sub 20%: schimbare mică nu generează insight.
- Ordine: total e primul, apoi după delta absolut descrescător.
- Cap 3.
- Lună fără istoric (luni precedente cu 0 tranzacții): returnează listă goală.

## Out of scope

- Insights vs an precedent (#15 YoY).
- Recomandări „ar trebui să cheltuiești mai puțin la X".
- Alertă pentru pierdere de venit.
