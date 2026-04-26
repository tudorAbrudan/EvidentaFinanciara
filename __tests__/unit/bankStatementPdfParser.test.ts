import {
  detectStatementFormat,
  parseStatementPdf,
} from '@/services/bankStatementPdfParser';

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

describe('parseStatementPdf — BT format', () => {
  it('extracts transactions with negative amount for debit', () => {
    const text = `BANCA TRANSILVANIA
Extras de cont
Data tranzactie  Detalii  Suma
01.03.2026 Plata POS Kaufland Bucuresti -125.50 RON 4500.00
03.03.2026 Plata POS OMV Otopeni -250.00 RON 4250.00
15.03.2026 Salariu primit 9200.00 RON 13450.00`;
    const result = parseStatementPdf(text, 'RON');
    expect(result.format).toBe('bt');
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const amounts = result.rows.map(r => r.amount);
    expect(amounts.some(a => a < 0)).toBe(true);
  });

  it('handles RO decimal notation (comma) in BT layout', () => {
    const text = `BANCA TRANSILVANIA
01.03.2026 Plata Kaufland -125,50 RON 4.500,00
02.03.2026 Comision -5,00 RON 4.495,00
15.03.2026 Salariu 9.200,00 RON 13.695,00`;
    const result = parseStatementPdf(text, 'RON');
    expect(result.format).toBe('bt');
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const kaufland = result.rows.find(r =>
      (r.description ?? '').toLowerCase().includes('kaufland')
    );
    expect(kaufland).toBeDefined();
    expect(Math.abs((kaufland!.amount + 125.5))).toBeLessThan(0.01);
  });

  it('suggests category from merchant keywords', () => {
    const text = `BANCA TRANSILVANIA
01.03.2026 Plata POS Kaufland -125.50 RON 4500.00
02.03.2026 Plata POS OMV Petrom -250.00 RON 4250.00
03.03.2026 Plata POS Netflix -50.00 RON 4200.00`;
    const result = parseStatementPdf(text, 'RON');
    const cats = result.rows.map(r => r.category_key);
    expect(cats).toContain('food');
    expect(cats).toContain('vehicle');
    expect(cats).toContain('subscriptions');
  });
});

describe('parseStatementPdf — generic format', () => {
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
  });

  it('returns unknown with warning when no rows extractable', () => {
    const result = parseStatementPdf('Random text without any structured data', 'RON');
    expect(result.format).toBe('unknown');
    expect(result.rows).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
