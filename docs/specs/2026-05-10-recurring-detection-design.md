# Detectare automată tranzacții recurente

**Data:** 2026-05-10
**Status:** spec aprobat (idee #9 din IDEAS)

## Problemă

Userul are abonamente recurente — Netflix, Spotify, chirie, internet, asigurări — dar nu are vizibilitate consolidată asupra lor. Riscă să continue plata pentru ceva ce nu folosește, sau să rateze că o factură lunară nu a venit (semn că ceva nu e în regulă cu contul/cardul).

## Obiectiv

Detectează automat seriile recurente din istoric (același merchant + sumă similară + cadență ~lunară) și expune-le într-o secțiune „Abonamente active" pe Sumar. Detectează și **abonamente care lipsesc** (s-a depășit cadența cu > 35 zile fără apariție nouă).

## Algoritm

Pe ultimele **6 luni** de tranzacții non-transfer, non-duplicate, cu `amount < 0` și `merchant` non-vid:

1. **Grupare:** key = `normalizeMerchant(merchant)` (lowercase + diacritice strip + trim).
2. **Filtru sumă:** păstrează grupul doar dacă variațiile sunt în interval ±10% în jurul medianei (toleranță pentru fluctuații FX sau ajustări mici de preț).
3. **Filtru cadență:** ordonează tranzacțiile după dată, calculează interval-uri zile între consecutive. Considerat recurent dacă mediana intervalelor e între **25 și 35 zile** (lunar) sau între **6 și 10 zile** (săptămânal — mai rar) sau între **85 și 95 zile** (trimestrial). Pentru MVP: doar cadență lunară.
4. **Min ocurențe:** ≥ 3 apariții pe ultimele 6 luni.
5. **Status:**
   - `active`: ultima apariție în ultimele 35 zile.
   - `missing`: ultima apariție acum 35–70 zile (s-a sărit o lună).
   - `expired`: ultima apariție > 70 zile (probabil oprit).
6. **Expected next date:** ultima apariție + median interval.

## API

`services/recurring.ts`:

```ts
export type RecurringStatus = 'active' | 'missing' | 'expired';

export interface RecurringSeries {
  merchant_normalized: string;
  merchant_display: string;
  median_amount_ron: number;
  cadence_days: number;
  occurrences: number;
  first_seen: string; // YYYY-MM-DD
  last_seen: string;
  expected_next: string;
  status: RecurringStatus;
  category_id?: string;
  category_name?: string;
}

export async function detectRecurringSeries(): Promise<RecurringSeries[]>;
```

Funcție pură pentru test:

```ts
buildRecurringSeries(
  txs: { merchant: string; amount_ron: number; date: string; category_id?: string; category_name?: string }[],
  today: string // YYYY-MM-DD
): RecurringSeries[]
```

`detectRecurringSeries` interoghează DB și apelează `buildRecurringSeries`.

## UI

`components/RecurringSummary.tsx`:

- Afișat pe Sumar (între chip-uri și totals card, sau între insights și totals).
- Header: „Abonamente active" + count.
- Listă: max 5 active vizibile, restul în „vezi toate" (linkează la viitoare ecran dedicat — pentru MVP doar 5).
- Per row: merchant + sumă mediană + cadență („~lunar") + status badge.
- Status `missing`: highlight cu `statusColors.warning` și mesaj „lipsește de X zile".
- Empty state: dacă 0 series → cardul nu se afișează deloc.

Hook în `app/(tabs)/index.tsx` — `useEffect` care apelează `detectRecurringSeries` o dată la load.

## Out of scope

- Cadențe săptămânale/trimestriale (decis MVP doar lunar).
- Predicție forecast (cât vei cheltui luna viitoare pe abonamente).
- Marcare manuală „NU e recurent" pentru a exclude false positives. Pentru MVP: algoritmul se bazează pe ≥ 3 apariții consecutive — false positives improbabile.
- Notificări locale când lipsește un abonament. Lăsat pentru #13 (notificări bugete + abonamente).
- Ecran dedicat „Toate abonamentele". Doar lista pe Sumar.

## Teste

`__tests__/unit/recurring.test.ts`:

- Detectează serie cu 3 apariții lunare în ±10% sumă.
- Ignoră merchant cu doar 2 apariții.
- Ignoră merchant cu sume foarte diferite (>10% variație).
- Ignoră merchant cu cadență neregulată (out of 25-35 zile).
- Status `active` / `missing` / `expired` corect calculat din today.
- Expected next date = last_seen + median_cadence.
- Median amount calculat corect (nu medie).
