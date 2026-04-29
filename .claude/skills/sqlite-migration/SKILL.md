---
name: sqlite-migration
description: Use when modifying schema in services/db.ts, adding tables, columns, or changing serialized structures — enforces migration safety, backup compatibility, and manifest hash updates.
---

# SQLite migration — Finanțe Personale

Reguli pentru modificarea schemei SQLite. Aplică **înainte** de orice modificare la `services/db.ts`.

## Principii

1. **Niciodată edit la migrații existente.** Adaugă migrație nouă în array-ul de migrații. Edit retroactiv strică DB-urile userilor existenți.
2. **Backup compat.** Format ZIP din `services/backup.ts` trebuie să citească versiuni vechi. Verifică `manifest.version` și fall-back logic.
3. **Manifest hash.** `services/manifestHash.ts` e folosit pentru invalidare cache. Update dacă schimbi structura serializată (nume tabel, coloană în export).
4. **Test migration round-trip.** În `__tests__/unit/db.test.ts` (sau echivalent): creare DB curat → aplică migrații → verifică schemă + insert/select sample.

## Procedură

1. Identifică ce schimbi: tabel nou, coloană nouă, redenumire, drop?
2. Scrie migrația ca instrucțiune SQL idempotentă (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN ...`).
3. Adaugă entry nou în array-ul de migrații (la final, niciodată inserat la mijloc).
4. Update `manifestHash.ts` dacă export-ul include coloana/tabelul nou.
5. Update `services/backup.ts` dacă serializarea se schimbă: păstrează capabilitate de citire pentru versiuni anterioare.
6. Test în `__tests__/unit/`:
   ```ts
   it('migrează curat de la versiunea X la Y', () => {
     // setup DB la state vechi
     // aplică migrația
     // verifică schemă nouă
   });
   ```
7. Test backup round-trip: export → reset → import → verifică date intacte.

## Anti-patterns

- ❌ Edit la migrație committed deja.
- ❌ `DROP TABLE` fără strategie de păstrare date pentru useri existenți.
- ❌ Schimbare nume coloană fără migrație de redenumire.
- ❌ Skip update manifest hash → cache stale, useri nu văd date noi.
- ❌ Schimbare format backup fără capabilitate citire format vechi.

## Workflow recomandat

```
1. Branch nou: schema-<descriere>
2. Scrie migrația
3. Test round-trip local
4. Test backup pe DB existent (export înainte → import după = identic)
5. PR cu mențiune explicită: "schema change" în titlu
```
