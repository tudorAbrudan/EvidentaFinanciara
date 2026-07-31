# Idei și roadmap — Finanțe Personale

> Aplicație publică, local-first, posibil monetizată. Principii:
>
> 1. Datele rămân pe device. Niciun backend obligatoriu.
> 2. AI-ul e opțional și transparent (consent explicit, fără dark patterns).
> 3. Nu adăugăm complexitate inutilă — fiecare idee răspunde la: _câți utilizatori beneficiază real, merită complexitatea?_

**Status:** roadmap inițial, înainte de primul spec implementat.
**Ultima actualizare:** 2026-07-31.

---

## Pre-lansare (toate trebuie făcute înainte de App Store)

Lista e ordonată după priority. Fiecare punct devine propriul spec → plan → implementare.

### Fundație produs

0. **Harness agentic (enforcement pe faze)** — **instalat 2026-07-31, în așteptarea rodajului live.** Pașii 1–8 din plan sunt livrați cu teste verzi: plan-gate + Stop-gate cu chitanțe legate de amprenta diff-ului, blocare push din agent, pre-push cu `check:workflow` + APPROVE uman la `/dev/tty`, roluri planner/coder/reviewer/verifier cu modele și unelte impuse prin front-matter, `AGENTS.md` canonic + `CLAUDE.md` pointer (gate `check:pointers`), `LEARNINGS.md`, statusline de fază, `permissions.deny` pe guardrails. **Rămâne pasul 9 — rodajul live**, care se execută manual, cu omul de față (checklist în plan): harness-ul nu e „activ" până nu trec cele 10 verificări. Adaptare a spec-ului portabil din proiectul sprint-board. Spec: `docs/specs/2026-07-30-agentic-harness-design.md`. Plan: `docs/plans/2026-07-30-agentic-harness.md`. Bugetele (#12) = primul feature rulat sub harness.
1. **Onboarding wizard** — welcome, aspect (light/dark/auto), securitate (PIN/biometric), primul cont, AI consent, sumar. Adaptat din `documents/app/components/OnboardingWizard.tsx`, simplificat la specificul finanțelor (fără entități/documente — pașii relevanți: aspect, securitate, primul cont, notificări, AI, backup, sumar).
2. **Quick-add tranzacție** — FAB („+") pe Sumar și Tranzacții. Modal rapid: sumă, categorie, opțional cont/notă/data. One-tap. Cea mai folosită acțiune trebuie să fie cea mai accesibilă.
3. **Empty states** — pe fiecare ecran (Sumar, Conturi, Tranzacții, Categorii) când nu există date. Mesaj prietenos + acțiune sugerată.
4. **Backup/restore vizibil** — în onboarding (pas dedicat) și în Setări. Alertă „nu ai făcut backup de X zile" cu CTA. Folosește implementarea existentă din `services/backup.ts`.
5. ~~**Date demo opționale**~~ — implementat 2026-05-09 cu default **on** (opt-out). Vezi mai jos.
6. ~~**Pagini legale**~~ — implementat 2026-04-30 (vezi mai jos). Privacy ✓; Terms rămâne TBD dacă apare nevoie reală.
7. **Localizare structurală** — separi string-urile în `i18n/ro.ts` (sau echivalent) chiar dacă lansezi RO-only. Pregătire EN fără refactor.

### Diferențiator (de ce ar alege cineva app-ul tău)

8. **Sugerare AI categorii pe import (mapare)** — după parser determinist + `suggestCategory` (regex), AI propune categorie pentru tranzacțiile încă necategorizate. **User confirmă, AI nu auto-aplică.** UI: badge „AI sugerează: Mâncare ✓ ✗" pe tranzacție. Free: cota built-in actuală (20/zi). Premium: nelimitat.
9. ~~**Detectare automată tranzacții recurente**~~ — implementat 2026-05-10. Vezi mai jos.
10. ~~**Insights lunari**~~ — implementat 2026-05-10. Vezi mai jos.
11. ~~**Învățare locală auto-categorizare**~~ — implementat 2026-05-10. Vezi mai jos.
12. **Bugete pe categorii cu progress bar** — schema are deja `monthly_limit`. Lipsește UI: ecran „Bugete" cu listă categorii + bar progres + edit limit. Status colors la 80% / 100%.
13. **Notificări locale pe bugete** — la 80% și 100% din `monthly_limit` pe categorie, notificare locală. Folosește `expo-notifications` (deja în deps). Configurabil din Setări (on/off, threshold).

### Funcții avansate

14. **Descoperire categorii noi (AI)** — dacă AI vede pattern-uri pe „necategorizate" (ex. 10% din cheltuieli la veterinar/petshop) și nu există categorie potrivită, propune să adauge una nouă cu icon + nume sugerat. User confirmă. WOW factor.
15. **Statistici YoY** — compară aprilie 2026 vs aprilie 2025 pe categorii. Grafic linie pe 12 luni rulante.
16. **Tag-uri pe tranzacții** — ortogonale categoriilor (ex. „concediu", „cadou", „business", „rambursabil"). Schema: tabel `tags` + `transaction_tags`. Filtrare în Tranzacții.
17. **Tracking datorii** — bidirecțional: am împrumutat / mi s-a împrumutat. Fără cont separat — câmp `debt_party` și `debt_status` pe tranzacție. Listă „Datorii deschise".
18. **Tranzacții programate** — rate cunoscute (leasing, rate cumpărări), plăți viitoare prevăzute. Apar în calendar și pre-populate la data lor.
19. **Export CSV/Excel/PDF** — export perioadă sau tot. CSV + PDF e suficient pentru MVP, Excel poate fi „PDF cu tabel" inițial.
20. **Split transaction** — 1 tranzacție pe mai multe categorii (ex. Lidl 200 RON: 150 mâncare + 50 igienă). Schema: tabel nou `transaction_splits`. Edit modal cu „adaugă split".
21. **Scan bon de casă** — poză bon → OCR (`@react-native-ml-kit/text-recognition` deja prezent) → tranzacție cash cu sumă + dată + best-effort merchant. Util pentru cash, frecvent în RO.
22. ~~**Mini-recap lunar**~~ — implementat 2026-05-10. Vezi mai jos.
23. **Obiective de economisire** — „vreau 5000 RON până decembrie". Calcul automat ce trebuie pus deoparte/lună. Tracking progres pe baza tranzacțiilor pe un cont marcat „economii".

---

## Implementat (post-MVP fundație)

- **Parser BT PDF v2 + reconciliere** (2026-07-30) — parserul vechi producea date complet greșite pe extrase BT reale, fără niciun warning (pe extrasul din iunie: 83 rânduri plauzibile, venituri +364.210,90 în loc de +99.246,10). Trei schimbări. (1) `services/pdfTextLayer.ts` — extractor pur (fără Expo, rulează și în Node) care urmărește operatorii de poziționare `Tm`/`Td`/`TD`/`T*`/`TL`, grupează span-urile pe linii după y și sparge coloanele îndepărtate în linii separate, deci tabelul iese ca linii reale. (2) `services/pdfExtractor.ts` — text-layer first cu quality gate (`isUsableExtraction`), OCR doar fallback; semnătura devine `{ text, source, warnings }` iar tăierea OCR la 10 pagini nu mai e silențioasă. (3) `parseBt` v2 — state machine ancorată în `REF:` + linia-sumă (ordine indiferentă, ca să supraviețuiască granițelor de pagină), semn dedus în două trepte: lexicon determinist pe tipul operațiunii → reconciliere pe zi cu `RULAJ ZI` (căutare de semne aplicată doar când soluția e unică). Reconcilierea e output de prim rang (`PdfParseResult.reconciliation`) și se vede în `components/ImportReconciliationCard.tsx`: verde când fiecare zi și totalul bat la ban, galben cu zilele care nu bat + îndemn la a doua citire AI. Rândurile reconciliate nu mai trec prin `applyDirectionHint` — euristica ar întoarce exact cazurile pe care extrasul le confirmă („Rambursare principal credit"). Fixtures reale anonimizate în `__tests__/fixtures/bt-pdf/`; verificare pe PDF-uri locale fără a le commitui prin `npm run parse:pdf`. Spec: `docs/specs/2026-07-30-bt-pdf-parser-v2-design.md`. Plan: `docs/plans/2026-07-30-bt-pdf-parser-v2.md`.

- **AI development harness** (2026-05-21) — `services/aiSchemas.ts` centralizează schemele Zod pentru toate răspunsurile AI structurate (StatementResponseSchema, ChatResponseSchema) + `parseAiJsonResponse` tolerant (strip code fence, gestiune `no_json_found` / `invalid_json` / `schema_violation` cu path Zod). Statement mapper refactor: returnează `MapperParseOutput` cu stats (total/accepted/rejected/schemaError) → warnings vizibile în UI în loc de drop silent. Snapshot tests pe `buildSystemPrompt`, `buildPrompt` (RON+EUR), `VISION_SYSTEM_PROMPT`, `buildVisionUserText` → orice modificare la prompt-uri → diff vizibil în PR. Token & cost tracking: `recordAiTokens` parsează `usage` din response Mistral, persistă daily + cumulative în AsyncStorage; UI în Setări afișează consum. AI eval harness în `__tests__/evals/` cu 5 fixture-uri (BT simplu, zgomot, prompt injection, sume malformate, schema violation) și runner Jest care verifică sanitizarea prompt-ului + corectitudinea parser-ului + anti-injection guards. Script `npm run evals:ai` pentru iterație rapidă. CI job dedicat `ai-evals` în `.github/workflows/check.yml` triggered pe modificări în `services/ai*` sau `__tests__/evals/**` → feedback clar pe PR când regresează modul de interpretare AI. LIVE mode (apel real AI) e TODO, documentat în README. Fix-uri concomitente: temperature 0 default pentru `sendAiRequest` (determinist pentru SQL/JSON), `category_new` ca tip nou de insight, `normalizeMerchant` strip-uiește zgomot (#cod, \*card, cifre), `pickNextRecapMonth` arată cea mai veche lună necitită, cadență bi-monthly pentru recurring.

- **Mini-recap lunar one-shot** (2026-05-10) — `services/monthlyRecap.ts` afișează modal la prima deschidere a aplicației într-o lună nouă cu sumarul lunii trecute: total cheltuieli, delta față de luna anterioară, top 3 categorii, primul highlight insight (din `computeMonthlyInsights`). Skip dacă luna trecută are < 5 tranzacții (împotriva noise-ului în luna primă post-instalare). Persist `settings_last_recap_month` în AsyncStorage; recap-ul apare o singură dată per lună. Funcția pură `buildRecapSummary` separată pentru testare. UI: `components/MonthlyRecapModal.tsx` cu titlu „<Lună> <An> pe scurt", icon calendar, listă top categorii + buton primary „OK, înțeles". Wire în `app/(tabs)/index.tsx`: useEffect on mount apelează `shouldShowRecap`, dacă target existent → `buildRecap` → afișează modal; dismiss apelează `markRecapShown`. Spec: `docs/specs/2026-05-10-monthly-recap-design.md`. Plan: `docs/plans/2026-05-10-monthly-recap.md`.

- **Detectare abonamente recurente** (2026-05-10) — `services/recurring.ts` analizează ultimele 6 luni de cheltuieli (`amount < 0`, non-transfer, non-duplicate). Algoritm: grupare pe `normalizeMerchant`, filtru sumă (median ±10%), filtru cadență (median 25–35 zile lunar + majoritatea intervalelor în range pentru a respinge outlier-i extremi), min 3 apariții. Status: `active` (ultima apariție ≤ 35 zile), `missing` (35–70 zile, _ai sărit o lună_), `expired` (> 70 zile). `expected_next` calculat ca `last_seen + median_cadence`. Funcție pură `buildRecurringSeries` separată pentru testare. UI: `components/RecurringSummary.tsx` cu max 5 series afișate, badge status colorat (`statusColors.ok` / `critical`), evidențiere „lipsește de X zile" pentru `missing`. Inserat pe Sumar (`app/(tabs)/index.tsx`) între insights și chip-uri. Spec: `docs/specs/2026-05-10-recurring-detection-design.md`. Plan: `docs/plans/2026-05-10-recurring-detection.md`.

- **Insights lunari pe Sumar** (2026-05-10) — `services/insights.ts` calculează 0–3 narativi în RO comparând luna curentă cu media ultimelor 3 luni: total general (prag ±20% relativ ȘI ±50 RON absolut) + categorii (prag ±20% relativ ȘI ≥ 100 RON absolut luna curentă). Funcție pură `buildInsightsFromBreakdowns` separată pentru testare fără DB. Sortare descrescător după magnitudine, total e mereu primul, max 3 afișate. Severity (`positive` ↓ / `warning` ↑ / `neutral`) → culoare `statusColors.ok` / `critical` / `textSecondary`. Necategorizat exclus (numai categorii cu `category_id` non-null). UI `components/InsightsCard.tsx` cu header „Ce e diferit luna asta?" și icon trending-up/down inserat în Sumar (`app/(tabs)/index.tsx`) între monthBar și chip-uri; cardul nu se afișează deloc când 0 insights. Spec: `docs/specs/2026-05-10-monthly-insights-design.md`. Plan: `docs/plans/2026-05-10-monthly-insights.md`.

- **Învățare locală merchant → categorie** (2026-05-10) — la fiecare modificare manuală a categoriei pe o tranzacție cu merchant non-vid, regula `merchant_normalized → category_id` e persistată în tabel nou `merchant_category_rules` (PK pe normalized: lowercase + diacritice strip + trim, with `merchant_display` pentru afișare). La importul/quick-add unei tranzacții fără category_id explicit, regula match (exact sau prefix-pe-cuvânt) e aplicată automat și `transactions.category_learned=1` marchează atribuirea. Match-ul prefix permite ca regula „lidl" să prindă „LIDL Bucuresti" și „LIDL Cluj"; la conflict, regula mai specifică (mai lungă) câștigă. Coloana nouă `category_learned` pe `transactions` (default 0; resetată la modificare manuală). UI: badge `sparkles` în pill-ul de categorie din Sumar (`ExpandedTransactionRow` în `app/(tabs)/index.tsx`), sufix „· învățat" în lista din `app/tranzactii/index.tsx`, hint în detaliu (`app/tranzactii/[id].tsx`) cu mesaj „Atribuit automat din istoricul corecțiilor tale". Backup bumped la v2: `merchantCategoryRules` în payload; importul restorează regulile (cu remap `category_id` prin categoryMap) și apelează `applyRulesToUncategorized` best-effort. Spec: `docs/specs/2026-05-10-merchant-category-rules-design.md`. Plan: `docs/plans/2026-05-10-merchant-category-rules.md`.

- **Date demo on-by-default în onboarding** (2026-05-09) — toggle „Adaugă cont demo cu tranzacții fictive" pre-bifat în pasul Demo (`DemoDataStep` în `components/OnboardingWizard.tsx`) pentru time-to-first-value sub 30 secunde. Userul îl poate dezactiva înainte de Continuă. Switch dezactivat și mesaj informativ dacă există deja date demo (`hasDemoData`). În Setări, secțiunea „Cont demo" apare doar când demo există și conține un singur buton destructiv „Șterge datele demo" → `deleteDemoData()` în `services/demoData.ts` (curăță contul demo + tranzacțiile asociate, idempotent).

- **Filtru categorie + drilldown din Evoluție** (2026-05-07) — chip nou „Categorie" în `TransactionFilterBar` cu sheet (Toate / Necategorizat / listă categorii cu dot colorat). Backend deja avea `category_id` și `uncategorized` în `TransactionFilter` — am wire-uit doar UI-ul. `app/tranzactii/index.tsx` citește acum `category_id`, `uncategorized`, `fromDate`, `toDate`, `account_id` din `useLocalSearchParams` (validare YMD) ca să poată fi seed-uit din alte ecrane. Drilldown din `app/(tabs)/evolutie.tsx`: tap pe coloana lunară din chart-ul agregat → `/tranzactii?fromDate=…&toDate=…` (dezactivat pentru luni cu total 0); tap pe rândul din „Top categorii" → `/tranzactii?category_id=…&fromDate=…&toDate=…` (sau `uncategorized=1` pentru rândul fără categorie), cu intervalul derivat din `monthsBack` (3/6/12 luni).

- **Ștergere în lot tranzacții filtrate** (2026-05-05) — bară de filtre pe ecranul Tranzacții (cont, perioadă, descriere, sumă în valori absolute) + acțiune „Șterge filtrate" în header cu ecran de confirmare cu pre-bifare și deselect per tranzacție. Backend: `bulkDeleteTransactions(ids)` în `services/transactions.ts` rulează atomic într-o `withTransactionAsync` cu cleanup transferuri interne (contraparte devine tranzacție obișnuită), dezmarcare duplicate, DELETE chunked la 500 IDs și auto-purge `bank_statements` rămase fără tranzacții. Filtru nou `absAmountRange` adăugat în `TransactionFilter` (matching pe interval semnat + absolut). Componentă reutilizabilă `TransactionFilterBar` cu sheet-uri pentru cont/perioadă/descriere/sumă. Handoff IDs între ecrane prin store in-memory `services/bulkDeleteHandoff.ts` (semantică one-shot). Sumar pe ecran de confirmare: count selectate, sumă absolută per valută, count transferuri interne și count din extrase. Spec: `docs/specs/2026-05-05-bulk-delete-transactions-design.md`. Plan: `docs/plans/2026-05-05-bulk-delete-transactions.md`.

- **Sugestie transfer intern (cash + economii)** (2026-05-04) — detectează automat trei tipuri de tranzacții care reprezintă transferuri către/dinspre conturi proprii neimportate și sugerează conversia în transfer intern (mecanism existent `is_internal_transfer` + `linked_transaction_id`): retrageri cash (regex `retragere|extragere|atm|bancomat|cash withdrawal|numerar`), transfer la economii / constituire depozit (`transfer la/spre/catre economii|alimentare economii|constituire depozit|economisire`) și retragere economii / lichidare depozit (`transfer din/de la economii|retragere economii|lichidare depozit`). Trei surface-uri UX: banner pe Sumar (`TransferSuggestionBanner`) cu count pending în ultimul an și dismiss pe sesiune; ecran batch (`app/sugestie-transfer/batch.tsx`) post-import sau din banner, cu badge tip per rând și filtrare cont destinație pe tip + valută; checkbox inline în formular tranzacție (`InternalTransferToggle` în `app/tranzactii/[id].tsx`) cu auto-detect edge-trigger și label adaptiv. Schema neschimbată — `cash_suggestion_dismissed` reutilizat ca flag generic per-tx. Conversie atomică bidirecțională prin `convertToTransfer` (sumă negativă → cash sau economii; sumă pozitivă → economii cu mirror negativ). Spec: `docs/specs/2026-05-04-internal-transfer-suggestion-design.md`. Plan: `docs/plans/2026-05-04-internal-transfer-suggestion.md`.

- **Politică confidențialitate + AI consent explicit Mistral** (2026-04-30) — răspuns la respingerea Apple (5.1.1(i) / 5.1.2(i) și 2.1(b)). Sursa unică `services/privacyPolicy.ts` exportă `AI_DISCLOSURE` (consent surface) și `PRIVACY_POLICY_FULL` (ecran + landing). Componente: `AiDisclosureExpandable` (onboarding + Setări), `AiPreflightDialog` (per-fișier la import PDF/CSV), `PrivacyPolicyView` (ecran `app/confidentialitate.tsx`). Numire explicită „Mistral AI (Mistral SAS, Franța)" + link la termeni; clarificare „tranzacțiile NU se trimit la chatbot — AI primește doar schema, query rulează local". Pagină publică `landing/privacy.html` generată din TS via `npm run build:privacy`. Spec: `docs/specs/2026-04-30-app-store-rejection-privacy-design.md`.

- **Redesign navigație — focus pe evoluție** (2026-04-30) — tab bar restructurat: `Sumar | Evoluție | Adaugă | Chat | Setări`. Conturi/Tranzacții/Categorii mutate din `(tabs)/` în root pentru push real cu back button; accesibile din Setări (hub) și din Sumar (drill-down). Tab „Adaugă" cu listener pe tabPress care deschide formular tranzacție nouă fără a schimba tabul activ. Bug fix scroll formular cu tastatura deschisă (`keyboardDismissMode='on-drag'` în loc de wrapper Pressable). Spec: `docs/specs/2026-04-30-redesign-navigatie-design.md`. Plan: `docs/plans/2026-04-30-redesign-navigatie.md`.

- **Asistent AI conversațional** (2026-04-29) — tab dedicat „Asistent" în tab bar, Setări mutat în header Sumar (⚙️). AI traduce întrebări în limba română în SQL SELECT (read-only, defense-in-depth: allowlist tabele/cuvinte cheie + PRAGMA `query_only` + clamp `LIMIT 500` + timeout 3s). App formează răspunsul prin template-uri locale (zero halucinare numerică): `search_merchant`, `top_merchants`, `monthly_total`, `category_evolution`, `period_compare`, `list_accounts`, `list_categories`, `raw_list`, `cannot_answer`. Spec: `docs/specs/2026-04-29-ai-chatbot-design.md`. Plan: `docs/plans/2026-04-29-ai-chatbot.md`.

---

## Premium (post-lansare, monetizare)

24. **AI vision nelimitat** — free: cota built-in actuală (20 cereri/zi). Premium: nelimitat sau cheie proprie acceptată (ce e deja implementat ca `external` provider).
25. **Backup automat în iCloud / Google Drive** — free: export manual ZIP. Premium: programat săptămânal/lunar fără intervenție.
26. **Rapoarte PDF brandate** — pentru oameni care vor să trimită cuiva (contabil, partener) un raport oficial pe perioadă. Template + logo + formate predefinite.
27. **Multi-device sync E2E** — _decis ulterior._ Costă infrastructură; poate să nu apară niciodată dacă local-first e poziționarea.

---

## Respinse / amânate

| Idee                                     | Motiv                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Conectare directă API bănci (PSD2/Plaid) | RO acoperit slab, costă, fragil. PDF/CSV import e suficient pentru MVP.         |
| Sync cloud proprietar                    | Împotriva poziționării local-first. Backup ZIP e suficient.                     |
| Login/cont online obligatoriu            | Împotriva poziționării. App lock-ul biometric/PIN e tot ce trebuie.             |
| Vânzare date                             | Niciodată — e selling point invers.                                             |
| Notificări push de pe server             | Nu există backend; notificările locale sunt suficiente.                         |
| Widget homescreen iOS/Android            | Amânat — costă timp de implementare per platformă. Poate intra după monetizare. |
| Wear OS / Apple Watch                    | Out of scope pentru produs financiar.                                           |
| Family sharing / household partajat      | Decis după monetizare; necesită infrastructură.                                 |

---

## Cum folosim acest fișier

- **Idee nouă** → adaug în secțiunea potrivită cu context scurt.
- **Idee validată** → mut în spec proper (`docs/specs/YYYY-MM-DD-<topic>-design.md`) înainte de implementare.
- **Idee respinsă** → mut în tabelul de mai sus cu motivul.
