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
