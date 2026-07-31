# Arhitectură — Finanțe Personale

> Document point-in-time. Hook-ul `sync-docs` semnalează când conținutul poate fi învechit.
> **Ultima actualizare:** 2026-05-04.

## Overview

```
Import extras (PDF/CSV)
     ↓ (PDF) text layer cu poziții (services/pdfTextLayer.ts)
     ↓        └─ quality gate pică → OCR pagini (services/pdfOcr.ts)
Parser determinist (services/bankStatement*Parser.ts)
     ↓        └─ BT: reconciliere cu totalurile din extras (RULAJ ZI)
     ↓ (necategorizate rămase, sau extras necitit)
Mapper AI opțional (services/aiStatement*Mapper.ts)
     ↓
SQLite (services/db.ts, services/transactions.ts)
     ↓
UI (app/**, components/**)
```

Aplicația e **local-first**: nu există backend obligatoriu. Backup și sync (iCloud, cloud) sunt opt-in.

## Folder layout

### `app/` — rute Expo Router

`(tabs)/` conține tab-urile principale (Sumar, Evoluție, Adaugă, Chat, Setări). Tabul „Adaugă" e virtual: listenerul din `(tabs)/_layout.tsx` deschide formularul de tranzacție nouă fără a schimba tabul activ.

Ecranele de management date — `app/conturi/` (cu sub-rute add/edit/import/[id]), `app/tranzactii/` (cu [id]), `app/categorii.tsx` — sunt rute root, accesibile din Setări (hub) și din Sumar (drill-down). Sunt în root, nu în `(tabs)/`, ca să fie push-ate corect pe root Stack cu back button.

Root `_layout.tsx` setează tema, autentificarea (PIN/biometric) și onboarding wizard la prima rulare. Nu pune logică de business aici — extrage în `services/` sau `hooks/`.

### `services/` — logică pură

| Fișier                          | Rol                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `db.ts`                         | conexiune SQLite + schema + migrații                                            |
| `transactions.ts`               | CRUD tranzacții, filtre, agregări                                               |
| `categories.ts`                 | CRUD categorii, sugestii prin regex                                             |
| `financialAccounts.ts`          | CRUD conturi                                                                    |
| `bankStatementParser.ts`        | parser CSV pentru extrase BT/ING/Revolut/OTP                                    |
| `bankStatementPdfParser.ts`     | parser PDF: BT (state machine + reconciliere cu RULAJ ZI) și generic euristic   |
| `bankStatements.ts`             | orchestrare import + deduplicate                                                |
| `internalTransferSuggestion.ts` | detectare cash/savings/investment + conversie bidirecțională în transfer intern |
| `merchantCategoryRules.ts`      | reguli învățate `merchant → categorie` (upsert, match exact + prefix-pe-cuvânt) |
| `insights.ts`                   | narativi lunari (compară luna curentă vs media ultimelor 3 luni)                |
| `recurring.ts`                  | detectare abonamente recurente (lunar) cu status active/missing/expired         |
| `monthlyRecap.ts`               | mini-recap lunar one-shot (modal sumar lună trecută la trecerea în lună nouă)   |
| `aiProvider.ts`                 | abstracție provider AI (built-in cu cotă, sau cheie proprie)                    |
| `aiStatementMapper.ts`          | mapare tranzacții necategorizate prin AI                                        |
| `aiStatementVisionMapper.ts`    | OCR + mapare AI pentru extrase imagine                                          |
| `aiChat.ts`                     | orchestrator chat AI (SQL gen → guard → execute → format)                       |
| `aiChatPrompt.ts`               | construire system prompt + history compaction                                   |
| `aiChatSqlGuard.ts`             | validare SQL allowlist + clamp `LIMIT`                                          |
| `aiChatTemplates.ts`            | template-uri formatare răspuns determinist                                      |
| `aiChatRepo.ts`                 | CRUD pe tabel `chat_messages`                                                   |
| `aiSchemas.ts`                  | scheme Zod centralizate + `parseAiJsonResponse` tolerant pentru toate AI calls  |
| `pdfTextLayer.ts`               | decodare text layer PDF cu poziții (pur, fără Expo — rulează și în Node)        |
| `pdfExtractor.ts`               | orchestrator extragere PDF: text layer first, OCR doar fallback                 |
| `pdfOcr.ts`                     | OCR pe PDF când text layer-ul nu trece quality gate-ul                          |
| `ocr.ts`                        | wrapper ML Kit pentru OCR imagini                                               |
| `backup.ts`                     | export/import ZIP cu manifest                                                   |
| `cloudStorage.ts`               | iCloud Drive / Google Drive abstracție                                          |
| `cloudSync.ts`                  | sync periodic cu cloud storage                                                  |
| `fxRates.ts`                    | rate de schimb (cache local)                                                    |
| `settings.ts`                   | preferințe utilizator (theme, lock, AI consent)                                 |
| `demoData.ts`                   | tranzacții demo pentru onboarding                                               |
| `manifestHash.ts`               | hash structură DB pentru invalidare cache                                       |
| `privacyPolicy.ts`              | sursa unică text confidențialitate (consent + politică)                         |

**Regulă arhitecturală:** `services/` nu importă din `components/`, `app/`, `hooks/`. Logica e portabilă, testabilă, fără dependențe UI.

### `components/` — UI reutilizabil

Componente non-screen: `CategoryIcon`, `IconPicker`, `OnboardingWizard`, `AppLockScreen`, `AppLockPinModal`, `Themed`, `useColorScheme`. Sub-folder `ui/` pentru primitive.

### `hooks/` — React hooks custom

Hook-uri care încapsulează state + side effects (ex. `useCategoryTransactions`).

### `theme/` — culori și tokens

`colors.ts` exportă `Colors` (scheme `light`/`dark`), `primary`, `statusColors`. Nu hardcoda culori în componente.

### `__tests__/`

- `__tests__/unit/` — teste Jest pe `services/`. Snapshot-uri pentru prompt-uri AI în `__snapshots__/aiPromptSnapshots.test.ts.snap`. `setup.ts` configurează mock-uri Expo.
- `__tests__/unit/harness/` — teste pe gate-urile de workflow. Fiecare script de enforcement e rulat ca proces separat, cu stdin de fixture, în repo-uri git temporare; se asertează exit code (0 permite / 2 blochează), mesajul de pe stderr și comportamentul fail-open.
- `__tests__/evals/` — AI eval harness: `aiEvals.test.ts` iterează prin `fixtures/*.json` și verifică parser + schema + sanitizare prompt. Rulat automat în `npm test` și ca job CI separat (`ai-evals` în `.github/workflows/check.yml`). Vezi `__tests__/evals/README.md` pentru cum se adaugă fixture nou și planul de LIVE mode (apel real AI).

### `agents/` — definițiile canonice ale rolurilor

`orchestrator.md`, `planner.md`, `coder.md`, `reviewer.md`, `verifier.md` — ce face fiecare rol, ce nu face, checklist-ul lui. Bindings-urile subțiri din `.claude/agents/<rol>.md` impun mecanic modelul și uneltele prin front-matter (`model:`, `tools:`), astfel încât „planner-ul nu editează" să fie o proprietate a uneltelor, nu o promisiune. Agenții specializați existenți (`bank-parser-reviewer`, `landing-copy-reviewer`) rămân doar în `.claude/agents/`.

### `scripts/` — gate-uri de workflow și utilitare

Harness-ul agentic (vezi `AGENTS.md` → „Bucla de lucru"):

- `workflow-lib.mjs` — contractele partajate: amprenta diff-ului (`git status --porcelain` + `\0` + `git diff HEAD`, cu `.claude/` exclus), definiția „cod de feature", chitanțele din `.claude/state/phase-*.json`, escape hatch-urile cu audit.
- `record-phase.mjs` — scrie chitanța unei faze (plan/verify/review) legată de amprentă; hash-uiește screenshot-urile.
- `check-plan-pretool.mjs` — hook PreToolUse: fără plan pe HEAD-ul curent nu se editează cod de feature.
- `check-workflow-stop.mjs` — hook Stop: un diff de feature nu închide tura fără verify + review valide.
- `check-no-push-pretool.mjs` — hook PreToolUse pe Bash: trimiterea la remote nu se face din sesiunile de agent.
- `check-workflow.mjs` (`npm run check:workflow`) — gate de pre-push: `LEARNINGS.md` atins în range + chitanțe valide și pe HEAD, nu doar pe amprentă.
- `check-pointer-files.mjs` (`npm run check:pointers`) — `CLAUDE.md` rămâne pointer subțire către `AGENTS.md`.
- `statusline-phase.mjs` — statusline `◉ <fază> · <branch>`, faza dedusă din chitanțele încă valide.

Toate hook-urile sunt **fail-open**: orice eroare internă → exit 0. Toate au teste în `__tests__/unit/harness/`, rulate ca procese cu stdin de fixture.

### `landing/`

Site static (HTML + CSS) deploy-uit pe GitHub Pages la fiecare push pe `main` care atinge `landing/**`. `privacy.html` e generat din `services/privacyPolicy.ts` via `npm run build:privacy` (`scripts/build-privacy-html.ts`) — sursa unică de adevăr pentru textele de confidențialitate (in-app + landing).

## Date

### Schema SQLite (versiunea curentă)

| Tabel                     | Rol                                                                      |
| ------------------------- | ------------------------------------------------------------------------ |
| `financial_accounts`      | conturi (bancă, cash, card, economii, investiții) cu sold inițial        |
| `expense_categories`      | categorii ierarhice cu icon, culoare, `monthly_limit`                    |
| `transactions`            | tranzacții cu sumă, dată, categorie, cont, notă, `category_learned`      |
| `merchant_category_rules` | reguli învățate `merchant_normalized → category_id` din corecții manuale |
| `bank_statements`         | evidență import-uri pentru deduplicate                                   |
| `fx_rates`                | cursuri valutare cache (BNR, per zi/valută)                              |
| `chat_messages`           | istoric conversație Asistent AI                                          |

Detalii complete în `services/db.ts`.

### Backup

Format ZIP cu:

- `manifest.json` — versiune schemă, data export, count per tabel
- `data.sqlite` — copie DB
- `images/` — opțional, atașamente

Manifest-hash din `services/manifestHash.ts` permite invalidare cache la schimbări structurale.

## Securitate / privacy

- **App lock** — biometric (`expo-local-authentication`) sau PIN, configurabil în Setări.
- **AI consent** — opt-in explicit la onboarding sau în Setări, cu denumire explicită „Mistral AI (Mistral SAS, Franța)" + link la termenii furnizorului. Free tier 20 cereri/zi (cotă built-in). Premium: nelimitat sau cheie proprie (provider `external`).
- **Pre-flight la upload** — pentru import PDF/CSV, `AiPreflightDialog` cere confirmare per-fișier înainte de fiecare trimitere către AI (afișează nume fișier + dimensiune + ce conține).
- **Politică confidențialitate** — sursa unică `services/privacyPolicy.ts` alimentează ecranul in-app `app/confidentialitate.tsx` și pagina publică `landing/privacy.html` (generată via `npm run build:privacy`). Acoperă cerințele Apple 5.1.1(i)/5.1.2(i): ce date, cui, scopuri, third-party.
- **Cloud sync** — opțional, opt-in. Fără cont online obligatoriu.
- **Date externe trimise** — doar la provider AI selectat. Pentru chatbot conversațional, conținutul tranzacțiilor NU se trimite (AI primește doar schema DB; query-ul rulează local). Pentru import extras, conținutul fișierului se trimite explicit cu pre-flight per-upload. Niciun analytics, fără tracking.

## Mentenanță

- Acest fișier este **point-in-time** — adaugă și actualizează când structura/schema se schimbă.
- Hook-ul `.claude/hooks/sync-docs.sh` semnalează când commit-ul atinge `services/db.ts`, folder-e noi în `services/`/`components/`, sau scripts noi în `package.json`.
