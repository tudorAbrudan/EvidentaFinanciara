/**
 * Rulează extractorul de text layer + parserul de extrase pe un PDF local și
 * tipărește raportul de reconciliere.
 *
 * Rulare: `npm run parse:pdf -- ~/Downloads/"Iunie 2026.pdf"`
 *
 * Există ca să putem verifica parserul pe extrase reale **fără să le commitem**.
 * Importă doar module pure (fără Expo) — dacă nu mai compilează în Node,
 * `services/pdfTextLayer.ts` a căpătat o dependență pe care n-ar trebui s-o aibă.
 */

import { readFileSync } from 'node:fs';

import {
  formatAmountRo,
  isFullyReconciled,
  parseStatementPdf,
} from '../services/bankStatementPdfParser.ts';
import { countPdfPages, isUsableExtraction, parsePdf } from '../services/pdfTextLayer.ts';

const PREVIEW_ROWS = 10;

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('Folosire: npm run parse:pdf -- <cale-catre-extras.pdf>');
    process.exitCode = 1;
    return;
  }

  const base64 = readFileSync(path).toString('base64');
  const text = parsePdf(base64);
  const usable = isUsableExtraction(text);
  const source = usable ? 'text-layer' : 'ocr (necesar — text layer inutilizabil)';

  console.log(`Fișier:  ${path}`);
  console.log(`Pagini:  ${countPdfPages(base64)}`);
  console.log(`Sursă:   ${source}`);
  console.log(`Text:    ${text.length} caractere, ${text.split('\n').length} linii`);

  if (!usable) {
    console.log('\nText layer-ul nu trece quality gate-ul; în app s-ar folosi OCR.');
  }

  const result = parseStatementPdf(text);
  console.log(`Format:  ${result.format}`);
  console.log(`Rânduri: ${result.rows.length}`);

  const debit = result.rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const credit = result.rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const currency = result.rows[0]?.currency ?? '';
  console.log(`Cheltuieli: ${formatAmountRo(debit)} ${currency}`);
  console.log(`Venituri:   ${formatAmountRo(credit)} ${currency}`);

  const rec = result.reconciliation;
  if (rec) {
    console.log('\n─── Reconciliere ───────────────────────────────────────────');
    for (const day of rec.days) {
      const mark = day.ok ? '✓' : '✗';
      const detail = day.ok
        ? `debit ${formatAmountRo(day.actualDebit)} · credit ${formatAmountRo(day.actualCredit)}`
        : `calculat ${formatAmountRo(day.actualDebit)}/${formatAmountRo(day.actualCredit)} ` +
          `vs extras ${formatAmountRo(day.expectedDebit)}/${formatAmountRo(day.expectedCredit)}`;
      console.log(`  ${mark} ${day.date}  ${detail}`);
    }
    const okDays = rec.days.filter(d => d.ok).length;
    console.log(`\n  Zile reconciliate: ${okDays}/${rec.days.length}`);
    console.log(
      `  Total debit:  ${formatAmountRo(rec.totals.actualDebit)} ` +
        `(extras ${formatAmountRo(rec.totals.expectedDebit)}) ${rec.totals.ok ? '✓' : '✗'}`
    );
    console.log(
      `  Total credit: ${formatAmountRo(rec.totals.actualCredit)} ` +
        `(extras ${formatAmountRo(rec.totals.expectedCredit)}) ${rec.totals.ok ? '✓' : '✗'}`
    );
    console.log(`  Tranzacții: ${rec.transactionCount} · referințe în extras: ${rec.refCount}`);
    console.log(
      `\n  ${isFullyReconciled(rec) ? '✓ Extras reconciliat integral' : '✗ Extrasul NU se reconciliază integral'}`
    );
  } else {
    console.log('\nParserul nu produce reconciliere pentru acest format.');
  }

  console.log(`\n─── Primele ${PREVIEW_ROWS} rânduri ────────────────────────────`);
  for (const row of result.rows.slice(0, PREVIEW_ROWS)) {
    const amount = `${row.amount > 0 ? '+' : ''}${formatAmountRo(row.amount)}`;
    console.log(
      `  ${row.date}  ${amount.padStart(12)} ${row.currency}  ` +
        `${(row.merchant ?? row.description ?? '').slice(0, 46)}`
    );
  }

  if (result.warnings.length > 0) {
    console.log('\n─── Avertismente ───────────────────────────────────────────');
    for (const w of result.warnings) console.log(`  • ${w}`);
  } else {
    console.log('\nFără avertismente.');
  }
}

main();
