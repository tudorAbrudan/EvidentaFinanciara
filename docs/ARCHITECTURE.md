# Arhitectură — Finanțe Personale

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

| Fișier                       | Rol                                                          |
| ---------------------------- | ------------------------------------------------------------ |
| `db.ts`                      | conexiune SQLite + schema + migrații                         |
| `transactions.ts`            | CRUD tranzacții, filtre, agregări                            |
| `categories.ts`              | CRUD categorii, sugestii prin regex                          |
| `financialAccounts.ts`       | CRUD conturi                                                 |
| `bankStatementParser.ts`     | parser CSV pentru extrase BT/ING/Revolut/OTP                 |
| `bankStatementPdfParser.ts`  | parser PDF (text extraction)                                 |
| `bankStatements.ts`          | orchestrare import + deduplicate                             |
| `aiProvider.ts`              | abstracție provider AI (built-in cu cotă, sau cheie proprie) |
| `aiStatementMapper.ts`       | mapare tranzacții necategorizate prin AI                     |
| `aiStatementVisionMapper.ts` | OCR + mapare AI pentru extrase imagine                       |
| `aiChat.ts`                  | orchestrator chat AI (SQL gen → guard → execute → format)    |
| `aiChatPrompt.ts`            | construire system prompt + history compaction                |
| `aiChatSqlGuard.ts`          | validare SQL allowlist + clamp `LIMIT`                       |
| `aiChatTemplates.ts`         | template-uri formatare răspuns determinist                   |
| `aiChatRepo.ts`              | CRUD pe tabel `chat_messages`                                |
| `pdfExtractor.ts`            | extragere text PDF                                           |
| `pdfOcr.ts`                  | OCR pe PDF când text-extraction eșuează                      |
| `ocr.ts`                     | wrapper ML Kit pentru OCR imagini                            |
| `backup.ts`                  | export/import ZIP cu manifest                                |
| `cloudStorage.ts`            | iCloud Drive / Google Drive abstracție                       |
| `cloudSync.ts`               | sync periodic cu cloud storage                               |
| `fxRates.ts`                 | rate de schimb (cache local)                                 |
| `settings.ts`                | preferințe utilizator (theme, lock, AI consent)              |
| `demoData.ts`                | tranzacții demo pentru onboarding                            |
| `manifestHash.ts`            | hash structură DB pentru invalidare cache                    |

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

| Tabel                | Rol                                                   |
| -------------------- | ----------------------------------------------------- |
| `financial_accounts` | conturi (bancă, cash, card) cu sold inițial           |
| `expense_categories` | categorii ierarhice cu icon, culoare, `monthly_limit` |
| `transactions`       | tranzacții cu sumă, dată, categorie, cont, notă       |
| `bank_statements`    | evidență import-uri pentru deduplicate                |
| `settings`           | preferințe utilizator (key-value)                     |
| `chat_messages`      | istoric conversație Asistent AI                       |

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
