# Asistent AI conversațional peste DB

**Data:** 2026-04-29
**Status:** spec aprobat de user, gata pentru plan de implementare

## Context și problema

Utilizatorul are tranzacții, conturi și categorii salvate local în SQLite. UI-ul curent expune ecrane fixe (Sumar lunar, listă Tranzacții, Conturi, Categorii) cu filtre limitate. Întrebări naturale precum:

- „La ce bănci am cont?"
- „De unde cumpăr cea mai multă mâncare?"
- „În contul BT_curent_ron am cumpărat ceva de la MCDONALDS?"
- „Anul ăsta sau anul trecut am cumpărat mai mult de la McDonald's?"
- „Cum au evoluat cheltuielile cu întreținerea față de anul trecut?"

… nu pot fi acoperite fără navigare prin mai multe ecrane sau filtre manuale. Există deja agregări utile (`getMonthlyTotals`, `getCategoryBreakdown`, `getCategoryEvolution`), dar utilizatorul trebuie să compună singur răspunsul.

Există deja AI provider configurat (`services/aiProvider.ts`) — built-in Mistral small cu cotă 20/zi sau cheie proprie nelimitată. Folosit în prezent doar pentru categorizare la import + vision pe extrase.

## Decizia

Adăugăm un al cincilea tab **„Asistent"** cu chat conversațional. Utilizatorul scrie întrebări în limbaj natural, AI-ul traduce întrebarea într-un SQL SELECT (read-only) pe care app-ul îl rulează local. Răspunsul natural este construit de app pe baza unui set fix de template-uri românești — **AI-ul nu reformulează cifrele**, eliminând prin construcție halucinarea numerică.

**Constrângere fundamentală — zero improvizație:** răspunsurile cu date numerice (sume, count, totaluri) sunt generate deterministic din rezultatele SQL. Dacă întrebarea nu se mapează pe DB, app-ul răspunde explicit „nu pot răspunde", niciodată cu o aproximare.

## Decizii arhitecturale (rezumat)

| Decizie        | Alegere                                | Alternative respinse                                                            |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| Scope produs   | (b) conversațional liber               | (a) chips fixe — prea limitat; (c) hibrid — over-engineering MVP                |
| Generare query | (b3) AI generează SQL                  | (b1) tool-calling în loop — consumă cota; (b2) JSON intent — schemă DSL fragilă |
| Multi-turn     | da, fereastră 4 perechi                | single-turn — UX inferior; istoric nelimitat — context overflow                 |
| UI             | tab nou „Asistent"                     | rută `/chat` cu intrări multiple — discoverability slabă                        |
| Evidence       | collapsible „Sursa" + listă tranzacții | text simplu — încredere slabă; inline citation — Mistral small unreliable       |
| Persistare     | SQLite, single conversație             | ephemeral — pierdere insight-uri; multi-thread — YAGNI MVP                      |
| Format răspuns | 1 AI pass + template local             | 2 AI passes — risc halucinare numerică + cota dublă                             |
| Cota epuizată  | hard block + CTA Setări                | soft block cu fallback — over-engineering                                       |
| Consent        | global existent (`AI_CONSENT_KEY`)     | dedicat — fricțiune dublă                                                       |

## Fluxul principal

```
[user scrie întrebare în tab Asistent]
       ↓
[ChatService.sendMessage]
       ↓
1. încarcă ultimele 4 perechi user/assistant din SQLite (fereastră multi-turn)
       ↓
2. construiește prompt SQL-gen:
     - system: schema DB + reguli (doar SELECT, fără DML, LIMIT obligatoriu, lista template-uri valide)
     - history: ultimele 4 perechi (doar întrebări + explanation_short al răspunsurilor, FĂRĂ rows)
     - user: întrebarea curentă
       ↓
3. AI răspunde cu JSON: { "sql": "...", "template": "search_merchant", "params": {...}, "explanation_short": "..." }
       ↓
4. validare în app:
     - Zod schema pe răspuns
     - SQL allowlist (parser regex multi-stage + tabele permise + clamp LIMIT)
     - dacă invalid → un singur retry cu eroare ca feedback, apoi giveup → "nu pot răspunde, reformulează"
       ↓
5. db.getAllAsync(sql) într-o conexiune READ-ONLY (PRAGMA query_only = 1) cu timeout 3s
       ↓
6. ResponseFormatter.format(template, rows, params) → text românesc + evidence list
       ↓
7. salvează în chat_messages (user msg + assistant msg + evidence_json)
       ↓
8. UI afișează răspunsul + collapsible „Sursa: N tranzacții"
```

## Module noi

| Modul                         | Rol                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `services/aiChat.ts`          | orchestrator (pașii 1-7)                                                                                    |
| `services/aiChatPrompt.ts`    | construire system prompt + history compaction                                                               |
| `services/aiChatSqlGuard.ts`  | validare SQL: doar SELECT, allowlist tabele/coloane, fără PRAGMA/ATTACH/DETACH/`;`/`--`/`/*`, LIMIT max 500 |
| `services/aiChatTemplates.ts` | template-uri formatare răspuns (un fișier per template-tip)                                                 |
| `services/aiChatRepo.ts`      | CRUD pe `chat_messages` (load history, save, clear, recentPairs)                                            |
| `app/(tabs)/assistant.tsx`    | ecran tab (lista mesaje + input)                                                                            |
| `components/ChatMessage.tsx`  | bubble user/assistant + collapsible evidence                                                                |
| `components/EvidenceList.tsx` | lista tranzacții cu deep-link                                                                               |

**Reguli arhitecturale (existing):**

- `services/aiChat*` nu importă din `components/`, `app/`, `hooks/` (regula existentă enforcer-uită prin `dependency-cruiser`).
- Tab-ul Asistent e accesibil **doar** dacă `getAiConfig().type !== 'none'` și `AI_CONSENT_KEY` acceptat. Altfel afișează empty state „Activează AI din Setări".

## SQL gen + safeguards

### Format JSON cerut de la AI (validat cu Zod)

```json
{
  "sql": "SELECT ... FROM transactions ... LIMIT 100",
  "template": "search_merchant" | "monthly_total" | "top_merchants" | "category_evolution" | "list_accounts" | "list_categories" | "period_compare" | "raw_list" | "cannot_answer",
  "params": { "merchant": "MCDONALDS", "account_id": "...", ... },
  "explanation_short": "Tranzacții la McDonald's în BT_curent_ron"
}
```

`explanation_short` e folosit doar la istoric (în loc de rows) pentru fereastra multi-turn. Nu apare user-ului direct.

Când AI nu poate răspunde: `{ "sql": null, "template": "cannot_answer", "explanation_short": "..." }`.

### Schema în system prompt (compactă, în română)

```
Bază SQLite, citești doar. Schema relevantă:

financial_accounts(id, name, type, currency, initial_balance)
expense_categories(id, name, key, parent_id, icon, color, monthly_limit)
transactions(id, account_id, date, amount, currency, amount_ron,
             description, merchant, category_id, source,
             is_internal_transfer, is_refund, duplicate_of_id, notes)

Reguli:
- Excludem mereu: duplicate_of_id IS NULL AND is_internal_transfer = 0
  (excepție: când utilizatorul cere explicit transferuri/duplicate).
- Cheltuielile sunt amount < 0; veniturile amount > 0.
- Pentru sume folosește COALESCE(amount_ron, amount).
- LIMIT obligatoriu, max 500.
- Generezi DOAR SELECT. Niciun INSERT/UPDATE/DELETE/PRAGMA/ATTACH/DROP.
- Returnezi JSON conform schemei.
- Dacă întrebarea nu poate fi mapată pe schemă, răspunzi cu
  { "sql": null, "template": "cannot_answer", "explanation_short": "..." }.
```

Plus 4-5 few-shot examples pentru calibrare Mistral small.

### SQL guard (`aiChatSqlGuard.ts`) — defense in depth

1. **Parser strict** (regex multi-stage):
   - Lower-case + trim → trebuie să înceapă cu `select` sau `with ... select`.
   - Reject: `;` (multi-statement), `--`, `/*`, `pragma`, `attach`, `detach`, `insert`, `update`, `delete`, `drop`, `create`, `alter`, `replace`, `vacuum`, `reindex`, `into` (SELECT INTO), `load_extension`.
2. **Allowlist tabele:** `{transactions, expense_categories, financial_accounts}`. Refuzăm `bank_statements`, `settings`, `fx_rates`, `chat_messages`.
3. **LIMIT injection / clamp:** dacă lipsește → adăugăm `LIMIT 500`. Dacă > 500 → clamp la 500.
4. **PRAGMA query_only=1** pe conexiunea de execute. Garanție SQLite: orice scriere → eroare runtime.
5. **Timeout execute:** 3 secunde (`Promise.race`).

### Retry logic

- AI returns JSON invalid (Zod fail) sau SQL respins de guard: **un singur retry** cu mesaj feedback ca system message adițional („SQL-ul nu e valid: <motiv>. Generează altul").
- Dacă și retry-ul eșuează → mesaj user „Nu pot răspunde la asta. Reformulează." Cost total: max 2 calls.
- AI răspunde cu `template: "cannot_answer"` → afișăm `explanation_short` ca răspuns. 1 call.

### Trade-off-uri SQL

- Regex-based guard, nu parser SQL real. Risk: edge case scăpat. Mitigare: combinație guard + `query_only` pragma + allowlist tabele + timeout. Defense in depth.
- Schema e mică (~150 tokens) — `bank_statements`, `fx_rates`, `settings`, `chat_messages` excluse din prompt și din allowlist.
- Few-shot examples (~300 tokens) cresc prompt-ul, dar îmbunătățesc dramatic calitatea SQL pe Mistral small.

## Template-uri răspuns

Fiecare template e o funcție pură: `format(rows, params, ctxLookups) → { text: string, evidence: EvidenceItem[] }`.

`ctxLookups` = mic helper sincron pentru a rezolva ID-uri în nume (account name, category name) — pre-încărcate o singură dată per request din `services/financialAccounts.ts` și `services/categories.ts`.

### Cele 8 template-uri MVP

| Template             | Întrebare-tip                                      | Format text românesc                                                                                                                                                          |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_merchant`    | „Am cumpărat de la X în contul Y?"                 | „Da, ai N tranzacții la **{merchant}** în **{account}**, total **{sum} RON**, între **{firstDate}** și **{lastDate}**." sau „Nu am găsit tranzacții la {merchant}{account?}." |
| `top_merchants`      | „De unde cumpăr cea mai multă mâncare?"            | „Top 5 merchants{cat?}{period?}: 1. **{m1}** — {s1} RON ({c1} tranz.) ..."                                                                                                    |
| `monthly_total`      | „Cât am cheltuit luna trecută{cat?}?"              | „În **{month}** ai cheltuit **{sum} RON**{cat?: pe categoria X} din N tranzacții. Față de luna precedentă: **{delta}**."                                                      |
| `category_evolution` | „Cum au evoluat cheltuielile cu întreținerea YoY?" | „Pe categoria **{cat}**: ultimele 12 luni vs precedentele 12 luni: **{thisYear} RON** vs **{lastYear} RON** (**{delta}**). Per lună: {compactSeries}."                        |
| `period_compare`     | „Anul ăsta vs anul trecut McDonald's?"             | „**{merchantOrCat}** — **{period1}**: {sum1} RON ({c1} tranz). **{period2}**: {sum2} RON ({c2} tranz). Diferență: **{delta}**."                                               |
| `list_accounts`      | „La ce bănci am cont?"                             | „Ai **N conturi**: 1. **{name}** ({type}, {currency}, sold inițial {bal}) ..."                                                                                                |
| `list_categories`    | „Ce categorii am?"                                 | Listă ierarhică categorii principale + sub-categorii.                                                                                                                         |
| `raw_list`           | fallback — listă tranzacții generale               | „Am găsit **N tranzacții**{filtre?}, total **{sum} RON**. Primele 10 (vezi Sursa pentru toate)."                                                                              |

**Notă:** `cannot_answer` (din lista de valori valide pentru câmpul `template` din JSON) **nu** e un template de format propriu-zis — e un sentinel folosit când AI-ul declară că întrebarea nu poate fi mapată pe schemă. UI-ul afișează direct `explanation_short` ca mesaj user, fără rendering de evidence. Tipul TS `ChatTemplate` din `aiChatRepo.ts` e union-ul celor 8 template-uri + `'cannot_answer'`.

### Reguli formatare

- Sume: `value.toLocaleString('ro-RO', { maximumFractionDigits: 2 })` + ` RON`.
- Date: `DD MMM YYYY` în română (ex. „12 ian 2026"). Format manual pe lookup `['ian','feb','mar',...]` ca să evităm dep nou.
- Period delta: „**+15%** (+45 RON)", culoare după `statusColors` (creștere cheltuială = roșu, scădere = verde).
- Empty results: fiecare template are explicit „Nu am găsit ..." — fără AI improvizație.

### Evidence list

```ts
type EvidenceItem =
  | {
      kind: 'transaction';
      id: string;
      date: string;
      amount: number;
      merchant: string;
      account: string;
      category?: string;
    }
  | { kind: 'account'; id: string; name: string; type: string }
  | { kind: 'category'; id: string; name: string; parent?: string }
  | { kind: 'aggregate'; label: string; period: string; total: number; count: number };
```

UI: lista compactă, max 10 vizibile + „arată toate (N)". Tap pe `transaction` → `router.push('/transactions/[id]')`. Pe `account` / `category` → ecranele respective. Tranzacție inexistentă (între timp ștearsă) → placeholder „Tranzacție ștearsă", fără crash.

### Cum decide AI-ul template-ul

Few-shot examples în prompt (4-5 perechi întrebare → JSON output corect):

- „de la X în contul Y" → `search_merchant`
- „de unde cumpăr cel mai mult ..." → `top_merchants`
- „cum au evoluat ... față de anul trecut" → `category_evolution`
- „anul ăsta vs anul trecut" → `period_compare`
- restul / liste → `raw_list`

## Schema DB nouă

Tabel nou `chat_messages` adăugat în `services/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,                  -- 'user' | 'assistant' | 'system_error'
  content TEXT NOT NULL,               -- text afișat user
  template TEXT,                       -- doar pe assistant: 'search_merchant' | ...
  sql_used TEXT,                       -- SQL-ul real executat (pt. debugging + retry)
  evidence_json TEXT,                  -- JSON.stringify(EvidenceItem[])
  explanation_short TEXT,              -- folosit în history compaction
  error_kind TEXT,                     -- 'invalid_sql' | 'quota_exhausted' | 'cannot_answer' | 'context_overflow'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
```

Schema nouă declanșează în `services/manifestHash.ts` un manifest hash nou (regula `sqlite-migration` skill). Backup-urile existente rămân compatibile — `IF NOT EXISTS` îl creează la primul boot post-update. Restore din backup vechi (fără tabel) → se creează gol.

### API `services/aiChatRepo.ts`

```ts
type ChatRole = 'user' | 'assistant' | 'system_error';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  template?: ChatTemplate;
  sqlUsed?: string;
  evidence?: EvidenceItem[];
  explanationShort?: string;
  errorKind?: 'invalid_sql' | 'quota_exhausted' | 'cannot_answer' | 'context_overflow';
  createdAt: string;
}

listMessages(limit?: number, beforeId?: string): Promise<ChatMessage[]>
appendMessage(input: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage>
clearAll(): Promise<void>
recentPairs(n: number): Promise<{ user: ChatMessage; assistant: ChatMessage }[]>
```

`recentPairs(4)` întoarce ultimele 4 perechi user/assistant complete (skip mesaje orfane, skip `system_error`). Asta intră în system prompt (compactat: doar `content` user + `explanationShort` assistant).

### Storage budget

- Mesaj user mediu: ~50 chars text. Mesaj assistant cu evidence: ~200 chars text + ~5kB JSON evidence (10 items).
- 1000 mesaje ≈ 5MB. Acceptabil pentru SQLite.
- Buton „Șterge conversația" → confirmation dialog → `DELETE FROM chat_messages`. Acțiune ireversibilă, alertăm clar.

## UI — tab Asistent

### Locație

`app/(tabs)/assistant.tsx`. Adăugat în `app/(tabs)/_layout.tsx` ca al 5-lea tab cu icon `chatbubbles` (Ionicons) și titlu „Asistent".

### Layout

```
┌──────────────────────────────────────────┐
│  Asistent              [⋮ menu]         │ ← header SafeArea
├──────────────────────────────────────────┤
│                                          │
│  [welcome / empty state, dacă lista vidă]│
│                                          │
│  ┌─ User ──────────────────────────────┐│
│  │ La ce bănci am cont?                ││
│  └─────────────────────────────────────┘│
│  ┌─ Asistent ──────────────────────────┐│
│  │ Ai 3 conturi: ...                   ││
│  │ ▸ Sursa: 3 conturi                  ││ ← collapsible
│  └─────────────────────────────────────┘│
│                                          │
├──────────────────────────────────────────┤
│  [22/20 cota] (afișat când builtin)     │
├──────────────────────────────────────────┤
│ [Întreabă ceva...]              [trimite]│
└──────────────────────────────────────────┘
```

### Empty states

| Stare                                              | Conținut                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AI dezactivat (`type === 'none'` sau fără consent) | Icon mare + „Asistentul AI nu este activ.\nActivează-l din **Setări → Asistent AI**." + buton primary „Mergi la Setări" |
| Activ, fără mesaje                                 | Icon `sparkles` + „Întreabă orice despre finanțele tale.\nExemple:" + 4-5 chips clickable                               |
| Cota atinsă (builtin)                              | Banner roșu sus + buton „Setări AI". Input dezactivat, lista mesajelor read-only                                        |
| Eroare retea / timeout                             | Mesaj `system_error` în chat + buton retry pe ultimul mesaj user                                                        |

Chips de exemplu (empty state):

- „La ce bănci am cont?"
- „Top 5 merchants luna asta"
- „Cât am cheltuit pe Mâncare?"
- „Tranzacții la Lidl anul ăsta"

### `ChatMessage` componentă

- **User bubble:** aliniat dreapta, fundal `Colors[scheme].tint`, text alb, max 80% lățime.
- **Assistant bubble:** aliniat stânga, fundal `Colors[scheme].card`, text `Colors[scheme].text`. Suport markdown bold (`**...**`). Render manual pe split (fără dep nou) ca să evităm package suplimentar.
- **`system_error` bubble:** aliniat centru, fundal `statusColors.error` cu opacity 0.1, text `statusColors.error`, fără collapsible.

### Collapsible „Sursa"

- Buton ghost sub bubble assistant: „▸ Sursa: 3 tranzacții" / „▾ Sursa: 3 tranzacții".
- Open → render `EvidenceList`: max 10 items vizibile + „arată toate (N)".
- Item tap → `router.push('/transactions/[id]')` etc.

### Input bar

- `TextInput` multiline (max 4 rânduri).
- Buton trimite: dezactivat când input gol sau cota atinsă sau loading.
- Loading state: spinner pe buton + shimmer placeholder „Asistent gândește..." în lista de chat.
- iOS: `KeyboardAvoidingView` ridică input-ul peste tastatură.

### Header menu (⋮)

- „Șterge conversația" → confirmation dialog → `clearAll()` → reload listă goală.
- „Setări AI" → navigare la ecranul Setări AI existent.

### Cota indicator

Doar pe `type === 'builtin'`. Rând subțire deasupra input-ului: text mic „22/20 azi" colorat după `statusColors` (verde <80%, galben 80-99%, roșu 100%). Update după fiecare răspuns AI.

### Convenții (rn-expo-conventions skill)

- Texte UI 100% în română.
- `useColorScheme` din `@/components/useColorScheme`.
- `Colors[scheme]` pentru toate culorile, zero hardcoded.
- Alias `@/` pentru imports.
- Componente split la 250+ linii (`ChatMessage`, `EvidenceList` separate).

### `FlatList inverted` pentru chat

Lista mesajelor folosește `FlatList inverted` ca să avem auto-scroll la bottom „pe gratis" (cel mai nou mesaj e primul element).

## Erori și fallback (consolidat)

| Eroare                             | UI mesaj                                             | Cost cota             |
| ---------------------------------- | ---------------------------------------------------- | --------------------- |
| AI cota atinsă (pre-call check)    | Banner roșu + input dezactivat                       | 0 calls               |
| AI invalid JSON / SQL guard reject | Retry o dată; eșec → „Nu pot răspunde, reformulează" | max 2 calls           |
| AI răspunde `cannot_answer`        | „Nu pot răspunde la asta: {explanation}"             | 1 call                |
| SQL execute timeout (>3s)          | „Întrebarea durează prea mult; simplifică-o"         | 1-2 calls             |
| `AiContextOverflowError`           | „Conversația e prea lungă; șterge-o din meniu"       | 1 call                |
| Network error / API 5xx            | „Eroare conexiune" + buton retry                     | 0 calls (retry e nou) |
| AI consent off                     | Empty state „activează din Setări"                   | 0 calls               |

## Testare

| Layer                      | Tip teste                                    | Locație                                  |
| -------------------------- | -------------------------------------------- | ---------------------------------------- |
| `aiChatSqlGuard.ts`        | unit, ~25 cazuri                             | `__tests__/unit/aiChatSqlGuard.test.ts`  |
| `aiChatTemplates.ts`       | snapshot per template (happy + empty + edge) | `__tests__/unit/aiChatTemplates.test.ts` |
| `aiChatRepo.ts`            | unit cu DB in-memory                         | `__tests__/unit/aiChatRepo.test.ts`      |
| `aiChatPrompt.ts`          | unit pe history compaction + schema render   | `__tests__/unit/aiChatPrompt.test.ts`    |
| `aiChat.ts` (orchestrator) | integration cu mock `sendAiRequest`          | `__tests__/unit/aiChat.test.ts`          |

### Cazuri critice SQL guard

```
ACCEPT: SELECT * FROM transactions WHERE merchant LIKE '%MCD%' LIMIT 100
ACCEPT: SELECT SUM(amount_ron) FROM transactions WHERE date >= '2026-01-01' LIMIT 1
ACCEPT: WITH cte AS (SELECT ...) SELECT * FROM cte LIMIT 50

REJECT: DROP TABLE transactions
REJECT: SELECT * FROM transactions; DELETE FROM transactions
REJECT: SELECT * FROM transactions /* sneaky */ INTO outfile
REJECT: PRAGMA table_info(transactions)
REJECT: ATTACH DATABASE 'evil.db' AS evil
REJECT: SELECT * FROM bank_statements (tabel nu e în allowlist)
REJECT: SELECT * FROM settings (tabel nu e în allowlist)
REJECT: -- comment\nDELETE FROM transactions
REJECT: SELECT load_extension('evil.so')

REWRITE LIMIT: SELECT * FROM transactions → ... LIMIT 500 (auto-injectat)
REWRITE LIMIT: SELECT * FROM transactions LIMIT 9999 → LIMIT 500 (clamp)
```

### Snapshot tests template-uri

- Fiecare template → 3+ teste cu fixture rows determinist + assertion exact pe text + evidence.
- **Critical:** test dedicat per template care verifică `responseText.match(/\d+(\.\d+)? RON/)` corespunde cu `sum(rows.amount_ron)` calculat în test → garantează că textul reflectă rows fără manipulare.
- Format dată snapshot-uit cu `process.env.TZ='Europe/Bucharest'` set în `__tests__/setup.ts`.

### Integration test orchestrator

- Mock `sendAiRequest` să întoarcă JSON-uri pre-definite per întrebare.
- Verifică flow complet: input → SQL gen mock → guard → query DB seed → format template → save → output.
- Cazuri:
  - happy path search_merchant
  - AI întoarce JSON invalid → retry → succes la a doua
  - AI întoarce SQL respins de guard → retry → succes
  - AI întoarce `cannot_answer` → mesaj user fără retry
  - Cota atinsă → mesaj system_error, niciun call AI
  - Context overflow → mesaj user

## Criterii de acceptare

### Funcțional

- Cele 8 template-uri răspund corect pe DB demo (rulat cu `services/demoData.ts`).
- Exemplele user-ului toate funcționează:
  - „La ce bănci am cont?" → `list_accounts`
  - „De unde cumpăr cea mai multă mâncare?" → `top_merchants` cu filtru categorie
  - „În contul BT_curent_ron am cumpărat ceva de la MCDONALDS?" → `search_merchant`
  - „Anul acesta sau anul trecut am cumparat mai mult de la macdonands?" → `period_compare`
  - „Cum au evoluat cheltuielile cu intretinerea fata de anul trecut" → `category_evolution`
- Multi-turn cu fereastră 4 perechi funcționează (testat cu „și luna trecută?").
- Buton „Șterge conversația" șterge tot și reset state.

### Siguranță

- SQL guard testat ≥25 cazuri ACCEPT/REJECT.
- PRAGMA `query_only=1` confirmat pe conexiunea de execute (test integration: `INSERT` aruncă eroare).
- Backup ZIP cu/fără tabel funcționează (restore din ZIP vechi nu crash-uie).

### Calitate cod

- `npm run check` trece (lint + type-check + tests + knip + madge + dep-cruise).
- `services/aiChat*` nu importă din `components/`, `app/`, `hooks/`.
- Toate textele UI în română.
- Componente split la 250+ linii.

### UX

- Empty state cu chips de exemple.
- Cota visible la builtin.
- Loading state vizibil (spinner / shimmer).
- Deep-link evidence → tranzacție merge.

### Documentație

- `docs/IDEAS.md` — adaug „Asistent AI conversațional" la status „implementat".
- `docs/ARCHITECTURE.md` — adaug servicii noi în tabel + secțiune chat.
- `landing/` — verificat de `landing-copy-reviewer` agent dacă e nevoie de menționare.
- `CLAUDE.md` — adaug doar dacă apare convenție nouă.

## Non-goals MVP

- Export conversație, multi-thread, share răspuns. YAGNI.
- Răspunsuri proactive / notificări gen „azi ai cheltuit mult". Doar reactive.
- Suport limbi non-RO. Hardcodat ro.
- Pool comun de cota / quota burst. User-ul cu utilizare intensă setează cheie proprie.
