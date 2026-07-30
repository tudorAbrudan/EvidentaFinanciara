/**
 * Teste pentru parserul de extrase PDF.
 *
 * Fixture-urile din `__tests__/fixtures/bt-pdf/` sunt text extras din extrase BT
 * reale, anonimizate — sumele, datele și structura liniilor sunt identice cu
 * originalul. `expected.json` e ground truth luat din rândurile de sumar ale
 * extrasului, deci testele cer reconciliere exactă, nu „aproximativ corect".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  detectStatementFormat,
  formatAmountRo,
  isFullyReconciled,
  parseStatementPdf,
  type PdfParseResult,
} from '@/services/bankStatementPdfParser';

const FIXTURES = join(__dirname, '../fixtures/bt-pdf');

interface ExpectedDay {
  date: string;
  debit: number;
  credit: number;
  sold_final: number;
}

interface ExpectedStatement {
  account_currency: string;
  transaction_count: number;
  total_debit: number;
  total_credit: number;
  sold_final: number;
  days: ExpectedDay[];
}

const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as Record<
  string,
  ExpectedStatement
>;

function parseFixture(name: string, currency = 'RON'): PdfParseResult {
  return parseStatementPdf(readFileSync(join(FIXTURES, name), 'utf8'), currency);
}

const RON_FIXTURE = 'bt-extras-ron-2026-06.txt';
const EUR_FIXTURE = 'bt-extras-eur-2026-06.txt';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('detectStatementFormat', () => {
  it('detects BT from header keyword', () => {
    expect(detectStatementFormat('BANCA TRANSILVANIA\nExtras de cont\n...')).toBe('bt');
  });

  it('detects BT from BT24 mention', () => {
    expect(detectStatementFormat('Bun venit BT24 mobile\n01.03.2026 Plata')).toBe('bt');
  });

  it('detects generic when 3+ date+amount lines exist', () => {
    const text = `Some bank
01.03.2026 Plata POS 100.00 RON
02.03.2026 Comision 5.00 RON
03.03.2026 Salariu 5000.00 RON`;
    expect(detectStatementFormat(text)).toBe('generic');
  });

  it('returns unknown when no recognizable pattern', () => {
    expect(detectStatementFormat('Random text without dates')).toBe('unknown');
  });

  it('returns unknown for too few date lines', () => {
    const text = `Some bank
01.03.2026 Plata 100.00 RON`;
    expect(detectStatementFormat(text)).toBe('unknown');
  });
});

describe('parseStatementPdf — extras BT real (RON)', () => {
  const result = parseFixture(RON_FIXTURE);
  const truth = expected[RON_FIXTURE];
  const rec = result.reconciliation;

  it('extrage exact câte tranzacții are extrasul', () => {
    expect(result.format).toBe('bt');
    expect(result.rows).toHaveLength(truth.transaction_count);
    expect(rec?.transactionCount).toBe(truth.transaction_count);
    expect(rec?.refCount).toBe(truth.transaction_count);
  });

  it('reconciliază totalurile la ban cu RULAJ TOTAL CONT', () => {
    const debit = sum(result.rows.filter(r => r.amount < 0).map(r => -r.amount));
    const credit = sum(result.rows.filter(r => r.amount > 0).map(r => r.amount));
    expect(debit).toBeCloseTo(truth.total_debit, 2);
    expect(credit).toBeCloseTo(truth.total_credit, 2);
    expect(rec?.totals.ok).toBe(true);
  });

  it('reconciliază fiecare zi din extras', () => {
    expect(rec?.days).toHaveLength(truth.days.length);
    for (const day of truth.days) {
      const actual = rec?.days.find(d => d.date === day.date);
      expect(actual).toBeDefined();
      expect(actual?.expectedDebit).toBeCloseTo(day.debit, 2);
      expect(actual?.expectedCredit).toBeCloseTo(day.credit, 2);
      expect(actual?.actualDebit).toBeCloseTo(day.debit, 2);
      expect(actual?.actualCredit).toBeCloseTo(day.credit, 2);
      expect(actual?.ok).toBe(true);
    }
    expect(isFullyReconciled(rec)).toBe(true);
  });

  it('nu produce warning-uri de reconciliere', () => {
    expect(result.warnings).toEqual([]);
  });

  it('nu lasă rânduri de sumar sau header în descrieri', () => {
    for (const row of result.rows) {
      expect(row.description).toBeDefined();
      expect(row.description).not.toMatch(/RULAJ|SOLD|BANCA TRANSILVANIA/i);
    }
  });

  it('pune valuta contului pe toate rândurile și păstrează referința', () => {
    for (const row of result.rows) {
      expect(row.currency).toBe(truth.account_currency);
      expect(row.reference).toBeTruthy();
    }
  });

  it('citește creditul ca debit, nu ca încasare (rambursare + dobândă)', () => {
    const day = result.rows.filter(r => r.date === '2026-06-05');
    expect(day).toHaveLength(2);
    const rambursare = day.find(r => /Rambursare principal/i.test(r.description ?? ''));
    const dobanda = day.find(r => /Dobanda credit/i.test(r.description ?? ''));
    expect(rambursare?.amount).toBeCloseTo(-579.95, 2);
    expect(dobanda?.amount).toBeCloseTo(-261.15, 2);
  });

  it('păstrează comisionul care împarte REF-ul cu încasarea (fără dedup pe REF)', () => {
    const incasare = result.rows.find(r => /Incasare OP urgente/i.test(r.description ?? ''));
    expect(incasare?.amount).toBeCloseTo(3926.1, 2);
    expect(incasare?.date).toBe('2026-06-02');

    const comision = result.rows.find(r => /Comision incasare OP/i.test(r.description ?? ''));
    expect(comision?.amount).toBeCloseTo(-5, 2);
    expect(comision?.reference).toBe(incasare?.reference);
  });

  it('deduce direcția P2P din destinatar vs titular', () => {
    const day = result.rows.filter(
      r => r.date === '2026-06-02' && /^P2P/i.test(r.description ?? '')
    );
    const trimis = day.find(r => r.amount < 0);
    const primit = day.find(r => r.amount > 0);
    expect(trimis?.amount).toBeCloseTo(-7600, 2);
    expect(primit?.amount).toBeCloseTo(205, 2);
  });

  it('reconstituie tranzacția ruptă de header-ul de pagină', () => {
    const omv = result.rows.find(
      r => r.date === '2026-06-30' && Math.abs(r.amount + 492.23) < 0.01
    );
    expect(omv).toBeDefined();
    expect(omv?.description).toMatch(/OMV 1083/);
    expect(omv?.reference).toBeTruthy();
  });

  it('deduce direcția transferurilor interne din sensul economiilor', () => {
    const spreEconomii = result.rows.find(r =>
      /Transfer in contul de economii/i.test(r.description ?? '')
    );
    expect(spreEconomii?.amount).toBeCloseTo(-10000, 2);

    const dinEconomii = result.rows.find(
      r => r.date === '2026-06-04' && /Transfer din economii/i.test(r.description ?? '')
    );
    expect(dinEconomii?.amount).toBeCloseTo(1000, 2);
  });

  it('sugerează categoria din descriere', () => {
    const lidl = result.rows.find(
      r => r.date === '2026-06-06' && /LIDL/i.test(r.description ?? '')
    );
    expect(lidl?.category_key).toBe('food');
  });

  it('are expected.json consistent intern (sold curge din zi în zi)', () => {
    for (let i = 1; i < truth.days.length; i++) {
      const prev = truth.days[i - 1];
      const day = truth.days[i];
      expect(prev.sold_final + day.credit - day.debit).toBeCloseTo(day.sold_final, 2);
    }
    expect(sum(truth.days.map(d => d.debit))).toBeCloseTo(truth.total_debit, 2);
    expect(sum(truth.days.map(d => d.credit))).toBeCloseTo(truth.total_credit, 2);
  });
});

describe('parseStatementPdf — extras BT real (EUR)', () => {
  const result = parseFixture(EUR_FIXTURE, 'RON');
  const truth = expected[EUR_FIXTURE];

  it('extrage cele trei tranzacții și le reconciliază', () => {
    expect(result.rows).toHaveLength(truth.transaction_count);
    expect(isFullyReconciled(result.reconciliation)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('folosește valuta contului, nu valuta din descriere („ECHIVALENT LEI")', () => {
    expect(result.rows.every(r => r.currency === 'EUR')).toBe(true);
  });

  it('citește schimbul valutar ca intrare în contul EUR', () => {
    const schimb = result.rows.find(r => /Schimb valutar/i.test(r.description ?? ''));
    expect(schimb?.amount).toBeCloseTo(20, 2);
  });

  it('citește plata și comisionul ca ieșiri', () => {
    const plata = result.rows.find(r => /Hetzner/i.test(r.description ?? ''));
    const comision = result.rows.find(r => /Comision Plata Instant/i.test(r.description ?? ''));
    expect(plata?.amount).toBeCloseTo(-15.08, 2);
    expect(comision?.amount).toBeCloseTo(-0.48, 2);
  });
});

describe('parseStatementPdf — format generic', () => {
  it('parses date+amount lines from any layout', () => {
    const text = `Some bank
Statement period 01.03 - 31.03
01.03.2026 Plata POS magazin 125.50 RON
05.03.2026 Salariu 5000.00 RON
10.03.2026 Comision 5.00 RON`;
    const result = parseStatementPdf(text, 'RON');
    expect(result.format).toBe('generic');
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
    expect(result.warnings.some(w => w.includes('fiabilitate'))).toBe(true);
    expect(result.reconciliation).toBeUndefined();
  });

  it('returns unknown with warning when no rows extractable', () => {
    const result = parseStatementPdf('Random text without any structured data', 'RON');
    expect(result.format).toBe('unknown');
    expect(result.rows).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('formatAmountRo', () => {
  it('formatează sumele în stil RO', () => {
    expect(formatAmountRo(97423.94)).toBe('97.423,94');
    expect(formatAmountRo(0)).toBe('0,00');
    expect(formatAmountRo(-5)).toBe('-5,00');
    expect(formatAmountRo(1234567.5)).toBe('1.234.567,50');
  });
});

describe('isFullyReconciled', () => {
  it('e fals când lipsește reconcilierea', () => {
    expect(isFullyReconciled(undefined)).toBe(false);
  });

  it('e fals când numărul de referințe nu se potrivește', () => {
    expect(
      isFullyReconciled({
        days: [
          {
            date: '2026-06-02',
            expectedDebit: 1,
            expectedCredit: 0,
            actualDebit: 1,
            actualCredit: 0,
            ok: true,
          },
        ],
        totals: {
          expectedDebit: 1,
          expectedCredit: 0,
          actualDebit: 1,
          actualCredit: 0,
          ok: true,
        },
        transactionCount: 1,
        refCount: 2,
      })
    ).toBe(false);
  });
});
