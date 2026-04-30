# Redesign navigație — focus pe evoluție și acțiune rapidă

**Data:** 2026-04-30
**Status:** aprobat, urmează plan de implementare
**Aria afectată:** `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/setari.tsx`, formular tranzacție

## Context și motivație

Tab bar-ul curent are 5 sloturi: `Sumar | Conturi | Tranzacții | Categorii | Asistent`. Folosirea reală a aplicației arată că:

- **Importul de extrase** (acțiune lunară) pleacă din Sumar, nu din tabul Conturi.
- **Conturi** ca tab dedicat e redundant: Sumar are deja filtru pe cont, buton de import și link „Conturi" către lista completă.
- **Categorii** se editează rar — e configurare, nu navigație zilnică.
- **Tranzacții** ca listă cronologică se accesează rar; drill-down per categorie din Sumar acoperă fluxul principal.
- Lipsește un slot pentru **adăugare manuală rapidă** de tranzacție.
- Focusul real al utilizatorului e pe **evoluția cheltuielilor**, dar ecranul `evolutie` e ascuns (`href: null`).

## Decizie

Rescriem tab bar-ul cu 5 sloturi orientate pe ce face utilizatorul des:

```
┌─────────┬──────────┬─────────┬──────┬─────────┐
│  Sumar  │ Evoluție │ Adaugă  │ Chat │ Setări  │
└─────────┴──────────┴─────────┴──────┴─────────┘
```

Conturi, Tranzacții și Categorii sunt **mutate fizic din `app/(tabs)/` în `app/`** (rădăcină) ca să fie push-ate corect din Setări/Sumar pe root Stack, cu back button funcțional. Lăsarea lor cu `href: null` în `(tabs)/` ar schimba tabul activ la push, nu ar genera un Stack push real.

## Tab bar — detalii

| Slot | Rută               | Icon          | Titlu    | Comportament                          |
| ---- | ------------------ | ------------- | -------- | ------------------------------------- |
| 1    | `index`            | `pie-chart`   | Sumar    | neschimbat                            |
| 2    | `evolutie`         | `trending-up` | Evoluție | era `href: null`, devine vizibil      |
| 3    | `adauga` (virtual) | `add-circle`  | Adaugă   | tab pattern Instagram (vezi mai jos)  |
| 4    | `assistant`        | `chatbubbles` | Chat     | titlu „Chat" în loc de „Asistent"     |
| 5    | `setari`           | `settings`    | Setări   | mutat din root în `(tabs)/setari.tsx` |

Rutele scoase complet din `(tabs)/` și mutate în rădăcină:

- `app/(tabs)/conturi/` → `app/conturi/` (cu sub-rutele add/edit/import/[id])
- `app/(tabs)/tranzactii/` → `app/tranzactii/` (cu sub-ruta [id])
- `app/(tabs)/categorii.tsx` → `app/categorii.tsx`

Toate referințele `router.push('/(tabs)/conturi/...')`, `/(tabs)/tranzactii/...`, `/(tabs)/categorii` se actualizează la path-uri root (`/conturi/...`, `/tranzactii/...`, `/categorii`).

## Tab „Adaugă" — implementare

Tabul nu are ecran propriu. La tap se deschide formularul de tranzacție nouă **fără** a schimba tabul activ. Implementare:

1. `Tabs.Screen` cu `name="adauga"` (ecran placeholder gol — nu va fi afișat).
2. `listeners={{ tabPress: (e) => { e.preventDefault(); router.push({ pathname: '/(tabs)/tranzactii/[id]', params: { id: 'new' } }); } }}` (forma deja folosită în `app/(tabs)/tranzactii/index.tsx:76`).
3. Stilul iconului poate fi accentuat (ex: `tabBarIconStyle` cu culoare primary, sau icon mai mare) ca să comunice rolul de CTA central.

Avantaj: când utilizatorul închide formularul (back sau salvare), rămâne pe tabul anterior. Nu pierdem starea.

## Setări — devine hub

`app/(tabs)/setari.tsx` capătă o secțiune nouă „**Date**" la început, cu 3 rânduri tappable (icon + label + chevron-forward, stil rând listă):

- `wallet` **Conturi** → `router.push('/(tabs)/conturi')`
- `pricetags` **Categorii** → `router.push('/(tabs)/categorii')`
- `list` **Toate tranzacțiile** → `router.push('/(tabs)/tranzactii')`

Restul secțiunilor existente rămân ca acum, în ordine: Backup & restaurare, Backup în iCloud (iOS), Cont demo (condițional), Asistent AI, Blocare app, Onboarding.

Stilul rândurilor link folosește tokens existente (`Colors[scheme]`, `radius.md`) — nu introducem culori hardcodate.

## Modificări concrete pe fișiere

### `app/(tabs)/_layout.tsx` (rescris)

- Înlocuiește lista actuală de `Tabs.Screen` cu noua ordine.
- `conturi`, `tranzactii`, `categorii` **nu** mai sunt declarate aici (au fost mutate în rădăcină).
- `evolutie` capătă vizibilitate (titlu + icon).
- `setari` adăugat ca tab.
- `adauga` adăugat cu listener pe `tabPress` + ecran placeholder gol `app/(tabs)/adauga.tsx`.

### `app/setari.tsx` → `app/(tabs)/setari.tsx`

- Mutat fizic în folderul `(tabs)/` ca să intre în group-ul de tab-uri.
- Adăugată secțiunea „Date" la începutul `ScrollView`-ului (înainte de „Backup & restaurare").
- `Stack.Screen` cu `headerShown: true` și `title: 'Setări'` rămâne neschimbat.
- Importurile relative se ajustează la noua locație (`@/` rămâne valid).

### Toate referințele `router.push('/setari')` din cod

Devin `router.push('/(tabs)/setari')`. Locații cunoscute (din grep):

- `app/(tabs)/assistant.tsx:122, 195`
- `app/(tabs)/index.tsx:212`

### Bug fix scroll formular tranzacție — `app/(tabs)/tranzactii/[id].tsx`

- Pe `ScrollView`-ul intern (linia ~255 în `KeyboardAvoidingView`): adaugă `keyboardShouldPersistTaps="handled"` ca tap-ul în afara câmpurilor să nu blocheze scrollul când tastatura e deschisă.
- Verifică `behavior` pentru iOS (`padding`) — păstrat ca acum.

## Componente noi / atinse

Niciuna nouă obligatorie. Pentru rândul de link în Setări putem refolosi pattern-ul de `Pressable` deja existent în fișier (stil `button` + secondary), sau introduce un mic `SettingsLinkRow` reutilizabil dacă apar 3+ rânduri (decizie în plan).

## Acceptanță

- Tab bar afișează exact 5 sloturi: Sumar, Evoluție, Adaugă, Chat, Setări.
- Tap pe Adaugă deschide formularul de tranzacție nouă; back-ul revine la tabul anterior.
- Tap pe Conturi/Categorii/„Toate tranzacțiile" în Setări deschide ecranele corespunzătoare cu header și back funcțional.
- Drill-down din Sumar către tranzacție individuală rămâne funcțional.
- Toate flow-urile existente (import extras, edit cont, edit categorie, edit tranzacție, AI chat) rămân accesibile fără regresie.
- Scrollul în formularul tranzacție funcționează cu tastatura deschisă.
- `npm run check` trece (lint + type-check + test + knip + madge + dep-cruise).

## Out of scope

- Refactor vizual al ecranului Setări (rămâne ScrollView-ul actual).
- Animații custom între tab-uri.
- Schimbarea iconografiei sau a paletei.
- Adăugarea de FAB-uri suplimentare.
- Restructurarea ecranului Sumar.
