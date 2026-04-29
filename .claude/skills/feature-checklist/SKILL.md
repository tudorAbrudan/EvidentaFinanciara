---
name: feature-checklist
description: Use when finishing a feature from docs/IDEAS.md — checklist final cu spec, plan, teste, IDEAS update, landing update, CLAUDE.md/ARCHITECTURE.md update.
---

# Feature checklist — Finanțe

La finalizarea unui feature din `docs/IDEAS.md`, înainte de ultimul commit, parcurge checklist-ul:

- [ ] **Spec scris** — `docs/specs/<data>-<topic>-design.md` există și e committed.
- [ ] **Plan scris** — `docs/plans/<data>-<topic>.md` există și e committed.
- [ ] **Implementare cu teste** — toate funcțiile noi în `services/` au teste în `__tests__/unit/`.
- [ ] **`npm run check` trece** — lint + type-check + type-coverage + test + knip + madge + dep-cruise + audit.
- [ ] **`docs/IDEAS.md` actualizat** — feature mutat în „done" sau marcat status (eventual cu data implementării).
- [ ] **`landing/index.html` actualizat** — dacă feature e user-visible, lista features pe landing îl reflectă.
- [ ] **`CLAUDE.md` actualizat** — dacă scripts noi în `package.json`, convenții noi, sau comenzi uzuale schimbate.
- [ ] **`docs/ARCHITECTURE.md` actualizat** — dacă folder/modul nou, schemă DB schimbată, flux nou de date.
- [ ] **Privacy/terms verificate** — dacă feature implică date trimise extern (AI, cloud), verifică `docs/privacy.html` și `docs/terms.html` (când vor exista) sau marchează în IDEAS „needs privacy review".

## Note

- Hook-ul `sync-docs` semnalează automat după commit dacă vreunul din pașii de mai sus pare omis. Folosește acest skill ca verificare proactivă **înainte** de commit-ul final.
- Dacă feature-ul nu e user-visible (refactor intern, fix bug), pașii „landing" și „IDEAS user-visible" se omit — dar verifică totuși CLAUDE/ARCHITECTURE dacă e modul/script nou.
