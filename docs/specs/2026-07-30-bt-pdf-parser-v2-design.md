# Parser BT PDF v2 + reconciliere — design

**Data:** 2026-07-30
**Status:** aprobat pentru implementare (plan: `docs/plans/2026-07-30-bt-pdf-parser-v2.md`)

## Problema

Testat pe extrase BT reale (iunie 2026, cont RON 8 pagini / 84 tranzacții + cont EUR):
parserul actual `parseBt` din `services/bankStatementPdfParser.ts` produce date complet
greșite, **fără niciun warning**:

| | Extrasul real | Ce produce aplicația azi |
|---|---|---|
| Tranzacții | 84 | 83 (include rânduri „RULAJ ZI", exclude tranzacții reale) |
| Venituri | +99.246,10 | **+364.210,90** |
| Cheltuieli | −97.423,94 | **−116.513,40** |

Cauze (verificate rulând codul real pe extrasul real):

1. **Mismatch de layout.** `parseBt` presupune „dată + descriere + sumă pe aceeași linie".
   Extrasul BT real are data **o dată pe zi** (header de zi), apoi mai multe tranzacții,
   fiecare cu descriere pe 2–4 linii, `REF:` pe linie proprie și suma pe linia ei.
   Debit vs credit sunt coloane (informație pozițională). Parserul agregă zile întregi,
   ia sume din interiorul descrierilor („valoare tranzactie: 290.00 RON") și tratează
   datele din descrieri („EPOS 01/06/2026") ca început de tranzacție.
2. **Eșec silențios.** Întoarce >0 rânduri plauzibile ⇒ UI afișează „Format detectat: BT"
   fără warnings și fallback-ul AI (condiționat de `rows.length === 0`) nu se declanșează.
3. **Extracția aruncă structura.** Pipeline-ul e OCR-first (150 dpi, max 10 pagini, tăiere
   silențioasă) chiar și pentru PDF-uri digitale; fallback-ul text (`parsePdf`) decodează
   corect text layer-ul BT (verificat: 22.634 caractere complete) dar emite **7 newlines
   în tot documentul** și lipește cuvintele — inutilizabil pentru un parser pe linii.
4. **Valuta.** Pe extrasul EUR, `detectCurrency` per linie vede „CURS 5.2328 RON" în
   descriere și marchează tranzacții EUR ca RON.
5. **Fixture-urile de test sunt sintetice** (un format pe care BT nu-l produce), deci
   testele trec în timp ce realitatea pică.

## Oportunitatea care schimbă designul

Extrasul BT conține propriile totaluri de control: `RULAJ ZI` (debit + credit pe zi),
`SOLD FINAL ZI`, `RULAJ TOTAL CONT`. Un parser corect se poate **auto-verifica matematic
la ban** și poate raporta exact ziua care nu se reconciliază. Validat pozițional pe
extrasul real: debitele reconciliază exact (97.423,94), creditele după excluderea
footer-ului (`TOTAL DISPONIBIL` / `Fonduri proprii`).

Aliniat cu principiul proiectului: cifrele afișate sunt exacte sau declarat lipsă —
niciodată plauzibile-dar-greșite.

## Decizii de design

### D1. Text layer first, OCR doar fallback

`extractTextFromPdf` încearcă întâi parserul de text layer (redenumit/mutat în
`services/pdfTextLayer.ts`, pur, fără importuri Expo). Un **quality gate** decide dacă
rezultatul e utilizabil (minim 10 linii și minim 3 linii cu pattern de sumă sau dată);
dacă nu, cade pe OCR (fluxul existent). PDF-urile generate de bănci au text layer
perfect — OCR-ul rămâne pentru scanuri/poze. Semnătura devine
`{ text, source: 'text-layer' | 'ocr', warnings: string[] }` (include warning când
PDF-ul are peste `MAX_PAGES` pagini la OCR — azi tăierea e silențioasă).

### D2. Extractor cu poziții → linii în ordinea de citire

`parsePdf` urmărește operatorii de poziționare din content stream (`Tm`, `Td`, `TD`,
`T*`, `TL`) pe lângă cei de text (`Tj`, `'`, `"`, `TJ`), colectează span-uri `{x, y, text}`,
le grupează pe linii după `y` (toleranță ±2 unități), sortează liniile descrescător după
`y` și span-urile crescător după `x`, apoi emite linii separate cu `\n` și span-uri unite
cu spațiu. Nu calculăm lățimi de glife — ordinea și separarea pe linii sunt suficiente;
funcția de grupare e pură și testabilă (`parseContentStreamPositioned`).

### D3. Parser BT v2 — state machine ancorată în REF + sumă

O tranzacție = bloc de linii care se închide când are **și** linie `REF:` **și** linie-sumă
(linie care conține doar o sumă). Ordinea REF/sumă poate varia (la granițe de pagină suma
apare înaintea REF-ului — cazul real OMV). Structura de zi:

- linie doar-dată `DD/MM/YYYY` → setează data curentă;
- `RULAJ ZI` → consumă următoarele 2 linii-sumă (debit, credit) pentru reconciliere;
- `SOLD FINAL ZI` → consumă 1 linie-sumă;
- `RULAJ TOTAL CONT` / `SOLD FINAL CONT` → totaluri; parsarea se oprește la
  `SUME BLOCATE` / `TOTAL DISPONIBIL` / „Acest extras de cont este valabil";
- header-ele de pagină repetate (BANCA TRANSILVANIA … Data/Descriere/Debit/Credit,
  marker `N / M`) se elimină, inclusiv când cad în mijlocul unui bloc.

Din header se extrag: **titularul** (linia dinaintea `Client:`), **valuta contului**
(`CONT \d{3}([A-Z]{3})CRT`) și **IBAN-ul contului** (`Cod IBAN: …`). Toate rândurile
primesc valuta contului — fără detecție per linie (elimină capcana „ECHIVALENT LEI").
Data tranzacției = data zilei din extras (data de decontare); data de utilizare a
cardului rămâne în descriere. Un REF poate fi partajat de 2 tranzacții (operațiune +
comisionul ei) — dedup pe REF simplu e interzis.

### D4. Semn în două trepte: lexicon + reconciliere

**Treapta 1 — lexicon determinist** pe tipul operațiunii (prima linie a blocului):

- debit: `Plata…`, `Comision…`, `Rambursare…`, `Dobanda…`, `Retragere…`, `Nota contabila…`
- credit: `Incasare…`
- `Transfer intern`: „din economii / de la economii" → credit; „catre/la/spre economii,
  constituire depozit" → debit; altfel ambiguu
- `P2P BTPay`: destinatarul din „catre <NUME> reprezentand" comparat cu titularul
  (case/spații-insensitive, pe token-uri) → egal = credit, diferit = debit
- `Schimb valutar`: „Cont debitat: <IBAN>" ≠ IBAN-ul contului curent → credit, altfel debit
- restul → ambiguu

**Treapta 2 — reconciliere pe zi.** Pentru fiecare zi comparăm suma debitelor/creditelor
cu `RULAJ ZI`. Dacă nu bate și există tranzacții ambigue (≤ 10 pe zi), căutăm atribuirea
de semne care reconciliază (brute force ≤ 2¹⁰); soluție unică → aplicată; zero sau mai
multe → ziua e marcată nereconciliată, ambiguele primesc fallback `applyDirectionHint`,
și emitem warning explicit cu ziua și diferența.

### D5. Reconcilierea e output de prim rang

`PdfParseResult` primește `reconciliation?: { days: [{date, expectedDebit, expectedCredit,
actualDebit, actualCredit, ok}], totals: {…, ok}, transactionCount, refCount }`.
UI-ul de import afișează un card de reconciliere: verde „84 tranzacții · debit
97.423,94 ✓ · credit 99.246,10 ✓" sau galben cu lista zilelor care nu bat + îndemn la
verificare manuală / AI. Butonul AI existent devine proeminent când reconcilierea pică.
Auto-fallback-ul AI rămâne pe `rows.length === 0` (repararea pe zile cu AI e etapă
separată, vezi IDEAS).

### D6. Fixtures reale + script de verificare pe PDF-uri locale

- Fixtures anonimizate din extrasele reale în `__tests__/fixtures/bt-pdf/`
  (`bt-extras-ron-2026-06.txt`, `bt-extras-eur-2026-06.txt`, `expected.json` cu rulaj
  pe fiecare zi; vezi README-ul din folder). Testele fixture-based cer reconciliere
  exactă — 84/84 tranzacții, totaluri la ban.
- `scripts/parse-real-pdf.ts` (`npm run parse:pdf -- <cale.pdf>`): rulează extractor +
  parser pe un PDF local și tipărește raportul de reconciliere. E instrumentul de
  verificare pe date reale **fără** a le commitui, și definiția lui „done".

## Ce NU facem în această etapă

- Reparare AI pe zilele nereconciliate (buclă agentică) — etapă separată.
- Modificări la parserul CSV, la OCR (ML Kit) sau la mapper-ele AI existente
  (limita de 15.000 caractere a `aiStatementMapper` rămâne cunoscută, netratată aici).
- Schema DB neatinsă — zero migrații.
- Bugete/notificări (IDEAS #12–13) — independent de parser.
