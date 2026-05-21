/**
 * AI eval harness rulat prin Jest.
 *
 * Iterează prin `fixtures/*.json` și verifică:
 *   - parser-ul (parseResponse) extrage rândurile așteptate din canonical_response
 *   - prompt-ul construit (buildPrompt) sanitizează caractere de injection
 *   - rândurile de zgomot (totale, solduri) nu apar
 *   - sumele de prompt injection sunt blocate
 *   - schema violations sunt raportate
 *
 * Rulare: `npm run evals:ai` (echivalent cu `jest __tests__/evals`).
 *
 * LIVE mode (apel real la AI) e gestionat de un script separat, nu de aici.
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

function loadFixtures(): Fixture[] {
  const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
    return JSON.parse(raw) as Fixture;
  });
}

const fixtures = loadFixtures();

describe('AI eval harness', () => {
  it('cel puțin un fixture există', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$name', (fixture: Fixture) => {
    const messages = buildPrompt(fixture.input.ocrText, fixture.input.currency);
    const userPrompt = messages.find(m => m.role === 'user')?.content ?? '';
    const parsed = parseResponse(fixture.canonical_response, fixture.input.currency);
    const rows = parsed.rows;
    const stats = parsed.stats;

    if (fixture.expected.promptMustSanitize) {
      for (const banned of fixture.expected.promptMustSanitize) {
        it(`prompt nu conține „${banned}" (sanitizare)`, () => {
          expect(userPrompt).not.toContain(banned);
        });
      }
    }

    if (fixture.expected.schemaErrorContains) {
      it(`schemaError conține „${fixture.expected.schemaErrorContains}"`, () => {
        expect(stats.schemaError).toBeDefined();
        expect(stats.schemaError ?? '').toContain(fixture.expected.schemaErrorContains!);
      });
    } else {
      it('schema validă (no schemaError)', () => {
        expect(stats.schemaError).toBeUndefined();
      });
    }

    if (fixture.expected.minRows !== undefined) {
      it(`cel puțin ${fixture.expected.minRows} rânduri acceptate`, () => {
        expect(rows.length).toBeGreaterThanOrEqual(fixture.expected.minRows!);
      });
    }

    if (fixture.expected.maxRows !== undefined) {
      it(`cel mult ${fixture.expected.maxRows} rânduri acceptate`, () => {
        expect(rows.length).toBeLessThanOrEqual(fixture.expected.maxRows!);
      });
    }

    if (fixture.expected.minRejected !== undefined) {
      it(`cel puțin ${fixture.expected.minRejected} rânduri rejected (date/sume invalide)`, () => {
        expect(stats.rejected).toBeGreaterThanOrEqual(fixture.expected.minRejected!);
      });
    }

    for (const must of fixture.expected.rowsMustContain ?? []) {
      const label =
        must.merchant === null
          ? `rând fără merchant cu sign=${must.amountSign}`
          : `rând cu merchant=${must.merchant} sign=${must.amountSign ?? 'any'}`;
      it(`include: ${label}`, () => {
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
        const offenders = rows.filter(r =>
          (r.merchant ?? '').toUpperCase().includes(banned.toUpperCase())
        );
        expect(offenders).toHaveLength(0);
      });
    }

    for (const banned of fixture.expected.mustNotIncludeAmounts ?? []) {
      it(`nu include suma ${banned} (anti-injection)`, () => {
        expect(rows.some(r => r.amount === banned)).toBe(false);
      });
    }
  });
});
