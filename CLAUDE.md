# Finanțe Personale — context proiect pentru Claude

Aplicație React Native + Expo (TypeScript) pentru gestiunea financiară personală.
Local-first: datele rămân pe device, AI și cloud sync sunt opționale și transparente.
Limba UI și docs: română.

## Comenzi uzuale

| Comandă              | Ce face                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `npm start`          | Pornește Expo dev server                                                                 |
| `npm run ios`        | Build și rulare iOS simulator                                                            |
| `npm run android`    | Build și rulare Android emulator                                                         |
| `npm run lint`       | ESLint pe `.ts`/`.tsx`                                                                   |
| `npm run lint:fix`   | ESLint cu auto-fix                                                                       |
| `npm run type-check` | `tsc --noEmit`                                                                           |
| `npm test`           | Jest                                                                                     |
| `npm run test:watch` | Jest în watch mode                                                                       |
| `npm run format`     | Prettier write                                                                           |
| `npm run check`      | Tot lanțul: lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit |

## Convenții cod

- **TypeScript strict.** `any` e error (warning în teste).
- **Texte UI și docs în română.**
- **Theme tokens:** `Colors[scheme]` din `@/theme/colors`. Zero culori hardcodate.
- **`useColorScheme`:** import doar din `@/components/useColorScheme` (nu din `react-native`).
- **Alias `@/`** pentru import-uri cross-folder. Fără `../../` între folder-e top-level.
- **Componente** se split la peste 250 linii.
- **Servicii pure:** `services/` nu importă din `components/`, `app/`, `hooks/` (enforce via `dependency-cruiser`).

## Structură folder

Detalii în `docs/ARCHITECTURE.md`. Pe scurt:

- `app/` — rute Expo Router
- `services/` — logică pură (DB, parsere, AI, backup, cloud)
- `components/` — UI reutilizabil
- `hooks/` — React hooks custom
- `theme/` — culori și tokens
- `__tests__/unit/` — teste Jest pe servicii
- `landing/` — site static prezentare (deploy GitHub Pages)
- `docs/` — IDEAS, specs, plans

## Workflow feature

1. Idee → `docs/IDEAS.md` (roadmap).
2. Validată → spec în `docs/specs/YYYY-MM-DD-<topic>-design.md`.
3. Aprobat → plan în `docs/plans/YYYY-MM-DD-<topic>.md`.
4. Implementat → cu teste, `npm run check` trece.
5. Finalizat → status în IDEAS, landing dacă user-visible, CLAUDE.md/ARCHITECTURE.md dacă convenții/structură noi.

## Gating commit

- **Pre-commit (Husky)** rulează: test-pairing (services fără test = blocat), `lint-staged` (ESLint + Prettier), `type-check`.
- **CI (GitHub Actions)** rulează `npm run check` la fiecare PR.
- **Hook PostToolUse** semnalează după commit dacă docs/landing pot fi învechite.

## Skill-uri proiect (`.claude/skills/`)

| Skill                 | Când                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `rn-expo-conventions` | editare în `app/`, `components/`, `hooks/`, sau orice TSX                          |
| `sqlite-migration`    | modificare schemă în `services/db.ts`                                              |
| `bank-parser-pattern` | modificare/adăugare parser în `services/bankStatement*.ts`                         |
| `ai-prompt-ro`        | modificare prompt-uri/mappers în `services/aiProvider.ts`, `aiStatement*Mapper.ts` |
| `feature-checklist`   | finalizare feature din IDEAS                                                       |

## Agenți proiect (`.claude/agents/`)

- `bank-parser-reviewer` — review independent pe schimbări de parser bănci.
- `landing-copy-reviewer` — verifică alinierea landing ↔ feature-uri reale.
