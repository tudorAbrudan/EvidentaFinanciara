# Chat — întrebări cu filtre pe perioadă, cont și categorie

**Problemă.** Chatul nu răspunde la întrebări de forma:

1. „În perioada 01–20.06.2026 câți bani am cheltuit pe carburant din contul X?"
2. „În luna mai pe ce am cheltuit cei mai mulți bani?"

**Cauze (două, independente):**

- **Prompt orb.** `buildSystemPrompt()` e static: nu conține conturile, categoriile,
  nici data curentă. Modelul inventează nume de cont și chei de categorie
  (`key = 'carburant'` în loc de `vehicle`), iar SQL-ul întoarce 0 rânduri —
  fără nicio eroare vizibilă, ceea ce e mai rău decât un refuz.
- **Template-uri lipsă.** Cele 9 existente nu acoperă „sumă pe filtre într-un interval
  arbitrar" (`monthly_total` e legat de o lună întreagă) și nici „pe ce am cheltuit"
  la nivel de categorie (`top_merchants` dă comercianți).

**Decizii luate cu userul:**

- Catalogul (conturi + categorii, doar nume/id/key, **fără sume**) se trimite în prompt.
- „Pe ce am cheltuit cei mai mulți bani" răspunde **și pe categorii, și pe comercianți**,
  în același mesaj.

---

## Pas 1 — Context live în prompt

`services/aiChatPrompt.ts`: `buildSystemPrompt(ctx)` și `buildMessages(ctx, history, q)`
primesc un `PromptContext` cu:

- `today` (ISO, `YYYY-MM-DD`),
- conturi active: `id | name | currency`,
- categorii active: `id | name | key`.

Reguli noi în prompt:

- Nu inventa id-uri sau chei: folosește **exclusiv** valorile din catalog.
- Potrivește numele din întrebare pe catalog tolerant (case-insensitive, fără diacritice,
  potrivire parțială); dacă nimic nu se potrivește → `cannot_answer` cu motivul.
- Intervale explicite → `t.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'`.
- Luni fără an se rezolvă față de `today`.

**Acceptanță:** test care verifică prezența în prompt a `today`, a numelor de conturi și a
perechilor `name|key` de categorii; și că **nu** apar sume/solduri/tranzacții.

## Pas 2 — Template `spend_total`

Sumă pe filtre arbitrare (categorie și/sau cont și/sau interval).
SQL: `SELECT SUM(...) AS total, COUNT(*) AS count`. Params: `label`, `period_label`,
`account_name`.
Text: „Pe **carburant** în **BT_curent_ron**, între **1 iun 2026** și **20 iun 2026**:
**X RON** din **N tranzacții**." Zero rânduri → mesaj explicit că nu există cheltuieli
pe acele filtre (nu „eroare").

**Acceptanță:** unit test pe formatter (cu/fără cont, cu/fără categorie, 0 rânduri).

## Pas 3 — Template `top_spending`

Un singur query, `UNION ALL` cu o coloană discriminator `dim` (`'category'` / `'merchant'`),
coloane `label`, `total`, `count`. Formatter randează două secțiuni: „Pe categorii" și
„De unde". Trece de `validateAndNormalizeSql` (UNION nu e keyword interzis; `LIMIT` final).

**Acceptanță:** unit test pe formatter (ambele secțiuni, doar una, zero rânduri) + test că
SQL-ul cu `UNION ALL` trece guard-ul nemodificat.

## Pas 4 — Înregistrare template-uri

`types/chat.ts` (`ChatTemplate`) și `services/aiSchemas.ts` (`TEMPLATES`) primesc
`spend_total` și `top_spending`. `formatResponse` capătă cele două `case`-uri —
switch-ul e exhaustiv, deci type-check-ul prinde orice omisiune.

## Pas 5 — Few-shot exact pe cele două întrebări

Exemplele din prompt folosesc **exact** formulările userului, ca ancoră.

## Pas 6 — `askAssistant` mută `loadCtx()` înainte de `buildMessages`

Azi contextul se încarcă abia după rularea SQL-ului (`aiChat.ts:141`). Se ridică la
începutul funcției și se refolosește pentru ambele scopuri — un singur load, nu două.

## Pas 7 — Verificare

`npm run check` verde. Diff-ul atinge doar `services/` și `types/` → fără screenshot.
