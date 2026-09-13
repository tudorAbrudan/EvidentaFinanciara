import type { PdfStatementInfo } from './bankStatementPdfParser';

export type StatementPeriodSource = 'header' | 'inferred';

export interface StatementFacts {
  period_from: string;
  period_to: string;
  period_source: StatementPeriodSource;
  opening_balance: number | null;
  closing_balance: number | null;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Soldurile sunt în valuta extrasului. Dacă extrasul e al altui cont decât cel
 * ales la import (ușor de greșit: BT RON și BT EUR arată la fel în listă), o
 * verificare ulterioară de sold ar compara lei cu euro. Când una dintre valute
 * lipsește, nu blocăm: nu avem pe ce să ne bazăm refuzul.
 */
function currencyMatches(info: PdfStatementInfo, expected?: string | null): boolean {
  if (!info.currency || !expected) return true;
  return info.currency.toUpperCase() === expected.toUpperCase();
}

/**
 * Faptele unui import de extras, așa cum ajung în `bank_statements`.
 *
 * **Perioada.** Cea tipărită pe extras, când parserul a validat-o (`header`).
 * Altfel, intervalul dintre prima și ultima tranzacție (`inferred`). Diferența
 * contează: un extras pe iunie cu prima plată pe 3 iunie s-ar salva ca „3–28
 * iunie", iar detectarea extraselor lipsă ar raporta un gol fals la început de
 * lună și n-ar vedea zilele rămase neacoperite la sfârșit.
 *
 * **Soldurile.** Se păstrează doar împreună cu perioada din antet — ele descriu
 * exact acel interval — și doar dacă valuta extrasului se potrivește cu a
 * contului.
 *
 * Întoarce `null` când nu există nici perioadă validată, nici tranzacții datate.
 */
export function resolveStatementFacts(
  rowDates: string[],
  info?: PdfStatementInfo | null,
  accountCurrency?: string | null
): StatementFacts | null {
  if (info?.periodFrom && info.periodTo) {
    const keepBalances = currencyMatches(info, accountCurrency);
    return {
      period_from: info.periodFrom,
      period_to: info.periodTo,
      period_source: 'header',
      opening_balance: keepBalances ? (info.openingBalance ?? null) : null,
      closing_balance: keepBalances ? (info.closingBalance ?? null) : null,
    };
  }

  const dates = rowDates.filter(d => YMD_RE.test(d)).sort();
  if (dates.length === 0) return null;

  return {
    period_from: dates[0],
    period_to: dates[dates.length - 1],
    period_source: 'inferred',
    opening_balance: null,
    closing_balance: null,
  };
}
