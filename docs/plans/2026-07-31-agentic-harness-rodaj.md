# Rodaj live harness agentic — checklist (Pas 9)

**Plan-sursă:** `docs/plans/2026-07-30-agentic-harness.md`, pasul 9.
**Stare:** pașii 1–8 livrați pe `feat/agentic-harness`, `npm run check` verde (578 teste).
**Acest pas NU e executat de agent.** Se rulează manual, cu omul de față, într-o
**sesiune nouă** de Claude Code — hook-urile din `.claude/settings.json` se încarcă la
pornirea sesiunii, deci sesiunea în care au fost scrise nu e o probă validă.

Bifează în PR. Dacă un punct pică, harness-ul **nu** e considerat activ.

---

## Pregătire

```sh
git checkout feat/agentic-harness
rm -f .claude/state/phase-*.json .claude/state/workflow-pause .claude/state/workflow-override
```

Pornește o sesiune nouă de Claude Code în `/Users/ax/work/finante`.
Verifică întâi că statusline-ul apare: `◉ – · feat/agentic-harness`.

---

## 1. Plan-gate blochează editarea fără plan

- [ ] Cere agentului: „adaugă un comentariu în `services/insights.ts`".
- [ ] **Așteptat:** editarea e blocată, agentul primește mesajul care începe cu
      `Plan-gate: editezi cod de feature (services/insights.ts) fără plan înregistrat.`

## 2. Cu plan înregistrat, editarea trece

```sh
node scripts/record-phase.mjs plan "test rodaj"
```

- [ ] Cere din nou aceeași editare.
- [ ] **Așteptat:** editarea trece. Statusline: `◉ PLAN · feat/agentic-harness`, apoi
      `◉ IMPLEMENT · …` după ce fișierul chiar se modifică.

## 3. Stop-gate blochează închiderea turei fără dovezi

- [ ] Cu modificarea din pasul 2 nesalvată în commit, lasă agentul să încerce să încheie tura.
- [ ] **Așteptat:** tura nu se închide; agentul primește mesajul
      `Stop-gate: diff-ul atinge cod de feature, dar dovezile de fază lipsesc…`,
      cu `services/insights.ts` listat.

## 4. Cu verify + review, tura se închide

```sh
node scripts/record-phase.mjs verify "npm test verde pe insights"
node scripts/record-phase.mjs review "cold-read: doar un comentariu"
```

- [ ] **Așteptat:** tura se încheie normal. Statusline: `◉ REVIEW · …`.

## 5. Chitanțele devin stale după o nouă editare

- [ ] Mai modifică ceva în `services/insights.ts` (un spațiu e de ajuns).
- [ ] **Așteptat:** statusline revine la `◉ IMPLEMENT`; la închiderea turei Stop-gate
      blochează din nou, cu motivul `chitanța de verify e învechită (codul s-a schimbat
    după înregistrare)`.

## 6. Push-ul din agent e blocat

- [ ] Cere agentului să ruleze `git push`.
- [ ] **Așteptat:** blocat, cu `no-push: push-ul nu se face din sesiunea de agent.`
- [ ] Verifică și că nu dă fals-pozitiv: un `git commit` al cărui mesaj conține textul
      comenzii interzise trebuie să treacă.

## 7. Pre-push: fără APPROVE nu pleacă nimic ⚠️ omul prezent

**Pe un branch de test, nu pe `main`.** Necesită `origin` accesibil.

```sh
git checkout -b test/rodaj-harness
git push -u origin test/rodaj-harness      # din terminal, nu din agent
```

- [ ] **Așteptat:** rulează `check:workflow`, apoi `npm run check`, apoi cere
      `Tastează APPROVE pentru push:`.
- [ ] Tastează orice altceva → `Push anulat.`, nimic nu pleacă.
- [ ] Reia și tastează `APPROVE` → push-ul trece.
- [ ] Șterge branch-ul de test local și remote după verificare.

> Notă: `check:workflow` va cere `LEARNINGS.md` în range dacă branch-ul de test conține
> cod de feature. Pe `feat/agentic-harness` range-ul `origin/main..HEAD` conține momentan
> și commit-urile BT v2 (nepushed) — se limpezește după ce `main` ajunge pe remote.

## 8. Fail-open pe intrare coruptă

```sh
echo garbage | node scripts/check-plan-pretool.mjs;  echo "plan-gate:  $?"
echo garbage | node scripts/check-workflow-stop.mjs; echo "stop-gate:  $?"
echo garbage | node scripts/check-no-push-pretool.mjs; echo "no-push:    $?"
```

- [ ] **Așteptat:** toate trei tipăresc `0`.

## 9. Escape hatch one-shot

```sh
touch .claude/state/workflow-pause
```

- [ ] Cere o editare în `services/` fără plan valid → **trece**.
- [ ] `ls .claude/state/workflow-pause` → nu mai există (consumat).
- [ ] `cat .claude/state/override-log.txt` → conține linia de audit cu `pause`.
- [ ] Repetă editarea → blocată din nou.

## 10. Curățenie

```sh
git checkout -- services/insights.ts
rm -f .claude/state/phase-*.json .claude/state/workflow-pause .claude/state/workflow-override
git status --short          # .claude/ nu trebuie să apară
```

- [ ] Tree curat, fără chitanțe de test rămase.
- [ ] `npm run check` verde.

---

## Ce se întâmplă dacă pică ceva

Notează în `LEARNINGS.md` ce a picat și cum, **nu relaxa gate-ul ca să treacă rodajul**.
Guardrails-urile se schimbă prin decizie umană, după ce se înțelege cauza — nu ca reacție
la un test roșu.
