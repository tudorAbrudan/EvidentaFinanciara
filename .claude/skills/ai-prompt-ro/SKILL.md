---
name: ai-prompt-ro
description: Use when editing services/aiProvider.ts, aiStatementMapper.ts, or aiStatementVisionMapper.ts — enforces Romanian prompts, stable JSON schemas, rate-limit awareness, and snapshot tests for AI responses.
---

# AI prompts RO — Finanțe Personale

Reguli pentru cod care interacționează cu provider AI.

## Limbă

**Toate prompt-urile sunt în română.** Inclusiv:

- System message
- Few-shot examples
- Format instructions

Răspunsul AI este așteptat în română (categorii, descrieri).

## Schema JSON output

- **Stabilă.** Nu schimba câmpuri sau tipuri fără update concomitent în mapper și în testele snapshot.
- **Documentată în comment** lângă prompt:
  ```ts
  // Schema răspuns:
  // { tranzactii: Array<{ id: string, categorie_sugerata: string, confianta: number }> }
  ```
- **Validare la primire:** parse cu schema explicită; respinge și log-uiește răspunsuri malformate.

## Rate limit & cost

- **Free tier:** cota built-in (20 cereri/zi în implementarea curentă).
- **Premium:** nelimitat sau cheie proprie (`provider: 'external'`).
- Verifică `getAiQuotaState()` (sau echivalent) înainte de cerere — fail rapid cu mesaj clar dacă cota epuizată.
- Mesaje user în română: `"Ai atins limita zilnică de 20 de cereri AI. Mâine resetează automat sau setează propria cheie API în Setări."`

## Consent

- AI consent e **opt-in explicit**, nu opt-out.
- Nu face cereri AI la app launch sau în background fără consimțământ activ.
- Setarea e în `services/settings.ts` (`aiConsent: boolean`).

## Teste

- **Snapshot tests** pentru schema răspuns: pune un fixture cu răspuns AI canonical, verifică că mapperul produce output identic.
- **Mock provider** în teste: nu apelăm API real în CI.

## Anti-patterns

- ❌ Prompt în engleză cu user request în română — confuzie pentru model.
- ❌ Schimbare câmp JSON fără update mapper → runtime error.
- ❌ Skip verificare cotă → user cu cont epuizat vede eroare brută de la provider.
- ❌ Cerere AI fără verificare consent → încălcare promisiune local-first.
