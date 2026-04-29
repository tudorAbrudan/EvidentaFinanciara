# Trimite extras bancar direct la AI (vision)

**Data:** 2026-04-25
**Status:** spec aprobat de user, gata pentru plan de implementare

## Context și problema

Utilizatorul importă extrase bancare PDF în `app/(tabs)/entitati/cont/import.tsx`. Pipeline-ul actual:

1. PDF → OCR (ML Kit, prin `pdfOcr.ts`).
2. Text OCR → parser determinist (`parseStatementPdf`).
3. Dacă parserul nu găsește tranzacții, fallback opțional la AI cu textul OCR (`mapStatementWithAi`).

Rezultat observat de utilizator:
- Totalurile apar dublate.
- Cheltuielile nu se mapează corect pe categorii.
- Modul „Analizează cu AI" pe text OCR e mai bun, dar pierde structura documentului.

Cauza: pasul OCR „aplatizează" documentul (tabele, header-e, totaluri devin linii de text). Parserul determinist și AI-ul text-only nu mai disting între linii de tranzacție și linii de subtotal.

## Decizia

Adăugăm un al doilea flux de extragere: **PDF rendering → vision AI direct**, care vede structura originală.

Fluxul nou nu înlocuiește integral pe cel vechi — apare doar pentru utilizatorii care folosesc resurse proprii (cheie API externă), pentru a proteja cota limitată a cheii Dosar AI built-in (20 cereri/zi).

## Matricea provider × flux

| Provider activ (`getAiConfig().type`) | Buton AI afișat | Flux la click |
|---|---|---|
| `external` (cheie API proprie) | „Trimite extras la AI" | **Vision-direct nou:** render pagini PDF → vision AI multi-image |
| `builtin` (Dosar AI) | „Re-analizează cu AI" | OCR text → `mapStatementWithAi` (flux actual, neschimbat) |
| `local` | „Re-analizează cu AI" | OCR text → `mapStatementWithAi` (flux actual, neschimbat) |
| `none` | (niciun buton AI) | doar parser local determinist |

Parser-ul local determinist rulează întotdeauna primul (rapid, gratis, offline). Butonul AI apare ca opțiune secundară — automat dacă parserul a returnat 0 rânduri, sau manual oricând pentru re-analiză.

Privacy: extrasul nu conține `private_notes` (acel câmp e doar pe `Document`, nu pe `transactions`), deci regulile din `.claude/rules/ai-privacy.md` se respectă din construcție.

## Strategie multi-pagini (vision-direct)

Extrasele bancare au tipic 2–10+ pagini. Strategia:

1. **Prima încercare:** randează toate paginile (`renderAllPdfPagesAsBase64`), trimite-le într-o singură cerere multi-image. AI-ul vede totalurile și header-ele → evită dublarea subtotalurilor ca tranzacții.
2. **Fallback la depășire context** (eroare HTTP 413 sau 400 cu mesaj despre `context length` / `max_tokens` / `payload too large`): split paginile în chunks de 3, apel secvențial, merge `ParsedRow[]` cu deduplicare pe cheia `(date, amount, description.slice(0, 40))`.
3. **Progress feedback:** `parsingStage` afișează:
   - „Se randează paginile PDF…" în timpul render-ului
   - „Se trimite la AI vision…" la single-shot
   - „Se trimite la AI vision (pagina 2/4)…" la mod chunked

Eroarea de overflow se detectează în `aiProvider.ts` parsând body-ul răspunsului non-OK pentru pattern-uri cunoscute; o aruncăm ca clasă `AiContextOverflowError` ca să o pot prinde specific în mapper.

## Componente

### Cod nou

**`services/aiStatementVisionMapper.ts`**
Public:
```ts
export async function mapStatementWithVisionAi(
  pdfUri: string,
  defaultCurrency?: string
): Promise<PdfParseResult>
```
Pași:
1. `renderAllPdfPagesAsBase64(pdfUri)` → `string[]` base64 JPEG.
2. Build prompt vision (system identic în spirit cu `aiStatementMapper.ts`, dar referă imaginea în loc de text OCR).
3. `sendAiRequestWithImage(systemPrompt, userText, images, 'image/jpeg', maxTokens)` (extins să accepte `string | string[]`) cu retry strategy multi-pagini descrisă mai sus.
4. Parsare JSON identică cu `aiStatementMapper.ts` (refolosesc `parseResponse` extras într-un helper partajat dacă e cazul).
5. Merge cu deduplicare la mod chunked.
6. Returnează `PdfParseResult` cu warning explicit: „Extras analizat direct cu AI vision — verifică tranzacțiile cu atenție."

### Cod modificat

**`services/aiProvider.ts`**
- `sendAiRequestWithImage` → acceptă `imageBase64: string | string[]`. Când e array, body-ul `messages[].content` are mai multe `{ type: 'image_url', ... }` blocks plus textul.
- Pentru `type === 'local'`: aruncă `Error('Modelul local nu suportă vision. Folosește OCR + AI text sau setează o cheie API proprie.')` în loc de fallback silent (regresia de comportament e intenționată — nu mai vrem fallback ascuns).
- Adaug clasa `AiContextOverflowError extends Error` și logica de detecție în branch-ul `!response.ok`.

**`app/(tabs)/entitati/cont/import.tsx`**
- La start (în `useEffect`): citește `getAiConfig()` în state local `aiProviderType`.
- Înlocuiește butonul existent „Trimite la AI / Re-analizează cu AI" cu un derivat din provider:
  - `external` → buton cu eticheta „Trimite extras la AI" + handler nou care apelează `mapStatementWithVisionAi(pickedUri, account.currency)`.
  - `builtin` / `local` → buton existent neschimbat (handler `tryAiFallback` actual).
  - `none` → niciun buton.
- La eroare vision-direct (alta decât consent / config), oferă un Alert cu opțiunea explicită de fallback la OCR + AI text doar dacă userul confirmă (un singur buton „Încearcă cu OCR + AI").
- `setUsedAi(true)` și sursa în card devine „PDF + AI vision".

**`app/(tabs)/setari.tsx`** (sub cardul „Asistent AI", linia ~1183)
- Citește `visibleEntityTypes` din `useVisibilitySettings`.
- Dacă `visibleEntityTypes.includes('financial_account')`: render un sub-paragraf cu textul:
  > Import extras bancar:
  > • Fără AI / Dosar AI / Model local: OCR + AI text.
  > • Cu cheie API proprie: PDF trimis direct la AI vision (mai precis).
- Sub paragraf: link „Cum funcționează →" care deschide cu `Linking.openURL` o constantă nouă `FINANCE_AI_IMPORT_URL` adăugată în `constants/AppLinks.ts`, definită ca `` `${SITE_URL}/gestiune-financiara.html#ai-import` ``. Pattern identic cu `SUPPORT_URL` / `PRIVACY_URL` deja folosite în setari.tsx.
- Stilul: `palette.textSecondary`, font 12, padding identic cu rândurile existente. Fără card separat — coadă la cardul „Asistent AI".

**`components/OnboardingWizard.tsx`** (pasul EXPENSES)
- Sub toggle-ul „Activează evidența cheltuielilor", când acesta e bifat, afișez un mic note:
  > ℹ️ Pentru import extras mai precis (PDF direct la AI), poți seta o cheie API proprie din Setări → Asistent AI după onboarding.
- Stil: text mic, `palette.textSecondary`, fără buton — informativ pur.

**`docs/gestiune-financiara.html`**
- Secțiune nouă cu ancora `id="ai-import"`, titlu „Cum extragem tranzacțiile din extras".
- Explică cele 3 moduri:
  1. Parser local (rapid, offline, simplu).
  2. OCR + AI text (Dosar AI / model local) — bine pentru extrase clasice, dar poate confunda subtotaluri.
  3. AI vision direct (cheie API proprie) — vede documentul ca imagine, mai precis pe extrase complexe.
- Tabel comparativ scurt: precizie, cost (token-i), offline?, tip provider necesar.
- Link în jos către `support.html` FAQ.

**`docs/support.html`**
- FAQ nou: „De ce extrasul meu pare dublat la import?" → răspuns scurt + link `gestiune-financiara.html#ai-import`.

### Tests

**`__tests__/unit/aiStatementVisionMapper.test.ts`** (nou)
- Mock `sendAiRequestWithImage` și `renderAllPdfPagesAsBase64`.
- Test 1: răspuns valid cu 5 tranzacții → returnează `ParsedRow[]` corect, format=`generic`, warning standard.
- Test 2: răspuns gol `{ rows: [] }` → returnează rows=[] cu warning explicit.
- Test 3: prima cerere aruncă `AiContextOverflowError` → mapper-ul face split în chunks, apel per chunk, merge cu deduplicare. Verific apelurile la `sendAiRequestWithImage` (numărul corect, fiecare cu chunk corect).
- Test 4: deduplicare — două chunks returnează aceeași tranzacție (date+amount+desc) → apare o singură dată în rezultatul final.

**`__tests__/unit/aiProvider.test.ts`** (extinde dacă există, altfel skip)
- Test: `sendAiRequestWithImage` cu array de 3 imagini → body-ul fetch-ului conține 3 blocks `image_url`.
- Test: `sendAiRequestWithImage` pe provider `local` → aruncă eroare (nu mai face fallback silent).

## Out of scope

- Vision pentru modele locale (LLaVA / Llama 3.2 Vision GGUF). Necesită modificări în `localModel.ts` + un toggle UI separat. Lăsat pentru viitor.
- Auto-categorizare îmbunătățită prin vision (AI-ul vede icon-ul comerciantului etc.). Folosim `suggestCategory` existent pe rezultatul AI.
- Sumarizare extras / insights („cheltuieli neobișnuite"). Spec separat.
- Persist setting „prefer vision când disponibil" — implicit on pentru `external`, fără opt-out (simplitate).

## Risk register

| Risc | Mitigare |
|---|---|
| Modelul user-set nu suportă vision (ex. `mistral-tiny`) | Eroare HTTP clară din provider → Alert cu mesaj și fallback la OCR + AI dacă userul confirmă |
| Cost token mare per extras (10+ pagini × ~500 KB base64) | Randare la scale 1.5 (nu 2.0) pentru a reduce dimensiunea per pagină. Fără plafon hard pe nr. pagini — strategia e „toate într-o cerere → fallback chunked la overflow". Pentru extrase >15 pagini afișez warning informativ înainte de trimitere. |
| Rate-limit pe provider extern | Lăsăm eroarea HTTP 429 să bubble-up cu mesaj clar — userul reîncearcă |
| Model returnează JSON invalid | `parseResponse` existent ignoră silent, `warnings` afișează „AI nu a returnat tranzacții valide" — comportament identic cu fluxul actual |
| Deduplicarea elimină tranzacții reale identice (ex. 2 plăți de 50 RON la același comerciant în aceeași zi) | Cheia de dedup include `description.slice(0, 40)` — dacă descrierile sunt identice e probabil dublură de chunk overlap. Acceptăm fals negative rare; warning în UI dacă nr. tranzacții după dedup ≠ suma chunks. |
