# Harness agentic — plan de implementare

**Spec:** `docs/specs/2026-07-30-agentic-harness-design.md` (deciziile A1–A10; citește-l întâi).
**Precondiție:** parserul BT v2 (`docs/plans/2026-07-30-bt-pdf-parser-v2.md`) e livrat și
merged — harness-ul se instalează pe un tree liniștit.

**Reguli pentru sesiunea de implementare:**

- Nu modifica: `.husky/pre-commit`, `.claude/hooks/sync-docs.sh`, skills-urile, agenții
  existenți (`bank-parser-reviewer`, `landing-copy-reviewer`), workflow-urile CI existente.
- `settings.json` se **extinde** (merge), nu se rescrie: hook-ul PostToolUse `sync-docs.sh`
  trebuie să rămână funcțional.
- Fiecare pas se termină cu testele lui verzi. La final `npm run check` verde + rodajul live.
- Toate textele noi (mesaje de hook, docs) în română.

## Contracte comune (pinuite — nu improviza)

**Protocolul hook-urilor Claude Code:** scriptul primește JSON pe stdin (câmpuri relevante:
`tool_name`, `tool_input` — pentru Bash: `tool_input.command`; pentru Edit/Write:
`tool_input.file_path`; `cwd`; la Stop: `stop_hook_active`). **Blocare = exit code 2 +
motivul pe stderr** (mesajul ajunge la model). Exit 0 = permite. Orice eroare internă
(JSON corupt, git indisponibil, fs error) → exit 0 (fail-open). Vezi
`.claude/hooks/sync-docs.sh` ca exemplu existent de parsing. Dacă ai dubii pe protocol,
verifică documentația Claude Code (agentul `claude-code-guide`), nu ghici.

**Fingerprint diff:** `sha256(git status --porcelain + "\0" + git diff HEAD)` calculat de
`workflow-lib.mjs`. Orice editare ulterioară schimbă fingerprint-ul → chitanțele devin stale.

**Chitanțe:** `.claude/state/phase-<plan|verify|review>.json`:

```json
{
  "phase": "verify",
  "detail": "text liber — ce s-a verificat",
  "head": "<sha HEAD>",
  "diffFingerprint": "<sha256>",
  "screenshots": [{ "path": "…", "sha256": "…" }],
  "recordedAt": "ISO-8601"
}
```

`screenshots` obligatoriu doar la `verify` când diff-ul atinge `app/|components/|theme/`
(vezi A5); scriptul re-hash-uiește fișierele la validare.

**Cod de feature (A4):** regex partajat în `workflow-lib.mjs`:
`^(services|app|components|hooks|theme|types)/` și nu `^__tests__/`.

**Escape hatches:** fișierul `.claude/state/workflow-pause` (se șterge automat după o
folosire) sau `workflow-override` (persistent) → toate gate-urile devin no-op, dar scriu
o linie de audit în `.claude/state/override-log.txt`.

## Pas 1 — AGENTS.md canonic + pointer + `check:pointers`

1. Creează `AGENTS.md` la root cu tot conținutul actual din `CLAUDE.md`, plus secțiuni noi:
   **Bucla de lucru** (PLAN→IMPLEMENT→VERIFY→REVIEW→LEARN, cu comenzile `record-phase`),
   **Roluri și delegare** (tabelul A6), **Reguli operaționale** (agentul nu face push;
   guardrails human-only; LEARNINGS + regula de promovare din A10).
2. `CLAUDE.md` devine pointer subțire (max 15 linii): titlu + „Sursa unică de adevăr este
   `AGENTS.md` — citește-l integral" + nota că skills/agents rămân în `.claude/`.
3. `scripts/check-pointer-files.mjs`: eșuează dacă `CLAUDE.md` are >15 linii nevide sau
   conține heading-uri de reguli (`##`). Adaugă `"check:pointers"` în package.json și
   include-l în lanțul `check`.
4. Test `__tests__/unit/harness/checkPointers.test.ts`: rulează scriptul cu
   `child_process.execFileSync` pe fixture-uri temp (pointer valid → exit 0; CLAUDE.md
   umflat → exit ≠ 0).

## Pas 2 — `scripts/workflow-lib.mjs` + `scripts/record-phase.mjs`

`workflow-lib.mjs` exportă: `readStdinJson()` (cu timeout scurt și fallback `{}`),
`diffFingerprint(cwd)`, `isFeatureFile(path)`, `featureFilesInDiff(cwd)`,
`readReceipt(phase)`, `writeReceipt(phase, data)`, `isPaused()` (+ consumă pause-ul),
`sha256File(path)`. Fără dependențe noi — doar `node:crypto`, `node:fs`, `node:child_process`.

`record-phase.mjs <plan|verify|review> "<detail>" [--screenshot <path>]...`:
scrie chitanța cu fingerprint-ul curent; la `verify` cu screenshot-uri, salvează hash-urile;
la `plan` leagă de HEAD. Tipărește confirmare + fingerprint scurt.

Teste `__tests__/unit/harness/recordPhase.test.ts` într-un repo git temporar
(`fs.mkdtempSync` + `git init` + commit inițial): chitanța se scrie corect; fingerprint-ul
se schimbă după o editare; screenshot inexistent → eroare clară.

## Pas 3 — plan-gate: `scripts/check-plan-pretool.mjs`

Logica (în ordine): pause/override → exit 0 · citește stdin → `tool_input.file_path` →
dacă nu e fișier de feature → exit 0 · dacă există `phase-plan.json` cu `head` == HEAD
curent → exit 0 · altfel **exit 2** cu stderr:
„Plan-gate: editezi cod de feature fără plan înregistrat. Rulează:
`node scripts/record-phase.mjs plan "<rezumatul planului>"` după ce planul e aprobat,
sau `touch .claude/state/workflow-pause` pentru o excepție one-shot."

Înregistrare în `.claude/settings.json` → `hooks.PreToolUse`, matcher
`Edit|Write|MultiEdit|NotebookEdit` (păstrează structura existentă a fișierului).

Teste: fișier non-feature → 0; feature fără plan → 2 + mesajul; cu plan valid → 0;
plan pe alt HEAD → 2; stdin corupt → 0 (fail-open); pause → 0 și pause consumat.

## Pas 4 — Stop-gate: `scripts/check-workflow-stop.mjs`

Logica: `stop_hook_active` true → exit 0 (anti-buclă) · pause/override → exit 0 ·
`featureFilesInDiff()` gol → exit 0 · altfel cere, pe fingerprint-ul curent:
`phase-verify.json` valid (cu screenshot-uri hash-corecte dacă diff-ul atinge
`app/|components/|theme/`) și `phase-review.json` valid. Lipsește ceva → **exit 2** cu
stderr care spune exact ce și cum (comenzile `record-phase verify/review`, cine face
review-ul — sub-agentul `reviewer`). LEARN nu blochează Stop-ul (se cere la push, Pas 6) —
o tură de lucru intermediară e legitimă fără LEARNINGS.

Înregistrare în `hooks.Stop`. Teste: cele 6 ramuri de mai sus + chitanțe stale după edit.

## Pas 5 — blocarea push-ului din agent: `scripts/check-no-push-pretool.mjs`

PreToolUse pe `Bash`: dacă `tool_input.command` matchează `\bgit\s+push\b` (inclusiv în
lanțuri `&&`/`;`) → exit 2: „Push-ul îl face omul, din terminal, prin pre-push gate.
Cere-i userului să ruleze push." Altfel exit 0. Nu bloca alte comenzi git.
Teste: `git push`, `cd x && git push origin main`, `git pushX` (nu blochează), stdin corupt.

## Pas 6 — pre-push: `check:workflow` + APPROVE uman

1. `scripts/check-workflow.mjs` (npm script `check:workflow`): pe range-ul de push
   (`@{push}..HEAD` cu fallback `origin/main..HEAD`), dacă există commit-uri care ating
   cod de feature: cere `LEARNINGS.md` atins în același range **și** chitanțe
   verify+review valide pe tree-ul curent (curat). Diferența față de Stop-gate: aici e
   ultima linie — mesajele explică exact ce lipsește.
2. `.husky/pre-push` (fișier nou): `node scripts/check-workflow.mjs && npm run check`,
   apoi sumarul (branch, commit-uri, fișiere) și **citește APPROVE de la `/dev/tty`**:
   ```sh
   if [ ! -t 0 ] && [ ! -e /dev/tty ]; then echo "Fără terminal interactiv — push refuzat."; exit 1; fi
   printf "Tastează APPROVE pentru push: " > /dev/tty
   read -r raspuns < /dev/tty
   [ "$raspuns" = "APPROVE" ] || { echo "Push anulat."; exit 1; }
   ```
3. Teste pentru `check-workflow.mjs` (repo temporar cu remote fake): range fără feature →
   0; feature fără LEARNINGS → ≠0; complet → 0. Hook-ul shell se verifică la rodaj (Pas 9).

## Pas 7 — roluri: `agents/` canonic + `.claude/agents/` bindings

1. `agents/{planner,coder,reviewer,verifier,orchestrator}.md` — definițiile canonice
   (rol, ce face/nu face, checklist-ul lui; orchestrator doar canonic, fără binding).
2. Bindings subțiri `.claude/agents/{planner,coder,reviewer,verifier}.md` cu front-matter:
   - planner: `model: opus`, `tools: Read, Grep, Glob, Bash, WebFetch` + Context7 (doar query);
   - coder: `model: sonnet`, fără restricție de tools;
   - reviewer: `model: opus`, `tools: Read, Grep, Glob, Bash`;
   - verifier: `model: sonnet`, `tools: Read, Grep, Glob, Bash` + uneltele iOS Simulator MCP.
     Corpul binding-ului = pointer la `agents/<rol>.md` + regulile dure („nu editezi", etc.).
3. Agenții existenți rămân neatinși.

## Pas 8 — LEARNINGS, permissions, statusline, PR template

1. `LEARNINGS.md` seed la root: format intrare (dată, context, lecție, unde s-a promovat),
   regula de promovare (A10) și regula „guardrails off-limits pentru self-learning".
2. `settings.json` → `permissions.deny`: Edit/Write pe `.claude/settings.json` și
   `.husky/**` (guardrails human-only).
3. `scripts/statusline-phase.mjs` + `statusLine` în settings: `◉ <fază-din-chitanțe> · <branch>`
   (faza = cea mai recentă chitanță validă pe fingerprint-ul curent, altfel `IMPLEMENT`… /
   `–` pe tree curat).
4. `.github/pull_request_template.md` minimal: teste, `npm run check`, reconciliere docs
   (IDEAS/ARCHITECTURE), fără date personale în fixtures.

## Pas 9 — rodaj live (obligatoriu, manual, cu omul de față)

Checklist executat într-o sesiune nouă de Claude Code, bifat în PR:

1. Edit pe `services/insights.ts` fără plan → **blocat** cu mesajul plan-gate-ului.
2. `record-phase plan "test rodaj"` → editarea **merge**.
3. Încearcă să închei tura cu diff de feature fără verify/review → Stop **blocat**.
4. `record-phase verify/review` → tura se închide.
5. Mai editează un fișier → chitanțele devin **stale** → Stop blocat din nou.
6. `git push` din agent → **blocat** de PreToolUse.
7. `git push` din terminal fără APPROVE → **refuzat**; cu APPROVE → trece (pe branch de test).
8. `echo garbage | node scripts/check-plan-pretool.mjs` → exit 0 (fail-open).
9. `touch .claude/state/workflow-pause` → un edit trece fără plan, pause-ul dispare,
   override-log conține intrarea.
10. Revert la starea curată; ștergerea chitanțelor de test.

## Acceptanță

- `npm run check` verde (include `check:pointers`); toate testele harness verzi.
- Rodajul live (Pas 9) bifat integral, cu omul prezent la pașii 7 și 10.
- `sync-docs.sh`, pre-commit-ul, skills-urile și agenții existenți funcționează neschimbat.
- `AGENTS.md` canonic, `CLAUDE.md` pointer, IDEAS + ARCHITECTURE actualizate.
- Niciun PDF/date personale în repo; `.claude/state/` nu apare în `git status`.
