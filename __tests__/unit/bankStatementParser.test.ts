import {
  parseCsvLine,
  normalizeDate,
  normalizeAmount,
  suggestCategory,
  parseBankStatementCsv,
} from '@/services/bankStatementParser';

describe('parseCsvLine', () => {
  it('splits simple comma-separated values', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
  });

  it('handles escaped double quotes inside quoted field', () => {
    expect(parseCsvLine('"a""b",c')).toEqual(['a"b', 'c']);
  });

  it('supports semicolon separator', () => {
    expect(parseCsvLine('a;b;c', ';')).toEqual(['a', 'b', 'c']);
  });

  it('supports tab separator', () => {
    expect(parseCsvLine('a\tb\tc', '\t')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace around cells', () => {
    expect(parseCsvLine('  a , b ,  c')).toEqual(['a', 'b', 'c']);
  });
});

describe('normalizeDate', () => {
  it('passes ISO YYYY-MM-DD through', () => {
    expect(normalizeDate('2026-04-25')).toBe('2026-04-25');
  });

  it('converts YYYY/MM/DD', () => {
    expect(normalizeDate('2026/04/25')).toBe('2026-04-25');
  });

  it('converts DD.MM.YYYY (RO format)', () => {
    expect(normalizeDate('25.04.2026')).toBe('2026-04-25');
  });

  it('converts DD/MM/YYYY', () => {
    expect(normalizeDate('25/04/2026')).toBe('2026-04-25');
  });

  it('converts DD-MM-YYYY', () => {
    expect(normalizeDate('25-04-2026')).toBe('2026-04-25');
  });

  it('expands two-digit year (>=70 → 19xx)', () => {
    expect(normalizeDate('25.04.95')).toBe('1995-04-25');
  });

  it('expands two-digit year (<70 → 20xx)', () => {
    expect(normalizeDate('25.04.26')).toBe('2026-04-25');
  });

  it('returns null on garbage', () => {
    expect(normalizeDate('garbage')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });
});

describe('normalizeAmount', () => {
  it('parses plain integer', () => {
    expect(normalizeAmount('100')).toBe(100);
  });

  it('parses RO format 1.234,56', () => {
    expect(normalizeAmount('1.234,56')).toBe(1234.56);
  });

  it('parses RO format 1234,56', () => {
    expect(normalizeAmount('1234,56')).toBe(1234.56);
  });

  it('parses US format 1,234.56', () => {
    expect(normalizeAmount('1,234.56')).toBe(1234.56);
  });

  it('parses negative amounts', () => {
    expect(normalizeAmount('-100,50')).toBe(-100.5);
  });

  it('strips currency symbols/spaces', () => {
    expect(normalizeAmount('RON 1.234,56')).toBe(1234.56);
  });

  it('returns null on empty / garbage', () => {
    expect(normalizeAmount('')).toBeNull();
    expect(normalizeAmount('abc')).toBeNull();
  });
});

describe('suggestCategory', () => {
  it('matches food merchants', () => {
    expect(suggestCategory('Cumparaturi alimentare', 'Kaufland Cluj')).toBe('food');
    expect(suggestCategory('LIDL', '')).toBe('food');
  });

  it('matches transport (taxi services)', () => {
    expect(suggestCategory('Bolt ride', '')).toBe('transport');
    expect(suggestCategory('Uber Romania', '')).toBe('transport');
  });

  it('matches vehicle (gas stations)', () => {
    expect(suggestCategory('OMV statie', '')).toBe('vehicle');
    expect(suggestCategory('Petrom carburant', '')).toBe('vehicle');
  });

  it('matches utilities', () => {
    expect(suggestCategory('Factura curent Enel', '')).toBe('utilities');
    expect(suggestCategory('Vodafone factura', '')).toBe('utilities');
  });

  it('matches subscriptions (streaming)', () => {
    expect(suggestCategory('Netflix abonament', '')).toBe('subscriptions');
    expect(suggestCategory('Spotify Premium', '')).toBe('subscriptions');
  });

  it('matches health (pharmacies)', () => {
    expect(suggestCategory('Catena farmacie', '')).toBe('health');
  });

  it('matches shopping', () => {
    expect(suggestCategory('eMAG comanda', '')).toBe('shopping');
  });

  it('returns undefined for unknown text', () => {
    expect(suggestCategory('xyz unknown random text', '')).toBeUndefined();
  });
});

describe('parseBankStatementCsv', () => {
  it('returns empty result for empty input', () => {
    const result = parseBankStatementCsv('');
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('parses generic CSV with date+amount+description', () => {
    const csv = [
      'Date,Amount,Description',
      '2026-04-01,-100.50,Kaufland Cluj',
      '2026-04-02,2500.00,Salariu',
    ].join('\n');
    const result = parseBankStatementCsv(csv, 'RON');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].date).toBe('2026-04-01');
    expect(result.rows[0].amount).toBe(-100.5);
    expect(result.rows[0].description).toBe('Kaufland Cluj');
    expect(result.rows[0].category_key).toBe('food');
    expect(result.rows[1].amount).toBe(2500);
  });

  it('handles RO date format and EUR amounts', () => {
    const csv = [
      'Data tranzactie;Suma;Moneda;Descriere',
      '01.04.2026;-1.234,56;EUR;Hotel Booking',
    ].join('\n');
    const result = parseBankStatementCsv(csv, 'RON');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].date).toBe('2026-04-01');
    expect(result.rows[0].amount).toBe(-1234.56);
    expect(result.rows[0].currency).toBe('EUR');
  });

  it('handles split debit/credit columns', () => {
    const csv = [
      'Data,Debit,Credit,Descriere',
      '2026-04-01,100.50,,OMV',
      '2026-04-02,,2500.00,Salariu',
    ].join('\n');
    const result = parseBankStatementCsv(csv, 'RON');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].amount).toBe(-100.5);
    expect(result.rows[0].category_key).toBe('vehicle');
    expect(result.rows[1].amount).toBe(2500);
  });

  it('strips BOM if present', () => {
    const csv = '﻿Date,Amount,Description\n2026-04-01,-50,Test';
    const result = parseBankStatementCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].date).toBe('2026-04-01');
  });

  it('detects Revolut format', () => {
    const csv = [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
      'CARD_PAYMENT,Current,2026-04-01 10:00:00,2026-04-01 10:00:00,Glovo,-30.50,0,RON,COMPLETED,1000',
    ].join('\n');
    const result = parseBankStatementCsv(csv, 'RON');
    expect(result.format).toBe('revolut');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBe(-30.5);
    expect(result.rows[0].category_key).toBe('food');
  });

  it('skips invalid lines and adds warnings', () => {
    const csv = ['Date,Amount,Description', 'invalid,xyz,abc', '2026-04-01,-50,Test'].join('\n');
    const result = parseBankStatementCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
