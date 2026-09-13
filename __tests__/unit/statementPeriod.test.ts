import { resolveStatementFacts } from '@/services/statementPeriod';

describe('resolveStatementFacts', () => {
  const dates = ['2026-06-03', '2026-06-28', '2026-06-15'];

  it('preferă perioada din antet, cu soldurile extrasului', () => {
    const facts = resolveStatementFacts(dates, {
      periodFrom: '2026-06-01',
      periodTo: '2026-06-30',
      openingBalance: 298.15,
      closingBalance: 2120.31,
    });
    expect(facts).toEqual({
      period_from: '2026-06-01',
      period_to: '2026-06-30',
      period_source: 'header',
      opening_balance: 298.15,
      closing_balance: 2120.31,
    });
  });

  it('fără antet, deduce intervalul din prima și ultima tranzacție', () => {
    const facts = resolveStatementFacts(dates);
    expect(facts).toEqual({
      period_from: '2026-06-03',
      period_to: '2026-06-28',
      period_source: 'inferred',
      opening_balance: null,
      closing_balance: null,
    });
  });

  it('nu lipește soldurile peste o perioadă dedusă', () => {
    // Soldurile descriu perioada tipărită; fără ea, s-ar compara cu altă zi.
    const facts = resolveStatementFacts(dates, { openingBalance: 298.15, closingBalance: 2120.31 });
    expect(facts?.period_source).toBe('inferred');
    expect(facts?.opening_balance).toBeNull();
    expect(facts?.closing_balance).toBeNull();
  });

  it('perioadă din antet fără solduri (extras care nu le tipărește)', () => {
    const facts = resolveStatementFacts(dates, {
      periodFrom: '2026-06-01',
      periodTo: '2026-06-30',
    });
    expect(facts?.period_source).toBe('header');
    expect(facts?.opening_balance).toBeNull();
  });

  it('antet incomplet (doar o margine) → cade pe tranzacții', () => {
    const facts = resolveStatementFacts(dates, { periodFrom: '2026-06-01' });
    expect(facts?.period_source).toBe('inferred');
    expect(facts?.period_from).toBe('2026-06-03');
  });

  it('ignoră datele malformate', () => {
    const facts = resolveStatementFacts(['nu-i data', '2026-06-10', '']);
    expect(facts?.period_from).toBe('2026-06-10');
    expect(facts?.period_to).toBe('2026-06-10');
  });

  it('fără tranzacții datate și fără antet → null', () => {
    expect(resolveStatementFacts([])).toBeNull();
    expect(resolveStatementFacts(['x'], {})).toBeNull();
  });

  it('antet valid fără tranzacții datate rămâne folosibil', () => {
    const facts = resolveStatementFacts([], {
      periodFrom: '2026-06-01',
      periodTo: '2026-06-30',
    });
    expect(facts?.period_source).toBe('header');
  });

  const euroStatement = {
    periodFrom: '2026-06-01',
    periodTo: '2026-06-30',
    openingBalance: 0,
    closingBalance: 4.44,
    currency: 'EUR',
  };

  it('extras în altă valută decât contul → perioada rămâne, soldurile nu', () => {
    // Extras EUR importat într-un cont RON: o verificare de sold ar scădea lei din euro.
    const facts = resolveStatementFacts(dates, euroStatement, 'RON');
    expect(facts?.period_source).toBe('header');
    expect(facts?.opening_balance).toBeNull();
    expect(facts?.closing_balance).toBeNull();
  });

  it('valuta se compară indiferent de scriere', () => {
    const facts = resolveStatementFacts(dates, euroStatement, 'eur');
    expect(facts?.closing_balance).toBeCloseTo(4.44, 2);
  });

  it('fără valută cunoscută nu blocăm soldurile', () => {
    const faraValutaContului = resolveStatementFacts(dates, euroStatement);
    expect(faraValutaContului?.closing_balance).toBeCloseTo(4.44, 2);

    const faraValutaExtrasului = resolveStatementFacts(
      dates,
      { periodFrom: '2026-06-01', periodTo: '2026-06-30', closingBalance: 10 },
      'RON'
    );
    expect(faraValutaExtrasului?.closing_balance).toBe(10);
  });
});
