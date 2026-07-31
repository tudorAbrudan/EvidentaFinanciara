# Finanțe Personale — context canonic pentru agenți

Aplicație React Native + Expo (TypeScript) pentru gestiunea financiară personală.
Local-first: datele rămân pe device, AI și cloud sync sunt opționale și transparente.
Limba UI și docs: română.

> Acesta e documentul canonic, vendor-neutral. `CLAUDE.md` e doar un pointer către el —
> gate-ul `npm run check:pointers` îl ține subțire. Orice regulă nouă se scrie aici.

## Comenzi uzuale

| Comandă                  | Ce face                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `npm start`              | Pornește Expo dev server                                                                            |
| `npm run ios`            | Build și rulare iOS simulator (Debug)                                                               |
| `npm run ios:release`    | Build Release + instalare + launch pe simulator (JS bundled)                                        |
| `npm run ios:dist:sim`   | `.app` Release standalone pentru simulator (gata de Distribute / partajat)                          |
| `npm run android`        | Build și rulare Android emulator                                                                    |
| `npm run lint`           | ESLint pe `.ts`/`.tsx`                                                                              |
| `npm run lint:fix`       | ESLint cu auto-fix                                                                                  |
| `npm run type-check`     | `tsc --noEmit`                                                                                      |
| `npm test`               | Jest                                                                                                |
| `npm run test:watch`     | Jest în watch mode                                                                                  |
| `npm run evals:ai`       | Doar AI eval harness (`__tests__/evals/`) — parser + schema + sanitizare prompt-uri                 |
| `npm run parse:pdf`      | Rulează extractor + parser pe un PDF local și tipărește raportul de reconciliere                    |
| `npm run format`         | Prettier write                                                                                      |
| `npm run check:pointers` | Verifică că `CLAUDE.md` a rămas pointer subțire către `AGENTS.md`                                   |
| `npm run check:workflow` | Gate de pre-push: chitanțe de fază valide + `LEARNINGS.md` atins la diff de feature                 |
| `npm run check`          | Tot lanțul: pointers + lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit |

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
- `agents/` — definițiile canonice ale rolurilor (bindings subțiri în `.claude/agents/`)
- `scripts/` — gate-uri de workflow, hook-uri și utilitare de build

## Workflow feature

1. Idee → `docs/IDEAS.md` (roadmap).
2. Validată → spec în `docs/specs/YYYY-MM-DD-<topic>-design.md`.
3. Aprobat → plan în `docs/plans/YYYY-MM-DD-<topic>.md`.
4. Implementat → cu teste, `npm run check` trece.
5. Finalizat → status în IDEAS, landing dacă user-visible, AGENTS.md/ARCHITECTURE.md dacă convenții/structură noi.

## Bucla de lucru

**PLAN → IMPLEMENT → VERIFY → REVIEW → LEARN.** Fazele nu sunt ceremonial: sunt impuse
mecanic de hook-uri. Un model care sare o fază e oprit, nu mustrat. Dovada fiecărei faze e
o **chitanță** în `.claude/state/phase-<fază>.json`, legată de un fingerprint al diff-ului —
orice editare ulterioară invalidează chitanțele vechi.

| Fază          | Ce se întâmplă                                                        | Cum se înregistrează                                                              |
| ------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **PLAN**      | Plan aprobat înainte de prima editare de cod de feature               | `node scripts/record-phase.mjs plan "<rezumat>"`                                  |
| **IMPLEMENT** | Se scrie codul; plan-gate-ul lasă editările să treacă                 | — (implicit)                                                                      |
| **VERIFY**    | `npm run check` verde; UI dovedit pe simulator dacă diff-ul atinge UI | `node scripts/record-phase.mjs verify "<ce s-a verificat>" [--screenshot <cale>]` |
| **REVIEW**    | Cold-read pe diff, de preferat prin sub-agentul `reviewer`            | `node scripts/record-phase.mjs review "<concluzia review-ului>"`                  |
| **LEARN**     | Ce s-a învățat intră în `LEARNINGS.md`                                | editare `LEARNINGS.md` (cerut la push, nu la sfârșit de tură)                     |

**Cod de feature** = fișierele care declanșează gate-urile:
`services/`, `app/`, `components/`, `hooks/`, `theme/`, `types/` — exclus `__tests__/`.
Docs, landing, scripts și fixtures nu cer plan sau dovezi.

**VERIFY cere screenshot** când diff-ul atinge `app/`, `components/` sau `theme/`: „done =
dovedit pe device". Screenshot-urile sunt hash-uite la înregistrare și re-verificate la
validare — nu poți înregistra o dovadă și apoi înlocui imaginea.

**Gate-urile care rulează:**

| Gate             | Când                     | Ce cere                                                        |
| ---------------- | ------------------------ | -------------------------------------------------------------- |
| plan-gate        | PreToolUse pe Edit/Write | chitanță `plan` pe HEAD-ul curent, dacă editezi cod de feature |
| Stop-gate        | la sfârșit de tură       | chitanțe `verify` + `review` valide pe fingerprint-ul curent   |
| no-push          | PreToolUse pe Bash       | blochează `git push` din sesiunile de agent                    |
| `check:workflow` | pre-push (husky)         | `LEARNINGS.md` atins în range + chitanțe valide                |
| APPROVE          | pre-push (husky)         | omul tastează `APPROVE` la `/dev/tty`                          |

**Escape hatches.** `touch .claude/state/workflow-pause` — excepție one-shot (se consumă
automat după o folosire). `.claude/state/workflow-override` — excepție persistentă. Ambele
scriu o linie de audit în `.claude/state/override-log.txt`. Sunt pentru situații reale
(gate cu bug, urgență), nu pentru a scurta bucla.

**Fail-open.** Orice eroare internă într-un gate (JSON corupt, git indisponibil, eroare de
fs) înseamnă exit 0. Un guardrail local nu are voie să te blocheze într-o tură
ne-terminabilă. Gate-urile protejează procesul, nu se substituie judecății.

## Roluri și delegare

Definițiile canonice sunt în `agents/<rol>.md`; bindings-urile din `.claude/agents/<rol>.md`
impun mecanic modelul și uneltele. Orchestratorul e agentul principal al sesiunii (fără
binding). Sub-agenții nu lansează sub-agenți.

| Rol        | Model  | Unelte                               | Notă                                  |
| ---------- | ------ | ------------------------------------ | ------------------------------------- |
| `planner`  | opus   | read-only + Context7                 | nu editează niciodată                 |
| `coder`    | sonnet | toate                                | implementează planul, rulează `check` |
| `reviewer` | opus   | read-only + Bash                     | cold-read pe diff; generic            |
| `verifier` | sonnet | read-only + Bash + iOS Simulator MCP | screenshot-uri pentru VERIFY          |

Cei doi revieweri specializați existenți (`bank-parser-reviewer`, `landing-copy-reviewer`)
rămân neschimbați — sunt complementari, nu înlocuiți de `reviewer`-ul generic.

Sesiunile interactive nu au model impus: harness-ul nu dictează modelul agentului principal.

## Reguli operaționale

- **Agentul nu face push.** `git push` e blocat din sesiunile de agent. Push-ul îl face omul,
  din terminal, prin pre-push gate cu APPROVE tastat. Un agent nu poate fabrica
  consimțământul: APPROVE se citește de la `/dev/tty`, nu de pe stdin.
- **Guardrails human-only.** Hook-urile, gate-urile, `.claude/settings.json` și `.husky/**`
  nu se modifică de către agenți și sunt **off-limits pentru self-learning**. Se schimbă
  doar prin decizie umană explicită. `permissions.deny` le protejează de Edit/Write.
- **`--no-verify` e interzis** prin convenție. Rămâne fizic posibil; controlul autoritar e
  branch protection pe GitHub (decizie umană separată).
- **Fără date personale în repo.** Fixture-urile de extrase bancare se anonimizează
  (`__tests__/fixtures/bt-pdf/anonymize.py`). Niciun PDF real, niciun IBAN real.
- **MCP-uri.** Context7 (docs live), iOS Simulator (verificare UI mobil) și Playwright
  (doar pentru `landing/`) sunt configurate la nivel user, pe o singură mașină. Nu ținem
  `.mcp.json` cu versiuni pinuite: fără echipă, pinning-ul e overhead fără beneficiu.

## LEARNINGS și regula de promovare

`LEARNINGS.md` e versionat și trece prin PR. E memoria din git — complementară memoriei
persistente per-mașină a agentului, nu în locul ei.

O lecție nu rămâne în LEARNINGS dacă are un loc mai bun. Regula de promovare:

| Ce ai învățat             | Unde se promovează            |
| ------------------------- | ----------------------------- |
| un coupling / o convenție | `AGENTS.md`                   |
| o decizie de arhitectură  | spec sau ADR în `docs/`       |
| o procedură repetabilă    | un skill în `.claude/skills/` |
| un checklist de rol       | `agents/<rol>.md`             |

## Gating commit

- **Pre-commit (Husky)** rulează: test-pairing (services fără test = blocat), `lint-staged`
  (ESLint + Prettier), `type-check`.
- **Pre-push (Husky)** rulează: `check:workflow` → `npm run check` → APPROVE uman.
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

- `planner`, `coder`, `reviewer`, `verifier` — rolurile buclei (definiții în `agents/`).
- `bank-parser-reviewer` — review independent pe schimbări de parser bănci.
- `landing-copy-reviewer` — verifică alinierea landing ↔ feature-uri reale.
