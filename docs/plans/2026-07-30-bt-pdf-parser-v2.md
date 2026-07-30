# Parser BT PDF v2 + reconciliere — plan de implementare

**Spec:** `docs/specs/2026-07-30-bt-pdf-parser-v2-design.md` — citește-l întâi; conține
faptele despre layout-ul BT și deciziile D1–D6. Acest plan e pas-cu-pas și autosuficient
pentru implementare.

**Reguli pentru sesiunea de implementare:**

- Încarcă skill-ul `bank-parser-pattern` înainte de a edita `services/bankStatement*.ts`
  și `rn-expo-conventions` înainte de orice TSX.
- Nu atinge: schema DB, parserul CSV, `services/ai*`, `services/ocr.ts`, `services/pdfOcr.ts`
  (doar apelurile către ele unde e specificat).
- Nu commitui PDF-uri reale sau text ne-anonimizat. Fixture-urile există deja în
  `__tests__/fixtures/bt-pdf/` — nu le regenera, nu le modifica.
- Fiecare pas se încheie cu testele lui verzi înainte de următorul.
- La final: `npm run check` complet verde + pașii de acceptanță de la sfârșit.

---

## Pas 1 — `services/pdfTextLayer.ts`: extractor pur cu poziții

Mută din `services/pdfExtractor.ts` tot ce e pur (fără Expo): `parsePdf`, `buildObjMap`,
`buildToUnicodeMaps`, `buildFontGlyphMaps`, `parseToUnicodeCMap`, `decodeHexStr`,
`decodeStr`, `decodePdfStr`, `decodeAscii85`, conversiile bytes↔string, `isPdfFile`.
Fișierul nou **nu importă nimic din Expo** (trebuie să ruleze și în Node pentru scriptul
de la Pas 5). `pako` se importă cu `import pako from 'pako'` (nu `require`).

Rescrie `extractTextOps` → `parseContentStreamPositioned(content, fontMaps)` care
returnează `PositionedLine[] = { y: number; spans: { x: number; text: string }[] }[]`:

- Urmărește starea text: `Tm a b c d e f` → poziția curentă `(e, f)`; `Td tx ty` /
  `TD tx ty` → translatare față de începutul liniei text curente (`TD` setează și `TL`);
  `T*` → `Td 0 -TL`; `TL v` → leading. La `BT` starea se resetează.
- La fiecare operator de text (`Tj`, `'`, `"`, `TJ`) emite un span la poziția curentă cu
  textul decodat prin glyph map-ul fontului curent (`Tf` — logica existentă). Nu calcula
  lățimi de glife; un operator = un span.
- Grupare: span-urile cu `|y1 − y2| ≤ 2` aparțin aceleiași linii. Liniile se sortează
  descrescător după `y` **per pagină/stream** (nu global — stream-urile se procesează în
  ordinea din document, ca acum), span-urile crescător după `x`.
- Serializare în `parsePdf`: liniile unite cu `\n`, span-urile unei linii unite cu un
  singur spațiu. Elimină normalizarea veche `.replace(/[ \t]{2,}/g, ' ')` pe tot
  documentul (aplic-o per linie dacă e nevoie). Nu mai folosi euristica „kerning < −100
  ⇒ spațiu".

Parserul regex de operatori existent (`opRe`) trebuie extins la operatorii de poziție —
atenție că `TJ`/`Tj` rămân cum sunt; adaugă alternanțe pentru
`([-\d.]+)\s+([-\d.]+)\s+T[dD]`, `T\*`, `([-\d.]+)\s+TL`,
`(şase numere)\s+Tm`. Ignoră `Tc/Tw/Tz/Ts/Tr` (irelevante aici).

**Test nou `__tests__/unit/pdfTextLayer.test.ts`** (test-pairing îl cere) cu content
stream-uri scrise de mână:

1. două `Td` cu y diferit → două linii în ordinea corectă;
2. `Tm` care repoziționează deasupra → liniile ies sortate după y, nu după ordinea din stream;
3. `TJ` cu array + kerning → un singur span text corect;
4. două span-uri pe același y (coloane) → o linie, ordonate după x, separate cu spațiu;
5. `T*` cu `TL` setat → linie nouă.

## Pas 2 — `services/pdfExtractor.ts`: pipeline text-layer-first

`pdfExtractor.ts` rămâne orchestratorul cu Expo și importă din `pdfTextLayer.ts`.
Semnătura nouă:

```ts
export interface PdfExtractionResult {
  text: string;
  source: 'text-layer' | 'ocr';
  warnings: string[];
}
export async function extractTextFromPdf(fileUri: string): Promise<PdfExtractionResult>;
```

Logica: citește base64 → `parsePdf` → dacă trece **quality gate-ul**, întoarce
`source: 'text-layer'`; altfel OCR (fluxul existent `extractTextFromPdfViaOcr`), cu
warning „S-a folosit OCR — verifică cu atenție" și, dacă `pageCount > MAX_PAGES`,
warning explicit „Doar primele 10 pagini au fost procesate (extrasul are N)".

Quality gate în `pdfTextLayer.ts` (pur, testat): `isUsableExtraction(text)` — minim
10 linii nevide și minim 3 linii care conțin o sumă (`/\d[\d.,]*[.,]\d{2}/`) sau o dată.

Actualizează **toate** call site-urile `extractTextFromPdf` (grep: `app/conturi/import.tsx`,
fluxul de re-analiză — caută `reanalyze`/`extractTextFromPdf` în `app/` și `services/`) la
noua semnătură; warnings-urile din extracție se concatenează cu cele din parser în UI.

## Pas 3 — `services/bankStatementPdfParser.ts`: parseBt v2

Rescrie complet `parseBt` conform D3/D4 din spec. Schelet:

1. **Header:** titular = linia imediat anterioară liniei `/^Client:/`; valuta =
   `/\bCONT\s+\d{3}([A-Z]{3})CRT/` (fallback `defaultCurrency`); IBAN cont =
   `/^Cod IBAN:\s*(\S+)/`.
2. **Clasificator de linii** (în ordinea asta): linie-dată (`/^\d{2}[./]\d{2}[./]\d{4}$/`),
   linie-sumă (`/^\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/` după trim — folosește `normalizeAmount`),
   linie `REF:` (`/^REF:\s*(\S+)/`), marker sumar (`RULAJ ZI`, `SOLD FINAL ZI`,
   `RULAJ TOTAL CONT`, `SOLD FINAL CONT`), stop (`SUME BLOCATE`, `TOTAL DISPONIBIL`,
   `Acest extras de cont`), header pagină (set de linii exacte: `BANCA TRANSILVANIA`,
   `Info clienti:`, linia de telefon, `Solicitant: …`, `Tiparit: …`,
   `BANCA TRANSILVANIA S.A. …`, `/^\d+ \/ \d+$/`, `Data`, `Descriere`, `Debit`,
   `Credit`), altfel linie-descriere.
3. **State machine:** blocul curent acumulează linii-descriere; linia-sumă îi setează
   `amount` (dacă nu are), `REF:` îi setează `reference`; blocul se închide când are
   ambele **și** urmează o linie-descriere/dată/sumar (adică începe altceva). Marker de
   sumar → închide blocul forțat și consumă liniile-sumă aferente (2 pentru RULAJ,
   1 pentru SOLD) pentru reconciliere. Header-ele de pagină se sar fără a închide blocul
   (cazul OMV: descriere → sumă → header pagină → restul descrierii → REF). Linie-sumă
   orfană (fără bloc deschis și fără marker) → warning, ignorată.
4. **Semn** conform D4 (lexicon → P2P cu titular → schimb valutar cu IBAN → ambiguu),
   apoi **reconciliere pe zi** cu fix-up brute-force pe ambigue (cap 10/zi) și warnings
   pentru zilele care nu bat.
5. **Rând:** `date` = data zilei curente (ISO), `amount` semnat, `currency` = valuta
   contului, `description` = liniile blocului unite cu spațiu (fără linia REF),
   `reference` = REF-ul, `merchant` = euristică: pentru POS, textul de după
   `TID:<cod>` până la primul `;`, `valoare tranzactie`, `RRN:` sau șir de ≥6 cifre,
   max 4 cuvinte; pentru transferuri, contrapartea; `category_key` = `suggestCategory`.
6. **Reconciliation în rezultat** — extinde tipurile exact ca în D5.
7. `parseGeneric` și `detectStatementFormat` rămân neschimbate.

## Pas 4 — teste fixture-based (`__tests__/unit/bankStatementPdfParser.test.ts`)

Șterge testele BT sintetice existente (formatul lor nu există în realitate). Păstrează
testele pentru `detectStatementFormat` și `parseGeneric`. Adaugă, încărcând fixture-urile
cu `fs.readFileSync` și `expected.json`:

**RON (`bt-extras-ron-2026-06.txt`):**

- `rows.length === 84` și `reconciliation.refCount === 84`;
- suma debitelor = −97.423,94 ±0,01; suma creditelor = +99.246,10 ±0,01;
- toate cele 24 de zile au `ok === true`; `totals.ok === true`;
- niciun `description` nu conține `RULAJ`, `SOLD` sau `BANCA TRANSILVANIA`;
- toate rândurile au `currency === 'RON'` și `reference` setat;
- spot-checks: rambursarea de credit din 2026-06-05 e **−579.95** și dobânda **−261.15**
  (nu +9.579,95 ca azi); încasarea din 2026-06-02 e **+3.926,10** iar comisionul ei
  **−5,00** cu **același `reference`** (REF partajat — nu dedupa); P2P trimis din
  2026-06-02 e **−7.600,00**, P2P primit **+205,00**; tranzacția OMV ruptă la granița
  de pagină există cu **−492,23** pe 2026-06-30; rândul LIDL din 2026-06-06 are
  `category_key === 'food'`;
- consistență internă `expected.json`: pentru zilele 2+,
  `sold_final(zi) = sold_final(zi precedentă) + credit − debit` ±0,01.

**EUR (`bt-extras-eur-2026-06.txt`):**

- exact 3 rânduri, **toate cu `currency === 'EUR'`** (capcana „ECHIVALENT LEI");
- schimbul valutar e **+20,00** (contul debitat e cel de RON, deci aici e intrare),
  plata Hetzner **−15,08**, comisionul **−0,48**; reconciliere ok.

## Pas 5 — `scripts/parse-real-pdf.ts` + npm script `parse:pdf`

Script Node (`node --experimental-strip-types`), stil `scripts/build-privacy-html.ts`:
primește o cale locală de PDF, citește base64 cu `node:fs`, rulează `parsePdf` din
`services/pdfTextLayer.ts` + `parseStatementPdf`, tipărește: sursa extracției, număr
rânduri, venituri/cheltuieli, raportul de reconciliere pe zile (✓/✗ cu diferențe),
primele 10 rânduri și warnings. Importă **doar** module pure (fără Expo) — dacă nu
compilează în Node, structura din Pas 1 e greșită.

## Pas 6 — UI import (`app/conturi/import.tsx` + componentă nouă)

- Adaptează la noua semnătură `PdfExtractionResult` (afișează și warnings de extracție).
- Componentă nouă `components/ImportReconciliationCard.tsx` (sub 250 de linii, tokens
  din `Colors[scheme]`, text RO): stare verde — „Extras BT verificat: 84 tranzacții ·
  debit 97.423,94 ✓ · credit 99.246,10 ✓"; stare galbenă — zilele nereconciliate cu
  diferențele, mesaj „Verifică manual sau trimite la AI". Randată doar când
  `reconciliation` există.
- Când reconcilierea pică, butonul AI existent primește vizibilitate (același buton,
  poziționat sub card). Auto-fallback-ul AI rămâne doar pe `rows.length === 0`.

## Pas 7 — docs + finalizare

- `docs/ARCHITECTURE.md`: rând nou în tabelul de servicii pentru `pdfTextLayer.ts`;
  actualizează descrierea pipeline-ului de import (text-layer first).
- `docs/IDEAS.md`: marchează itemul „Parser BT PDF v2" ca implementat, cu data.
- `npm run check` complet verde.

## Acceptanță (definiția lui „done")

1. `npm test` verde, inclusiv noile teste fixture-based (84/84, reconciliere exactă).
2. `npm run check` verde integral.
3. `npm run parse:pdf -- ~/Downloads/"Iunie 2026.pdf"` (PDF-ul real, local) afișează:
   `source: text-layer`, **84 tranzacții**, debit **97.423,94**, credit **99.246,10**,
   **24/24 zile reconciliate ✓**. Același lucru pentru `"Iunie 2027.pdf"` (contul EUR):
   3 tranzacții EUR, 15,56 / 20,00, reconciliat.
4. Verificare UI pe iOS Simulator: ecranul de import cu un PDF real arată cardul de
   reconciliere verde. Dacă simulatorul nu e disponibil, spune explicit „nu am verificat UI".
5. Niciun fișier cu date personale reale adăugat în repo (`git status` curat de PDF-uri).
