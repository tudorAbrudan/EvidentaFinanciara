/**
 * Extragere text din PDF via render pagini → ML Kit OCR.
 * Folosește modulul nativ PdfRenderer (iOS PDFKit) pentru a converti
 * fiecare pagină în JPEG, apoi rulează ML Kit OCR pe fiecare imagine.
 *
 * Fallback robust pentru orice tip de PDF (scan, encoding custom etc.)
 */

import { extractText } from '@/services/ocr';
import * as FileSystem from 'expo-file-system/legacy';
import { EncodingType } from 'expo-file-system/legacy';

// Import lazy pentru a evita crash dacă modulul nativ nu e disponibil în build
let _getPdfPageCount: ((filePath: string) => Promise<number>) | null = null;
let _renderPdfPage:
  | ((filePath: string, pageIndex: number, scale: number) => Promise<string>)
  | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@/modules/pdf-renderer/src');
  _getPdfPageCount = mod.getPdfPageCount;
  _renderPdfPage = mod.renderPdfPage;
} catch {
  // Modulul nativ PdfRenderer nu e disponibil în acest build
}

const MAX_PAGES = 10; // limităm la primele 10 pagini

/**
 * Extrage text din PDF redând fiecare pagină ca imagine și rulând ML Kit OCR.
 * @param fileUri URI local (file:// sau path absolut)
 * @returns textul extras concatenat din toate paginile
 */
export async function extractTextFromPdfViaOcr(fileUri: string): Promise<string> {
  if (!_getPdfPageCount || !_renderPdfPage) {
    console.log('[pdfOcr] modul nativ PdfRenderer indisponibil');
    return '';
  }

  const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;

  let pageCount: number;
  try {
    pageCount = await _getPdfPageCount(uri);
    console.log(`[pdfOcr] ${pageCount} pagini`);
  } catch (e) {
    console.log('[pdfOcr] eroare getPageCount:', e instanceof Error ? e.message : String(e));
    return '';
  }

  const pagesToProcess = Math.min(pageCount, MAX_PAGES);
  const texts: string[] = [];

  for (let i = 0; i < pagesToProcess; i++) {
    let imageUri: string | null = null;
    try {
      // Redăm pagina ca JPEG (scale 1.5 = ~150 DPI, suficient pentru OCR)
      imageUri = await _renderPdfPage(uri, i, 1.5);
      const result = await extractText(imageUri);
      if (result.text.trim()) {
        texts.push(result.text.trim());
        console.log(`[pdfOcr] pagina ${i + 1}: ${result.text.length} chars`);
      }
    } catch (e) {
      console.log(`[pdfOcr] eroare pagina ${i}:`, e instanceof Error ? e.message : String(e));
    } finally {
      // Ștergem imaginea temp după OCR
      if (imageUri) {
        const path = imageUri.startsWith('file://') ? imageUri.slice(7) : imageUri;
        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      }
    }
  }

  const combined = texts.join('\n');
  console.log(`[pdfOcr] total ${combined.length} chars din ${pagesToProcess} pagini`);
  return combined;
}

/**
 * Randează toate paginile unui PDF ca JPEG și returnează array de base64 (pentru export PDF).
 * Paginile care eșuează sunt sărite silențios.
 */
export async function renderAllPdfPagesAsBase64(fileUri: string): Promise<string[]> {
  if (!_getPdfPageCount || !_renderPdfPage) return [];

  const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
  let pageCount = 0;
  try {
    pageCount = await _getPdfPageCount(uri);
  } catch {
    return [];
  }

  const results: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    let imageUri: string | null = null;
    try {
      imageUri = await _renderPdfPage(uri, i, 2.0);
      const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: EncodingType.Base64 });
      results.push(base64);
    } catch {
      // pagina nu poate fi randată — continuăm
    } finally {
      if (imageUri) {
        const path = imageUri.startsWith('file://') ? imageUri.slice(7) : imageUri;
        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      }
    }
  }
  return results;
}

/**
 * Randează prima pagină din PDF ca JPEG și returnează base64 (pentru vision AI).
 * Returnează null dacă modulul nativ nu e disponibil sau dacă randarea eșuează.
 */
export async function renderPdfFirstPageForVision(fileUri: string): Promise<string | null> {
  if (!_renderPdfPage) return null;

  const uri = fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`;
  let imageUri: string | null = null;
  try {
    // scale 2.0 = ~200 DPI, mai clar pentru vision AI
    imageUri = await _renderPdfPage(uri, 0, 2.0);
    const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: EncodingType.Base64 });
    return base64;
  } catch (e) {
    console.log('[pdfOcr] renderForVision eroare:', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    if (imageUri) {
      const path = imageUri.startsWith('file://') ? imageUri.slice(7) : imageUri;
      FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
  }
}
