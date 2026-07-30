/**
 * Teste pentru orchestratorul de extragere PDF.
 *
 * Verificăm doar decizia „text layer vs OCR" și warning-urile — decodarea
 * propriu-zisă e testată în `pdfTextLayer.test.ts`.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { extractTextFromPdf } from '@/services/pdfExtractor';
import { extractTextFromPdfViaOcr } from '@/services/pdfOcr';
import { countPdfPages, isUsableExtraction, parsePdf } from '@/services/pdfTextLayer';

jest.mock('@/services/pdfOcr', () => ({
  extractTextFromPdfViaOcr: jest.fn(),
}));

jest.mock('@/services/pdfTextLayer', () => ({
  parsePdf: jest.fn(),
  isUsableExtraction: jest.fn(),
  countPdfPages: jest.fn(),
}));

const readAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const ocr = extractTextFromPdfViaOcr as jest.Mock;
const parse = parsePdf as jest.Mock;
const usable = isUsableExtraction as jest.Mock;
const pageCount = countPdfPages as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  readAsStringAsync.mockResolvedValue('BASE64');
  pageCount.mockReturnValue(1);
});

describe('extractTextFromPdf', () => {
  it('folosește text layer-ul când e utilizabil și nu apelează OCR', async () => {
    parse.mockReturnValue('BANCA TRANSILVANIA\n02/06/2026\n300.00');
    usable.mockReturnValue(true);

    const result = await extractTextFromPdf('file:///extras.pdf');

    expect(result.source).toBe('text-layer');
    expect(result.text).toContain('BANCA TRANSILVANIA');
    expect(result.warnings).toEqual([]);
    expect(ocr).not.toHaveBeenCalled();
  });

  it('cade pe OCR când text layer-ul nu trece quality gate-ul', async () => {
    parse.mockReturnValue('doar cateva cuvinte');
    usable.mockReturnValue(false);
    ocr.mockResolvedValue('text din OCR');

    const result = await extractTextFromPdf('file:///scan.pdf');

    expect(result.source).toBe('ocr');
    expect(result.text).toBe('text din OCR');
    expect(result.warnings.some(w => w.includes('OCR'))).toBe(true);
  });

  it('avertizează explicit când OCR-ul procesează doar o parte din pagini', async () => {
    parse.mockReturnValue('');
    usable.mockReturnValue(false);
    pageCount.mockReturnValue(24);
    ocr.mockResolvedValue('text din OCR');

    const result = await extractTextFromPdf('file:///lung.pdf');

    expect(result.warnings.some(w => w.includes('24'))).toBe(true);
  });

  it('nu avertizează despre pagini când documentul intră în limită', async () => {
    parse.mockReturnValue('');
    usable.mockReturnValue(false);
    pageCount.mockReturnValue(8);
    ocr.mockResolvedValue('text din OCR');

    const result = await extractTextFromPdf('file:///scurt.pdf');

    expect(result.warnings).toHaveLength(1);
  });

  it('cade pe OCR și când parserul de text layer aruncă', async () => {
    parse.mockImplementation(() => {
      throw new Error('stream corupt');
    });
    ocr.mockResolvedValue('text din OCR');

    const result = await extractTextFromPdf('file:///corupt.pdf');

    expect(result.source).toBe('ocr');
    expect(result.text).toBe('text din OCR');
  });

  it('întoarce text gol cu warning când nici OCR-ul nu produce nimic', async () => {
    parse.mockReturnValue('');
    usable.mockReturnValue(false);
    ocr.mockResolvedValue('');

    const result = await extractTextFromPdf('file:///gol.pdf');

    expect(result.text).toBe('');
    expect(result.warnings.some(w => w.includes('Nu s-a putut extrage'))).toBe(true);
  });

  it('încearcă OCR-ul chiar dacă fișierul nu poate fi citit ca base64', async () => {
    readAsStringAsync.mockRejectedValue(new Error('ENOENT'));
    ocr.mockResolvedValue('text din OCR');

    const result = await extractTextFromPdf('/fara/schema.pdf');

    expect(parse).not.toHaveBeenCalled();
    expect(result.source).toBe('ocr');
    expect(result.text).toBe('text din OCR');
  });

  it('normalizează calea fără schemă înainte de citire', async () => {
    parse.mockReturnValue('text');
    usable.mockReturnValue(true);

    await extractTextFromPdf('/tmp/extras.pdf');

    expect(readAsStringAsync).toHaveBeenCalledWith('file:///tmp/extras.pdf', expect.anything());
  });
});
