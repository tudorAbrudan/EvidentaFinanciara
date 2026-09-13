# Proxy AI + semnale financiare (extrase lipsă, cheltuieli atipice, sugestii de economisire)

Două blocuri independente. **A** e securitate și are termen: cheia Mistral e azi compilată în
bundle. **B** e produs: semnale noi, toate deterministe și locale, cu AI doar opțional și doar
peste cifre calculate din DB (vezi regula „AI nu inventează cifre").

Ordinea de implementare e tabelul de la final. Fundația de parser și B1 (acoperirea) vin primele
din B, pentru că B2, B3 și B6–B8 dau concluzii false pe luni fără extras importat.

## Contextul de utilizare care dictează designul

Userul **nu introduce cheltuieli manual**. Importă extrasele bancare **o dată, la final de lună**.
Consecințe:

- Luna curentă n-are date până la import. Orice semnal „în timp real" e gol: ritm până azi,
  notificare de buget la 80%, salariu întârziat.
- **Momentul care contează e imediat după import.** Acolo se pun toate semnalele, într-un singur
  raport (B4), nu pe Sumar în mijlocul lunii.
- **O lună se analizează doar când e completă:** au intrat extrasele _tuturor_ conturilor. După
  ce ai importat doar BT RON, lipsa BT EUR ar arăta ca o scădere de cheltuieli.
- `monthlyRecap` se declanșează azi după calendar (prima deschidere în luna nouă), adică exact
  înainte de import, pe date goale sau parțiale. Trebuie declanșat de acoperire, nu de calendar.

---

## A. Proxy AI (cheia pleacă din aplicație)

### Starea de azi

`services/aiProvider.ts:114` — `BUILTIN_API_KEY = process.env.EXPO_PUBLIC_MISTRAL_API_KEY`.
Orice `EXPO_PUBLIC_*` intră în bundle-ul JS, deci cine despachetează `.ipa` are cheia și cotă
nelimitată pe contul nostru. La Dosar s-a întâmplat exact asta (rate limit permanent pe cheia
veche, 2026-09-07). Limita de 20 cereri/zi e doar pe device (`AsyncStorage`), deci
nu oprește pe nimeni care a extras cheia.

Build-urile trimise la Apple (inclusiv cel respins pe 2026-04-30) conțineau cheia. **Considerăm
cheia compromisă** indiferent ce facem mai departe.

### A0 — Azi, fără cod (15 minute)

1. Plafon de cheltuială în contul Mistral (billing limit). Doar el mărginește paguba; tot ce
   urmează reduce probabilitatea.
2. **Decis (2026-09-11): cheia e aceeași ca la Dosar și se schimbă.** `finante/.env` conține
   cheia veche din bundle-ul Dosar, abuzată și cu rate limit permanent din 2026-09-07.
   `documents/app/.env` nu mai are nicio cheie Mistral de atunci. Consecințe:
   - **Finanțe AI (`builtin`) e foarte probabil deja nefuncțional** pentru toți userii: chat,
     import cu AI, vision. De confirmat în consola Mistral (starea cheii vechi).
   - Pentru Finanțe se creează o cheie **nouă, dedicată**, care stă **doar** pe serverul proxy,
     niciodată în `.env`-ul aplicației. Dacă Mistral permite workspace separat cu plafon
     propriu, cheia se creează acolo.
   - De confirmat că serverul Dosar rulează pe cheia rotită, cum cere README-ul lui, și nu pe
     cea veche. Altfel bundle-ul Finanțe scurge și cheia serverului Dosar.
3. Nu trimitem build 13 (v1.1.0, versiunea din working tree) la review cu cheia în bundle.
   Primul build public trebuie să iasă direct pe proxy.

**Acceptanță:** plafonul e setat și verificat în dashboard. Starea cheii vechi e confirmată.
Cheia nouă există și nu apare în niciun `.env` al vreunei aplicații.

### A1 — Proxy-ul (server)

**Decis (2026-09-11):** același cod ca `documents/app/ai-proxy`, **deploy separat**
`finante-ai-proxy` pe Danube Rapids (free tier), **cheie Mistral separată**, token de aplicație
propriu.

**De verificat în dashboard:** free tier-ul Danube e per cont sau per serviciu? Dacă e per cont,
cele două proxy-uri împart aceeași cotă lunară (2M cereri, ~69 vCPU-ore). Un proxy care doar
releează un fetch consumă puțin, dar `GLOBAL_DAILY_LIMIT` pe ambele se setează ținând cont de
cota comună.

| Variantă                                    | Pro                                                                | Contra                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Deploy separat, cod copiat** (recomandat) | incident izolat; plafoane și limite per app; revocare independentă | ~400 linii duplicate între două repo-uri                                                              |
| Un singur proxy multi-tenant                | un singur deploy                                                   | abuzul pe o app o oprește pe cealaltă; plafon Mistral comun; Dosar e live, orice schimbare e riscantă |

Copia se pune în `finante/ai-proxy/` (Node ≥20, zero dependențe), cu modificările:

1. **Header-e generice.** `X-App-Device` pentru contorizare. Token-ul se primește ca
   `Authorization: Bearer` (proxy-ul îl acceptă deja). Scoatem `X-Dosar-*`.
2. **Whitelist strâns:** `ALLOWED_MODELS=mistral-small-latest`. Finanțe folosește un singur
   model atât pentru text, cât și pentru vision (`BUILTIN_MODEL`). Un whitelist mai larg ar
   permite rularea unor modele scumpe cu token-ul extras.
3. **Limite:** `PER_DEVICE_DAILY_LIMIT=20` (= `DAILY_AI_LIMIT` din app), `GLOBAL_DAILY_LIMIT`
   calculat din plafonul Mistral împărțit la costul mediu al unei cereri.
4. **`MAX_BODY_BYTES` = 2 MB.** Constatat la implementare: vision nu trece prin Finanțe AI.
   `mapStatementWithVisionAi` refuză orice provider în afară de `external`, deci prin proxy trece
   doar text (chat, extrase CSV/text). Peste plafon, proxy-ul livrează efectiv 413. Varianta din
   Dosar tăia conexiunea, iar aplicația vedea o eroare de rețea fără explicație.
5. **Test nou, care lipsește la Dosar:** conținutul mesajelor nu apare niciodată în log.
   Testul interceptează `console.log` în timpul unei cereri cu un marker unic în prompt și
   verifică că markerul nu apare. Prin proxy trec extrase bancare.
6. Excluderi din tooling-ul app-ului: `jest` roots, `knip.json`, `.eslintrc.js` ignore, madge/
   dep-cruise. Proxy-ul e plain JS cu `node --test`, nu intră în `npm run check` al app-ului.
   Primește un script separat, `npm run test:proxy`.

**Acceptanță:** `node --test` verde (testele portate + testul de log). Pe instanța deployată:
`curl /health` → 200; o cerere validă → 200; token greșit → 401; `mistral-large-latest` → 403.
Secretul e marcat ca secret în Rapids și nu apare în loguri.

### A2 — Wiring în aplicație

`services/aiProvider.ts`:

1. `BUILTIN_API_KEY` → `EXPO_PUBLIC_FINANTE_AI_TOKEN`, `BUILTIN_URL` →
   `EXPO_PUBLIC_FINANTE_AI_URL`. Comentariul explică de ce token-ul **nu** e cheie de provider
   (după modelul din Dosar, `documents/app/services/aiProvider.ts:87`).
2. `getAiDeviceId()` — id anonim aleator, persistat, trimis ca `X-App-Device` **doar** pentru
   `builtin`. Pentru `external` nu trimitem nimic în plus.
3. `validateConfig` pentru `builtin` cere și URL-ul, și token-ul.
4. **Erori traduse** (azi 429 apare ca `Eroare AI (429): {json}`):
   - 429 → „Ai atins limita zilnică de interogări AI…" + hint cheie proprie.
   - 503 → „Serviciul Finanțe AI e indisponibil momentan." (proxy-ul transformă 401/403 de la
     Mistral în 503, ca userul să nu fie trimis să repare o cheie care nu e a lui).
   - 504/502 → mesaj de timeout/indisponibilitate.
5. **Cold start.** Rapids e scale-to-zero. Timeout-ul pentru Finanțe AI crește de la 30s la 60s,
   ca prima cerere după o pauză să nu pice. Pentru cheia proprie rămâne 30s. Warm-up-ul prin
   `GET /health` la deschiderea importului se amână: ar atinge `app/` doar pentru latență, iar
   60s acoperă pornirea.
6. Contorul local de 20/zi rămâne, ca pre-check de UX. Autoritatea e serverul.
   **De verificat la fluxul lunar:** importul tuturor extraselor unei luni, cu fallback AI pe
   mai multe fișiere, nu trebuie să atingă limita în aceeași zi. Numărăm cererile reale pe un
   import complet (BT RON + BT EUR) și dimensionăm limita cu marjă.

**Audit de secrete.** Se portează `documents/app/scripts/expo-public-secrets-audit.js`
(flag pe `EXPO_PUBLIC_*` cu KEY/TOKEN/SECRET) și se adaugă în `npm run check`. Allowlist doar
pentru `EXPO_PUBLIC_FINANTE_AI_TOKEN`, cu motivul scris lângă. Așa, cheia nu se mai poate
întoarce în bundle pe tăcute.

**Confidențialitate.** Există acum un intermediar pentru datele trimise la AI.

- `services/privacyPolicy.ts`: „Cererile trec printr-un server propriu (Danube Data, România),
  care nu stochează și nu loghează conținutul, apoi ajung la Mistral AI". Textul „Cererile sunt
  trimise direct către API-ul Mistral" (linia 40) devine fals și se înlocuiește.
- `npm run build:privacy` → `landing/privacy.html`.
- Verificăm App Privacy din App Store Connect (categoriile de date nu se schimbă, dar
  destinatarii da).

**Teste (`__tests__/unit/aiProvider.test.ts`):** `builtin` trimite la URL-ul proxy-ului, cu
Bearer = token-ul de aplicație și cu `X-App-Device` stabil între apeluri. `external` merge la
URL-ul userului, fără `X-App-Device`. Mesajele pentru 429/503/504 se asertează pe text.
`validateConfig` pe `builtin` fără URL → eroare. Snapshot-urile de prompt rămân neschimbate.

**Acceptanță:** `npm run check` verde, inclusiv auditul de secrete. `grep -r MISTRAL_API_KEY`
în `services/ app/` → 0 rezultate. Pe simulator, cu build Release, sunt dovedite: un chat, un
import PDF cu AI și mesajul de limită (cu `PER_DEVICE_DAILY_LIMIT=1` pe o instanță de test).

### A3 — Rollout

1. Deploy proxy cu cheie Mistral **nouă** + curl-urile din A1.
2. Build nou pe proxy → TestFlight → verificare pe device → App Store.
3. Cheia veche e deja compromisă și blocată, deci n-are rost să o păstrăm pentru userii vechi.
   Singura constrângere e Dosar: o revocăm imediat ce e confirmat că nicio versiune Dosar încă
   în uz nu mai depinde de ea.
4. Scoatem `EXPO_PUBLIC_MISTRAL_API_KEY` din `.env`.

**Hardening ulterior (proiect separat):** App Attest (iOS) / Play Integrity. Token-ul de
aplicație rămâne obfuscare, nu securitate. Contoarele în memorie se resetează la cold start.
Dacă apare abuz real, mutăm starea în Valkey, cu aceeași interfață în `limits.js`.

---

## B. Semnale financiare

Principii comune, aplicate pe toate:

- **Detectare deterministă, în funcții pure** (`services/*.ts`, testabile fără DB, ca
  `buildInsightsFromBreakdowns`). AI-ul nu decide ce e anomalie și nu produce cifre.
- **Se calculează pe luni închise și complete**, declanșat de import, nu de calendar.
- **Fiecare semnal are dovezi:** id-uri de tranzacții + drilldown în `/tranzactii` (filtrele
  există deja).
- **Fără moralizare.** Textul constată și propune o verificare. Nu face afirmații despre oferte
  bancare pe care nu le cunoaștem.
- **Dismiss persistat per semnal.** Un semnal ignorat nu revine până nu se schimbă datele.
- Agregările folosesc helper-ele din `services/amountSql.ts` (`IS_EXPENSE_SQL`, `amountRonSql`),
  ca să fie consecvente cu ce corectează planul `2026-09-03-corectitudine-agregari`.

### B1 — „N-ai încărcat extrasul pentru contul X"

**Defect de fundație descoperit la analiză.** `app/conturi/import.tsx:361` salvează
`period_from`/`period_to` ca data primei și a ultimei tranzacții, nu ca perioada tipărită pe
extras. Un extras BT pe iunie, cu prima tranzacție pe 3 și ultima pe 28, e stocat ca 03–28.
Orice detectare de goluri construită pe asta ar alerta fals la aproape fiecare lună.

**Fix fundație:**

1. `parseBt` extrage perioada din antet (linia de perioadă a extrasului BT; formatul exact se
   confirmă pe fixture-urile din `__tests__/fixtures/bt-pdf/`). Perioada se expune pe
   `PdfParseResult` și se persistă la import. Fallback-ul pe min/max tranzacții rămâne pentru
   CSV și PDF generic, marcat `period_source: 'header' | 'inferred'`.
2. Coloana nouă `period_source` pe `bank_statements` (migrație + backup + cloudSync). Se aplică
   skill-ul `sqlite-migration`. Rândurile vechi primesc `inferred`.

**Detectare** — `services/statementCoverage.ts`, funcție pură
`findCoverageGaps(accounts, statements, today, mutedAccountIds)`:

- **Conturi vizate:** nearhivate, `type != 'cash'`, cu cel puțin un extras importat vreodată.
  În fluxul userului, asta înseamnă toate conturile bancare.
- **Acoperire:** reuniunea intervalelor `[period_from, period_to]` per cont. Două intervale se
  lipesc dacă între ele e cel mult 1 zi. Intervalele `inferred` se extind la granițele lunii
  calendaristice când acoperă ≥ 20 de zile din aceeași lună, altfel rămân cum sunt.
- **Fereastra așteptată:** de la primul `period_from` până la sfârșitul ultimei luni închise.
- **Rezultat per cont:** `missingMonths` (lunile cu ≥ 50% neacoperite), `partialGaps` (intervale
  mai scurte, de ≥ 3 zile) și `lastCoveredTo`.
- **Capcana exportului făcut înainte de sfârșitul lunii.** Un extras exportat din BT pe 28 acoperă
  1–28. Extrasul lunii următoare începe pe 1, deci 29–31 nu apar nicăieri: tranzacții pierdute,
  nu doar o formalitate. `partialGaps` prinde cazul, iar mesajul e explicit: „Extrasul din august
  se oprește pe 28; lipsesc 29–31 august. Re-exportă luna întreagă."
- **`isMonthComplete(ym)`** = toate conturile vizate acoperă luna. E poarta pentru B2, B3, B4,
  `insights.ts` și `monthlyRecap.ts`.

**UI:**

- **La finalul importului** (ecranul de reconciliere existent): „Luna august: ✓ BT RON · lipsește
  BT EUR". CTA → importă următorul, cu contul preselectat.
- Banner pe Sumar, după modelul `TransferSuggestionBanner`, doar când a trecut ziua de reminder
  (B5) și luna tot nu e completă.
- Pe `app/conturi/[id].tsx`, lunile lipsă apar în lista de extrase.
- Toggle per cont „Nu importez extrase pentru acest cont" (AsyncStorage, fără migrație).
- **Luni incomplete marcate:** insights, recap și Evoluție nu mai afirmă „cheltuiești cu 40% mai
  puțin" pe o lună parțială. Arată în schimb „date incomplete: lipsește extrasul BT EUR". Asta
  repară o eroare care există deja azi.

**Teste/acceptanță:**

- Extras pe iunie cu header 01–30 și tranzacții 03–28 → fără gol.
- Import iunie + august → iulie lipsă.
- Extras august exportat 1–28, urmat de septembrie 1–30 → `partialGap` 29–31 august.
- Cont arhivat, cont cash și cont dezactivat → fără alertă.
- Rând vechi `inferred` 02–29 → acoperă luna.
- Doar BT RON importat pe august → `isMonthComplete('2026-08') === false`.
- Screenshot cu starea la finalul importului.

### B2 — „Categoria X e atipică luna asta"

`services/insights.ts` compară azi luna curentă (goală până la import, în fluxul userului) cu
**media** ultimelor 3 luni (±20%, ≥100 RON). O singură lună cu concediu strică media. Nu
înlocuim cardul, înlocuim motorul din spatele `category_change`.

**Detectare** — `services/spendingAnomalies.ts`, pură, rulată pe **o lună închisă și completă**:

- **Istoric:** ultimele 12 luni **complete** (B1). Minim 4 luni, altfel nu emitem nimic.
- **Baseline robust:** mediana. Dispersia = MAD × 1,4826, cu podea
  `max(MAD, 15% din mediană, 50 RON)`, ca o chirie fixă (MAD = 0) să nu declanșeze la 10 RON
  diferență.
- **Regula:** anomalie dacă `z ≥ 3` **și** `curent − mediană ≥ max(150 RON, 30% din mediană)`.
  Anomaliile în jos se raportează cu prioritate mai mică.
- **Explicație (primul tag care se potrivește):**
  - `single_large` — o tranzacție ≥ 50% din excedent: „o singură plată de 1.240 RON la eMAG".
  - `new_merchant` — comercianți nevăzuți în 12 luni ≥ 50% din excedent.
  - `more_frequent` — nr. tranzacții ≥ 1,5 × mediana numărului.
  - `higher_ticket` — valoarea medie ≥ 1,3 × mediana valorii medii.
- **Sezonalitate:** dacă aceeași lună de anul trecut există și curentul e în ±25% față de ea,
  severitatea coboară la `neutral`: „similar cu decembrie 2025".
- **Nu există „ritm până azi".** Fără date în cursul lunii, un asemenea semnal ar fi mereu gol.

**Numerarul invizibil — decis (2026-09-11): retragerile contează ca cheltuială.** Userul nu
înregistrează cheltuielile cash. Dacă acceptă sugestia „transfer intern cash"
(`internalTransferSuggestion.ts`), retragerea devine `is_internal_transfer = 1` și **dispare din
toate agregările**. Banii scoși din bancomat nu mai apar nicăieri.

Regula, aplicată doar în agregări (DB-ul rămâne neschimbat):

- Pentru fiecare lună M și fiecare cont cash: `numerar_net = retrageri spre cont − depuneri din
cont înapoi în bancă`, cu minim 0.
- **Dacă contul cash n-are cheltuieli proprii în luna M**, `numerar_net` intră în cheltuieli ca
  pseudo-categorie „Numerar retras". Apare în totaluri, breakdown, Evoluție, anomalii (B2) și
  sugestii (B3).
- **Dacă are cheltuieli proprii în M**, se numără cheltuielile acelea, iar transferul rămâne
  neutru. Așa nu se dublează nimic dacă userul începe vreodată să noteze cash-ul.
- Retragerile neconvertite în transfer sunt deja cheltuieli. Se mută în aceeași pseudo-categorie,
  ca numerarul să fie comparabil lună de lună indiferent dacă sugestia a fost acceptată.
- Implementare într-un singur loc, în `services/amountSql.ts`, folosit de `getMonthlyTotals` și
  `getCategoryBreakdown`. **Se coordonează cu planul `2026-09-03-corectitudine-agregari`**, care
  atinge exact aceleași funcții.
- UI: în totalul lunii apare explicit „include 1.200 RON numerar retras", ca schimbarea cifrelor
  față de azi să nu pară un bug.

Test: aceeași lună, cu retrageri convertite și neconvertite, dă același total. Cont cash cu o
cheltuială manuală în M → transferul nu se mai adună. Depunere înapoi mai mare decât retragerile
→ 0, nu negativ.

**UI:** în raportul lunii (B4) și în `InsightsCard`, cu explicația și drilldown pe categorie +
perioadă, sortat după sumă. `total_change` rămâne, dar trece și el pe mediană.

**Teste/acceptanță:**

- Chirie 2.500 constantă, apoi 2.560 → nimic.
- Mâncare ~1.200 ±150, apoi 2.100 → anomalie; o tranzacție de 900 → `single_large`.
- Decembrie cadouri ≈ decembrie anul trecut → `neutral`.
- 3 luni de istoric → nimic.
- Lună incompletă (lipsește un cont) → nu se calculează deloc.
- Retrageri cash convertite în transfer, cont cash fără ieșiri → apar ca „Numerar retras".
- Testele existente din `insights.test.ts` se actualizează explicit, nu se șterg.

### B3 — Sugestii de optimizare a cheltuielilor

`services/savingsSuggestions.ts`, detectori puri. Fiecare întoarce
`{ id, kind, title, detail, annualImpactRon, evidenceTxIds }`. **`annualImpactRon` e
întotdeauna o sumă observată** (de ex. comisioane plătite în ultimele 12 luni), niciodată o
estimare de tip „ai putea economisi 30%". Rulează pe lunile complete.

**v1, doar detectori cu precizie mare:**

| Detector                    | Regulă                                                                                                                   | Exemplu de mesaj                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `subscription_price_up`     | serie din `recurring.ts` cu ultima sumă ≥ 5% și ≥ 2 RON peste mediana anterioară                                         | „Netflix: de la 49,99 la 59,99 RON din iulie (+120 RON/an)"               |
| `subscriptions_overview`    | ≥ 3 serii active; total lunar ×12                                                                                        | „5 abonamente active, 2.340 RON/an. Le mai folosești pe toate?"           |
| `overlapping_subscriptions` | ≥ 2 serii active din același grup (streaming video, muzică, cloud, fitness), cu o hartă de cuvinte-cheie în `constants/` | „Plătești și Netflix, și HBO Max: 110 RON/lună"                           |
| `bank_fees`                 | regex pe descriere (comision, taxă administrare, dobândă debitoare, penalitate) pe 12 luni, ≥ 50 RON, defalcat pe tip    | „312 RON comisioane în 12 luni, din care 180 RON la retrageri de numerar" |
| `merchant_growth`           | comerciant din `food`/`entertainment`/`shopping`/`transport`, ultimele 3 luni ≥ 1,5 × precedentele 3 și ≥ 300 RON        | „Glovo: 23 comenzi, 1.480 RON în 3 luni (+60%)"                           |
| `small_purchases`           | într-o categorie, ≥ 20 de tranzacții < 30 RON pe lună, suma ≥ 400 RON                                                    | „34 de plăți mici la cafenele: 612 RON în august"                         |

`recurring.ts` detectează azi doar cadență lunară/bilunară, deci `subscription_price_up` e
limitat la abonamente lunare. Cadența anuală vine în B7.

**Status `missing` în `recurring.ts` e fals în fluxul userului.** Un abonament „lipsește de 40 de
zile" doar pentru că luna trecută nu e importată încă. Statusul se calculează față de
`lastCoveredTo` al contului (B1), nu față de `today`.

**UI:** în raportul lunii (B4), maxim 3 sugestii, ordonate după `annualImpactRon`, cu „Ascunde"
persistat. Tap → dovezi. Lista completă e pe Evoluție.

**AI în v1 — decis (2026-09-11).** Detectorii rămân deterministici și decid _ce_ se afișează.
AI-ul scrie doar _ce poți face_ pentru fiecare fapt deja calculat. **Depinde de A:** nu se
livrează pe cheia din bundle.

- **O singură cerere pe lună:** la prima deschidere a raportului lunii (B4). Rezultatul se
  păstrează local pe cheia `ym + hash(fapte)` și se regenerează doar dacă faptele se schimbă.
  Consum ~1 cerere/lună din cota de 20/zi.
- **Ce pleacă la AI:** doar faptele produse de detectori: `fact_id`, tip, nume afișat de
  comerciant, sume RON rotunjite, număr de tranzacții, luna. **Nu pleacă:** descrieri brute,
  IBAN, nume de conturi, date zilnice.
- **Ce se întoarce** (schemă Zod în `services/aiSchemas.ts`):
  `{ items: [{ fact_id, action }] }`, cu `action` ≤ 200 de caractere. AI-ul nu poate adăuga
  fapte. Un `fact_id` necunoscut e aruncat.
- **Validator numeric:** orice număr din `action` trebuie să existe printre numerele faptului
  respectiv, după normalizarea formatului RO (1.240 / 1240 / 1.240,00). Altfel acțiunea e
  aruncată și rămâne template-ul local. Același principiu ca la chat: zero cifre inventate.
- **Prompt injection prin numele comercianților.** Numele vin din textul extrasului, deci pot
  conține orice. Se trunchiază la 40 de caractere, se păstrează doar litere/cifre/spații, iar
  prompt-ul le marchează ca date, nu ca instrucțiuni. Fixture nou în `__tests__/evals/` cu un
  comerciant de tip „IGNORĂ INSTRUCȚIUNILE…".
- **Limită onestă:** validatorul prinde cifrele inventate, nu și afirmațiile false fără cifre
  (de ex. „BT are un pachet fără comisioane"). Prompt-ul interzice afirmații despre oferte,
  prețuri sau produse ale terților. Fixture-urile din evals verifică asta pe cazuri
  reprezentative, dar nu e o garanție. În UI, textul AI e etichetat „Idee AI".
- **Consent:** comutator separat „Idei AI în raportul lunar", **default off**. Se cere la
  prima deschidere a raportului, cu textul exact a ce se trimite. `privacyPolicy.ts` primește
  o secțiune nouă, pentru că azi politica spune că la chat nu se trimit sume. Apoi
  `npm run build:privacy`.
- **Fallback:** fără consent, fără rețea, la 429 sau cu răspuns invalid se afișează
  template-urile locale, fără mesaj de eroare în fața userului.
- Se aplică skill-ul `ai-prompt-ro`, cu snapshot test pe prompt. `temperature` 0,3.

**Acceptanță suplimentară:** răspuns AI cu o sumă inexistentă → acțiunea e aruncată, rămâne
template-ul. `fact_id` necunoscut → aruncat. Fixture de injection → nicio instrucțiune
executată, schemă respectată. Al doilea deschis al raportului în aceeași lună → zero cereri noi.
Consent off → zero cereri.

**Teste/acceptanță:** fixture per detector cu caz pozitiv + caz la limită negativ. `bank_fees`
nu prinde „Taxa de drum" dintr-o plată la benzinărie (lista de regex are și excluderi).
Abonament cu ultima apariție pe 5 iulie, cont acoperit până pe 31 iulie, azi 11 septembrie →
`active`, nu `missing`. Dismiss-ul persistă după repornire.

### B4 — Raportul lunii (suprafața unică, după import)

Userul deschide app-ul serios o dată pe lună, la import. Cele trei semnale se adună într-un
singur ecran, nu se împrăștie în carduri pe Sumar.

- **Declanșare:** în momentul în care `isMonthComplete(ym)` devine `true` pentru o lună încă
  necitită, adică după ultimul import al lunii. Înlocuiește declanșarea după calendar din
  `monthlyRecap.shouldShowRecap`. Cheia `settings_last_recap_month` rămâne.
- **Dacă luna nu e completă după import:** raportul nu se deschide. Ecranul de import arată ce
  mai lipsește (B1).
- **Conținut, în ordine:**
  1. Nepotriviri de sold nerezolvate (B6), dacă există. Vin primele, pentru că fac restul
     cifrelor nesigure.
  2. Recap-ul existent: total, delta vs mediană, top 3 categorii.
  3. Bugete: realizat vs buget, pe categoriile care au buget (B8).
  4. Anomalii (B2), maxim 3.
  5. Plăți recurente mari (B7), maxim 3, cu cele anuale marcate „în curând".
  6. Sugestii (B3), maxim 3.
- `MonthlyRecapModal` devine ecran (`app/raport-lunar/[ym].tsx`). Conținutul nu mai încape
  într-un modal, iar raportul trebuie să fie redeschis din Evoluție pentru orice lună completă.

**Acceptanță:** import BT RON august → nu apare raportul, apare „lipsește BT EUR". Import
BT EUR → raportul apare o dată. Redeschis din Evoluție → același conținut. Screenshot-uri pe
ambele stări.

### B5 — Notificări locale

`expo-notifications` e în dependențe, dar nu e folosit nicăieri și nu apare în pluginurile din
`app.json`. E prima utilizare: plugin + permisiune cerută **contextual** (la activarea din
Setări, nu la pornirea app-ului). Setările existente `getPushEnabled` din `services/settings.ts`
se refolosesc.

În fluxul userului au sens **două notificări**, amândouă cu dată previzibilă din istoric:
reminderul de import și plata anuală mare care se apropie (B7).

- **Ziua e configurabilă** în Setări (default: ziua 2 a lunii următoare, când BT a emis deja
  extrasul pe luna întreagă). Nu o fixăm la „final de lună": un export făcut înainte de ultima
  zi taie zilele rămase (vezi B1).
- La fiecare deschidere a app-ului și după fiecare import: se anulează și se reprogramează.
  Notificarea rămâne programată doar dacă luna trecută nu e completă. Un import făcut înainte o
  anulează.
- **Plată anuală mare (B7):** notificare cu 7 zile înainte de `expected_next`, reprogramată la
  fiecare deschidere și după fiecare import. Se anulează dacă plata apare deja într-un extras
  importat.
- Anomaliile și sugestiile **nu** generează notificări: sunt calculate la import, deci userul e
  deja în app când le vede.
- **Consecință pentru IDEAS #13** (notificări pe bugete la 80% / 100%): nu se potrivește cu
  importul lunar, pentru că pragul se află abia după ce luna s-a terminat. Bugetele (#12) se
  evaluează retrospectiv, în raportul lunii.

**Acceptanță:** test pe funcția pură care decide ce se programează. Pe device: notificarea
apare, iar după un import complet nu mai apare.

---

### B6 — Soldul din extras nu bate cu soldul din aplicație

Fiindcă toate datele vin din extrase, soldul e cea mai bună plasă de siguranță. Prinde ce nu
vede B1: extras importat, dar cu tranzacții șterse, marcate greșit ca duplicat sau editate.

**Fundație (se face împreună cu fix-ul de perioadă din B1, aceeași trecere prin antet).**
`parseBt` recunoaște deja markerii `SOLD ANTERIOR` și `SOLD FINAL CONT`
(`bankStatementPdfParser.ts:157–164`), dar nu îi expune. Se expun ca
`PdfReconciliation.openingBalance` / `closingBalance`. Se persistă pe `bank_statements` în
coloanele noi `opening_balance REAL`, `closing_balance REAL`, nullable, în aceeași migrație cu
`period_source`. Doar extrasele care tipăresc soldul (BT PDF) sunt verificabile. Pentru restul
nu afirmăm nimic.

**Verificare** — `services/balanceCheck.ts`, pură: `diagnoseBalance(statement, accountTxs, account)`.

- Soldul din app la o dată D = `initial_balance` (dacă `initial_balance_date ≤ D`) + suma
  `amount` pe tranzacțiile contului cu `date ≤ D`, `duplicate_of_id IS NULL`. Se folosește
  aceeași formulă ca `getCurrentBalance`, în **valuta contului**, nu în RON.
- Se compară în două puncte: `period_from − 1 zi` cu `opening_balance`, și `period_to` cu
  `closing_balance`. Toleranța e 0,01.

**Ce poate face userul: diagnosticul îi spune unde e diferența și îi dă o acțiune.**

| Diagnostic                                                                  | Ce înseamnă                                                                                           | Acțiune în UI                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before_statement` — soldul de început nu bate                              | problema e **înainte** de extras: lipsește un extras anterior sau soldul inițial al contului e greșit | Dacă B1 are un gol înainte: **„Importă extrasul lipsă din iulie"**. Altfel: **„Corectează soldul inițial"**, cu valoarea veche → nouă afișată, ca soldul de început să bată. Se poate reface din editarea contului. |
| `inside_statement` + o tranzacție marcată duplicat cu exact suma diferenței | tranzacția e reală, dar a fost marcată duplicat                                                       | **„Tranzacția din 14 august, 45,90 RON, e marcată duplicat. Nu e duplicat?"** → anulează marcajul                                                                                                                   |
| `inside_statement` + mai puține tranzacții decât `transaction_count`        | tranzacții șterse după import                                                                         | **„Din extrasul din august lipsesc 2 tranzacții față de import."** → **„Re-importă extrasul"** (fluxul existent din `app/conturi/[id].tsx`; deduplicarea păstrează ce există)                                       |
| `inside_statement`, altă cauză                                              | o sumă editată manual sau un semn schimbat                                                            | **„Re-importă extrasul"**, apoi reconcilierea pe zile existentă arată ziua care nu bate                                                                                                                             |
| Diferența persistă după toate                                               | userul hotărăște că extrasul are dreptate                                                             | **„Aliniază la extras"**: creează tranzacția „Ajustare sold la extras" pe `period_to`, cu suma diferenței și `source = 'adjustment'`, **exclusă din toate analizele de cheltuieli/venituri**                        |

Mesajul principal are cifre exacte: „Soldul BT RON la 31 august: extrasul spune 4.215,30 RON,
aplicația calculează 4.169,40 RON. Diferență: 45,90 RON."

**Unde apare:** la finalul importului (lângă `ImportReconciliationCard`), în detaliul contului și
în raportul lunii (B4), dacă luna are o nepotrivire nerezolvată.

**Implementare:** `TransactionSource` primește `'adjustment'`, iar `IS_EXPENSE_SQL` /
`IS_INCOME_SQL` din `amountSql.ts` exclud `source = 'adjustment'`.

**Teste/acceptanță:**

- Extras cu toate tranzacțiile → `ok`.
- Sold inițial greșit cu 100 → `before_statement`; după corecție → `ok`.
- O tranzacție marcată duplicat cu suma diferenței → diagnosticul o numește.
- 2 tranzacții șterse → numărul lipsă corect.
- Ajustarea aduce soldul la `ok` și nu schimbă totalul cheltuielilor lunii.
- Cont EUR → comparația e în EUR.
- Extras fără sold (CSV) → nicio afirmație.

### B7 — Plăți recurente mari

Userul trebuie să afle că are o cheltuială recurentă mare, lunară sau anuală, cu cifre exacte
din DB. AI-ul nu ghicește ce e plata: categoria apare doar dacă userul a atribuit-o.

**Detectare** — extinde `services/recurring.ts`:

- Cadență nouă, `annual` (350–380 de zile). Minim 2 apariții, toleranță de sumă ±25% (asigurările
  și impozitele se schimbă de la an la an). Fereastra de istoric pentru anual e 25 de luni; cea
  lunară rămâne 6 luni.
- Statusul se calculează față de `lastCoveredTo` (B1), nu față de `today`.
- **„Mare"** (constante exportate, testate):
  - lunar/bilunar: echivalentul lunar ≥ `max(300 RON, 5% din mediana cheltuielilor lunare pe 12
luni complete)`;
  - anual: ultima sumă ≥ 500 RON.
- Se sortează după suma pe 12 luni. Dismiss per `merchant_normalized` („Știu, nu mai arăta").

**Mesaje** — template-uri locale, doar cu date calculate:

- **Lunar:**
  „Plată recurentă mare: RAIFFEISEN LEASING — 1.850,00 RON pe lună, de 7 luni (din februarie
  2026). În ultimele 12 luni: 12.950,00 RON, adică 14% din cheltuielile tale. Următoarea e
  așteptată în jur de 15 septembrie."
  Dacă ultima plată diferă cu ≥ 5% de mediană, se adaugă: „Ultima plată a fost 1.920,00 RON, cu
  70,00 RON peste suma obișnuită."
- **Anual:**
  „Plată anuală: ALLIANZ TIRIAC — 1.126,40 RON pe 12 octombrie 2025 și 1.084,00 RON pe 9
  octombrie 2024 (categoria Auto). Următoarea e probabil în jur de 12 octombrie 2026. Echivalent:
  93,87 RON pe lună."
  Paranteza cu categoria apare doar dacă tranzacțiile au categorie atribuită.
- **Notificare** (B5), cu 7 zile înainte de o plată anuală mare:
  „Peste ~7 zile: plata anuală ALLIANZ TIRIAC. Anul trecut: 1.126,40 RON."

**Unde apare:** în raportul lunii (B4), secțiunea „Plăți recurente mari", maxim 3. Plățile anuale
așteptate în următoarele 45 de zile sunt marcate „în curând". Lista completă e în Evoluție.

**Teste/acceptanță:**

- Leasing 1.850 × 7 luni → lunar mare, 12 luni și procent corecte.
- Netflix 59,99 → nu e „mare".
- RCA 1.084 (2024) + 1.126,40 (2025) → anual, `expected_next` la 12 octombrie 2026.
- O singură apariție anuală → nimic.
- Ultima plată +70 → propoziția de diferență apare.
- Cont acoperit doar până pe 31 iulie → statusul nu devine `missing` din cauza lunii neimportate.
- Mesajele sunt snapshot-uite.

### B8 — Buget sugerat, ajustabil

Precompletează `monthly_limit` (coloană existentă) cu ce cheltuie userul de obicei. Userul
ajustează.

- `suggestBudget(monthlyTotals)`, pură: mediana ultimelor 6 luni **complete** (B1), rotunjită în
  sus la 50 RON. `null` dacă sunt mai puțin de 3 luni complete cu cheltuieli în categorie.
- **UI** — ecran „Bugete" (din Setări și din raportul lunii):
  - listă de categorii cu buget curent și sugestie („sugerat: 1.250 RON — mediana ultimelor 6
    luni");
  - câmp numeric editabil, cu buton „Folosește sugestia" per rând și „Aplică sugestiile" pentru
    categoriile fără buget;
  - golirea câmpului = fără buget.
    Nu suprascrie niciodată un buget setat de user fără acțiune explicită.
- **Evaluare retrospectivă** în raportul lunii: „Mâncare: 1.380 / 1.250 RON (+130 RON, +10%)",
  colorat cu `statusColors` la ≥ 100%. Fără notificări în timp real (#13 respins pentru fluxul
  lunar).

**Teste/acceptanță:**

- 6 luni [1.100, 1.200, 1.180, 1.260, 1.150, 1.900] → mediana 1.190 → sugestie 1.200.
- 2 luni → `null`.
- Luni incomplete excluse.
- Salvarea scrie `monthly_limit`, iar golirea îl setează `NULL`.
- Screenshot-uri: ecranul Bugete și secțiunea din raport.

---

## Ordinea de implementare

Fiecare pas se încheie cu `npm run check` verde. Pașii care ating `app/` sau `components/` au
screenshot pe simulator.

| #   | Pas                                                                                      | Depinde de |
| --- | ---------------------------------------------------------------------------------------- | ---------- |
| 1   | A1 — `ai-proxy/` local, cu teste                                                         | —          |
| 2   | A2 — wiring `aiProvider`, erori traduse, audit secrete, confidențialitate                | 1          |
| 3   | Fundație parser + migrație: perioadă din antet, sold de început/sfârșit, `period_source` | —          |
| 4   | B1 — acoperire extrase + UI la import                                                    | 3          |
| 5   | B6 — diagnostic sold + acțiuni                                                           | 3          |
| 6   | Regula numerarului în `amountSql.ts` + excluderea `adjustment`                           | —          |
| 7   | B2 — anomalii                                                                            | 4, 6       |
| 8   | B7 — plăți recurente mari                                                                | 4          |
| 9   | B3 — sugestii de economisire + AI                                                        | 2, 7, 8    |
| 10  | B8 — bugete sugerate                                                                     | 4          |
| 11  | B4 — raportul lunii                                                                      | 5, 7–10    |
| 12  | B5 — notificări (import + plăți anuale)                                                  | 4, 8       |

A0 și A3 (cheie nouă, deploy, TestFlight, revocare) sunt pași manuali ai userului.

## Stare implementare (2026-09-12)

**Pasul 1 (A1) — proxy local, gata.** `ai-proxy/` cu 28 de teste. Față de planul scris,
review-ul a impus patru corecții:

- **Mesajele se reconstruiesc** (`{ role, content }`, doar text). Varianta din Dosar releea
  `messages`, deci treceau blocuri `image_url` cu URL-uri arbitrare — vision pe contul nostru,
  cu tokeni nemărginiți de plafonul pe corp.
- **429 de la provider → 503.** Altfel aplicația spunea userului că a atins limita zilnică, deși
  limita atinsă era a contului nostru.
- **Limită și per IP**, fiindcă `X-App-Device` poate fi schimbat de cine extrage token-ul; plus
  restituirea cotei când providerul întoarce eroare.
- **`/health` nu mai expune contoarele** fără token.

**Pasul 2 (A2) — wiring, gata.** `aiProvider.ts` pe proxy (token + URL din env la momentul
cererii), `X-App-Device` anonim, erori traduse (429/413/401/503/502/504), timeout 60s pentru
Finanțe AI. Gate nou `npm run check:secrets` în `npm run check`. Confidențialitate actualizată
(server intermediar, contoare, IP ca alternativă) + `landing/privacy.html` regenerat.
`EXPO_PUBLIC_MISTRAL_API_KEY` comentat în `.env` — aplicația nu-l mai citește.

**Pasul 3 — fundația de parser și migrația, gata.** `parseBt` expune perioada din antet și
soldurile (`SOLD ANTERIOR` / `SOLD FINAL CONT`), fiecare validat: perioada trebuie să cuprindă
toate tranzacțiile, soldurile trebuie să se lege prin rulaj. Coloane noi pe `bank_statements`
(`period_source`, `opening_balance`, `closing_balance`) cu migrație pentru instalările
existente, purtate prin backup și cloud sync. Perioada se decide în `services/statementPeriod.ts`
(pur, testat), iar importul o scrie prin `recordBankStatement`.

**A doua trecere de review** a găsit că primul set de corecții deschisese două portițe, ambele
confirmate cu sondă:

- `release()` rula pe orice status ≥ 400, deci un provider care întoarce 422 sau 404 dădea cotă
  nelimitată (12 din 12 cereri la upstream, contoare zero). Acum scutirea e doar pe 5xx și
  timeout — ce clientul nu poate provoca.
- Găleata per IP se lua din primul element al lui `X-Forwarded-For`, adică din ce trimite
  clientul (platformele adaugă adresa reală la coadă). Acum se folosește adresa socket-ului, iar
  `TRUSTED_PROXY_HOPS` spune explicit câți proxy stau în față.

Tot de acolo, pe pasul 3: perioada și soldurile se expun **doar când extrasul se reconciliază
integral**. Verificarea prin rulaj arată că extrasul e coerent cu el însuși, nu că parserul a
citit tot; pe un extras trunchiat ar fi intrat în DB „luna întreagă, sursă: antet" peste 33 din
84 de tranzacții. Soldurile se rețin doar dacă valuta extrasului se potrivește cu a contului, iar
pe fișiere cu două extrase lipite valuta e a primului, nu a ultimului.

**A0 și A3 — făcute pe 2026-09-12.** Plafon de cheltuială pus, cheie Mistral nouă, container
`finante-ai-proxy` pe Danube Rapids (separat de `dosar-ai-proxy`, în același cont), adresa și
token-ul în `.env`, build Release cu cache Metro șters.

Verificat live, nu presupus:

- `status: running / healthy`, revizia `finante-ai-proxy-00002`, variabile setate: cheie upstream,
  token de aplicație, plafon global, plafon per IP.
- `GET /health` → `{"ok":true}` (fără contoare — codul nou); fără token → 401; cu token → răspuns
  real de la Mistral; `mistral-large-latest` → 403; bloc `image_url` → 400.
- În bundle-ul instalat: adresa proxy-ului, token-ul, modelul permis și `X-App-Device` prezente;
  `api.mistral.ai` și `EXPO_PUBLIC_MISTRAL` absente.
- Din aplicație, pe simulator: întrebarea „Ce sold am acum în fiecare cont?" a primit răspuns real,
  iar contoarele serverului au urcat de la 1 la 2, cu o găleată de device nouă — dovada că cererea
  a trecut prin proxy, nu direct la provider.

**Constatat din logurile de producție:** pe Knative, containerul primește conexiuni de la
queue-proxy peste loopback (`dial tcp 127.0.0.1:8080`), deci adresa văzută de proces e aceeași
pentru toți utilizatorii și găleata per IP devine una singură. La `PER_IP_DAILY_LIMIT=60`, userii
legitimi s-ar bloca între ei după 60 de cereri pe zi în total. Până se verifică forma reală a lui
`X-Forwarded-For`, plafonul per IP se ține egal cu cel global (inert), iar protecția rămâne pe
plafonul per device (20/zi, cât arată și aplicația) și pe cel global.

**Rămâne la user:** revocarea cheii vechi Mistral, după ce se confirmă că nicio versiune Dosar în
uz nu mai depinde de ea; TestFlight/App Store pentru build-ul nou; eventual `TRUSTED_PROXY_HOPS`
după verificarea headerului de adresă. `PER_IP_DAILY_LIMIT=1000` — **făcut** pe 2026-09-12,
container `running`, deci găleata comună de loopback nu mai poate bloca useri legitimi.

**Pasul 4 (B1) — nucleul și două suprafețe, gata; restul nu.**

Gata și verificat: `services/statementCoverage.ts` (pur, 20 de teste) cu reuniunea intervalelor per
cont, lărgirea celor `inferred` la luna întreagă peste 20 de zile, lipirea la cel mult o zi
distanță, lunile lipsă la ≥ 50% neacoperit, golurile parțiale de la 3 zile și `isMonthComplete` ca
poartă pentru B2–B4. Strat de date: `getAllBankStatements`, conturi tăcute în `settings.ts`,
`loadCoverageReport`. Suprafețe: bannerul de pe Sumar (`components/StatementCoverageBanner.tsx`) —
**dovedit pe simulator**, cu textul „Cont demo: Lipsește extrasul pe august 2026." — și blocul de
la finalul importului („Luna august 2026: ✓ BT · lipsește Cont demo", cu CTA care preselectează
contul), **scris dar neverificat vizual**: ecranul de succes apare doar după un import real.

Corecție prinsă de teste, nu de autor: mesajul „Extrasul din august se oprește pe 28" nu apărea
niciodată în cazul pe care îl descrie, fiindcă verificam dacă un interval acoperit _începe_ în
aceeași lună (`iv.from`). Intervalele trecuseră însă prin lipire, deci iulie+august începeau pe 1
iulie. Corect e capătul unde acoperirea _se oprește_ (`iv.to`) — care e și ziua din mesaj.

**Restul lui B1 — scris.** Pagina contului (`app/conturi/[id].tsx`) arată lunile lipsă și
golurile parțiale ale contului, sub istoricul de importuri, plus toggle-ul „Nu import extrase
pentru acest cont" (AsyncStorage, fără migrație), care scoate contul din verificare.

Marcarea lunilor incomplete: `describeIncompleteMonth` (pur, testat) produce propoziția, iar
`InsightsCard` nu mai afișează **nicio** comparație când luna e neacoperită — arată motivul în
locul lor („Lipsește extrasul pentru BT EUR. Cifrele pe august 2026 sunt parțiale.", sau, pentru
luna în curs, „Septembrie 2026 nu s-a încheiat"). Recapul lunar e oprit prin `isMonthComplete`
înainte de a fi construit: afirmă „ai cheltuit cu X% mai puțin decât luna trecută", ceea ce pe o
lună fără toate extrasele e fals, nu aproximativ. Userul care n-a importat niciodată un extras nu
primește nimic din toate astea — nu ține evidența așa, deci n-are ce să-i lipsească.

**Evoluție rămâne neatinsă, deliberat:** ecranul nu conține nicio afirmație comparativă (zero
potriviri pentru „delta", „față de", „mai puțin"), ci grafice. Un grafic pe date parțiale e
incomplet, nu mincinos; nu are ce marca.

**Pasul 5 (B6) — nucleul, gata; suprafețele, nu.**

`services/balanceCheck.ts` (pur, 12 teste): `diagnoseBalance(statement, accountTxs, account)`
compară soldul tipărit pe extras cu cel calculat de aplicație, în două puncte — ziua dinaintea
perioadei și ultima zi — cu toleranță de un ban, în valuta contului. Întoarce unul din patru
diagnostice: `unverifiable` (extrasul nu tipărește solduri — CSV, PDF generic, AI: nu afirmăm
nimic), `before_statement` (cauza e dinainte de extras), `inside_statement` (începutul bate,
sfârșitul nu) sau `ok`. Pentru `inside_statement` numește cauza când o poate proba: tranzacția
marcată duplicat a cărei sumă e exact diferența, sau câte tranzacții lipsesc față de câte a adus
importul. Mesajele au cifre exacte, formatate românește (`4.215,30 RON`), fără `Intl` — pe Hermes
nu e garantat complet.

Sursa `adjustment` e adăugată în `TransactionSource` și exclusă din `IS_EXPENSE_SQL` /
`IS_INCOME_SQL`. Trei verificări făcute înainte de modificare, nu după: nu există `CHECK` pe
`transactions.source` (deci valoarea nouă se inserează), ambele interogări care folosesc
constantele sunt `FROM transactions` fără join (deci o condiție pe `source` fără alias e
neambiguă), iar `backupSchemas.ts` tratează `source` ca text liber (deci backup-urile cu
`adjustment` nu pică la validare).

Ce **nu** s-a schimbat, deliberat: `COUNT(*)` din `getMonthlyTotals` numără în continuare și
ajustările. Planul cere excluderea lor din analizele de cheltuieli și venituri; un contor de
rânduri nu e una, iar modificarea ar fi riscat teste existente fără câștig vizibil.

**Suprafețele B6 — gata.** În detaliul contului, sub istoricul de importuri, apare diagnosticul
celui mai recent extras care tipărește solduri, cu mesajul complet și cu acțiunile potrivite
_cauzei_, nu toate deodată: „Corectează soldul inițial" doar la `before_statement`, „Nu e
duplicat" doar când există un suspect numit, „Re-importă extrasul" la `inside_statement`, iar
„Aliniază la extras" mereu, cu confirmare, fiindcă scrie o tranzacție. La finalul importului
mesajul apare informativ, fără butoane: acțiunile stau lângă istoric, unde userul le poate relua
oricând.

Abatere de la plan, cu motiv: planul cerea diagnosticul „lângă `ImportReconciliationCard`", dar
acea carte se randează în previzualizarea de dinainte de import, iar `diagnoseBalance` are nevoie
de un extras deja salvat. A fost pus deci în ecranul de final de import — primul moment în care
extrasul există ca rând în baza de date.

Dovedit pe simulator, cu date care produc deliberat o nepotrivire: „Soldul Cont demo la
2026-07-31: extrasul spune 8.407,14 RON, aplicația calculează 8.032,14 RON. Diferență: 375,00
RON. Din extras lipsesc 9 tranzacții față de câte a adus importul. Re-importă extrasul." Pe acel
ecran apar exact două butoane — dovada că randarea condiționată alege după cauză: lipsesc
„Corectează soldul inițial" (soldul de început se potrivea) și „Nu e duplicat" (niciun suspect).
`no-orphans` pe `balanceCheck.ts` a dispărut odată cu cablarea ecranelor.

**Pasul 6 (numerarul) — nucleul, gata; cablarea, nu.**

`services/cashSpending.ts` (pur, 13 teste): `computeCashWithdrawals(txs, accounts, yearMonth)`
întoarce cât se **adaugă** la cheltuieli (retragerile convertite în transfer, azi invizibile) și
cât se **mută** (retragerile neconvertite, deja numărate, dar în altă categorie). Separarea nu e
cosmetică: fără ea, retragerile neconvertite ar fi numărate de două ori. Netarea pe cont cash
scade depunerile înapoi la bancă, cu podea la 0 — altfel o lună în care userul duce banii înapoi
ar produce un „venit" din numerar. Contul cash cu cheltuieli proprii în lună face transferul
neutru, ca să nu se dubleze nimic dacă userul începe vreodată să noteze cash-ul.

**Abatere de la plan, cu motiv.** Planul cerea implementarea „într-un singur loc, în
`amountSql.ts`". Acolo nu încape: fișierul conține expresii SQL, iar regula cere agregare pe lună
și pe cont, o condiție („contul cash are cheltuieli proprii?") și _mutarea_ unor tranzacții dintr-o
categorie în alta — o reconstrucție a rezultatului, nu un predicat. Modulul pur separat rămâne
„un singur loc", dar unul în care logica chiar încape.

Detectarea retragerilor refolosește `detectTransferType`, nu o copie a lui `CASH_RE`: un regex
duplicat ar diverge tăcut de cel testat.

**Două capcane găsite pentru incrementul de cablare, înainte de a-l scrie:**

1. **Drilldown-ul ar duce într-o listă goală.** `useCategoryTransactions` filtrează pe
   `category_id` cu `excludeTransfers: true`; tranzacțiile din pseudo-categorie sunt fie
   transferuri interne (excluse de acel flag), fie retrageri cu altă categorie reală. Are nevoie
   de un sentinel, ca `UNCATEGORIZED_KEY`.
2. **Testele existente ar primi date absurde.** În `transactions.test.ts`, `getFirstAsync` e
   mock-uit cu `mockResolvedValue`, deci întoarce același rând la orice apel, iar `getAllAsync`
   întoarce `undefined`. O interogare suplimentară în `getMonthlyTotals` ar citi `{income,
expense, cnt}` ca date de numerar. Cablarea trebuie să tolereze asta explicit, iar testele se
   actualizează, nu se șterg.

**Pasul 6 — cablarea, gata.** `getMonthlyTotals` adaugă `added_ron` la cheltuieli și expune
`cash_withdrawn_ron`; `getCategoryBreakdown` scade retragerile neconvertite din categoriile lor
originale, adaugă pseudo-categoria și elimină categoriile rămase la zero — altfel aceiași bani ar
apărea de două ori, iar suma categoriilor n-ar mai da totalul lunii. Drilldown-ul are sentinelul
lui în `useCategoryTransactions`, pe modelul `UNCATEGORIZED_KEY`. În Sumar apare nota „include …
RON numerar retras", ca schimbarea cifrelor față de versiunea anterioară să nu pară un bug.

Încărcătoarele din `cashSpending.ts` au **interogare proprie**, nu prin `transactions.ts`: acela
importă modulul, iar un import invers ar fi închis un ciclu. `madge --circular` confirmă că nu
există niciunul. Prețul e o mapare de rânduri duplicată, acceptată conștient.

**Descoperire despre teste, nu despre cod.** Testele `getMonthlyTotals` treceau fiindcă mock-ul
`getAllAsync` păstra o valoare **scursă dintr-un `describe` anterior** — nu fiindcă ar fi existat
vreun gard. La prima interogare nouă adăugată, ar fi picat din ordinea de rulare, nu din logică.
Ambele blocuri au acum `beforeEach` explicit. Merită reținut: un test care trece din scurgere
arată identic cu unul care trece din corectitudine.

**Pasul 7 (B2) — detectorul, gata; cablarea, nu.**

`services/spendingAnomalies.ts` (pur, 12 teste): baseline pe **mediană**, dispersie
`MAD × 1,4826` cu podea `max(MAD, 15% din mediană, 50 RON)`, anomalie doar când `z ≥ 3` **și**
diferența trece de `max(150 RON, 30% din mediană)`. Podeaua e partea care face regula utilizabilă:
o chirie fixă are MAD = 0, iar fără ea 60 de lei diferență ar da un `z` infinit și o alertă în
fiecare lună. Cele două praguri lucrează împreună — `z` spune „e departe față de cât variază de
obicei", pragul absolut oprește alertele pe categorii mărunte, unde și 40 de lei par enormi
statistic.

Explicația se alege după prima etichetă care se potrivește, în ordinea din plan: `single_large`,
`new_merchant`, `more_frequent`, `higher_ticket`. Ordinea contează — o plată unică mare explică
mai bine decât „mai multe tranzacții", chiar dacă amândouă sunt adevărate. Sezonalitatea nu
anulează semnalul, ci îi coboară tonul la `neutral`: „mare față de restul anului" și „mare față de
aceeași lună de anul trecut" sunt două afirmații diferite, iar userul o vrea pe a doua. Scăderile
se raportează ultimele: sunt informative, nu acționabile.

**Pasul 7 (B2) — cablarea, gata.** `getCategoryMonthlySeries` aduce 13 luni × categorie, cu total
și număr de tranzacții, într-o **singură** interogare; `getCategoryEvolution` nu putea servi,
fiindcă face câte o cerere per categorie și își calculează lunile din `new Date()`.
`computeMonthlyInsights` are acum poarta `isMonthComplete` **înaintea oricărei interogări**,
strânge ultimele 12 luni complete (sărind peste cele cu extrase lipsă — o lună incompletă în
istoric ar coborî mediana și ar face luna curentă să pară anomalie), rulează detectorul și
mapează prin `buildInsightsFromAnomalies`. Totalul lunii trece prin același detector, ca serie
unică, deci și `total_change` e acum pe mediană.

**Motorul vechi a fost scos complet** — `buildInsightsFromBreakdowns`, helperele și pragurile lui
pe medie. Cele 14 teste care îl acopereau au fost **înlocuite**, nu șterse tăcut: 10 teste noi
acoperă maparea și asamblarea (poarta de lună incompletă, pragul de istoric, cardul cu mesajul
detectorului, luna în tipar). Înlocuirea e consemnată aici tocmai fiindcă diferența dintre
„actualizat" și „șters" nu se vede din numărul de teste.

**Regresie de decis, nu de ascuns:** motorul vechi emitea `category_new` („Categorie nouă:
Veterinar cu 500 RON"). Detectorul nou nu are noțiunea de categorie nouă — are `new_merchant`,
care e altceva. Membrul `category_new` din `InsightType` a rămas **cod mort**, iar niciun gate nu
va semnala asta: knip și dependency-cruiser nu se uită la membri de uniune. Ori se adaugă regula
în detector, ori se scoate din tip.

**Risc mărit, nu introdus:** `buildRecap` cheamă `computeMonthlyInsights` într-un `try/catch`
best-effort. Dacă motorul aruncă, recapul pierde tăcut textul de evidențiere — fără log, fără
semnal. Traseul acela **nu are niciun test**: testele de recap verifică doar `buildRecapSummary`
cu un highlight dat de mână. Schimbarea l-a făcut mai greu (acoperire plus două interogări), deci
probabilitatea nu mai e neglijabilă.

**Rămâne de implementat:** pașii 8–12 (B7, B3, B8, B4, B5). Din B6 rămâne apariția în raportul
lunii, care se face în B4. **Nimic din pașii 6 și 7 nu e dovedit vizual** — de la capturile B1/B6
încoace s-au schimbat cifrele de pe Sumar, a apărut nota de numerar și s-a înlocuit tot motorul de
insights. Build-ul grupat e prima verificare reală a tuturor.

## Decizii (2026-09-11)

1. Cheia Mistral e aceeași ca la Dosar → cheie nouă, dedicată, doar pe server. (A0)
2. Proxy separat de Dosar, pe free tier. (A1)
3. Retragerile de numerar contează ca cheltuială „Numerar retras" în analize. (B2)
4. Sugestiile de economisire au AI în v1, peste fapte deterministe, cu validator numeric. (B3)
5. Sold extras vs sold app → intră, cu diagnostic și acțiuni. (B6)
6. Plăți anuale previzibile → extinse la „plăți recurente mari", lunare și anuale, cu
   notificare înainte de cele anuale. (B7)
7. Plată dublă suspectă → **respinsă**.
8. Buget sugerat → intră, ajustabil de user. (B8)
9. Retur neîncasat → **respins**.
