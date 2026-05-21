/**
 * AI eval harness rulat prin Jest.
 *
 * Două moduri:
 *   - MOCK (default): folosește `canonical_response` din fixture. Verifică
 *     parser + schema + sanitizare prompt. Rulat în CI.
 *   - LIVE (`RUN_LIVE_AI_EVALS=1`): apelează AI-ul real (Mistral) cu input-ul
 *     fixture-ului, salvează response în `captures/`, aplică aceleași
 *     assertions. Folosit manual înainte de release / după update model /
 *     după modificări de prompt. Necesită `EXPO_PUBLIC_MISTRAL_API_KEY`.
 *
 * Rulare:
 *   npm run evals:ai                              # MOCK
 *   RUN_LIVE_AI_EVALS=1 EXPO_PUBLIC_MISTRAL_API_KEY=sk-... npm run evals:ai
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildPrompt, parseResponse } from '@/services/aiStatementMapper';

interface FixtureExpected {
  minRows?: number;
  maxRows?: number;
  rowsMustContain?: {
    merchant?: string | null;
    amountSign?: 'positive' | 'negative';
  }[];
  mustNotIncludeMerchants?: string[];
  mustNotIncludeAmounts?: number[];
  promptMustSanitize?: string[];
  minRejected?: number;
  schemaErrorContains?: string;
}

interface Fixture {
  name: string;
  type: 'statement-text';
  input: { ocrText: string; currency: string };
  canonical_response: string;
  expected: FixtureExpected;
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CAPTURES_DIR = path.join(__dirname, 'captures');

const LIVE_MODE = process.env.RUN_LIVE_AI_EVALS === '1';
const LIVE_API_KEY = process.env.EXPO_PUBLIC_MISTRAL_API_KEY;
const LIVE_URL = process.env.AI_EVAL_URL ?? 'https://api.mistral.ai/v1/chat/completions';
const LIVE_MODEL = process.env.AI_EVAL_MODEL ?? 'mistral-small-latest';
const LIVE_TIMEOUT_MS = 30_000;
const LIVE_MAX_TOKENS = 4000;

function loadFixtures(): Fixture[] {
  const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
    return JSON.parse(raw) as Fixture;
  });
}

function captureFileFor(fixture: Fixture): string {
  const safe = fixture.name.replace(/[^a-z0-9-]+/gi, '_');
  return path.join(CAPTURES_DIR, `${safe}.json`);
}

/**
 * Apel direct la Mistral, fără import de `aiProvider` (care depinde de
 * AsyncStorage + SecureStore mock-uite în Jest). Reimplementăm minimal aici
 * — pentru LIVE mode e ok, e folosit doar ca regresie test.
 */
async function callLive(fixture: Fixture): Promise<string> {
  if (!LIVE_API_KEY) {
    throw new Error('EXPO_PUBLIC_MISTRAL_API_KEY lipsește din env');
  }
  const messages = buildPrompt(fixture.input.ocrText, fixture.input.currency);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const response = await fetch(LIVE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LIVE_API_KEY}`,
      },
      body: JSON.stringify({
        model: LIVE_MODEL,
        messages,
        max_tokens: LIVE_MAX_TOKENS,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Răspuns gol de la AI');

    // Salvăm capture-ul pentru replay / debug. Include și usage stats.
    if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    fs.writeFileSync(
      captureFileFor(fixture),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          model: LIVE_MODEL,
          fixture: fixture.name,
          usage: data.usage,
          response: content,
        },
        null,
        2
      )
    );
    return content;
  } finally {
    clearTimeout(timer);
  }
}

const fixtures = loadFixtures();

describe(`AI eval harness (${LIVE_MODE ? 'LIVE' : 'MOCK'} mode)`, () => {
  it('cel puțin un fixture există', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  if (LIVE_MODE) {
    it('API key disponibil', () => {
      expect(LIVE_API_KEY).toBeTruthy();
    });
  }

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      let response: string;
      let liveError: string | undefined;

      beforeAll(async () => {
        if (LIVE_MODE) {
          try {
            response = await callLive(fixture);
          } catch (e) {
            liveError = e instanceof Error ? e.message : String(e);
            // Fallback la canonical_response — restul testelor verifică
            // structural ce ar trebui să întoarcă AI-ul.
            response = fixture.canonical_response;
          }
        } else {
          response = fixture.canonical_response;
        }
      }, LIVE_TIMEOUT_MS + 5_000);

      if (LIVE_MODE) {
        it('LIVE apel reușit', () => {
          expect(liveError).toBeUndefined();
        });
      }

      // Prompt-ul nu depinde de response — îl putem evalua sincron.
      const messages = buildPrompt(fixture.input.ocrText, fixture.input.currency);
      const userPrompt = messages.find(m => m.role === 'user')?.content ?? '';

      if (fixture.expected.promptMustSanitize) {
        for (const banned of fixture.expected.promptMustSanitize) {
          it(`prompt nu conține „${banned}" (sanitizare)`, () => {
            expect(userPrompt).not.toContain(banned);
          });
        }
      }

      // Testele care depind de response folosesc parseResponse înăuntrul lor.
      if (fixture.expected.schemaErrorContains) {
        it(`schemaError conține „${fixture.expected.schemaErrorContains}"`, () => {
          const { stats } = parseResponse(response, fixture.input.currency);
          expect(stats.schemaError).toBeDefined();
          expect(stats.schemaError ?? '').toContain(fixture.expected.schemaErrorContains!);
        });
      } else {
        it('schema validă (no schemaError)', () => {
          const { stats } = parseResponse(response, fixture.input.currency);
          expect(stats.schemaError).toBeUndefined();
        });
      }

      if (fixture.expected.minRows !== undefined) {
        it(`cel puțin ${fixture.expected.minRows} rânduri acceptate`, () => {
          const { rows } = parseResponse(response, fixture.input.currency);
          expect(rows.length).toBeGreaterThanOrEqual(fixture.expected.minRows!);
        });
      }

      if (fixture.expected.maxRows !== undefined) {
        it(`cel mult ${fixture.expected.maxRows} rânduri acceptate`, () => {
          const { rows } = parseResponse(response, fixture.input.currency);
          expect(rows.length).toBeLessThanOrEqual(fixture.expected.maxRows!);
        });
      }

      if (fixture.expected.minRejected !== undefined) {
        it(`cel puțin ${fixture.expected.minRejected} rânduri rejected`, () => {
          const { stats } = parseResponse(response, fixture.input.currency);
          expect(stats.rejected).toBeGreaterThanOrEqual(fixture.expected.minRejected!);
        });
      }

      for (const must of fixture.expected.rowsMustContain ?? []) {
        const label =
          must.merchant === null
            ? `rând fără merchant cu sign=${must.amountSign}`
            : `rând cu merchant=${must.merchant} sign=${must.amountSign ?? 'any'}`;
        it(`include: ${label}`, () => {
          const { rows } = parseResponse(response, fixture.input.currency);
          const found = rows.some(r => {
            const merchantMatch =
              must.merchant === null
                ? !r.merchant
                : must.merchant
                  ? (r.merchant ?? '').toUpperCase().includes(must.merchant.toUpperCase())
                  : true;
            const signMatch =
              must.amountSign === 'positive'
                ? r.amount > 0
                : must.amountSign === 'negative'
                  ? r.amount < 0
                  : true;
            return merchantMatch && signMatch;
          });
          expect(found).toBe(true);
        });
      }

      for (const banned of fixture.expected.mustNotIncludeMerchants ?? []) {
        it(`nu include merchant „${banned}" (zgomot / totale)`, () => {
          const { rows } = parseResponse(response, fixture.input.currency);
          const offenders = rows.filter(r =>
            (r.merchant ?? '').toUpperCase().includes(banned.toUpperCase())
          );
          expect(offenders).toHaveLength(0);
        });
      }

      for (const banned of fixture.expected.mustNotIncludeAmounts ?? []) {
        it(`nu include suma ${banned} (anti-injection)`, () => {
          const { rows } = parseResponse(response, fixture.input.currency);
          expect(rows.some(r => r.amount === banned)).toBe(false);
        });
      }
    });
  }
});
