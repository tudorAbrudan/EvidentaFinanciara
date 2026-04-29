# Design — Tranzacții expandabile pe categorii în Gestiune financiară

**Data:** 2026-04-25
**Scope:** Ecranul `app/(tabs)/entitati/financiar/index.tsx`
**Status:** Aprobat (brainstorm), urmează plan de implementare

## Problema

Pe ecranul Gestiune financiară, secțiunea "Cheltuieli pe categorii" arată doar bara cu suma și numărul de tranzacții pentru fiecare categorie. Utilizatorul nu poate vedea ce tranzacții formează acea sumă fără să intre într-un alt ecran și nu poate recategoriza rapid tranzacții — în special cele "Necategorizate" rezultate dintr-un import de extras.

## Cerință

1. Tap pe o categorie din "Cheltuieli pe categorii" → afișează tranzacțiile acelei categorii **inline**, sub bara categoriei (expand/collapse).
2. Tap pe o tranzacție din lista expandată → ecranul existent de editare (`/entitati/cont/tranzactie?id=X`).
3. Recategorizare rapidă: tap pe pastila/badge-ul de categorie din interiorul rândului tranzacției → picker direct, fără a intra în editorul complet.

## Decizii de design (luate la brainstorm)

- **Expand inline**, nu ecran nou și nu modal full-screen.
- O singură categorie expandată simultan; deschiderea alteia o închide pe cea curentă.
- Toate tranzacțiile categoriei (fără paginare) — utilizatorul are nevoie de acces complet pentru recategorizare bulk-by-tap.
- Secțiunea "Tranzacții recente" se ascunde cât timp e o categorie expandată (evitare dublă afișare).
- **Multi-select bulk amânat pentru Faza 2.** Pentru MVP: tap pe rând = edit complet în ecranul existent, tap pe pastila de categorie = picker rapid inline.

## Arhitectură

### UI flow

```
[Bară categorie A]            ← Pressable, chevron ▶
[Bară categorie B] ◀ tap      ← Pressable
   ↓ becomes
[Bară categorie A]
[Bară categorie B]            ← chevron ▼
   ├─ Tranzacție 1            ← tap row = edit complet
   │   [pastila categorie] ◀ tap = quick picker
   ├─ Tranzacție 2
   └─ Tranzacție 3
[Bară categorie C]
```

Cât timp există o categorie expandată, secțiunea "Tranzacții recente" (de jos) e ascunsă.

### State în `FinanciarHubScreen`

```ts
const [expandedCatKey, setExpandedCatKey] = useState<string | null>(null);
// null         → nicio categorie expandată
// '__uncat__'  → categoria "Necategorizat" expandată
// string (id)  → o categorie reală expandată
```

### Componente noi (în același fișier `index.tsx`)

| Componentă | Rol |
|-----------|-----|
| `CategoryRow` (modificată) | Devine `Pressable`, primește `expanded`, `onPress`. Adaugă chevron ▶/▼. |
| `CategoryTransactionsList` | Sub row-ul expandat. Foloseste `useCategoryTransactions`. Loading skeleton + empty state. |
| `ExpandedTransactionRow` | Variantă a `TransactionRow` cu `Pressable` separat pe pastila categorie (tap pastilă = picker, tap rest = edit). |
| `CategoryQuickPickerModal` | Bottom-sheet cu `Modal` + listă categorii + opțiune "Necategorizat" + buton "Anulează". |

### Hook nou

`hooks/useCategoryTransactions.ts`:

```ts
export function useCategoryTransactions(
  yearMonth: string,
  categoryKey: string | null, // null=disabled, '__uncat__'=uncategorized, otherwise category_id
  accountId?: string
): {
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
```

- Când `categoryKey === null` → no-op (nu fetch).
- Când `categoryKey === '__uncat__'` → `getTransactions({ uncategorized: true, ... })`.
- Altfel → `getTransactions({ category_id: categoryKey, ... })`.
- Toate fetch-urile aplică: `fromDate = ${yearMonth}-01`, `toDate = ${yearMonth}-31`, `excludeDuplicates: true`, `excludeTransfers: true`, `onlyExpenses: true` (filtru nou — vezi secțiunea "Service layer"). Aceste 4 filtre asigură alinierea cu `getCategoryBreakdown`, deci sumele și numărul de tranzacții din lista expandată corespund exact cu cele din bara categoriei.

### Service layer — modificări `services/transactions.ts`

**Extindere `TransactionFilter` cu două flag-uri noi:**

```ts
export interface TransactionFilter {
  // ... existente
  uncategorized?: boolean; // nou: filtru pe category_id IS NULL
  onlyExpenses?: boolean;  // nou: filtru pe amount < 0
}
```

În `getTransactions`, după blocurile existente:

```ts
if (filter.uncategorized === true) {
  where.push('category_id IS NULL');
}
if (filter.onlyExpenses === true) {
  where.push('amount < 0');
}
```

Note semantice:
- `uncategorized` și `category_id` sunt în practică mutual exclusive. Dacă ambele sunt setate, condițiile se combină AND (`category_id = X AND category_id IS NULL`) și rezultatul e gol — comportament corect, fără handling special.
- `onlyExpenses: true` aliniază `getTransactions` cu `getCategoryBreakdown`, care exclude veniturile (`amount < 0`).

`updateTransaction` deja acceptă `category_id: string | null` — recategorizarea funcționează out-of-the-box.

### Quick picker — UX detaliu

`Alert.alert` nu e potrivit pentru 10+ categorii. Folosim `Modal` din React Native cu animație slide-up:

- Header: titlu "Schimbă categoria" + buton "Anulează" în dreapta.
- Listă scrolabilă: fiecare item = ícon categorie + nume. Tap → callback și închide modalul.
- Item special "Necategorizat" (la sfârșitul listei sau la început, cu separator vizual).
- Backdrop tappable pentru închidere.
- Stil identic cu cardurile existente: `palette.card`, `borderRadius: 12`, `padding: 16`, shadow EVPoint.

### Refresh logic

După `updateTransaction(txId, { category_id: newCatId })` în picker:

1. `await refreshExpanded()` — reîncarcă lista categoriei curente (`useCategoryTransactions.refresh`).
2. `await refresh()` — re-fetch breakdown + totaluri (`useMonthlyAnalysis.refresh`).
3. **Edge case:** dacă noua categorie face ca lista expandată să devină goală (toate tranzacțiile au plecat la altă categorie), categoria expandată mai există cât timp `transaction_count > 0` în breakdown. Dacă `breakdown` post-refresh nu mai conține `expandedCatKey`, setăm `setExpandedCatKey(null)`.

La întoarcerea din ecranul de edit (`/entitati/cont/tranzactie?id=X`), `useFocusEffect` din `FinanciarHubScreen` deja face `refresh()`. Dar **lista expandată e gestionată de `useCategoryTransactions`, nu de `useMonthlyAnalysis`** — adăugăm un `useFocusEffect` și pentru hook-ul nou, sau pasăm `refreshExpanded` din componentă în `useFocusEffect` deja existent.

## Edge cases

| Caz | Comportament |
|-----|-------------|
| Lista expandată e goală (după mutare) | Auto-collapse: `setExpandedCatKey(null)`. |
| Eroare la `updateTransaction` în picker | `Alert.alert('Nu s-a putut schimba categoria', e.message)`, picker rămâne deschis. |
| Eroare la fetch lista categoriei | Mesaj inline „Nu s-a putut încărca lista" + buton „Reîncearcă". |
| 60+ tranzacții într-o categorie | Randăm direct cu `.map` în `ScrollView`-ul existent. Refactor la `FlatList` doar dacă apar lag-uri reale. |
| Tranzacție `is_refund` (sumă negativă) | Apare normal în lista expandată cu sufixul „retur" (păstrare comportament `TransactionRow`). |
| Schimbare lună / cont filter cât timp e categorie expandată | Auto-collapse: schimbarea filtrelor invalidează `expandedCatKey`. |
| Theme dark/light | Folosește `palette` existent din `Colors[scheme]` și `primary`/`statusColors`. Niciun hex hardcodat. |

## Performance

- Fetch SQLite local pe lună e tipic <50ms; suficient pentru render imediat.
- Skeleton placeholder scurt (3 rows) afișat doar dacă fetch-ul depășește ~150ms (sau permanent — nu e un cost mare). MVP: spinner mic centrat, simplu.
- Re-render-ul layout-ului la expand nu necesită `LayoutAnimation` — dacă apare un jump vizibil, adăugăm `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` la toggle.

## Ce NU intră în acest scope

- Multi-select bulk (Faza 2).
- Picker inline cu chip-uri (în loc de modal).
- Drag-and-drop între categorii.
- Editare în loc a sumei/datei direct din lista expandată.
- Filtrare/sortare în interiorul listei expandate.

## Fișiere afectate

| Fișier | Tip |
|--------|-----|
| `app/(tabs)/entitati/financiar/index.tsx` | Modificare majoră (state, componente noi, refresh logic) |
| `services/transactions.ts` | Extindere `TransactionFilter` cu `uncategorized` și `onlyExpenses` |
| `hooks/useCategoryTransactions.ts` | Fișier nou |

Niciun tabel SQLite nou, nicio migrare, nicio schimbare în tipuri publice (`Transaction`, `ExpenseCategory`).

## Localizare

Toate textele noi în română:
- "Schimbă categoria"
- "Necategorizat"
- "Anulează"
- "Nu s-a putut încărca lista"
- "Reîncearcă"
- "Nu s-a putut schimba categoria"
