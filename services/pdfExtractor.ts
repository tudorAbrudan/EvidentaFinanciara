/**
 * Orchestrator pentru extragerea textului dintr-un PDF.
 *
 * Text layer first: PDF-urile generate de bănci au text layer perfect, deci
 * încercăm întâi parserul pur din `pdfTextLayer.ts`. OCR-ul (render pagini +
 * ML Kit) rămâne fallback pentru scanuri și poze — e mai lent, pierde
 * structura tabelului și taie documentul la primele pagini.
 *
 * Singurul modul din lanț care depinde de Expo; logica de decodare e pură și
 * stă în `pdfTextLayer.ts` (rulează și în Node, vezi `npm run parse:pdf`).
 */

import * as FileSystem from 'expo-file-system/legacy';

import { extractTextFromPdfViaOcr } from '@/services/pdfOcr';
import { countPdfPages, isUsableExtraction, parsePdf } from '@/services/pdfTextLayer';

/**
 * Câte pagini procesează OCR-ul (`MAX_PAGES` din `services/pdfOcr.ts`).
 * Îl ținem aici doar ca să putem avertiza userul când documentul e mai lung —
 * altfel tăierea ar fi silențioasă.
 */
const OCR_MAX_PAGES = 10;

export interface PdfExtractionResult {
  text: string;
  source: 'text-layer' | 'ocr';
  warnings: string[];
}

export async function extractTextFromPdf(fileUri: string): Promise<PdfExtractionResult> {
  const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;

  let base64: string | null = null;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e) {
    console.log('[pdfExtractor] nu s-a putut citi fișierul:', errMsg(e));
  }

  if (base64) {
    try {
      const text = parsePdf(base64);
      if (isUsableExtraction(text)) {
        console.log(`[pdfExtractor] text layer: ${text.length} chars`);
        return { text, source: 'text-layer', warnings: [] };
      }
      console.log('[pdfExtractor] text layer insuficient — trecem pe OCR');
    } catch (e) {
      console.log('[pdfExtractor] eroare parser text layer:', errMsg(e));
    }
  }

  const warnings = ['Textul a fost citit prin OCR — verifică tranzacțiile cu atenție.'];
  if (base64) {
    const pageCount = countPdfPages(base64);
    if (pageCount > OCR_MAX_PAGES) {
      warnings.push(
        `Doar primele ${OCR_MAX_PAGES} pagini au fost procesate (extrasul are ${pageCount}).`
      );
    }
  }

  try {
    const ocrText = await extractTextFromPdfViaOcr(fileUri);
    if (ocrText.length > 0) {
      console.log(`[pdfExtractor] OCR imagini: ${ocrText.length} chars`);
      return { text: ocrText, source: 'ocr', warnings };
    }
  } catch (e) {
    console.log('[pdfExtractor] eroare OCR imagini:', errMsg(e));
  }

  return {
    text: '',
    source: 'ocr',
    warnings: ['Nu s-a putut extrage text din PDF — nici din text layer, nici prin OCR.'],
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
