# Harness agentic pentru finante — design (adaptare a spec-ului portabil)

**Data:** 2026-07-30
**Sursa:** spec-ul portabil „Harness-ul agentic" (proiectul sprint-board / AI Brown Bag), adaptat
la realitatea finante. **Plan:** `docs/plans/2026-07-30-agentic-harness.md`.

## Teza (neschimbată față de spec-ul portabil)

Bucla nu se bazează pe încrederea că modelul respectă instrucțiunile. Enforcement-ul e în
hooks + gate-uri; un model care sare o fază e oprit mecanic. Instrucțiunile (AGENTS.md) sunt
„de dorit"; hook-urile sunt „obligatoriu". Proprietatea cheie: **model-independent** — exact
ce ne trebuie ca implementările să poată fi delegate la modele mai ieftine.

## Ce există deja în finante (nu se reconstruiește)

| Componentă    | Stare                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Gate agregat  | `npm run check` (lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit) — mai bogat decât în spec-ul portabil |
| Pre-commit    | husky: **test-pairing** (services fără test = blocat) + lint-staged + type-check                                                     |
| CI            | GitHub Actions rulează `check` pe PR + job dedicat `ai-evals`                                                                        |
| Proceduri     | `.claude/skills/` (5 skills) — echivalentul `.claude/commands/` din spec                                                             |
| Agenți        | `bank-parser-reviewer`, `landing-copy-reviewer` (rămân, sunt specializați)                                                           |
| Hook          | PostToolUse `sync-docs.sh` pe `git commit` (rămâne)                                                                                  |
| Workflow docs | IDEAS → spec → plan → implementare (echivalentul CONTEXT→PLAN pe hârtie)                                                             |

**Golurile reale:** nimic nu leagă mecanic fazele de editare (plan-gate), de sfârșitul turei
(Stop-gate cu dovezi), de push (agentul poate împinge; nu există pre-push, nici APPROVE uman);
nu există roluri cu unelte/modele impuse pentru delegare; nu există LEARNINGS versionat.

## Decizii de adaptare

### A1 — Ordine: parserul BT întâi, harness-ul imediat după

Parserul are deja acceptanță auto-verificabilă (reconciliere la ban + fixtures) — fazele
impuse i-ar adăuga puțin. Harness-ul, în schimb, atinge `settings.json` care afectează
**fiecare sesiune viitoare**: se instalează într-o fereastră liniștită, se rodează, și abia
apoi rulează feature-uri sub el. Bugetele (IDEAS #12) = primul feature implementat sub harness.

### A2 — AGENTS.md canonic, CLAUDE.md pointer subțire

Conținutul din `CLAUDE.md` se mută în `AGENTS.md` (canonic, vendor-neutral, aliniat cu
celălalt proiect al userului); `CLAUDE.md` devine pointer. Gate nou `check:pointers` impune
subțirimea pointerului (sub 15 linii, fără reguli proprii).

### A3 — Fazele: aceleași mecanici, mai puțin ceremonial

Bucla efectivă: **PLAN → IMPLEMENT → VERIFY → REVIEW → LEARN**, cu CHECK înglobat în VERIFY
(`npm run check`) și APPROVE la pre-push. Fără bannere de 50×# — statusline-ul arată faza.
Dovezile de fază = chitanțe cu fingerprint pe diff (`.claude/state/phase-*.json`, gitignored
deja prin `.claude/*`).

### A4 — Definiția „cod de feature" (ce declanșează gate-urile)

`services/**`, `app/**`, `components/**`, `hooks/**`, `theme/**`, `types/**` — exclus
`__tests__/**`. Docs, landing, scripts, fixtures nu cer plan/dovezi.

### A5 — VERIFY e specific React Native, nu Playwright

Chitanța VERIFY se leagă de fingerprint-ul diff-ului și cere:

- diff care atinge `app/|components/|theme/` → **≥1 screenshot iOS Simulator** (hash-uit,
  re-verificat) — aliniat cu regula globală „done = dovedit pe device";
- diff doar în `services/` → dovadă de rulare teste (`npm test` exit 0 la fingerprint-ul curent).
  Playwright rămâne doar pentru `landing/` (site static). Fără e2e mobile în această etapă
  (Maestro = idee separată în IDEAS, nu blocant).

### A6 — Roluri și modele (bindings enforced în `.claude/agents/`)

| Rol      | Model  | Unelte                               | Notă                                                                        |
| -------- | ------ | ------------------------------------ | --------------------------------------------------------------------------- |
| planner  | opus   | read-only + Context7                 | nu editează niciodată                                                       |
| coder    | sonnet | toate                                | implementează planul, rulează check                                         |
| reviewer | opus   | read-only + Bash                     | cold-read pe diff; generic — cei doi revieweri specializați existenți rămân |
| verifier | sonnet | read-only + Bash + iOS Simulator MCP | screenshot-uri pentru VERIFY                                                |

Orchestratorul = agentul principal (fără binding; sub-agenții nu lansează sub-agenți).
Definiții canonice în `agents/<rol>.md`, bindings subțiri în `.claude/agents/<rol>.md` cu
`tools:`/`model:` în front-matter (enforcement mecanic). Sesiunile interactive cu Fable
rămân neschimbate — harness-ul nu impune modelul agentului principal.

### A7 — Controale pe push

- PreToolUse pe Bash **blochează `git push`** din orice sesiune de agent.
- `.husky/pre-push` nou: `check:workflow` (chitanțe valide + LEARNINGS atins la diff de
  feature) → `npm run check` → **APPROVE tastat de om la `/dev/tty`** (nu stdin — un agent
  nu poate fabrica consimțământul; refuz dacă nu există terminal interactiv).
- `--no-verify` rămâne fizic posibil (documentat ca interzis); controlul autoritar =
  branch protection pe GitHub — decizie umană separată, în afara acestui plan.

### A8 — Escape hatches + fail-open (nemodificate din spec-ul portabil)

`.claude/state/workflow-pause` (one-shot), `workflow-override` (persistent, auditabil).
Orice eroare internă de tooling în hook → **exit 0** (fail-open): un guardrail local nu are
voie să te blocheze într-o tură ne-terminabilă. Stop hook-ul respectă `stop_hook_active`
(anti-buclă). Guardrail-urile (hooks, gate-uri, bindings) sunt **off-limits pentru
self-learning** — se schimbă doar prin decizie umană; `permissions.deny` protejează
`settings.json` de Edit/Write.

### A9 — Ce NU portăm (și de ce)

- **`.mcp.json` cu versiuni pinuite** — MCP-urile sunt configurate la nivel user pe o
  singură mașină (solo); pinning-ul e overhead fără echipă. Documentat în AGENTS.md.
- **OKF front-matter + export** — overkill pentru proiect personal; memoria + docs acoperă.
- **`.claude/commands/`** — skills-urile existente sunt echivalentul deja adoptat.
- **PR template Azure DevOps** — repo pe GitHub; un `.github/pull_request_template.md`
  minimal e inclus, atât.
- **Serena MCP** — neinstalat, nefolosit; navigarea LSP nu e gâtuirea actuală.
- **Cost în statusline** — statusline-ul arată faza + branch; costul per fază e raportat
  de orchestrator la APPROVE, nu calculat de scripturi.

### A10 — LEARNINGS.md

Adoptat, versionat, PR-reviewed. Regula de promovare: coupling → AGENTS.md; decizie →
spec/ADR în docs; procedură → skill; checklist de rol → `agents/<rol>.md`. Memoria
persistentă a lui Claude (per-mașină) rămâne complementară — LEARNINGS e ce vrei în git.

## Riscul principal și cum îl ținem în frâu

Un Stop-hook sau plan-gate cu bug = sesiuni blocate sau gate-uri care mint. De aceea:
(1) toate scripturile de enforcement au **teste unitare** care le rulează ca procese cu
stdin de fixture (exit 0 / exit 2 / stderr asertate); (2) fail-open peste tot; (3) rodaj
live scriptat la final (checklist în plan) înainte de a considera harness-ul activ.
