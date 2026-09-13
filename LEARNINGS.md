# Learnings

Ce s-a învățat lucrând la proiect — versionat, trecut prin PR. E memoria din git,
complementară memoriei persistente per-mașină a agentului, nu în locul ei.

## Cum se scrie o intrare

```markdown
### YYYY-MM-DD — titlu scurt

**Context:** ce se făcea când a apărut.
**Lecția:** ce s-a învățat, formulat ca regulă aplicabilă data viitoare.
**Promovat în:** unde a ajuns (sau „nicăieri încă" — atunci rămâne aici).
```

Scrie lecția, nu jurnalul. „Am petrecut 40 de minute pe X" nu e o lecție; „X eșuează tăcut
când Y, verifică Z întâi" e.

## Regula de promovare

O lecție nu rămâne aici dacă are un loc mai bun:

| Ce ai învățat             | Unde se promovează            |
| ------------------------- | ----------------------------- |
| un coupling / o convenție | `AGENTS.md`                   |
| o decizie de arhitectură  | spec sau ADR în `docs/`       |
| o procedură repetabilă    | un skill în `.claude/skills/` |
| un checklist de rol       | `agents/<rol>.md`             |

După promovare, intrarea rămâne aici cu „Promovat în: …" — istoricul deciziei e util chiar
și după ce regula a plecat în altă parte.

## Guardrails: off-limits pentru self-learning

Hook-urile, gate-urile, `.claude/settings.json`, `.husky/**` și bindings-urile de rol **nu
se modifică pe baza unei lecții**. Un sistem care își relaxează singur controalele când îl
incomodează nu mai e un control. Dacă un guardrail e greșit, lecția se scrie aici și
decizia o ia omul.

---

### 2026-07-31 — Amprenta diff-ului nu are voie să depindă de .gitignore-ul gazdei

**Context:** instalarea harness-ului agentic. Chitanțele de fază se scriu în
`.claude/state/`, iar amprenta se calcula din `git status --porcelain` întreg.

**Lecția:** magazia unui mecanism nu poate face parte din ce măsoară mecanismul. Scrierea
chitanței de `verify` schimba chiar amprenta pe care tocmai o înregistrase, așa că `review`
o găsea instantaneu învechită. În `finante` bug-ul era invizibil, fiindcă `.claude/*` e
gitignored — dar corectitudinea nu are voie să stea pe o regulă de ignore a repo-ului gazdă.
Testele au prins-o pentru că rulau în repo-uri temporare fără acel `.gitignore`.

**Promovat în:** `scripts/workflow-lib.mjs` (excludere explicită a `.claude/`).

### 2026-07-31 — Un gate care citește text nu trebuie să confunde datele cu codul

**Context:** gate-ul care blochează trimiterea la remote din sesiunile de agent, prima
versiune: potrivire directă pe textul comenzii Bash.

**Lecția:** gate-ul a blocat commit-ul care îl descria pe el însuși — mesajul conținea
literal comanda interzisă. Când inspectezi o comandă shell, uită-te la ce se execută, nu la
ce se scrie: scoate corpurile de heredoc și șirurile ghilimelate înainte de a potrivi. Un
guardrail cu fals-pozitive frecvente e un guardrail pe care cineva îl va dezactiva.

**Promovat în:** `scripts/check-no-push-pretool.mjs`.

### 2026-07-31 — Debug pe telefon fizic nu are bundle: „No script URL provided"

**Context:** build pe iPhone-ul real, aplicația crapă la pornire cu
`unsanitizedScriptURLString = (null)`.

**Lecția:** build phase-ul „Bundle React Native code and images" setează `SKIP_BUNDLING=1`
pe orice configurație Debug, iar `AppDelegate.bundleURL()` returnează sub `#if DEBUG` un URL
către Metro. Pe simulator asta merge — `localhost` e aceeași mașină; pe un telefon fizic nu
există nimic la acel URL și nici bundle înăuntru, deci `nil`. Regula: pe device se testează
**doar** Release (`npm run ios:device`). Dacă vrei totuși Debug pe device, trebuie Metro
pornit și telefonul pe aceeași rețea, cu IP-ul explicit — nu merită pentru un rodaj.

**Promovat în:** `AGENTS.md` (tabelul de comenzi, `npm run ios:device`).

### 2026-07-31 — Icoana e primul lucru pe care îl vede cineva; nu o lăsa generată

**Context:** icoana și splash-ul erau un grafic cu bare, o săgeată de creștere și un „L"
într-un cerc, pe verde spălăcit — ilizibile la 40px și fără legătură cu produsul.

**Lecția:** un mark care trebuie explicat nu funcționează la dimensiunea la care e privit
de fapt. Testează orice icoană la 40px înainte de 1024px. Contrastul se calculează, nu se
apreciază: alb pe `#4E5F2E` dă 7:1, alb pe `#A3B86C` (primary-ul din temă) dă 1.9:1 — de
aceea vechea variantă părea ștearsă. Asset-urile se regenerează cu
`python3 scripts/gen-app-icons.py`, apoi `npm run prebuild`.

**Promovat în:** `scripts/gen-app-icons.py` (generatorul e sursa, nu PNG-urile).

### 2026-07-31 — Splash-ul vechi de pe telefon nu era în build; era cache-ul iOS

**Context:** după rebranding, telefonul tot arăta splash-ul vechi (verde `#A3B86C`, logo în
cerc), deși asset-urile noi erau deja generate.

**Lecția:** înainte de a repara ceva, dovedește _unde_ e problema. `assetutil --info` pe
`Assets.car` din `.app`-ul construit arată exact ce s-a împachetat — acolo erau deja
`SplashScreenLegacy` și `SplashScreenBackground` noi, în ambele build-uri de device. iOS
păstrează un snapshot al launch screen-ului între update-uri și îl reia la pornire; se
invalidează la instalare curată, nu la rebuild. Regula: când repo-ul și build-ul spun
același lucru, iar device-ul spune altceva, e cache de OS — dezinstalează, nu rescrie cod.

**Promovat în:** nimic executabil — e un reflex de diagnostic, nu o regulă de cod.

### 2026-07-31 — `Text` iese din buton fiindcă nu are lățime de la care să se rupă

**Context:** la Dynamic Type mare, „Trimite la Mistral AI" ieșea din pilula butonului în
`AiPreflightDialog`, peste marginile rotunjite.

**Lecția:** într-un container coloană cu `alignItems: 'center'`, copilul `Text` se măsoară
la lățimea lui intrinsecă și _depășește_ părintele — `flexShrink` nu ajută, e pe axa
principală. Ce leagă textul de buton e `alignSelf: 'stretch'` + `textAlign: 'center'`.
A doua capcană, la stivuirea pe verticală: în Yoga `flexBasis: 'auto'` recade pe `0` cât
timp `flex > 0` rămâne setat, deci un „reset" cu `flexGrow: 0` + `flexBasis: 'auto'`
turtește elementul la înălțime 0. Reset-ul corect e `flex: 0`.

**Promovat în:** `components/AiPreflightDialog.tsx` (comentarii la `btnText` și `btnStacked`).

### 2026-09-03 — Un prompt text-to-SQL fără catalog eșuează _tăcut_, nu zgomotos

**Context:** chatul nu răspundea la „câți bani am cheltuit pe carburant din contul X" și
„în luna mai pe ce am cheltuit cei mai mulți bani". `buildSystemPrompt()` era static: fără
conturi, fără categorii, fără data curentă.

**Lecția:** modelul nu refuză când nu știe catalogul — inventează. Cere `key = 'carburant'`
(în schemă e `vehicle`) sau `a.name = 'contul X'`, SQL-ul e perfect valid, trece de guard,
rulează și întoarce **0 rânduri**. Userul primește „nu am găsit nimic" și crede că n-a
cheltuit, nu că întrebarea n-a fost înțeleasă. Un guard sintactic nu prinde asta: e o
eroare de referință, nu de sintaxă. Cine trimite o schemă unui model trebuie să trimită și
valorile pe care schema le poate lua — altfel validarea dă verde peste un răspuns greșit.
Corolar: mesajul pentru „zero rezultate" trebuie să repete filtrele înțelese, ca diferența
dintre „n-ai cheltuit" și „am înțeles greșit" să fie vizibilă.

**A doua lecție, la audit:** lărgirea a invalidat o promisiune scrisă. `privacyPolicy.ts`,
`landing/privacy.html` și `ARCHITECTURE.md` afirmau că AI-ul primește „doar schema bazei de
date". Un `grep` pe fraza din politică, nu doar pe cod, face parte din diff-ul care schimbă
ce se trimite la un terț.

**Promovat în:** `services/aiChatPrompt.ts` (`PromptContext` + regulile de potrivire),
`services/aiChat.ts` (`localToday()`), `services/privacyPolicy.ts`.

### 2026-09-03 — `COALESCE(amount_ron, amount)` adună valuta ca și cum ar fi RON

**Context:** patru defecte de agregare reparate împreună — protecție valutară, restituiri,
sold, potrivire transferuri. Toate din aceeași familie: **cifre greșite fără niciun semnal**.

**Lecția:** `COALESCE(x_convertit, x_brut)` e o capcană ori de câte ori cele două au unități
diferite. Pentru o tranzacție în EUR fără curs, `amount_ron` e NULL și COALESCE cade pe
`amount` — 100 EUR intrau în total ca 100 RON. Forma corectă e
`CASE WHEN currency = 'RON' THEN amount ELSE amount_ron END`: dă NULL, iar `SUM` sare peste
NULL-uri, deci totalul devine _incomplet_ în loc de _greșit_. Dar incomplet-și-tăcut nu e un
progres față de greșit-și-tăcut, așa că agregările întorc și `missing_rate_count`. Regula
generală: când alegi să sari peste date, numără ce ai sărit și raportează.

**A doua lecție — regulile care se contrazic.** Am adăugat în promptul de chat regula „nu
folosi COALESCE", dar few-shot-urile din același prompt continuau să-l folosească, iar mai
jos rămăsese regula veche „pentru sume folosește COALESCE". Un model copiază exemplul, nu
paragraful. Când schimbi o regulă într-un prompt, `grep` după forma veche în tot fișierul —
exemplele sunt parte din instrucțiuni, nu ilustrații.

**A treia — o validare prea strictă blochează propriul fix.** `linkAsInternalTransfer`
respingea sumele care nu se anulează exact, deci perechile deduse din comision sau din curs
n-ar fi putut fi aplicate nici după confirmarea utilizatorului. Când extinzi un detector,
verifică și ce face _scriitorul_ din aval cu rezultatele lui.

**Promovat în:** `services/amountSql.ts` (nou), `services/transactions.ts`,
`services/categories.ts`, `services/aiChatPrompt.ts`.

### 2026-09-04 — Un guard care validează „doar ce reușește să parseze" e fail-open

**Context:** trecere de securitate pe aplicație. `validateAndNormalizeSql` extrăgea numele
de tabel cu `/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/g` și verifica fiecare potrivire față de
un allowlist.

**Lecția:** allowlist-ul era iluzoriu, pentru că bucla de verificare rula **peste
potriviri**. `FROM "chat_messages"` nu se potrivea cu regex-ul, deci nu producea nicio
potrivire, deci nu se verifica nimic — și trecea. La fel `[x]` și `` `x` ``. Bonus:
`FROM a, b` verifica doar `a`. Regula: un guard nu are voie să fie construit ca „verifică
ce găsești"; trebuie să fie „ce nu poți dovedi că e permis, respinge". Diferența e între a
itera potriviri și a impune că fiecare poziție sintactică relevantă a fost înțeleasă.

**A doua lecție — secretele cu prefix public.** `EXPO_PUBLIC_*` e inline-at în bundle-ul JS
la build. Cheia „inclusă" ajungea în clar în fiecare artefact distribuit; confirmat cu
`grep` pe `main.jsbundle` de Release și cu `strings` pe bytecode-ul Hermes. Numele
prefixului chiar spune ce face — merită citit ca atare înainte de a pune un secret acolo.

**A treia — proba vizuală nu e mereu accesibilă.** `Switch`-ul din React Native nu răspunde
la tap prin idb, deci starea de blocare a PIN-ului n-a putut fi demonstrată pe simulator.
Substitutul onest a fost un test de randare cu `@testing-library/react-native` pe starea
blocată, plus declararea explicită a ce a rămas neverificat vizual — nu un screenshot
nerelevant prezentat ca dovadă.

**Promovat în:** `services/aiChatSqlGuard.ts`, `services/appLockThrottle.ts` (nou),
`services/backupSchemas.ts` (nou), `__tests__/unit/appLockScreen.test.tsx`.

### 2026-09-12 — „Nu releăm corpul" nu înseamnă nimic dacă releezi `messages`

**Context:** proxy AI propriu, ca să scoatem cheia providerului din bundle. Codul pornea din
Dosar și își scria în comentariu propria regulă: payload-ul se reconstruiește din câmpuri
cunoscute, nu se releează.

**Lecția:** reconstruia doar _nivelul de sus_. `messages` treceau ca atare, deci cu token-ul
extras din bundle puteai trimite blocuri `image_url` cu URL-uri arbitrare (vision/OCR pe contul
nostru, iar tokenii unei imagini remote nu sunt mărginiți de plafonul pe corpul cererii),
`document_url`, `name`, `prefix`, `tool_calls`. Când reconstruiești un payload, coboară în
fiecare structură imbricată: un allowlist care se opriește la primul nivel e un comentariu, nu
un control. Mai rău: testul „mesaje vision trec" _consacra_ comportamentul nedorit — un test
scris din comportamentul observat, nu din regula dorită, transformă gaura în specificație.

**Promovat în:** `ai-proxy/validate.js` (fiecare mesaj devine `{ role, content }`, doar text).

### 2026-09-12 — `req.destroyed` nu deosebește „abortat" de „citit până la capăt"

**Context:** plafon pe corpul cererii în proxy. La depășire voiam 413 livrat efectiv, nu
conexiune tăiată, ca aplicația să poată spune userului că extrasul e prea mare.

**Lecția:** Node distruge automat `IncomingMessage` după evenimentul `end`, deci garda
`if (req.destroyed) return;` din calea de eroare era adevărată **și** pe calea normală: 413 nu
plecă niciodată, iar cererea rămânea agățată până la timeout. Starea „nu mai am cui răspunde" e
a _ta_, nu a stream-ului: marchează-o explicit (un flag pe eroare) în locul în care chiar ai
tăiat conexiunea. Bug-ul s-a văzut doar pentru că testul aștepta statusul, nu doar „nu 200".

**Promovat în:** `ai-proxy/server.js` (`readBody`, erori marcate `aborted`).

### 2026-09-12 — Un status releat de la provider devine minciună în UI

**Context:** proxy-ul releea răspunsurile providerului AI așa cum veneau.

**Lecția:** un 429 de la provider e limita _contului nostru_, dar aplicația îl traduce în „ai
atins limita zilnică de interogări", adică îi spune userului o cifră despre el care e falsă,
exact ca la incidentul cu cheia abuzată. Când releezi statusuri între două sisteme, mapează-le
după **cine** a impus limita, nu după codul numeric: 429-ul propriu rămâne 429, cel al
providerului devine 503 („indisponibil momentan"). Corolar aplicat în aceeași trecere: o cerere
care n-a produs niciun răspuns AI nu are voie să consume cota zilnică a userului.

**Promovat în:** `ai-proxy/server.js` (429 → 503, `release` pe erori),
`services/aiProvider.ts` (`describeHttpError`).

### 2026-09-12 — Fiecare „scutire" dintr-un plafon e o portiță; iar `X-Forwarded-For` e input

**Context:** a doua trecere de review pe proxy. Primul set de corecții adăugase găleți per
device și per IP, plus `release()` — întoarcerea cotei când cererea n-a produs un răspuns AI.

**Lecția, în două părți, amândouă găsite cu sondă, nu prin citire.**

1. `release()` rula pe orice status ≥ 400. Un 4xx e însă o **cerere servită**: cu un provider
   care întoarce 422 (payload refuzat) sau 404 (`MODEL_MAP` greșit), 12 din 12 cereri au ajuns
   la upstream și contoarele au rămas la zero — cotă nelimitată, inclusiv pe plafonul global.
   Regula: scutirea se dă doar pentru ce clientul **nu** poate provoca (5xx, timeout). Orice
   condiție de scutire pe care o poate declanșa cel limitat transformă plafonul în decor.
2. Găleata per IP se alegea din `X-Forwarded-For.split(',')[0]` — adică exact valoarea trimisă
   de client, fiindcă platformele adaugă adresa reală la **coadă**. Rotind header-ul, 10 din 10
   cereri au trecut peste limite de 2 și 3 pe zi: fix-ul pentru ocolirea prin `X-App-Device`
   era ocolit prin același mijloc. Un header nu devine de încredere pentru că îl pune de obicei
   infrastructura; devine de încredere doar dacă declari **câți** proxy stau în față și numeri
   de la coadă. Implicit acum: `req.socket.remoteAddress`, iar `TRUSTED_PROXY_HOPS` e opt-in.

**Corolar de testare:** testul care „demonstra" limita per IP folosea `X-Forwarded-For` ca date
de intrare, deci consfințea controlul clientului asupra găleții — la fel ca testul „mesaje
vision trec" din trecerea precedentă. Un test scris din comportamentul observat documentează
gaura; scrie-l din proprietatea dorită („clientul nu-și poate alege găleata").

**Promovat în:** `ai-proxy/server.js` (scutire doar pe 5xx/abort), `ai-proxy/validate.js`
(`clientIp` + hops de încredere), `ai-proxy/config.js` (`TRUSTED_PROXY_HOPS`).

### 2026-09-12 — Reconcilierea dovedește coerența extrasului, nu completitudinea extragerii

**Context:** pasul 3 — perioada din antetul extrasului și soldurile tipărite, folosite ca să
știm ce lună acoperă un import.

**Lecția:** legasem expunerea lor de verificarea internă „sold anterior + credit − debit = sold
final". Pe un extras trunchiat (33 din 84 de rânduri extrase), verificarea aceea trece în
continuare — e despre cifrele _declarate_ de bancă, nu despre cât a citit parserul — deci în
DB ar fi intrat „iunie, 1–30, sursă: antet" peste o extragere pe jumătate, iar detectarea
extraselor lipsă ar fi raportat luna ca acoperită. Două verificări care sună la fel:
_documentul e coerent_ și _l-am citit tot_. Când o concluzie depinde de a doua, cere-o explicit
(aici: reconcilierea completă, inclusiv numărul de referințe vs. tranzacții extrase).

**Promovat în:** `services/bankStatementPdfParser.ts` (gard pe `isFullyReconciled`).

### 2026-09-12 — Un contor „per IP" nu contorizează nimic dacă procesul nu vede IP-ul clientului

**Context:** primul deploy al proxy-ului pe Danube Rapids (Knative). Adăugasem, tocmai ca fix de
securitate, o găleată de contorizare pe adresa cererii, cu implicit `req.socket.remoteAddress`,
fiindcă `X-Forwarded-For` e scris de client.

**Lecția:** în spatele unui sidecar (aici queue-proxy-ul Knative, vizibil în loguri la pornire ca
`dial tcp 127.0.0.1:8080`), procesul vede **loopback** pentru toate cererile. Găleata „per IP"
devine una singură, pentru toți utilizatorii: la un plafon de 60/zi, userii legitimi se blochează
reciproc, iar mesajul primit („prea multe cereri din rețeaua ta") arată ca o eroare a lor. Un
plafon care lovește pe cine nu trebuie e mai rău decât lipsa lui. Regula: înainte de a contoriza
pe o identitate de rețea, dovedește ce vede procesul în runtime-ul ăla — nu în modelul mental al
unui server care ascultă direct pe internet. Până la dovadă, ține plafonul inert (egal cu cel
global) și bazează-te pe identități pe care le controlezi (aici: cota per device și cea globală).

**Promovat în:** `ai-proxy/README.md` (nota despre Knative + procedura de verificare cu
`PER_IP_DAILY_LIMIT=1`).

### 2026-09-12 — După ce contopești intervale, orice verificare pe capătul lor e despre alt obiect

**Context:** B1 — mesajul pentru extrasul exportat înainte de sfârșitul lunii: „Extrasul din
august se oprește pe 28; lipsesc 29–31 august. Re-exportă luna întreagă."

**Lecția:** decideam dacă un gol e coada unui extras uitându-mă dacă vreun interval acoperit
**începe** în aceeași lună, înaintea golului (`iv.from`). Dar intervalele trecuseră deja prin
lipire: extrasul pe iulie și cel pe august devin unul singur, care începe pe 1 iulie. Luna lui
`from` e deci iulie, iar verificarea răspunde „nu" exact în cazul pe care mesajul îl descrie —
userul primea „Lipsesc 29–31 august" în loc de propoziția care-i spune ce s-a întâmplat și ce
să facă. Normalizarea care contopește obiecte le schimbă identitatea capetelor: „unde începe"
nu mai e despre extrasul la care mă gândeam. Aici întrebarea corectă era oricum despre celălalt
capăt — mă interesează unde se _oprește_ acoperirea, care e și ziua din mesaj (`iv.to`).

**Corolar de testare:** l-a prins doar testul scris pe scenariul real (trei extrase consecutive,
iulie + august trunchiat + septembrie). Un test minimal, cu un singur extras înaintea golului,
ar fi trecut și ar fi consfințit bug-ul — intervalele n-ar fi avut ce contopi.

**Promovat în:** `services/statementCoverage.ts` (`stopsBefore` calculat pe `iv.to`), test
„prinde extrasul exportat înainte de sfârșitul lunii".
