# Hardening: guard SQL, limitare PIN, validare backup

Trei constatări din trecerea de securitate. (#1, cheia Mistral inclusă în bundle, rămâne
în afara acestui plan: cere rotirea cheii și infrastructură de proxy, decizie a userului.)

---

## Pas 1 — Guard SQL fail-closed (RIDICAT)

**Defect.** `validateAndNormalizeSql` extrage numele de tabel cu
`/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/g` și validează **doar ce reușește să extragă**.
Un identificator citat nu se potrivește, deci nu se validează nimic:
`SELECT * FROM "chat_messages"`, `[chat_messages]` și `` `chat_messages` `` trec toate.
Fail-open, exact invers față de ce trebuie să facă un guard.

Al doilea defect, descoperit la analiză: la `FROM a, b` se verifică doar `a`.

**Fix.**

1. După eliminarea literalilor șir, normalizează citarea identificatorilor:
   `"x"`, `[x]`, `` `x` `` → `x`. (Literalii cu apostrof sunt deja eliminați, deci ce
   rămâne între ghilimele duble e identificator, nu șir.)
2. Extragere fail-closed: după fiecare `FROM`/`JOIN`, ținta trebuie să fie **ori** `(`
   (subquery — al cărui `FROM` interior e verificat separat), **ori** o listă de
   identificatori separați prin virgulă, fiecare tabel permis sau nume de CTE.
   Orice altceva → respingere, inclusiv cazul „n-am putut parsa".

**Acceptanță:** cele trei forme citate sunt respinse; `FROM transactions, expense_categories`
validează ambele tabele; `FROM a, "chat_messages"` respins; subquery-urile și CTE-urile
existente continuă să treacă; toate SQL-urile din few-shot rămân valide.

## Pas 2 — Limitare încercări PIN (MEDIU)

**Defect.** `useAppLock.unlockWithPin` compară și returnează. Fără contor, fără blocare,
fără întârziere. PIN de 4–8 cifre.

**Fix.** Contor de eșecuri + blocare temporară, persistate în SecureStore (nu în state, ca
să nu se reseteze la repornirea aplicației). Prag: 5 încercări greșite, apoi blocare
escaladată — 30s, 1m, 5m, 15m, 1h. Succesul resetează contorul. Biometria rămâne
disponibilă în timpul blocării: ea are deja limitarea proprie a sistemului, iar blocarea
noastră țintește ghicirea PIN-ului.

UI: `AppLockScreen` afișează timpul rămas și dezactivează butonul cât e blocat.

**Acceptanță:** teste pe logica de blocare (prag, escaladare, reset la succes,
persistență); screenshot cu starea blocată.

**Notă onestă de scop:** asta îngreunează ghicirea PIN-ului prin UI. NU protejează baza
SQLite, care rămâne necriptată pe disc — cine are acces la filesystem citește direct,
fără PIN. Criptarea bazei e o discuție separată.

## Pas 3 — Validare backup la import (MEDIU)

**Defect.** `importBackup` face `JSON.parse` și apoi cast-uri TypeScript
(`a.name as string`) care la runtime nu verifică nimic. Proiectul folosește Zod pentru
răspunsurile AI, dar nu pentru singurul fișier care intră din exterior.

**Fix.** Schemă Zod pentru payload, validată înainte de orice scriere. Reguli:

- Colecțiile lipsă sunt tratate ca liste goale (backup-uri vechi rămân importabile).
- Elementele individuale invalide sunt **sărite și raportate** în `errors`, nu abandonează
  tot importul — comportamentul actual per-element se păstrează.
- Tipurile greșite sunt respinse, nu coerciate tăcut: un `initial_balance: "abc"` e o
  eroare vizibilă, nu un 0 inventat.

**Acceptanță:** test cu backup valid (neschimbat față de azi); test cu câmp de tip greșit
(element sărit, eroare raportată, restul importat); test cu colecție lipsă; test că
importul nu scrie nimic când `app`/`version` nu se potrivesc.

## Pas 4 — Verificare

`npm run check` verde. Diff atinge `components/` → screenshot pe simulator.
