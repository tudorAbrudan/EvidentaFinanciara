# AI eval harness

Verifică sănătatea fluxului AI (parser + schema + sanitizare) fără să apelăm
modelul real în CI. Folosește fixture-uri cu `canonical_response` pre-recorded.

## Rulare

```bash
npm run evals:ai          # rulează doar eval-urile (mock mode)
npm test                  # rulează tot suite-ul, inclusiv eval-urile
```

Eval-urile rulează prin Jest (vezi `aiEvals.test.ts`), folosind `canonical_response`
din fiecare fixture pentru parser tests + sanitization checks.

## LIVE mode (TODO — manual)

Pentru a apela AI-ul real cu fixture-urile și a actualiza `canonical_response`:
nu există încă un runner separat. Plan: script Node care setează env
`EXPO_PUBLIC_MISTRAL_API_KEY`, importă `sendAiRequest`, rulează prin fixtures
și salvează response în `captures/` pentru replay.

Soluție temporară: scrie un test manual care apelează `mapStatementWithAi` cu
fixture-ul și inspectează response-ul. Sau folosește app-ul real cu fixture-ul
ca PDF mock.

## Structură fixture

```json
{
  "name": "descriere scurtă",
  "type": "statement-text",
  "input": { "ocrText": "...", "currency": "RON" },
  "canonical_response": "{...JSON serializat...}",
  "expected": {
    "minRows": 3,
    "maxRows": 3,
    "rowsMustContain": [{ "merchant": "LIDL", "amountSign": "negative" }],
    "mustNotIncludeMerchants": ["Sold final"],
    "mustNotIncludeAmounts": [-99999],
    "promptMustSanitize": ["[INST]"],
    "minRejected": 1,
    "schemaErrorContains": "rows"
  }
}
```

## Cum adaugi un fixture

1. Capturează input + output AI dintr-un caz real (sau sintetizează unul).
2. Anonimizează: înlocuiește IBAN/sume reale cu valori sintetice.
3. Salvează în `fixtures/<descriere>.json`.
4. Rulează `npm run evals:ai` să confirmi pass.

## Ce verificăm

- **Schema:** JSON respectă `StatementResponseSchema` (Zod).
- **Sanitizare:** prompt-ul construit nu conține tokens prompt-injection.
- **Acoperire:** rândurile așteptate apar; cele de zgomot (totale, solduri) nu.
- **Resilience:** sume invalide sunt rejected; schemaError raportat.
- **Anti-injection:** sume din INST nu apar în output.

## CI gate

Workflow `.github/workflows/check.yml` rulează MOCK mode automat. LIVE rămâne
manual (necesită API key + cota).
