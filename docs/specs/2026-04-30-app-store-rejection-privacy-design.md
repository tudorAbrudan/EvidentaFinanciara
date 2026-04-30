# Spec — Răspuns rejection App Store: privacy + AI disclosure

**Data:** 2026-04-30.
**Submission:** 1.0 (5), respinsă pe 5.1.1(i) / 5.1.2(i) (privacy/AI third-party) și 2.1(b) (informații business model).
**Trigger:** Rejection email Apple, App Store Connect submission `ea807023-7d04-4078-931f-2da7f13a3db0`.

## Problema

Apple a respins build 5 din două motive:

1. **5.1.1(i) / 5.1.2(i)** — app-ul trimite date la un third-party AI service, dar:
   - nu spune **ce date** trimite,
   - nu identifică **cui** trimite (doar „provider" generic),
   - nu cere permisiune explicită cu informația aceasta în față,
   - nu are privacy policy publică care să acopere cele 4 cerințe Apple (ce date, cum, scopuri, third-party).
2. **2.1(b)** — Apple cere clarificări pe business model (paid content, IAP, subscription).

## Decizii cheie (din brainstorming)

- **Strategie:** A — răspuns rapid către Apple + build 6 cu modificări minime + actualizare landing.
- **Numire furnizor:** păstrăm brandul „Finanțe AI" ca etichetă a opțiunii built-in, dar consimțământul + ecranul Confidențialitate + privacy policy numesc explicit Mistral AI (Mistral SAS, Franța).
- **Granularitate consent:** global (existent) + pre-flight per upload PDF/CSV (nou). Pentru chatbot, banner persistent + un singur „prima oară" dialog la prima întrebare.

## Arhitectură

**Single source of truth pentru text:** `services/privacyPolicy.ts` exportă două structuri:

- `AI_DISCLOSURE` — versiunea scurtă pentru consent surface (onboarding, setări, pre-flight).
- `PRIVACY_POLICY_FULL` — politica completă cu 8 secțiuni numerotate, folosită la ecranul „Confidențialitate" și la `landing/privacy.html`.

Tot textul în română. Ambele structuri sunt obiecte TypeScript (`{ heading, paragraphs[] }`-style), nu Markdown — randate direct de componenta `PrivacyPolicyView`.

**Generare landing:** script `scripts/build-privacy-html.ts` rulat manual (sau prin npm script), citește `services/privacyPolicy.ts` și scrie `landing/privacy.html` cu același CSS din `landing/style.css`.

## Componente noi

| Fișier                                  | Rol                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `services/privacyPolicy.ts`             | Sursa unică de adevăr (TS exports)                                                 |
| `components/PrivacyPolicyView.tsx`      | Render secțiuni numerotate (folosit de ecranul Confidențialitate)                  |
| `components/AiDisclosureExpandable.tsx` | Block expandabil „Ce date trimit?" — folosit lângă consent în onboarding și setări |
| `components/AiPreflightDialog.tsx`      | Modal pre-flight la upload PDF/CSV: nume fișier, mărime, ce conține, butoane       |
| `app/confidentialitate.tsx`             | Ecran nou (root, push din Setări) cu PRIVACY_POLICY_FULL                           |
| `landing/privacy.html`                  | Pagina publică pentru App Store Connect                                            |
| `scripts/build-privacy-html.ts`         | Generează `landing/privacy.html` din `services/privacyPolicy.ts`                   |
| `__tests__/unit/privacyPolicy.test.ts`  | Smoke test: structurile sunt non-empty, conțin „Mistral", lista date sent          |

## Modificări

| Fișier                            | Schimbare                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/OnboardingWizard.tsx` | În pasul AI: text consent nou (numește Mistral) + `AiDisclosureExpandable` sub checkbox                                                                                |
| `app/(tabs)/setari.tsx`           | În secțiunea AI: text consent nou + `AiDisclosureExpandable`. În secțiune nouă „Despre & legal": link „Confidențialitate"                                              |
| `app/conturi/import.tsx`          | Înainte de `tryAiFallback` și `runVisionFlow`, deschide `AiPreflightDialog`; dacă user anulează, abort. Pre-flight nu se reține                                        |
| `landing/index.html`              | Footer: link „Politica de confidențialitate" → `privacy.html`. Secțiunea `#privacy` actualizată cu mențiune „pentru detalii AI și prelucrare, vezi politica completă". |
| `docs/IDEAS.md`                   | Marchează punctul 6 „Pagini legale" ca implementat                                                                                                                     |
| `docs/ARCHITECTURE.md`            | Adaugă mențiune scurtă despre `services/privacyPolicy.ts` și fluxul build                                                                                              |
| `package.json`                    | Script nou `build:privacy` care rulează `scripts/build-privacy-html.ts` (via tsx/ts-node sau bun)                                                                      |

## Conținut text — extras din brainstorming

### `AI_DISCLOSURE` (versiune scurtă)

Numește Mistral AI (Mistral SAS, Franța), enumeră ce se trimite per use-case (chatbot / CSV / PDF vision), scopul, link la termenii Mistral, opt-in & revocare. Vezi secțiunea „Conținut" din decizia de design.

### `PRIVACY_POLICY_FULL` (8 secțiuni)

1. Cine suntem & local-first.
2. Date create/păstrate local (tranzacții, conturi, categorii, fișiere import, log).
3. Date trimise terților + AI_DISCLOSURE integrat.
4. Backup iCloud opțional.
5. Securitate device (PIN, biometric, SecureStore).
6. Drepturile tale (export JSON, ștergere = dezinstalare).
7. Modificări ale politicii (data + sursă GitHub).
8. Contact.

### Pre-flight dialog (PDF/CSV)

Nume fișier + mărime/pagini → „Vor fi trimise [paginile PDF ca imagini / textul fișierului] către Mistral AI" + link termeni Mistral + butoane „Anulează" / „Trimite la Mistral AI".

## Răspunsul către Apple

Două mesaje în Resolution Center:

1. **Pentru 5.1.1/5.1.2:** lista modificărilor în build 6 (nume Mistral peste tot, disclosure pe categorii de date, pre-flight pe upload, privacy policy publică).
2. **Pentru 2.1(b):** declarație clară că nu există paid content / IAP / subscription. Built-in AI key e plătită de developer; user poate aduce propria cheie (plătită direct la provider). Niciun pachet IAP integrat.

URL privacy policy: `https://<github-pages-domain>/privacy.html` — completat când deploy-ul e gata.

## Plan testare

- **Unit:** `__tests__/unit/privacyPolicy.test.ts` — verifică `AI_DISCLOSURE` și `PRIVACY_POLICY_FULL` au lungime non-zero, conțin string-ul „Mistral", și acoperă cele 4 cerințe Apple (data collected, how, all uses, third-party).
- **Manual:** flux onboarding cu opt-in AI, salvare → verifică text nou; setări → click „Confidențialitate" → ecran randat; import PDF cu AI → dialog pre-flight; refuz dialog → abort; accept → trimite.
- **Build:** `npm run build:privacy` generează `landing/privacy.html` valid; `npm run check` trece.

## Out of scope

- Localizare EN — RO-only conform IDEAS.md.
- Audit log local al cererilor AI — YAGNI pentru rejection actual.
- Per-message consent în chatbot — interpretare prea strictă, ar distruge UX.
- Schimbarea provider-ului Mistral cu alt vendor.
