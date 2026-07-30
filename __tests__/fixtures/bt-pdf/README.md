# Fixtures extrase BT PDF (anonimizate)

Text extras din **extrase BT reale** (iunie 2026, cont RON + cont EUR), anonimizat
cu `anonymize.py`: nume de persoane, ID client, IBAN-uri personale, REF-uri, RRN-uri,
numere de card și un merchant medical au fost înlocuite. **Sumele, datele și structura
liniilor sunt identice byte-cu-byte cu originalul** (scriptul face assert pe semnătura
sumelor), deci fixture-urile reproduc fidel layout-ul real:

- data apare o dată pe zi (header de zi), urmată de mai multe tranzacții;
- fiecare tranzacție: tip operațiune + descriere pe 2–4 linii + `REF:` + suma pe linie proprie;
- rânduri de sumar `RULAJ ZI` / `SOLD FINAL ZI` / `RULAJ TOTAL CONT` cu sumele pe liniile următoare;
- header de pagină repetat care rupe o tranzacție la granița de pagină (cazul OMV, pag. 7→8);
- pe extrasul EUR, descrierile conțin „CURS … RON ECHIVALENT LEI …" (capcana de valută).

`expected.json` conține ground truth extras automat din extras: număr tranzacții
(= numărul de linii `REF:`), rulaj total debit/credit, sold final și rulajul pe
fiecare zi — parserul BT trebuie să reconcilieze exact cu aceste valori.

## Regenerare

1. Extrage textul din PDF-ul real cu PyMuPDF (`page.get_text()`, paginile concatenate).
2. Rulează `python3 anonymize.py` în folderul cu fișierele `.txt` sursă
   (vezi constantele `SRC_*` din script).
3. Verifică output-ul: `leftover: NONE` și semnătura sumelor neschimbată (assert).

**Nu commitui niciodată PDF-ul real sau textul ne-anonimizat.**
