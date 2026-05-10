# Mini-recap lunar

**Data:** 2026-05-10
**Status:** spec aprobat (idee #22 din IDEAS)

## Problemă

Userul vede statisticile dacă navighează ele însuși, dar nu primește un _moment_ de feedback la finalul lunii. Lipsa retrospectivei reduce sentimentul că app-ul îl ajută activ.

## Obiectiv

La prima deschidere a aplicației într-o lună nouă, afișează un modal _one-shot_ cu sumarul lunii trecute: total cheltuieli, top 3 categorii, schimbare vs luna anterioară. Dismiss-abil. Reapare doar când se schimbă luna calendaristică.

## Reguli

- **Trigger:** la primul mount al ecranului Sumar într-o lună calendaristică nouă.
- **Conținut:** luna trecută (current_month - 1).
- **Skip:** dacă luna trecută are < 5 tranzacții non-transfer non-duplicate (împotriva noise-ului în luna primă post-instalare).
- **One-shot:** persistă `last_seen_recap_month` în AsyncStorage; recap-ul apare o singură dată per lună.
- **Locație:** modal nativ peste Sumar.

## API

`services/monthlyRecap.ts`:

```ts
export interface MonthlyRecap {
  month: string; // YYYY-MM
  expense_ron: number;
  income_ron: number;
  net_ron: number;
  top_categories: Array<{ name: string; amount_ron: number; color?: string; icon?: string }>;
  delta_vs_previous_pct?: number; // schimbare expense vs luna înainte
  highlight_insight?: string; // primul mesaj din insights, dacă există
}

export async function shouldShowRecap(): Promise<string | null>;
// returnează YYYY-MM al lunii trecute dacă recap-ul nu a fost încă afișat,
// sau null altfel.

export async function markRecapShown(month: string): Promise<void>;

export async function buildRecap(month: string): Promise<MonthlyRecap | null>;
// null dacă < 5 tranzacții.
```

## UI

`components/MonthlyRecapModal.tsx`:

- Modal centrat cu card.
- Titlu: „<Lună> <An> pe scurt" (ex. „Aprilie 2026 pe scurt").
- Linia 1: total cheltuieli + opțional „cu X% mai mult/puțin față de luna trecută".
- Linia 2: „Top: <Cat 1>, <Cat 2>, <Cat 3>" cu sume.
- Linia 3 (opțional): primul highlight insight, dacă există.
- Buton primary „OK, înțeles" → dismiss + `markRecapShown`.

Wire în `app/(tabs)/index.tsx`: useEffect pe mount, dacă `shouldShowRecap` → setează state `recap` → afișează modal.

## Teste

`__tests__/unit/monthlyRecap.test.ts`:

- `shouldShowRecap`: returnează luna trecută dacă AsyncStorage nu are valoare salvată.
- `shouldShowRecap`: returnează null dacă luna trecută a fost deja shown.
- `shouldShowRecap`: returnează luna trecută nouă dacă AsyncStorage are valoare mai veche.
- Logica de derivare top 3 categorii (test pe funcție pură `buildRecapSummary`).

## Out of scope

- Animație complexă.
- Share imagine.
- Recap interactiv cu tap pe categorii.
- Recap pentru intervaluri custom (3 luni, an).
