---
name: rn-expo-conventions
description: Use when editing files in app/, components/, hooks/, theme/, or any TSX file in this project — enforces project conventions for TypeScript, theme tokens, useColorScheme imports, alias paths, and Romanian UI text.
---

# RN/Expo conventions — Finanțe Personale

Reguli proiect pentru editarea de cod RN/Expo. Aplică-le proactiv, fără ca userul să le ceară explicit.

## TypeScript

- **Strict mode activ.** Nu introduce `any` — folosește tipuri explicite sau `unknown` + narrowing.
- `@typescript-eslint/no-explicit-any` e ridicat la `error` (în teste e doar `warn`).
- Tipuri partajate în `types/` sau lângă consumator dacă e local.

## Texte UI

- **Toate textele UI sunt în română.** Inclusiv erori afișate userului, butoane, label-uri.
- Tonul: prietenos, direct, fără jargon tech.
- Erori tehnice: în log-uri (`console.warn`/`console.error`), nu în UI.

## Theme și culori

- **Zero culori hardcodate.** Folosește `Colors[scheme]` din `@/theme/colors`.
- Pentru status: `statusColors` (success, warning, danger).
- `primary` din `@/theme/colors` pentru accent.
- `useColorScheme()` se importă **doar** din `@/components/useColorScheme` — niciodată din `react-native` direct (proiectul are wrapper care gestionează override-ul user din Setări).

## Import-uri

- Cross-folder: alias `@/` (configurat în `tsconfig.json` `paths`).
  ```ts
  import { Colors } from '@/theme/colors';
  // NU: import { Colors } from '../../theme/colors';
  ```
- În același folder: relative OK.
- ESLint enforce ordinea: builtin → external → internal (`@/`) → parent → sibling, separate prin newline.

## Componente

- Split fișiere la peste **250 linii**.
- Hook-uri custom: prefix `use*`, locație `hooks/` sau `components/use*.ts` dacă e UI-bound.
- `useState`/`useEffect` cu `react-hooks/exhaustive-deps` la `error` — adaugă toate dependențele sau folosește `useCallback`/`useMemo`.

## Async & Promises

- `@typescript-eslint/no-floating-promises` la `error`.
- `Promise` ne-await-uit: prefix `void` explicit dacă vrei să-l ignori.
  ```ts
  void saveDraft();
  ```
- Handler-i UI (`onPress` etc.): nu pasa `async () => {}` direct — wrap cu `() => { void doAsync(); }`.

## Anti-patterns

- ❌ `import { useColorScheme } from 'react-native';`
- ❌ `style={{ color: '#FF0000' }}` — folosește `Colors[scheme].danger`.
- ❌ `<Button onPress={async () => await save()} />` — `void` explicit.
- ❌ `function foo(x: any) { ... }` — tipează sau folosește generic.
- ❌ `import { foo } from '../../../services/bar';` — folosește `@/services/bar`.
