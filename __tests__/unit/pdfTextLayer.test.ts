/**
 * Teste pentru extractorul pur de text layer PDF.
 *
 * Content stream-urile sunt scrise de mână — verificăm că operatorii de
 * poziționare (`Tm`, `Td`, `TD`, `T*`, `TL`) produc linii în ordinea de
 * citire, independent de ordinea din stream.
 */

import {
  isUsableExtraction,
  linesToText,
  parseContentStreamPositioned,
  type GlyphMap,
} from '@/services/pdfTextLayer';

const NO_FONTS = new Map<string, GlyphMap>();

describe('parseContentStreamPositioned', () => {
  it('emite două linii pentru două `Td` cu y diferit, în ordinea corectă', () => {
    const content = 'BT /F1 10 Tf 100 700 Td (Prima linie) Tj 0 -20 Td (A doua linie) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines).toHaveLength(2);
    expect(lines[0].y).toBeCloseTo(700, 3);
    expect(lines[0].spans.map(s => s.text)).toEqual(['Prima linie']);
    expect(lines[1].y).toBeCloseTo(680, 3);
    expect(lines[1].spans.map(s => s.text)).toEqual(['A doua linie']);
  });

  it('sortează după y, nu după ordinea din stream, când `Tm` repoziționează deasupra', () => {
    const content = 'BT /F1 10 Tf 1 0 0 1 50 100 Tm (Jos) Tj 1 0 0 1 50 500 Tm (Sus) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines.map(l => l.spans[0].text)).toEqual(['Sus', 'Jos']);
  });

  it('unește un array `TJ` cu kerning într-un singur span, fără spații parazite', () => {
    const content = 'BT /F1 10 Tf 1 0 0 1 10 200 Tm [(Ba)-120(nca)-800( Transilvania)] TJ ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toHaveLength(1);
    expect(lines[0].spans[0].text).toBe('Banca Transilvania');
  });

  it('grupează două span-uri de pe același y într-o linie, ordonate după x', () => {
    const content =
      'BT /F1 10 Tf 1 0 0 1 200 300 Tm (dreapta) Tj 1 0 0 1 100 300 Tm (stanga) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines).toHaveLength(1);
    expect(lines[0].spans.map(s => s.x)).toEqual([100, 200]);
    expect(lines[0].spans.map(s => s.text)).toEqual(['stanga', 'dreapta']);
  });

  it('tratează diferențe de y sub toleranță ca aceeași linie', () => {
    const content =
      'BT /F1 10 Tf 1 0 0 1 20 300.9 Tm (eticheta) Tj 1 0 0 1 400 300 Tm (12,34) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines).toHaveLength(1);
    expect(lines[0].spans.map(s => s.text)).toEqual(['eticheta', '12,34']);
  });

  it('avansează pe linie nouă la `T*` folosind leading-ul din `TL`', () => {
    const content = 'BT /F1 10 Tf 12 TL 1 0 0 1 20 400 Tm (Prima) Tj T* (A doua) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines).toHaveLength(2);
    expect(lines[0].y).toBeCloseTo(400, 3);
    expect(lines[1].y).toBeCloseTo(388, 3);
    expect(lines[1].spans[0].x).toBeCloseTo(20, 3);
  });

  it('setează leading-ul din `TD` și îl refolosește la `T*`', () => {
    const content = 'BT /F1 10 Tf 1 0 0 1 20 400 Tm (A) Tj 0 -15 TD (B) Tj T* (C) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines.map(l => Math.round(l.y))).toEqual([400, 385, 370]);
  });

  it('resetează starea textului la fiecare `BT`', () => {
    const content = 'BT /F1 10 Tf 100 700 Td (Sus) Tj ET BT /F1 10 Tf 0 500 Td (Mai jos) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines.map(l => Math.round(l.y))).toEqual([700, 500]);
    expect(lines[1].spans[0].x).toBeCloseTo(0, 3);
  });

  it('ține cont de scala din `Tm` pentru mărimea efectivă a fontului', () => {
    const content = 'BT 8 0 0 8 90 400 Tm /F1 1 Tf (text) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines[0].spans[0].size).toBeCloseTo(8, 3);
  });

  it('decodează textul prin glyph map-ul fontului curent', () => {
    const map: GlyphMap = new Map([
      [0x01, 'A'],
      [0x02, 'B'],
    ]);
    const fonts = new Map<string, GlyphMap>([['G1', map]]);
    const content = 'BT 10 0 0 10 0 100 Tm /G1 1 Tf <00010002> Tj ET';
    const lines = parseContentStreamPositioned(content, fonts);

    expect(lines[0].spans[0].text).toBe('AB');
  });

  it('nu confundă textul dintr-un string cu operatori', () => {
    const content = 'BT /F1 10 Tf 1 0 0 1 10 100 Tm (BT 0 -20 Td text ET) Tj ET';
    const lines = parseContentStreamPositioned(content, NO_FONTS);

    expect(lines).toHaveLength(1);
    expect(lines[0].spans[0].text).toBe('BT 0 -20 Td text ET');
  });
});

describe('linesToText', () => {
  it('unește span-urile apropiate cu un singur spațiu', () => {
    const content =
      'BT /F1 10 Tf 1 0 0 1 100 300 Tm (stanga) Tj 1 0 0 1 140 300 Tm (dreapta) Tj ET';
    const out = linesToText(parseContentStreamPositioned(content, NO_FONTS));

    expect(out).toEqual(['stanga dreapta']);
  });

  it('sparge coloanele îndepărtate în linii separate', () => {
    const content =
      'BT /F1 10 Tf 1 0 0 1 90 300 Tm (Plata la POS) Tj 1 0 0 1 450 300 Tm (1.234,56) Tj ET';
    const out = linesToText(parseContentStreamPositioned(content, NO_FONTS));

    expect(out).toEqual(['Plata la POS', '1.234,56']);
  });

  it('elimină liniile rămase goale după split (celule fără valoare)', () => {
    const content = 'BT /F1 10 Tf 1 0 0 1 90 300 Tm (Comision) Tj 1 0 0 1 550 300 Tm (   ) Tj ET';
    const out = linesToText(parseContentStreamPositioned(content, NO_FONTS));

    expect(out).toEqual(['Comision']);
  });
});

describe('isUsableExtraction', () => {
  it('acceptă un text cu destule linii și sume', () => {
    const text =
      Array.from({ length: 12 }, (_, i) => `linia ${i}`).join('\n') + '\n1.234,56\n99,00\n12.00';
    expect(isUsableExtraction(text)).toBe(true);
  });

  it('respinge un text cu prea puține linii', () => {
    expect(isUsableExtraction('doar\ndoua linii\n1.234,56\n99,00\n12.00')).toBe(false);
  });

  it('respinge un text fără sume sau date', () => {
    const text = Array.from({ length: 20 }, (_, i) => `linia fara cifre ${'x'.repeat(i)}`).join(
      '\n'
    );
    expect(isUsableExtraction(text)).toBe(false);
  });

  it('acceptă un text cu date în loc de sume', () => {
    const text =
      Array.from({ length: 12 }, (_, i) => `linia ${i}`).join('\n') +
      '\n01/06/2026\n02/06/2026\n03/06/2026';
    expect(isUsableExtraction(text)).toBe(true);
  });

  it('respinge textul gol', () => {
    expect(isUsableExtraction('')).toBe(false);
  });
});
