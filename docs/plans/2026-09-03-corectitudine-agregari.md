# Corectitudine agregări: valută, restituiri, sold, potrivire transferuri

Patru defecte din aceeași familie: **produc cifre greșite fără să semnaleze nimic**.

Decizii luate cu userul: se repară toate patru; restituirile **scad cheltuiala** pe
categoria lor.

---

## Pas 1 — Valuta: nu mai aduna EUR peste RON

**Defect.** Peste tot se folosește `COALESCE(amount_ron, amount)` (11 locuri în
`transactions.ts`, `categories.ts`, `aiChatPrompt.ts`). Pentru o tranzacție non-RON cu
`amount_ron` NULL, expresia cade pe `amount` — suma brută în EUR — și o adună la totalul
în RON. Că NULL-ul e real o dovedește `countMissingRates()` (`transactions.ts:964`), care
există exact ca să numere cazul.

**Fix.** Helper SQL unic: `CASE WHEN currency = 'RON' THEN amount ELSE amount_ron END`.
Non-RON fără curs → NULL → `SUM` îl sare. Rezultatul devine _incomplet și declarat_, nu
greșit și tăcut.

**Raportare.** Agregările întorc și `excluded_count` (tranzacții sărite din lipsă de curs).
Chatul îl afișează ca avertisment sub răspuns când e > 0. Fără el am înlocui o eroare
tăcută cu o subestimare tăcută — nu e un progres.

**Acceptanță:** test cu o tranzacție EUR fără `amount_ron` — nu intră în sumă și apare în
`excluded_count`; test că RON-ul e neschimbat; test că EUR cu `amount_ron` setat intră
convertit.

## Pas 2 — Restituirile scad cheltuiala

**Defect.** `is_refund` se scrie, dar nu e filtrat în nicio agregare. O restituire e
`amount > 0`, deci se contabilizează ca venit și lasă cheltuiala inițială neatinsă.

**Fix.** În agregările de cheltuieli, o tranzacție cu `is_refund = 1` intră cu semn opus pe
categoria ei (reduce cheltuiala) și **nu** intră la venituri. Cumperi 500, returnezi 100 →
categoria arată 400, veniturile 0.

**Acceptanță:** test pe `getMonthlySpending` și `getMonthlyTotals` cu perechea 500/-100;
test că o restituire fără categorie nu strică totalul general.

## Pas 3 — Sold curent

**Defect.** Nu există noțiunea de sold curent — doar `initial_balance`. Iar regula din
promptul de chat („exclude mereu transferurile interne") e **corectă la cheltuieli și
greșită la sold**: un transfer chiar scoate banii din contul sursă.

**Fix.** `getAccountBalance(accountId)` în `financialAccounts.ts`:
`initial_balance + SUM(mișcări)`, **incluzând** transferurile interne, excluzând
duplicatele, cu aceeași protecție valutară din Pasul 1. Sold pe valuta contului, nu în RON.
Template nou de chat `account_balance` + excepția explicită în regulile promptului.

**Acceptanță:** test că un transfer între două conturi scade soldul sursei și crește pe al
destinației; test că duplicatele nu contează; test că regula de excludere a transferurilor
NU se aplică la sold.

## Pas 4 — Potrivire transferuri cu comision și valută

**Defect.** `matchTransferCandidates` cere sume opuse la ±0.01, deci ratează transferul cu
comision (1000 ieșit / 995 intrat + 5 comision) și pe cel valutar (RON→EUR).

**Fix.** Două extinderi, ambele deterministe și locale (nimic la AI):

- **Comision:** ieșire potrivită cu intrare + tranzacții de comision din aceeași fereastră,
  dacă suma lor egalează ieșirea.
- **Valută:** când valutele diferă, se compară valorile convertite în RON prin `getRateRon`,
  cu toleranță pentru spreadul bancar (cursul băncii nu e cel BNR).

Potrivirile exacte rămân automate. Cele prin toleranță devin **sugestii de confirmat** prin
UI-ul existent (`sugestie-transfer/batch`) — un fals pozitiv automat ar ascunde venit real
din analize, iar asta e exact clasa de bug pe care planul o repară.

**Acceptanță:** fixture cu transfer + comision; fixture RON→EUR; test că o potrivire
ambiguă NU se aplică automat; test că plata la comerciant nu devine niciodată candidat.

## Pas 5 — Verificare

`npm run check` verde. Diff-ul atinge `app/`/`components/` → screenshot pe simulator.
