import {
  parseCsvLine,
  normalizeDate,
  normalizeAmount,
  suggestCategory,
  parseBankStatementCsv,
  applyDirectionHint,
  type ParsedRow,
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

  // String-uri reale dintr-un extras BT (anonimizat) care ratau încadrarea.
  it('matches merchants exact din extras BT', () => {
    // MEGAIMAGE fără spațiu (pattern avea „mega image")
    expect(suggestCategory('Plata la POS', 'MEGAIMAGE 0844 Simion')).toBe('food');
    // EON fără punct (pattern avea „e.on")
    expect(suggestCategory('WWW.EON.RO/MYLINE TG MURES', '')).toBe('utilities');
    // E-BLOC.RO — întreținere bloc
    expect(suggestCategory('E-BLOC.RO CLUJ NAPOCA', '')).toBe('utilities');
    // POLARIS MEDICAL — „medical", nu doar „medic"
    expect(suggestCategory('POLARIS MEDICAL SAT SUCEAGU', '')).toBe('health');
    // CTP — transport public Cluj
    expect(suggestCategory('CTP CLUJ NAPOCA', '')).toBe('transport');
    // olx, sportano, ZOOCENTER — cumpărături
    expect(suggestCategory('olx.com NICOLAE TITULESC', '')).toBe('shopping');
    expect(suggestCategory('sportano.ro Zielona Gora', '')).toBe('shopping');
    expect(suggestCategory('ZOOCENTER CLUJ NAPOCA', '')).toBe('shopping');
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

describe('applyDirectionHint', () => {
  const base: ParsedRow = { date: '2026-05-15', amount: -100, currency: 'RON' };

  it('flips a negative "Incasare" to income (real bug: BT incasare clasificată ca cheltuială)', () => {
    const row = { ...base, amount: -26400, description: 'Incasare OP - canal electronic' };
    expect(applyDirectionHint(row).amount).toBe(26400);
  });

  it('flips a negative "Salariu" to income', () => {
    const row = { ...base, amount: -9200, description: 'Salariu mai 2026' };
    expect(applyDirectionHint(row).amount).toBe(9200);
  });

  it('flips a positive "Plata POS" to expense', () => {
    const row = { ...base, amount: 125.5, description: 'Plata POS Kaufland' };
    expect(applyDirectionHint(row).amount).toBe(-125.5);
  });

  it('leaves a correctly-signed income untouched', () => {
    const row = { ...base, amount: 5000, description: 'Incasare transfer' };
    expect(applyDirectionHint(row).amount).toBe(5000);
  });

  it('leaves a correctly-signed expense untouched', () => {
    const row = { ...base, amount: -50, description: 'Plata abonament Netflix' };
    expect(applyDirectionHint(row).amount).toBe(-50);
  });

  it('does not touch ambiguous rows with both markers', () => {
    const row = { ...base, amount: -3000, description: 'Plata salariu angajat' };
    expect(applyDirectionHint(row).amount).toBe(-3000);
  });

  it('does not touch rows without any direction marker', () => {
    const row = { ...base, amount: -42, description: 'Transfer XYZ', merchant: 'Cash' };
    expect(applyDirectionHint(row).amount).toBe(-42);
  });

  it('matches markers in the merchant field too', () => {
    const row = { ...base, amount: -700, description: undefined, merchant: 'Rambursare asigurare' };
    expect(applyDirectionHint(row).amount).toBe(700);
  });
});
