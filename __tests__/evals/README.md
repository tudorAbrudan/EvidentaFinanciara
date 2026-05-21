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

## LIVE mode (apel real AI)

Pentru regresie test pe modelul real — folosit manual înainte de release,
după update Mistral sau după modificări de prompt:

```bash
RUN_LIVE_AI_EVALS=1 \
EXPO_PUBLIC_MISTRAL_API_KEY=sk-... \
npm run evals:ai
```

Override-uri opționale:

- `AI_EVAL_URL` — endpoint custom (default `https://api.mistral.ai/v1/chat/completions`)
- `AI_EVAL_MODEL` — model alternativ (default `mistral-small-latest`)

Pentru fiecare fixture, runner-ul:

1. Construiește prompt-ul cu `buildPrompt` (același ca în app).
2. Face fetch real cu `temperature: 0`, `max_tokens: 4000`, timeout 30s.
3. Salvează `{timestamp, model, usage, response}` în `captures/<fixture-name>.json`.
4. Aplică aceleași assertions ca MOCK mode (schema, rowsMustContain, etc.).
5. Failure dacă apelul eșuează SAU dacă răspunsul real ratează assertions.

Captures sunt gitignored — sunt date variabile per run. Pentru a actualiza
`canonical_response`-urile din fixture pe baza capture-urilor, copiezi manual
`captures/X.json` → field `canonical_response` din `fixtures/X.json`.

LIVE rulează **NU** în CI (consumă cota + costă) — doar manual.

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
