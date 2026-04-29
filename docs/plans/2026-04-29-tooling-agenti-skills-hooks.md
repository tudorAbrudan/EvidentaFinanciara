# Tooling, agenți, skill-uri și hook-uri — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurează stratul de calitate cod (ESLint strict, knip, madge, dep-cruiser, type-coverage, Jest coverage thresholds), pre-commit Husky cu test-pairing, CI GitHub Actions, plus 5 skill-uri și 2 agenți Claude Code la nivel proiect, plus un hook PostToolUse care semnalează când documentația/landing-ul ar putea fi învechite, plus seed CLAUDE.md și docs/ARCHITECTURE.md.

**Architecture:** Patru straturi independente care se construiesc bottom-up: (1) tooling cod în `package.json` + configs root, (2) pre-commit + CI, (3) documentație seed, (4) skill-uri + agenți + hook în `.claude/`. Fiecare task produce o schimbare standalone, commited separat.

**Tech Stack:** Node.js 20, npm, ESLint 8 cu TypeScript-ESLint, Jest, Husky 9, lint-staged, knip, madge, dependency-cruiser, type-coverage, GitHub Actions, jq (pentru hook bash).

**Spec referință:** `docs/specs/2026-04-29-tooling-agenti-skills-hooks-design.md`

**Convenții repo:**
- Working dir pentru comenzi npm: rădăcina proiectului (`/Users/ax/work/finante`).
- Path-uri relative la repo root.
- TS strict, fără `any`. Texte în română (UI și docs).
- Commit-urile au `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- Format prettier: `printWidth: 100`, `singleQuote`, `semi`, `trailingComma: es5`, `tabWidth: 2`, `arrowParens: avoid`.

---

## Task 1: Instalează deps ESLint typed + plugin-uri

**Files:**
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Instalează deps**

```bash
npm install --save-dev \
  @typescript-eslint/parser@^7 \
  @typescript-eslint/eslint-plugin@^7 \
  eslint-plugin-import@^2.29 \
  eslint-plugin-security@^3 \
  eslint-plugin-jest@^28
```

Expected: package.json updated, no lint errors yet.

- [ ] **Step 2: Verifică deps în package.json**

Run: `cat package.json | grep -E "(typescript-eslint|eslint-plugin-import|eslint-plugin-security|eslint-plugin-jest)"`
Expected: 5 linii cu versiuni.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add typed ESLint plugins (import, security, jest, ts-eslint)

Pregătire pentru upgrade .eslintrc cu typed linting.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Upgrade `.eslintrc.js` la typed linting + reguli stricte

**Files:**
- Modify: `.eslintrc.js` (rescriere completă)

- [ ] **Step 1: Rescrie `.eslintrc.js`**

```js
module.exports = {
  root: true,
  extends: ['expo', 'prettier'],
  plugins: ['prettier', 'import', 'security', 'jest'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
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
    'import/order': [
      'warn',
      { 'newlines-between': 'always', alphabetize: { order: 'asc', caseInsensitive: true } },
    ],
    'import/no-cycle': 'error',
    'security/detect-unsafe-regex': 'warn',
    'security/detect-eval-with-expression': 'error',
  },
  overrides: [
    {
      files: ['__tests__/**/*.{ts,tsx}'],
      env: { 'jest/globals': true },
      rules: {
        'security/detect-non-literal-fs-filename': 'off',
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
    {
      files: ['.eslintrc.js', '*.config.js', '*.config.cjs'],
      parserOptions: { project: null },
      rules: {
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/no-misused-promises': 'off',
        '@typescript-eslint/await-thenable': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    '.expo/',
    'dist/',
    'build/',
    'coverage/',
    'ios/',
    'android/',
  ],
};
```

- [ ] **Step 2: Rulează lint pentru a vedea ce erori apar**

Run: `npm run lint 2>&1 | tee /tmp/lint-baseline.log`
Expected: probabil multe `no-floating-promises` și `no-misused-promises` și `import/order` warnings. Se rezolvă în Task 3.

- [ ] **Step 3: Commit (config separat de fix-uri)**

```bash
git add .eslintrc.js
git commit -m "$(cat <<'EOF'
chore(lint): typed ESLint cu reguli stricte (no-floating-promises, import/no-cycle, security)

Erorile noi sunt fix-uite în commit-ul următor.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix erori ESLint nou apărute

**Files:**
- Modify: variabil — toate fișierele care produc erori

- [ ] **Step 1: Auto-fix ce se poate**

Run: `npm run lint:fix`
Expected: rezolvă `import/order` și prettier issues automat.

- [ ] **Step 2: Citește erorile rămase**

Run: `npm run lint 2>&1 | grep "error" | head -50`
Expected: listă erori rămase (probabil `no-floating-promises`, `no-misused-promises`, `exhaustive-deps`).

- [ ] **Step 3: Fix manual fiecare eroare**

Pentru `no-floating-promises`: adaugă `void` sau `await` sau `.catch(...)`.
```ts
// Înainte
fetchData();
// După
void fetchData();
```

Pentru `no-misused-promises`: pentru handler-i `onPress` care sunt async, înfășoară:
```ts
// Înainte
<Button onPress={async () => { await save(); }} />
// După
<Button onPress={() => { void save(); }} />
```

Pentru `exhaustive-deps`: adaugă dependențele ratate sau folosește `useCallback`/`useMemo` pentru funcții.

Pentru `no-explicit-any` (escalat la error): înlocuiește `any` cu tip explicit sau `unknown` + narrowing.

- [ ] **Step 4: Verifică lint curat**

Run: `npm run lint`
Expected: 0 errors, 0 warnings (sau doar warning-uri intenționate).

- [ ] **Step 5: Verifică tests încă trec**

Run: `npm test -- --watchAll=false`
Expected: PASS (toate testele).

- [ ] **Step 6: Commit fix-urile**

```bash
git add -u
git commit -m "$(cat <<'EOF'
chore(lint): fix erori după upgrade ESLint typed

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Adaugă `knip` (cod mort)

**Files:**
- Create: `knip.json`
- Modify: `package.json` (deps + scripts)

- [ ] **Step 1: Instalează knip**

```bash
npm install --save-dev knip@^5
```

- [ ] **Step 2: Creează `knip.json`**

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "entry": [
    "app/**/*.{ts,tsx}",
    "expo-router/entry",
    "__tests__/setup.ts"
  ],
  "project": [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "services/**/*.{ts,tsx}",
    "theme/**/*.{ts,tsx}",
    "constants/**/*.{ts,tsx}",
    "types/**/*.{ts,tsx}"
  ],
  "ignore": [
    "__mocks__/**",
    "ios/**",
    "android/**",
    ".expo/**"
  ],
  "ignoreDependencies": [
    "expo-constants",
    "expo-status-bar",
    "react-dom"
  ]
}
```

- [ ] **Step 3: Adaugă script în `package.json`**

În secțiunea `"scripts"`, adaugă:
```json
"knip": "knip"
```

- [ ] **Step 4: Rulează knip**

Run: `npm run knip`
Expected: raport cu cod nefolosit. Pot fi false-pozitive (componente folosite prin `expo-router` discovery).

- [ ] **Step 5: Triază raportul**

Pentru fiecare item:
- **Cod genuin nefolosit** → șterge.
- **Fals-pozitiv** → adaugă în `knip.json` la `ignoreExportsUsedInFile` sau în `entry`.

- [ ] **Step 6: Verifică raport curat**

Run: `npm run knip`
Expected: 0 unused (sau lista documentată ca acceptată).

- [ ] **Step 7: Commit**

```bash
git add knip.json package.json package-lock.json
git add -u  # pentru cod șters dacă a fost
git commit -m "$(cat <<'EOF'
chore(quality): add knip pentru detecție cod mort

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Adaugă `madge` (dependențe ciclice)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalează madge**

```bash
npm install --save-dev madge@^7
```

- [ ] **Step 2: Adaugă script**

În `package.json` `"scripts"`:
```json
"madge": "madge --circular --extensions ts,tsx services components hooks app"
```

- [ ] **Step 3: Rulează madge**

Run: `npm run madge`
Expected: `✔ No circular dependency found!` sau listă de cicluri.

- [ ] **Step 4: Dacă cicluri găsite, fix-uiește**

Pentru fiecare ciclu, refactor pentru a sparge dependența (de obicei extragerea unui tip comun într-un fișier separat).

- [ ] **Step 5: Verifică curat**

Run: `npm run madge`
Expected: `✔ No circular dependency found!`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git add -u  # dacă au fost refactor-uri
git commit -m "$(cat <<'EOF'
chore(quality): add madge pentru detecție dependențe ciclice

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Adaugă `dependency-cruiser` cu reguli arhitecturale

**Files:**
- Create: `.dependency-cruiser.cjs`
- Modify: `package.json`

- [ ] **Step 1: Instalează**

```bash
npm install --save-dev dependency-cruiser@^16
```

- [ ] **Step 2: Creează `.dependency-cruiser.cjs`**

```js
module.exports = {
  forbidden: [
    {
      name: 'services-no-ui',
      severity: 'error',
      comment: 'services/ trebuie să rămână pure logic, fără import UI.',
      from: { path: '^services' },
      to: { path: '^(components|app|hooks)' },
    },
    {
      name: 'components-no-app',
      severity: 'error',
      comment: 'components/ nu cunosc structura ecranelor (app/).',
      from: { path: '^components' },
      to: { path: '^app' },
    },
    {
      name: 'no-test-imports-in-prod',
      severity: 'error',
      comment: 'Codul de producție nu importă din __tests__/ sau __mocks__/.',
      from: { pathNot: '(^__tests__|^__mocks__)' },
      to: { path: '(^__tests__|^__mocks__)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Fără dependențe ciclice.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Fișiere fără import-uri inbound (posibil cod mort).',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.config\\.(js|cjs|mjs|ts|json)$',
          '__tests__/setup\\.ts$',
          '^app/',
          'expo-env\\.d\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
```

- [ ] **Step 3: Adaugă script**

În `package.json`:
```json
"dep-cruise": "depcruise --validate .dependency-cruiser.cjs services components hooks app"
```

- [ ] **Step 4: Rulează**

Run: `npm run dep-cruise`
Expected: 0 errors. Warning-uri pe orphans pot apărea — triază.

- [ ] **Step 5: Triază eventualele violări**

Pentru fiecare violare error:
- Refactor codul ca să respecte regula, **sau**
- Documentează excepție în `.dependency-cruiser.cjs` (cu comment de motivare).

- [ ] **Step 6: Commit**

```bash
git add .dependency-cruiser.cjs package.json package-lock.json
git add -u  # dacă au fost refactor-uri
git commit -m "$(cat <<'EOF'
chore(quality): add dependency-cruiser cu reguli arhitecturale

services/ nu importă din UI, components/ nu importă din app/,
prod nu importă din __tests__/, fără cicluri.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Adaugă `type-coverage`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalează**

```bash
npm install --save-dev type-coverage@^2
```

- [ ] **Step 2: Verifică coverage actual**

Run: `npx type-coverage --strict --detail | tail -20`
Expected: procentaj exact (ex. `97.2%`).

- [ ] **Step 3: Setează prag realist**

Folosește valoarea găsită minus 1% ca prag (ex. dacă e 97.2%, setează 96).

În `package.json` `"scripts"`:
```json
"type-coverage": "type-coverage --strict --at-least 96"
```

(Înlocuiește `96` cu valoarea calculată în Step 2.)

- [ ] **Step 4: Rulează**

Run: `npm run type-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(quality): add type-coverage cu prag $(npm run -s type-coverage 2>&1 | grep -oE '[0-9]+%' | head -1)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

(Înlocuiește placeholder-ul cu pragul efectiv setat.)

---

## Task 8: Adaugă Jest coverage thresholds

**Files:**
- Modify: `package.json` (secțiunea `jest`)

- [ ] **Step 1: Verifică coverage actual**

Run: `npm test -- --coverage --watchAll=false 2>&1 | tail -30`
Expected: tabel coverage. Notează valorile pentru `services/`.

- [ ] **Step 2: Adaugă thresholds în `package.json`**

În secțiunea `"jest"`, adaugă (sau actualizează):
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

(Dacă coverage actual e sub aceste valori, scade pragul la valoarea reală minus 5% pentru rezervă.)

- [ ] **Step 3: Verifică**

Run: `npm test -- --coverage --watchAll=false`
Expected: PASS, cu raport coverage la final.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore(test): add Jest coverage thresholds pe services/

Prag inițial conservator; ridicăm pe măsură ce adăugăm teste.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Adaugă script `check` agregat

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Adaugă script**

În `package.json` `"scripts"`:
```json
"check": "npm run lint && npm run type-check && npm run type-coverage && npm test -- --coverage --watchAll=false && npm run knip && npm run madge && npm run dep-cruise && npm audit --audit-level=high"
```

- [ ] **Step 2: Rulează**

Run: `npm run check`
Expected: PASS pe toți pașii.

- [ ] **Step 3: Dacă audit eșuează**

Dacă `npm audit` găsește vulnerabilități high/critical:
- Verifică dacă sunt în deps direct: `npm audit fix`.
- Dacă sunt în deps tranzitive fără fix disponibil, documentează în comment lângă script (deocamdată, înainte de a relaxa pragul).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(quality): add npm run check (lint + type-check + test + analize + audit)

Un singur punct de intrare pentru toate verificările locale și CI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Adaugă Husky + lint-staged + pre-commit

**Files:**
- Create: `.husky/pre-commit` (executable)
- Modify: `package.json` (deps + scripts + lint-staged config)

- [ ] **Step 1: Instalează**

```bash
npm install --save-dev husky@^9 lint-staged@^15
```

- [ ] **Step 2: Inițializează husky**

```bash
npx husky init
```

Expected: creează `.husky/pre-commit` cu un default + adaugă `prepare` script în `package.json`.

- [ ] **Step 3: Adaugă config `lint-staged` în `package.json`**

La nivelul rădăcinii JSON, adaugă:
```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

- [ ] **Step 4: Rescrie `.husky/pre-commit`**

```bash
#!/usr/bin/env sh

# 1. Test-pairing check
staged=$(git diff --cached --name-only --diff-filter=ACM)
services_staged=$(echo "$staged" | grep -E '^services/.*\.ts$' | grep -v '\.test\.ts$' || true)
tests_staged=$(echo "$staged" | grep -E '^__tests__/unit/.*\.test\.ts$' || true)

if [ -n "$services_staged" ] && [ -z "$tests_staged" ]; then
  echo "Modificare în services/ fără test nou:"
  echo "$services_staged"
  echo ""
  echo "Adaugă test în __tests__/unit/ sau folosește 'git commit --no-verify'"
  echo "cu motivul în mesajul commit."
  exit 1
fi

# 2. Lint-staged (eslint --fix + prettier pe staged)
npx lint-staged || exit 1

# 3. Type-check rapid (pe tot proiectul)
npm run type-check || exit 1
```

- [ ] **Step 5: Marchează executabil**

```bash
chmod +x .husky/pre-commit
```

- [ ] **Step 6: Test pre-commit (smoke)**

Modifică un fișier oarecare cu o tipografie și rulează:
```bash
echo "// test comment" >> services/transactions.ts
git add services/transactions.ts
git commit -m "test pre-commit"
```
Expected: hook să blocheze cu mesaj „Modificare în services/ fără test nou".

- [ ] **Step 7: Curăță testul**

```bash
git reset HEAD
git checkout services/transactions.ts
```

- [ ] **Step 8: Commit setup-ul Husky**

```bash
git add .husky/pre-commit package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(quality): add Husky pre-commit cu test-pairing și lint-staged

Pre-commit blochează modificări services/*.ts fără test pairing,
rulează lint-staged și type-check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Adaugă CI workflow `check.yml`

**Files:**
- Create: `.github/workflows/check.yml`

- [ ] **Step 1: Creează workflow**

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
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run check
        run: npm run check
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/check.yml
git commit -m "$(cat <<'EOF'
ci: add check workflow (lint + type-check + test + analize)

Rulează pe PR spre main și push pe branch-uri non-main.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push branch test (opțional)**

Dacă vrei să verifici live: creează un branch fictiv, push, observă rularea workflow-ului în GitHub Actions.

```bash
git checkout -b test-ci
git push origin test-ci
# verifică github.com → Actions tab
git checkout main
git branch -D test-ci
# nu push --delete dacă nu vrei să curățezi remote-ul
```

---

## Task 12: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Adaugă entry-uri**

La sfârșitul `.gitignore`, adaugă:

```
# Coverage
coverage/

# ESLint cache
.eslintcache

# Husky internal (păstrat — necesar pentru hook-uri)
# .husky/_
```

- [ ] **Step 2: Verifică**

Run: `git check-ignore -v coverage/foo .eslintcache`
Expected: ambele rezolvă la `.gitignore`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore: ignore coverage/ și .eslintcache

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Scrie `CLAUDE.md` (root)

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Creează `CLAUDE.md`**

```markdown
# Finanțe — context proiect pentru Claude

Aplicație React Native + Expo (TypeScript) pentru gestiunea financiară personală.
Local-first: datele rămân pe device, AI și cloud sync sunt opționale și transparente.
Limba UI și docs: română.

## Comenzi uzuale

| Comandă | Ce face |
|---|---|
| `npm start` | Pornește Expo dev server |
| `npm run ios` | Build și rulare iOS simulator |
| `npm run android` | Build și rulare Android emulator |
| `npm run lint` | ESLint pe `.ts`/`.tsx` |
| `npm run lint:fix` | ESLint cu auto-fix |
| `npm run type-check` | `tsc --noEmit` |
| `npm test` | Jest |
| `npm run test:watch` | Jest în watch mode |
| `npm run format` | Prettier write |
| `npm run check` | Tot lanțul: lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit |

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

| Skill | Când |
|---|---|
| `rn-expo-conventions` | editare în `app/`, `components/`, `hooks/`, sau orice TSX |
| `sqlite-migration` | modificare schemă în `services/db.ts` |
| `bank-parser-pattern` | modificare/adăugare parser în `services/bankStatement*.ts` |
| `ai-prompt-ro` | modificare prompt-uri/mappers în `services/aiProvider.ts`, `aiStatement*Mapper.ts` |
| `feature-checklist` | finalizare feature din IDEAS |

## Agenți proiect (`.claude/agents/`)

- `bank-parser-reviewer` — review independent pe schimbări de parser bănci.
- `landing-copy-reviewer` — verifică alinierea landing ↔ feature-uri reale.
```

- [ ] **Step 2: Verifică prettier-formatat**

Run: `npx prettier --check CLAUDE.md`
Expected: PASS (sau auto-fix cu `--write`).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: add CLAUDE.md cu convenții, comenzi și skill-uri proiect

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Scrie `docs/ARCHITECTURE.md`

**Files:**
- Create: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Inspectează schema SQLite curentă**

Run: `head -100 services/db.ts`
Notează tabelele și coloanele cheie.

- [ ] **Step 2: Inspectează lista fișiere `services/`**

Run: `ls services/`
Notează fiecare fișier pentru descriere de o frază.

- [ ] **Step 3: Creează `docs/ARCHITECTURE.md`**

```markdown
# Arhitectură — Finanțe

> Document point-in-time. Hook-ul `sync-docs` semnalează când conținutul poate fi învechit.
> **Ultima actualizare:** 2026-04-29.

## Overview

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

Aplicația e **local-first**: nu există backend obligatoriu. Backup și sync (iCloud, cloud) sunt opt-in.

## Folder layout

### `app/` — rute Expo Router

`(tabs)/` conține ecranele principale (Sumar, Conturi, Tranzacții, Categorii). `_layout.tsx` setează tema, autentificarea și onboarding wizard la prima rulare. Nu pune logică de business aici — extrage în `services/` sau `hooks/`.

### `services/` — logică pură

| Fișier | Rol |
|---|---|
| `db.ts` | conexiune SQLite + schema + migrații |
| `transactions.ts` | CRUD tranzacții, filtre, agregări |
| `categories.ts` | CRUD categorii, sugestii prin regex |
| `financialAccounts.ts` | CRUD conturi |
| `bankStatementParser.ts` | parser CSV pentru extrase BT/ING/Revolut/OTP |
| `bankStatementPdfParser.ts` | parser PDF (text extraction) |
| `bankStatements.ts` | orchestrare import + deduplicate |
| `aiProvider.ts` | abstracție provider AI (built-in cu cotă, sau cheie proprie) |
| `aiStatementMapper.ts` | mapare tranzacții necategorizate prin AI |
| `aiStatementVisionMapper.ts` | OCR + mapare AI pentru extrase imagine |
| `pdfExtractor.ts` | extragere text PDF |
| `pdfOcr.ts` | OCR pe PDF când text-extraction eșuează |
| `ocr.ts` | wrapper ML Kit pentru OCR imagini |
| `backup.ts` | export/import ZIP cu manifest |
| `cloudStorage.ts` | iCloud Drive / Google Drive abstracție |
| `cloudSync.ts` | sync periodic cu cloud storage |
| `fxRates.ts` | rate de schimb (cache local) |
| `settings.ts` | preferințe utilizator (theme, lock, AI consent) |
| `demoData.ts` | tranzacții demo pentru onboarding |
| `manifestHash.ts` | hash structură DB pentru invalidare cache |

**Regulă arhitecturală:** `services/` nu importă din `components/`, `app/`, `hooks/`. Logica e portabilă, testabilă, fără dependențe UI.

### `components/` — UI reutilizabil

Componente non-screen: `CategoryIcon`, `IconPicker`, `OnboardingWizard`, `AppLockScreen`, `AppLockPinModal`, `Themed`, `useColorScheme`. Sub-folder `ui/` pentru primitive.

### `hooks/` — React hooks custom

Hook-uri care încapsulează state + side effects (ex. `useCategoryTransactions`).

### `theme/` — culori și tokens

`colors.ts` exportă `Colors` (scheme `light`/`dark`), `primary`, `statusColors`. Nu hardcoda culori în componente.

### `__tests__/`

`__tests__/unit/` — teste Jest pe `services/`. Fixture-uri în sub-folder per bancă (când va exista). `setup.ts` configurează mock-uri Expo.

### `landing/`

Site static (HTML + CSS) deploy-uit pe GitHub Pages la fiecare push pe `main` care atinge `landing/**`.

## Date

### Schema SQLite (versiunea curentă)

| Tabel | Rol |
|---|---|
| `financial_accounts` | conturi (bancă, cash, card) cu sold inițial |
| `expense_categories` | categorii ierarhice cu icon, culoare, `monthly_limit` |
| `transactions` | tranzacții cu sumă, dată, categorie, cont, notă |
| `bank_statements` | evidență import-uri pentru deduplicate |
| `settings` | preferințe utilizator (key-value) |

Detalii complete în `services/db.ts`.

### Backup

Format ZIP cu:
- `manifest.json` — versiune schemă, data export, count per tabel
- `data.sqlite` — copie DB
- `images/` — opțional, atașamente

Manifest-hash din `services/manifestHash.ts` permite invalidare cache la schimbări structurale.

## Securitate / privacy

- **App lock** — biometric (`expo-local-authentication`) sau PIN, configurabil în Setări.
- **AI consent** — opt-in explicit la onboarding sau în Setări. Free tier 20 cereri/zi (cotă built-in). Premium: nelimitat sau cheie proprie (provider `external`).
- **Cloud sync** — opțional, opt-in. Fără cont online obligatoriu.
- **Date externe trimise** — doar la provider AI selectat, doar conținut tranzacție necesar pentru categorizare. Niciun analytics, fără tracking.

## Mentenanță

- Acest fișier este **point-in-time** — adaugă și actualizează când structura/schema se schimbă.
- Hook-ul `.claude/hooks/sync-docs.sh` semnalează când commit-ul atinge `services/db.ts`, folder-e noi în `services/`/`components/`, sau scripts noi în `package.json`.
```

- [ ] **Step 4: Verifică prettier**

Run: `npx prettier --check docs/ARCHITECTURE.md`
Expected: PASS (sau auto-fix cu `--write`).

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: add ARCHITECTURE.md cu hartă code și fluxuri date

Point-in-time, mentenuit prin hook-ul sync-docs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Skill `rn-expo-conventions`

**Files:**
- Create: `.claude/skills/rn-expo-conventions/SKILL.md`

- [ ] **Step 1: Creează folder**

```bash
mkdir -p .claude/skills/rn-expo-conventions
```

- [ ] **Step 2: Scrie SKILL.md**

```markdown
---
name: rn-expo-conventions
description: Use when editing files in app/, components/, hooks/, theme/, or any TSX file in this project — enforces project conventions for TypeScript, theme tokens, useColorScheme imports, alias paths, and Romanian UI text.
---

# RN/Expo conventions — Finanțe

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
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/rn-expo-conventions/SKILL.md
git commit -m "$(cat <<'EOF'
chore(claude): add skill rn-expo-conventions

Convenții TS, theme, useColorScheme, alias @/, async/promises.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Skill `sqlite-migration`

**Files:**
- Create: `.claude/skills/sqlite-migration/SKILL.md`

- [ ] **Step 1: Creează folder + SKILL.md**

```bash
mkdir -p .claude/skills/sqlite-migration
```

Conținut `.claude/skills/sqlite-migration/SKILL.md`:

```markdown
---
name: sqlite-migration
description: Use when modifying schema in services/db.ts, adding tables, columns, or changing serialized structures — enforces migration safety, backup compatibility, and manifest hash updates.
---

# SQLite migration — Finanțe

Reguli pentru modificarea schemei SQLite. Aplică **înainte** de orice modificare la `services/db.ts`.

## Principii

1. **Niciodată edit la migrații existente.** Adaugă migrație nouă în array-ul de migrații. Edit retroactiv strică DB-urile userilor existenți.
2. **Backup compat.** Format ZIP din `services/backup.ts` trebuie să citească versiuni vechi. Verifică `manifest.version` și fall-back logic.
3. **Manifest hash.** `services/manifestHash.ts` e folosit pentru invalidare cache. Update dacă schimbi structura serializată (nume tabel, coloană în export).
4. **Test migration round-trip.** În `__tests__/unit/db.test.ts` (sau echivalent): creare DB curat → aplică migrații → verifică schemă + insert/select sample.

## Procedură

1. Identifică ce schimbi: tabel nou, coloană nouă, redenumire, drop?
2. Scrie migrația ca instrucțiune SQL idempotentă (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN ...`).
3. Adaugă entry nou în array-ul de migrații (la final, niciodată inserat la mijloc).
4. Update `manifestHash.ts` dacă export-ul include coloana/tabelul nou.
5. Update `services/backup.ts` dacă serializarea se schimbă: păstrează capabilitate de citire pentru versiuni anterioare.
6. Test în `__tests__/unit/`:
   ```ts
   it('migrează curat de la versiunea X la Y', () => {
     // setup DB la state vechi
     // aplică migrația
     // verifică schemă nouă
   });
   ```
7. Test backup round-trip: export → reset → import → verifică date intacte.

## Anti-patterns

- ❌ Edit la migrație committed deja.
- ❌ `DROP TABLE` fără strategie de păstrare date pentru useri existenți.
- ❌ Schimbare nume coloană fără migrație de redenumire.
- ❌ Skip update manifest hash → cache stale, useri nu văd date noi.
- ❌ Schimbare format backup fără capabilitate citire format vechi.

## Workflow recomandat

```
1. Branch nou: schema-<descriere>
2. Scrie migrația
3. Test round-trip local
4. Test backup pe DB existent (export înainte → import după = identic)
5. PR cu mențiune explicită: "schema change" în titlu
```
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/sqlite-migration/SKILL.md
git commit -m "$(cat <<'EOF'
chore(claude): add skill sqlite-migration

Reguli safety pentru schimbări schemă: migrații idempotente,
backup compat, manifest hash, test round-trip.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Skill `bank-parser-pattern`

**Files:**
- Create: `.claude/skills/bank-parser-pattern/SKILL.md`

- [ ] **Step 1: Creează folder + SKILL.md**

```bash
mkdir -p .claude/skills/bank-parser-pattern
```

```markdown
---
name: bank-parser-pattern
description: Use when editing or adding parsers in services/bankStatement*.ts — enforces fixture-based testing, regex robustness, deduplication, and edge cases for RO bank statements (BT, ING, Revolut, OTP).
---

# Bank parser pattern — Finanțe

Reguli pentru parser-uri de extrase bancare RO.

## Fixture obligatorie

Pentru fiecare bancă/format suportat, creează fixture în `__tests__/fixtures/<bank>/`:
- PDF/CSV scurt (5–10 tranzacții).
- **Anonimizat:** înlocuiește IBAN, sume mari, nume reale cu valori dummy. **Niciun document real al utilizatorului.**
- Numire: `<bank>-<format>-<scenariu>.{pdf,csv}` (ex. `bt-csv-multi-currency.csv`).

## Test obligatorii

Pentru fiecare parser nou/modificat:
- [ ] **Parse OK** pe fixture canonică (toate tranzacțiile parsate).
- [ ] **Deduplicate**: aceeași fixture import-ată de două ori nu produce duplicate (verificare prin hash sau combinație `account+date+amount+description`).
- [ ] **Multi-currency**: RON și EUR în același extras parsate corect (separate sau cu conversie).
- [ ] **Decimal separator**: virgulă (`1.234,56`) și punct (`1,234.56`) — formatul depinde de bancă.
- [ ] **Date format**: RO (`DD.MM.YYYY`, `DD/MM/YYYY`) și ISO (`YYYY-MM-DD`).
- [ ] **Headere/footere repetate**: extrase cu pagini multiple unde header-ul reapare → nu interpreta header ca tranzacție.
- [ ] **Tranzacție debit vs credit**: semn corect (negativ pentru cheltuieli, pozitiv pentru încasări).

## Regex robuste

- **Nu generic** care prinde header și footer. Folosește anchor specific (data la început, sumă la sfârșit).
- **Suportă variații**: spațiu sau tab între câmpuri, ghilimele opționale în CSV, `\r\n` și `\n`.
- **Numere mari**: `1.234.567,89` (RO) — separator mii este `.` sau spațiu, decimal e `,`.

## Edge cases

- **Storno / refund**: tranzacție care anulează una anterioară. Păstrează ambele cu legătură (sau marchează ca anulate).
- **Comision separat**: unele bănci listează comisionul ca tranzacție separată — păstrează.
- **Tranzacție cu mai multe rânduri descrierea**: concatenează toate rândurile aceleași tranzacții.
- **Conversie valutară**: cumpărătură EUR debit din cont RON → arată sumă originală + sumă efectivă.

## Texte de eroare

În română, prietenos:
- ❌ `"Failed to parse line"`
- ✅ `"Nu am putut citi linia <N>: format necunoscut"`

## Anti-patterns

- ❌ Regex care match-uiește orice rând cu cifre (prinde și sume agregate din footer).
- ❌ Test fără fixture commitată — test fragil, ne-reproductibil.
- ❌ Skip deduplicate — userul re-importează același extras și vede totul de două ori.
- ❌ Hardcoding ordine coloane CSV — parsează header dinamic dacă banca poate schimba ordinea.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/bank-parser-pattern/SKILL.md
git commit -m "$(cat <<'EOF'
chore(claude): add skill bank-parser-pattern

Fixtures, teste obligatorii, regex robuste, edge cases RO.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Skill `ai-prompt-ro`

**Files:**
- Create: `.claude/skills/ai-prompt-ro/SKILL.md`

- [ ] **Step 1: Scrie SKILL.md**

```bash
mkdir -p .claude/skills/ai-prompt-ro
```

```markdown
---
name: ai-prompt-ro
description: Use when editing services/aiProvider.ts, aiStatementMapper.ts, or aiStatementVisionMapper.ts — enforces Romanian prompts, stable JSON schemas, rate-limit awareness, and snapshot tests for AI responses.
---

# AI prompts RO — Finanțe

Reguli pentru cod care interacționează cu provider AI.

## Limbă

**Toate prompt-urile sunt în română.** Inclusiv:
- System message
- Few-shot examples
- Format instructions

Răspunsul AI este așteptat în română (categorii, descrieri).

## Schema JSON output

- **Stabilă.** Nu schimba câmpuri sau tipuri fără update concomitent în mapper și în testele snapshot.
- **Documentată în comment** lângă prompt:
  ```ts
  // Schema răspuns:
  // { tranzactii: Array<{ id: string, categorie_sugerata: string, confianta: number }> }
  ```
- **Validare la primire:** parse cu schema explicită; respinge și log-uiește răspunsuri malformate.

## Rate limit & cost

- **Free tier:** cota built-in (20 cereri/zi în implementarea curentă).
- **Premium:** nelimitat sau cheie proprie (`provider: 'external'`).
- Verifică `getAiQuotaState()` (sau echivalent) înainte de cerere — fail rapid cu mesaj clar dacă cota epuizată.
- Mesaje user în română: `"Ai atins limita zilnică de 20 de cereri AI. Mâine resetează automat sau setează propria cheie API în Setări."`

## Consent

- AI consent e **opt-in explicit**, nu opt-out.
- Nu face cereri AI la app launch sau în background fără consimțământ activ.
- Setarea e în `services/settings.ts` (`aiConsent: boolean`).

## Teste

- **Snapshot tests** pentru schema răspuns: pune un fixture cu răspuns AI canonical, verifică că mapperul produce output identic.
- **Mock provider** în teste: nu apelăm API real în CI.

## Anti-patterns

- ❌ Prompt în engleză cu user request în română — confuzie pentru model.
- ❌ Schimbare câmp JSON fără update mapper → runtime error.
- ❌ Skip verificare cotă → user cu cont epuizat vede eroare brută de la provider.
- ❌ Cerere AI fără verificare consent → încălcare promisiune local-first.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/ai-prompt-ro/SKILL.md
git commit -m "$(cat <<'EOF'
chore(claude): add skill ai-prompt-ro

Prompt-uri RO, schema JSON stabilă, rate-limit, consent.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Skill `feature-checklist`

**Files:**
- Create: `.claude/skills/feature-checklist/SKILL.md`

- [ ] **Step 1: Scrie SKILL.md**

```bash
mkdir -p .claude/skills/feature-checklist
```

```markdown
---
name: feature-checklist
description: Use when finishing a feature from docs/IDEAS.md — checklist final cu spec, plan, teste, IDEAS update, landing update, CLAUDE.md/ARCHITECTURE.md update.
---

# Feature checklist — Finanțe

La finalizarea unui feature din `docs/IDEAS.md`, înainte de ultimul commit, parcurge checklist-ul:

- [ ] **Spec scris** — `docs/specs/<data>-<topic>-design.md` există și e committed.
- [ ] **Plan scris** — `docs/plans/<data>-<topic>.md` există și e committed.
- [ ] **Implementare cu teste** — toate funcțiile noi în `services/` au teste în `__tests__/unit/`.
- [ ] **`npm run check` trece** — lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit.
- [ ] **`docs/IDEAS.md` actualizat** — feature mutat în „done" sau marcat status (eventual cu data implementării).
- [ ] **`landing/index.html` actualizat** — dacă feature e user-visible, lista features pe landing îl reflectă.
- [ ] **`CLAUDE.md` actualizat** — dacă scripts noi în `package.json`, convenții noi, sau comenzi uzuale schimbate.
- [ ] **`docs/ARCHITECTURE.md` actualizat** — dacă folder/modul nou, schemă DB schimbată, flux nou de date.
- [ ] **Privacy/terms verificate** — dacă feature implică date trimise extern (AI, cloud), verifică `docs/privacy.html` și `docs/terms.html` (când vor exista) sau marchează în IDEAS „needs privacy review".

## Note

- Hook-ul `sync-docs` semnalează automat după commit dacă vreunul din pașii de mai sus pare omis. Folosește acest skill ca verificare proactivă **înainte** de commit-ul final.
- Dacă feature-ul nu e user-visible (refactor intern, fix bug), pașii „landing" și „IDEAS user-visible" se omit — dar verifică totuși CLAUDE/ARCHITECTURE dacă e modul/script nou.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/feature-checklist/SKILL.md
git commit -m "$(cat <<'EOF'
chore(claude): add skill feature-checklist

Checklist final pentru feature: spec, plan, teste, docs sync.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Agent `bank-parser-reviewer`

**Files:**
- Create: `.claude/agents/bank-parser-reviewer.md`

- [ ] **Step 1: Creează folder + agent**

```bash
mkdir -p .claude/agents
```

```markdown
---
name: bank-parser-reviewer
description: Use to review bank parser changes before commit. Reads diff in services/bankStatement*.ts and __tests__/fixtures/, checks test coverage for new edge cases, and produces a short report under 200 words.
tools: Read, Grep, Glob, Bash
---

# Bank parser reviewer

Ești un agent de review specializat în parsere de extrase bancare RO. Scopul: review independent pe schimbări înainte de commit.

## Procedură

1. **Identifică diff-ul** — rulează `git diff HEAD` (sau `git diff --cached` dacă e staged) pe `services/bankStatement*.ts` și `__tests__/fixtures/`.
2. **Citește fixture-urile noi/modificate** — verifică că sunt anonimizate (fără IBAN reali, sume reale recognoscibile, nume reale).
3. **Citește testele** — pentru fiecare parser modificat, verifică că există teste pentru:
   - Parse OK pe fixture canonică
   - Deduplicate (același import de două ori → fără duplicate)
   - Multi-currency (RON + EUR)
   - Decimal separator (virgulă RO și punct US)
   - Date format (RO și ISO)
   - Headere/footere multi-page
   - Debit vs credit semn corect
4. **Identifică edge cases lipsă** — comparând cu schimbările din parser, ce cazuri noi nu sunt acoperite?
5. **Verifică regex-urile** — sunt prea generice? Pot prinde header-e/footere?

## Output

Raport sub 200 cuvinte, structurat:

```
## Coverage testat
- ✅ X
- ✅ Y

## Lipsuri
- ❌ Z (descriere caz neacoperit)

## Riscuri regex
- (dacă e cazul)

## Anonimizare fixture
- ✅ / ❌ cu detaliu
```

Fii direct, fără prelungiri. Dacă totul e curat, spune asta scurt.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/bank-parser-reviewer.md
git commit -m "$(cat <<'EOF'
chore(claude): add agent bank-parser-reviewer

Review independent pe schimbări de parser bănci RO.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Agent `landing-copy-reviewer`

**Files:**
- Create: `.claude/agents/landing-copy-reviewer.md`

- [ ] **Step 1: Scrie agent**

```markdown
---
name: landing-copy-reviewer
description: Use to verify landing page copy matches actual implemented features. Reads docs/IDEAS.md and landing/index.html and reports discrepancies in under 200 words.
tools: Read, Grep, Glob
---

# Landing copy reviewer

Ești un agent de review care verifică alinierea între ce promite landing-ul și ce e implementat efectiv.

## Procedură

1. **Citește `docs/IDEAS.md`** — identifică feature-urile marcate „done" / implementate vs cele în roadmap.
2. **Citește `landing/index.html`** — extrage lista de feature-uri promise (secțiunile features, bullets, descrieri).
3. **Cross-reference**:
   - Feature pe landing care NU e implementat (fals advertising) → flag.
   - Feature implementat care NU e pe landing (selling point ratat) → semnal.
   - Texte landing care promit specific (ex. „funcționează cu BT") — verifică în cod (`grep -i "bt\\|banca transilvania" services/`) că există.

## Output

Raport sub 200 cuvinte, structurat:

```
## Promovat dar nu implementat
- (listă cu detaliu)

## Implementat dar nu promovat
- (listă cu detaliu)

## Texte specifice care necesită verificare
- (ex. „funcționează cu BT" — verifică)
```

Fii concret, citează exact textul de pe landing dacă e discrepanță.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/landing-copy-reviewer.md
git commit -m "$(cat <<'EOF'
chore(claude): add agent landing-copy-reviewer

Verifică alinierea landing ↔ features implementate.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Hook `sync-docs` (script + settings.json)

**Files:**
- Create: `.claude/hooks/sync-docs.sh` (executable)
- Create: `.claude/settings.json`

- [ ] **Step 1: Verifică `jq` disponibil**

Run: `which jq`
Expected: cale (e.g. `/usr/bin/jq`). Dacă nu există: `brew install jq`.

- [ ] **Step 2: Creează folder hook-uri**

```bash
mkdir -p .claude/hooks
```

- [ ] **Step 3: Scrie scriptul**

`.claude/hooks/sync-docs.sh`:

```bash
#!/usr/bin/env bash
set -e

# Citește JSON de pe stdin
input=$(cat)

# Extrage comanda din tool_input
command=$(echo "$input" | jq -r '.tool_input.command // ""')

# Filtru: doar pe git commit
if [[ "$command" != *"git commit"* ]]; then
  exit 0
fi

# Filtru: dacă commit-ul a eșuat, nu emite reminder
# (PostToolUse fires și pe failure; verifică via tool_response)
exit_code=$(echo "$input" | jq -r '.tool_response.exit_code // 0')
if [[ "$exit_code" != "0" ]]; then
  exit 0
fi

# Cwd din input (sau fallback la PWD)
cwd=$(echo "$input" | jq -r '.cwd // ""')
if [[ -n "$cwd" ]]; then
  cd "$cwd" || exit 0
fi

# Trecere la repo root
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root"

# Diff fișiere ultimul commit
diff_files=$(git diff HEAD~1 HEAD --name-only 2>/dev/null) || exit 0

if [[ -z "$diff_files" ]]; then
  exit 0
fi

# Filtru smart: dacă toate fișierele sunt doar docs/landing/config — tăcere
all_doc_or_config=true
while IFS= read -r f; do
  case "$f" in
    landing/*|docs/*|.github/*|.claude/*|*.md|.gitignore|.prettierrc|.eslintrc.js|knip.json|.dependency-cruiser.cjs)
      ;;
    *)
      all_doc_or_config=false
      break
      ;;
  esac
done <<< "$diff_files"

if $all_doc_or_config; then
  exit 0
fi

# Detectează tipuri de schimbare
code_touched=false
privacy_touched=false
schema_touched=false
scripts_touched=false
new_module=false

while IFS= read -r f; do
  case "$f" in
    app/*|services/*|components/*|hooks/*|theme/*)
      code_touched=true
      ;;
  esac
  case "$f" in
    services/aiProvider.ts|services/aiStatement*Mapper.ts|services/cloudStorage.ts|services/cloudSync.ts|services/backup.ts)
      privacy_touched=true
      ;;
  esac
  case "$f" in
    services/db.ts|services/manifestHash.ts)
      schema_touched=true
      ;;
  esac
  case "$f" in
    package.json)
      scripts_touched=true
      ;;
  esac
done <<< "$diff_files"

if ! $code_touched && ! $scripts_touched; then
  exit 0
fi

# Detectează module noi (fișier nou în services/, components/, hooks/)
new_files=$(git diff HEAD~1 HEAD --name-only --diff-filter=A 2>/dev/null || true)
while IFS= read -r f; do
  case "$f" in
    services/*.ts|components/*.tsx|hooks/*.ts)
      new_module=true
      break
      ;;
  esac
done <<< "$new_files"

# Construiește mesajul
commit_msg=$(git log -1 --pretty=%B 2>/dev/null)
files_listed=$(echo "$diff_files" | head -30)
files_count=$(echo "$diff_files" | wc -l | tr -d ' ')

reminder="📋 Sync docs reminder după commit:

Commit:
$commit_msg

Fișiere modificate ($files_count):
$files_listed"

if [[ $files_count -gt 30 ]]; then
  reminder="$reminder
... (trunchiat)"
fi

reminder="$reminder

Verifică și PROPUNE update-uri (nu modifica automat fără confirmare):

1. **docs/IDEAS.md** — feature implementat? Mută/marchează status."

if $code_touched; then
  reminder="$reminder
2. **landing/index.html** — feature user-visible? Actualizează lista features."
fi

if $scripts_touched; then
  reminder="$reminder
3. **CLAUDE.md** — script nou în package.json? Convenție/comandă schimbată?"
fi

if $new_module || $schema_touched; then
  reminder="$reminder
4. **docs/ARCHITECTURE.md** — folder/modul nou sau schemă DB schimbată? Update folder layout sau secțiunea Date."
fi

if $privacy_touched; then
  reminder="$reminder

⚠️  Acest commit atinge cod legat de AI/cloud/backup (privacy-sensitive).
Verifică manual docs/privacy.html și docs/terms.html (când există) sau
marchează în IDEAS.md că e nevoie de privacy review."
fi

# Output JSON conform protocol PostToolUse
jq -n --arg ctx "$reminder" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
```

- [ ] **Step 4: Marchează executabil**

```bash
chmod +x .claude/hooks/sync-docs.sh
```

- [ ] **Step 5: Creează `.claude/settings.json`**

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

- [ ] **Step 6: Test smoke al scriptului**

Simulează input pentru un commit pe `services/`:

```bash
# Creează input fictiv care să declanșeze hook-ul
cat <<'EOF' | .claude/hooks/sync-docs.sh
{
  "tool_input": { "command": "git commit -m 'test'" },
  "tool_response": { "exit_code": 0 },
  "cwd": "$(pwd)"
}
EOF
```

(Înlocuiește `$(pwd)` cu calea reală în input.)

Expected: output JSON cu `hookSpecificOutput.additionalContext` conținând lista fișierelor și pașii de verificat — **doar dacă** commit-ul anterior a atins cod (probabil nu pentru testul ăsta).

Pentru smoke real: în următoarea sesiune Claude, după ce comitezi acest task, hook-ul va emite reminder-ul.

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/sync-docs.sh .claude/settings.json
git commit -m "$(cat <<'EOF'
chore(claude): add hook sync-docs PostToolUse

Hook bash care detectează commit-uri pe app/services/components/hooks
și emite reminder pentru sync IDEAS, landing, CLAUDE.md, ARCHITECTURE.md.
Semnal special pentru fișiere privacy-sensitive.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Verificare end-to-end

**Files:** niciuna nouă

- [ ] **Step 1: Rulează `npm run check` complet**

Run: `npm run check`
Expected: PASS pe toți pașii.

- [ ] **Step 2: Verifică hook sync-docs activ**

Repornește sesiunea Claude (sau dă `/restart` dacă e disponibil) ca să încarce `.claude/settings.json`.

În sesiunea nouă, fă o modificare minoră într-un fișier `services/` și commitează. După commit, ar trebui să vezi în context-ul Claude un mesaj de la hook care listează fișierele și pașii de verificat.

- [ ] **Step 3: Verifică hook tace pe commit-uri docs-only**

Modifică un fișier în `landing/` sau `docs/` și commitează. Hook-ul nu trebuie să producă output.

- [ ] **Step 4: Verifică pre-commit blochează modificare services fără test**

```bash
# Modifică un fișier services fără să atingi tests
echo "// minor change" >> services/transactions.ts
git add services/transactions.ts
git commit -m "test pre-commit block"
```
Expected: blocare cu mesaj „Modificare în services/ fără test nou".

Curăță:
```bash
git reset HEAD
git checkout services/transactions.ts
```

- [ ] **Step 5: Verifică CI rulează**

Push branch test către remote și verifică în GitHub Actions că workflow `Check` rulează și pasă.

- [ ] **Step 6: Final commit (opțional, doar dacă au apărut mici fix-uri)**

```bash
git add -u
git commit -m "$(cat <<'EOF'
chore: ajustări finale după verificare end-to-end

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Out of scope

- Conținutul existent al `docs/IDEAS.md`, `landing/index.html`, `docs/specs/*` — neatins.
- Privacy/terms HTML — nu se generează aici.
- Refactor cod sursă în afara fix-urilor pentru reguli ESLint nou activate.
- Localizare i18n — separat în roadmap (item 7 IDEAS).

## Note pentru executant

- **Husky e v9+** — fără `husky.sh` source line în pre-commit. Doar shebang.
- **Pragul `type-coverage`** se calibrează la rulare (Task 7 Step 3) — folosește valoarea reală minus 1%.
- **Pragul Jest coverage** se calibrează la rulare (Task 8 Step 1) — dacă valori sub 70%, scade pragul la valoarea reală minus 5%.
- **`knip` poate da fals-pozitive** pe rute Expo Router — config explicit cu `entry: ['app/**/*.tsx']`. Dacă tot apar, adaugă entry suplimentare sau ignore selectiv.
- **Hook `sync-docs`** depinde de `jq` instalat. Pe macOS: `brew install jq`. Verifică în Task 22 Step 1.
- **Ordinea task-urilor contează** — ESLint upgrade primul (Task 1–3) ca să nu primești fail pe ESLint la alte step-uri ulterioare. Hook-ul ultim (Task 22) ca să nu se declanșeze pe commit-urile de setup.
