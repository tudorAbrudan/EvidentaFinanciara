# Tooling, agenți, skill-uri și hook-uri — Design

> **Status:** propus, în așteptare review user.
> **Data:** 2026-04-29.
> **Scop:** ridică nivelul de calitate al codului, automatizează mentenanța documentației și a sitului de prezentare, și instaurează un set consistent de skill-uri/agenți specializați pentru proiect.

## Motivație

Proiectul are deja TS strict, ESLint, Prettier, Jest și o suită de teste pe `services/`. Lipsesc:

1. **CI** — niciun workflow nu rulează lint/type-check/test la PR.
2. **Pre-commit** — nimic nu blochează commit-uri cu cod care strică.
3. **Verificare statică completă** — fără `knip` (cod mort), `madge` (cicluri), `dependency-cruiser` (reguli arhitecturale), `type-coverage`.
4. **Mentenanță documentație** — `docs/IDEAS.md` se desincronizează ușor de cod; `landing/index.html` poate promova feature-uri care nu există încă.
5. **Hook-uri Claude Code la nivel proiect** — `.claude/settings.json` nu există; nu există nicio automatizare pentru sync docs.
6. **Procedurile recurente** (migrații SQLite, parser bancă nou, prompt AI nou) nu sunt codificate ca skill-uri — fiecare implementare reinventează checklist-ul.

Designul rezolvă toate punctele de mai sus printr-un sistem cu patru straturi.

---

## Arhitectură generală

```
.claude/
├── settings.json              # hook PostToolUse sync-docs
├── hooks/
│   └── sync-docs.sh           # script bash inteligent
├── skills/
│   ├── rn-expo-conventions/SKILL.md
│   ├── sqlite-migration/SKILL.md
│   ├── bank-parser-pattern/SKILL.md
│   ├── ai-prompt-ro/SKILL.md
│   └── feature-checklist/SKILL.md
└── agents/
    ├── bank-parser-reviewer.md
    └── landing-copy-reviewer.md

CLAUDE.md                      # convenții + comenzi (root)
docs/
├── ARCHITECTURE.md             # hartă code + fluxuri date
├── IDEAS.md                    # roadmap (existent)
├── specs/                      # design docs (existent)
└── plans/                      # implementation plans (existent)

.husky/
└── pre-commit                  # lint-staged + test-pairing + type-check

.github/workflows/
├── pages.yml                   # existent
└── check.yml                   # nou — lint + type-check + test + analize

# repo root
.eslintrc.js                    # upgrade
knip.json                       # nou
.dependency-cruiser.cjs         # nou
package.json                    # scripts + deps noi
.gitignore                      # + coverage/, .eslintcache
```

---

## Stratul 1 — Hook-uri Claude Code

### Hook 1: `sync-docs` (PostToolUse pe `git commit`)

**Locație config:** `.claude/settings.json`.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/sync-docs.sh"
          }
        ]
      }
    ]
  }
}
```

**Locație script:** `.claude/hooks/sync-docs.sh` (executable).

**Logică:**

1. Hook-ul primește pe stdin un JSON cu `tool_input` (comanda Bash) și `tool_response`.
2. Filtru: dacă comanda nu conține `git commit`, exit 0 fără output.
3. Filtru: dacă `tool_response.success` e `false`, exit 0 (commit-ul a eșuat — nu e nimic de sync).
4. Rulează `git diff HEAD~1 HEAD --name-only` în repo root.
5. **Filtru smart**: dacă diff-ul atinge **doar** `landing/**`, `docs/**`, `.github/**`, `.claude/**`, `*.md`, exit 0 fără output.
6. Dacă diff-ul atinge `app/**`, `services/**`, `components/**`, `hooks/**`, `theme/**`:
   - Construiește un mesaj `additionalContext` care:
     - Listează fișierele modificate (max 30 linii — trunchiere dacă mai multe).
     - Listează commit message-ul HEAD.
     - Cere lui Claude (în următoarea sesiune sau în continuare) să verifice 4 fișiere și să **propună** modificări (nu să le aplice automat fără confirmare):
       - `docs/IDEAS.md` — feature implementat? mută în „done" sau marchează status.
       - `landing/index.html` — feature user-visible? actualizează lista features.
       - `CLAUDE.md` — script nou în `package.json`, convenție nouă, comandă nouă?
       - `docs/ARCHITECTURE.md` — folder/modul nou, flux nou de date?
     - **Semnal-only** pentru `docs/privacy.html` / `docs/terms.html`: dacă commit-ul atinge `services/aiProvider.ts`, `services/cloudStorage.ts`, `services/cloudSync.ts`, `services/backup.ts` → emit avertisment „verifică manual privacy/terms".
7. Output JSON conform protocolului PostToolUse:
   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "PostToolUse",
       "additionalContext": "<mesajul de mai sus>"
     }
   }
   ```

**Notă comportamentală:** hook-ul nu modifică nimic și nu blochează nimic. Doar emite un mesaj care îl pune pe Claude să propună update-uri docs ca un commit separat după.

**Edge cases:**
- Commit `--amend` — `HEAD~1 HEAD` rămâne valid.
- Merge commit / commit gol — diff-ul e gol, scriptul tace.
- Primul commit pe branch — `git diff HEAD~1` poate eșua; scriptul tratează exit code și tace.
- Commit care atinge multiple zone — toate se listează, prioritizate IDEAS > landing > CLAUDE > ARCHITECTURE.

### De ce nu și PreToolUse pentru teste

Pre-commit-ul strict pentru pairing teste-cod este implementat ca **Husky pre-commit** (vezi Stratul 3) ca să prindă atât commit-urile lui Claude (prin Bash) cât și pe cele rulate manual din terminal. Un singur loc, o singură politică.

---

## Stratul 2 — Skill-uri și Agenți

### Skill-uri proiect

Locație: `.claude/skills/<nume>/SKILL.md`. Frontmatter cu `name` și `description`. Conținut concis (50–150 linii fiecare).

#### `rn-expo-conventions`

**Description:** „Use when editing files in `app/`, `components/`, `hooks/`, or any TSX file."

**Conținut:**
- TS strict, fără `any` (warning escalat la error).
- Toate textele UI în română.
- `useColorScheme` import doar din `@/components/useColorScheme` (nu din `react-native`).
- Zero culori hardcodate — folosește `Colors[scheme]` din `@/theme/colors` și `primary`/`statusColors`.
- Path-uri import cross-folder folosesc alias `@/` (vezi `tsconfig.json`).
- Componente noi: split la peste 250 linii.
- Hook-uri custom: prefix `use*`, locație `hooks/` sau `components/use*.ts` dacă e UI-bound.

#### `sqlite-migration`

**Description:** „Use when modifying `services/db.ts` schema or adding tables."

**Conținut:**
- Adaugă migrație nouă în array-ul de migrații; **niciodată** edit la migrații existente.
- Verifică compat cu format backup ZIP (`services/backup.ts` păstrează versiuni vechi citibile).
- Update `services/manifestHash.ts` dacă schimbi structura serializată (manifest hash = invalidare cache).
- Test migration round-trip în `__tests__/unit/` (creare DB curat → aplicare migrații → verificare schemă).
- Schema changes user-visible → semnalează în spec-ul featurei.

#### `bank-parser-pattern`

**Description:** „Use when editing `services/bankStatement*.ts` or adding new bank parsers."

**Conținut:**
- Fixture nouă în `__tests__/fixtures/<bank>/` (PDF/CSV scurt, anonimizat — fără date reale).
- Test pentru: parse OK, deduplicate cu același hash, RON și EUR, virgulă și punct decimal, dată în format RO și ISO.
- Regex-uri robuste — nu match generic care prinde și header-e.
- Edge cases: extrase cu pagini multiple, headere repetate, footer-e cu sume agregate.
- Toate textele de eroare în română.

#### `ai-prompt-ro`

**Description:** „Use when editing `services/aiProvider.ts`, `services/aiStatement*Mapper.ts`."

**Conținut:**
- Toate prompt-urile în română.
- Schema JSON output stabilă — nu schimba câmpuri fără update concomitent în mapper și în testele snapshot.
- Rate-limit free tier (20/zi) e built-in, premium = nelimitat sau cheie proprie (provider `external`).
- Verifică test-uri snapshot pentru schema răspuns AI.
- Consent user pentru AI rămâne explicit; nu adaugi pași automați fără opt-in.

#### `feature-checklist`

**Description:** „Use when finishing a feature from `docs/IDEAS.md`."

**Checklist final (toate punctele):**
- [ ] Spec în `docs/specs/<data>-<topic>-design.md`
- [ ] Plan în `docs/plans/<data>-<topic>.md`
- [ ] Implementare cu teste în `__tests__/unit/`
- [ ] `npm run check` trece (lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit)
- [ ] `docs/IDEAS.md`: feature mutat în „done" sau marcat cu status
- [ ] `landing/index.html`: actualizat dacă feature e user-visible
- [ ] `CLAUDE.md` / `docs/ARCHITECTURE.md`: actualizat dacă convenții sau structură nouă

### Agenți specializați

Locație: `.claude/agents/<nume>.md`. Frontmatter cu `name`, `description`, `tools`. Invocați explicit prin tool-ul `Agent`.

#### `bank-parser-reviewer`

**Description:** „Use to review bank parser changes before commit."

**Tools:** `Read`, `Grep`, `Glob`.

**Rol:** citește diff-ul curent pe `services/bankStatement*` + fixture-uri din `__tests__/fixtures/`, verifică test coverage pentru cazurile noi, semnalează edge cases ratate (RON vs EUR, decimal separator, dată ambiguă, deduplicate). Produce raport scurt sub 200 cuvinte.

#### `landing-copy-reviewer`

**Description:** „Use to verify landing page copy matches actual implemented features."

**Tools:** `Read`, `Grep`.

**Rol:** citește `docs/IDEAS.md` + `landing/index.html`, semnalează:
- Feature pe landing care nu apare ca implementat în IDEAS.
- Feature implementat (în IDEAS sau în cod) care nu apare pe landing.
- Texte landing care promit ceva neacoperit de cod (ex. „funcționează cu BT" dar nu există parser BT).

Raport sub 200 cuvinte.

---

## Stratul 3 — Verificare statică + Pre-commit

### 3.1 Upgrade ESLint

`.eslintrc.js` modificat:

```js
module.exports = {
  extends: ['expo', 'prettier'],
  plugins: ['prettier', 'import', 'security', 'jest'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
  },
  rules: {
    'prettier/prettier': 'warn',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'react-hooks/exhaustive-deps': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'import/order': ['warn', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
    'import/no-cycle': 'error',
    'security/detect-unsafe-regex': 'warn',
    'security/detect-eval-with-expression': 'error',
  },
  overrides: [
    {
      files: ['__tests__/**/*.{ts,tsx}'],
      env: { 'jest/globals': true },
      rules: { 'security/detect-non-literal-fs-filename': 'off' },
    },
  ],
  ignorePatterns: ['node_modules/', '.expo/', 'dist/', 'build/', 'coverage/'],
};
```

**Note:**
- Typed linting (`parserOptions.project`) e necesar pentru `no-floating-promises` și `await-thenable`. Crește puțin timpul de lint, dar e suficient pe proiect mic.
- `import/no-cycle` la `error` — proiectul e mic, ciclurile sunt evitabile.
- `security/detect-non-literal-fs-filename` dezactivat în teste (fixture-uri citite cu path dinamic).

### 3.2 Tools noi

| Tool | Scop | Config |
|---|---|---|
| `knip` | cod mort + import-uri nefolosite | `knip.json` cu `entry: ['app/**/*.tsx', 'expo-router/entry']` și `project: ['**/*.{ts,tsx}']` |
| `madge` | dependențe ciclice | rulat ca `madge --circular --extensions ts,tsx services/ components/ hooks/ app/` |
| `dependency-cruiser` | reguli arhitecturale | `.dependency-cruiser.cjs` cu reguli (vezi mai jos) |
| `type-coverage` | % cod tipat | rulat ca `type-coverage --strict --at-least 95` |

### 3.3 Reguli `dependency-cruiser`

`.dependency-cruiser.cjs`:

```js
module.exports = {
  forbidden: [
    {
      name: 'services-no-ui',
      severity: 'error',
      from: { path: '^services' },
      to: { path: '^(components|app|hooks)' },
      comment: 'services/ trebuie să rămână pure logic, fără import UI.',
    },
    {
      name: 'components-no-app',
      severity: 'error',
      from: { path: '^components' },
      to: { path: '^app' },
      comment: 'components/ nu cunosc structura ecranelor.',
    },
    {
      name: 'no-test-imports-in-prod',
      severity: 'error',
      from: { pathNot: '(^__tests__|^__mocks__)' },
      to: { path: '(^__tests__|^__mocks__)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
};
```

### 3.4 Coverage Jest

În `package.json`, secțiunea `jest`:

```json
"collectCoverageFrom": [
  "services/**/*.ts",
  "!services/**/*.d.ts"
],
"coverageThreshold": {
  "global": {
    "lines": 70,
    "branches": 60,
    "functions": 70,
    "statements": 70
  }
}
```

Prag inițial conservator (am tests pe `services/` deja, dar nu 100% acoperite). Ridicăm pe măsură ce adăugăm teste.

### 3.5 Husky + lint-staged

`.husky/pre-commit` (Husky v9+ style — fără `husky.sh` source):

```bash
#!/usr/bin/env sh

# 1. Test-pairing check
staged=$(git diff --cached --name-only --diff-filter=ACM)
services_staged=$(echo "$staged" | grep -E '^services/.*\.ts$' | grep -v '\.test\.ts$' || true)
tests_staged=$(echo "$staged" | grep -E '^__tests__/unit/.*\.test\.ts$' || true)

if [ -n "$services_staged" ] && [ -z "$tests_staged" ]; then
  echo "Modificare în services/ fără test nou:"
  echo "$services_staged"
  echo "Adaugă test în __tests__/unit/ sau folosește 'git commit --no-verify' cu motivul în mesaj."
  exit 1
fi

# 2. Lint-staged
npx lint-staged

# 3. Type-check rapid
npm run type-check
```

**Configurație `lint-staged`** în `package.json`:

```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

### 3.6 Script `check` agregat

În `package.json`:

```json
"scripts": {
  "knip": "knip",
  "madge": "madge --circular --extensions ts,tsx services components hooks app",
  "dep-cruise": "depcruise --validate .dependency-cruiser.cjs services components hooks app",
  "type-coverage": "type-coverage --strict --at-least 95",
  "check": "npm run lint && npm run type-check && npm run type-coverage && npm test -- --coverage --watchAll=false && npm run knip && npm run madge && npm run dep-cruise && npm audit --audit-level=high",
  "prepare": "husky"
}
```

---

## Stratul 4 — CI

`.github/workflows/check.yml`:

```yaml
name: Check
on:
  pull_request:
    branches: [main]
  push:
    branches-ignore: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run check
```

**Note:**
- Trigger pe `push` non-main + PR → evită double-run pe push la main (acolo merge deja `pages.yml`).
- `npm ci` cu cache npm.
- Eșec → PR blocat (status check obligatoriu — configurabil în branch protection rules).

---

## Stratul 5 — Documentație seed

### `CLAUDE.md` (root, ~100 linii)

**Secțiuni:**

1. **Despre proiect** — 2–3 fraze: aplicație finanțe personale RN/Expo, local-first, RO.
2. **Comenzi uzuale** — tabel:

   | Comandă | Ce face |
   |---|---|
   | `npm start` | Pornește Expo dev server |
   | `npm run ios` / `android` | Build nativ |
   | `npm run lint` / `lint:fix` | ESLint |
   | `npm run type-check` | `tsc --noEmit` |
   | `npm test` / `test:watch` | Jest |
   | `npm run check` | Tot lanțul (lint + type-check + test + analize) |
   | `npm run format` | Prettier |

3. **Convenții cod** (referință scurtă, detaliile în skill-uri):
   - TS strict, fără `any`.
   - Texte UI în română.
   - Theme tokens prin `Colors[scheme]` din `@/theme/colors`.
   - `useColorScheme` doar din `@/components/useColorScheme`.
   - Alias `@/` pentru import-uri cross-folder.

4. **Structură folder** — link la `docs/ARCHITECTURE.md`.

5. **Workflow feature** — spec → plan → implementare → teste → IDEAS update. Link la `docs/IDEAS.md`.

6. **Gating commit** — pre-commit rulează lint+type-check+test-pairing. CI rulează `npm run check`.

7. **Skill-uri proiect** — listă scurtă cu numele și când se aplică.

### `docs/ARCHITECTURE.md` (~200 linii)

**Secțiuni:**

1. **Overview** — diagramă text a fluxului principal:
   ```
   Import extras (PDF/CSV)
        ↓
   Parser determinist (services/bankStatement*Parser.ts)
        ↓ (necategorizate rămase)
   Mapper AI opțional (services/aiStatement*Mapper.ts)
        ↓
   SQLite (services/db.ts, services/transactions.ts)
        ↓
   UI (app/**, components/**)
   ```

2. **Per folder** — listă fișiere cu descriere scurtă:
   - `app/` — rute Expo Router; `(tabs)/` ecrane principale.
   - `services/` — fiecare fișier cu o frază (db, transactions, categories, bankStatementParser, bankStatementPdfParser, aiProvider, aiStatementMapper, aiStatementVisionMapper, backup, cloudStorage, cloudSync, ocr, pdfOcr, pdfExtractor, fxRates, settings, demoData, financialAccounts, manifestHash).
   - `components/` — UI reutilizabil (CategoryIcon, IconPicker, OnboardingWizard, AppLockScreen, AppLockPinModal, Themed, ui/).
   - `hooks/` — React hooks custom.
   - `theme/` — culori și tokens.
   - `__tests__/` — `unit/` cu teste pe servicii; pattern fixture-uri.

3. **Date** — schema SQLite curentă (tabele + descriere scurtă) + format backup ZIP (manifest + payload).

4. **Securitate / privacy** — app lock biometric/PIN, AI consent explicit, data flow extern (provider AI, cloud sync), rate-limit free tier.

5. **Mentenanță** — fișierul e point-in-time; hook-ul `sync-docs` semnalează când conținutul poate fi învechit.

---

## Modificări auxiliare

### `.gitignore`

Adăugat:
```
coverage/
.eslintcache
```

### `package.json` deps noi (devDependencies)

- `@typescript-eslint/parser` (peer pentru typed linting)
- `@typescript-eslint/eslint-plugin` (peer pentru reguli stricte)
- `eslint-plugin-import`
- `eslint-plugin-security`
- `eslint-plugin-jest`
- `knip`
- `madge`
- `dependency-cruiser`
- `type-coverage`
- `husky`
- `lint-staged`

---

## Riscuri și mitigări

| Risc | Mitigare |
|---|---|
| `knip` găsește fals-pozitive pe rute Expo Router | Config explicit cu `entry: ['app/**/*.tsx', 'expo-router/entry']` |
| Type-coverage 95% pică inițial | Scădem pragul la valoarea reală + 1%, urcăm gradual |
| `npm audit --audit-level=high` pică pe deps tranzitive | Pragul `high` (nu `moderate`) reduce zgomot; `npm audit fix` la nevoie |
| Pre-commit lent (>5s) | Dacă devine sâcâitor, mut `type-check` în CI și păstrăm doar lint-staged + test-pairing pre-commit |
| Hook sync-docs zgomotos pe commit-uri triviale | Filtru smart pe paths atinse (commit care doar updatează landing/docs nu mai întreabă) |
| Privacy/terms modificate accidental | Hook-ul **doar semnalează**, nu modifică (decizie deliberată) |
| Skill-uri duplică convenții din CLAUDE.md | CLAUDE.md = reguli statice, skill-uri = proceduri (checklist-uri pentru sarcini) |
| Reguli `dependency-cruiser` blochează refactoring legitim | Toate regulile sunt configurate la nivel de proiect; pot fi relaxate temporar cu commit + comment |

---

## Plan de testare

Fiecare strat e testabil independent:

1. **Hook sync-docs**: commit de test care atinge `services/db.ts` → verifică emit reminder. Commit care atinge doar `landing/style.css` → verifică tăcere.
2. **Skills**: invocare manuală pe edit-uri tipice (ex. modificare `services/bankStatementParser.ts` → verifică că se invocă `bank-parser-pattern`).
3. **Agents**: invocare via Task tool cu diff curent → verifică raport coerent.
4. **ESLint upgrade**: rulează pe codebase actual, fix toate erorile noi înainte de merge.
5. **Knip / madge / dep-cruise**: rulează inițial, fix raport sau adaugă excepții documentate.
6. **Type-coverage**: rulează, ajustează pragul la realitate.
7. **Husky**: commit fictiv care modifică `services/foo.ts` fără test → verifică blocare. Commit cu test-pairing → verifică passă.
8. **CI**: PR test cu schimbare minoră → verifică că ruleză și passă.

---

## Ordine de implementare propusă

1. ESLint upgrade + fix toate erorile noi (cel mai mare blast radius — făcut primul).
2. Tooling static (knip, madge, dep-cruise, type-coverage) + fix raporturi.
3. Husky + lint-staged + pre-commit.
4. CI workflow.
5. CLAUDE.md + ARCHITECTURE.md seed.
6. Skill-uri proiect (5).
7. Agenți (2).
8. Hook sync-docs.

Detaliile per task vor fi în plan-ul de implementare (`docs/plans/2026-04-29-tooling-agenti-skills-hooks.md`) creat după aprobarea acestui spec.

---

## Out of scope (explicit)

- Modificări la conținutul actual al `docs/IDEAS.md`, `landing/index.html`, `docs/specs/*` — doar tooling-ul de mentenanță, nu conținutul.
- Privacy/terms HTML — doar semnal, nu generare.
- Localizare i18n — în roadmap separat (item 7 din IDEAS).
- Bundle size analysis — out of scope acum (proiect mic).
- Refactor existent — strict tooling adăugat, fără modificări la cod sursă (în afara fix-urilor pentru reguli ESLint noi).
