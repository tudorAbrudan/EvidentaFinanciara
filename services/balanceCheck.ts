/**
 * Soldul din extras vs. soldul calculat de aplicație.
 *
 * Fiindcă toate datele vin din extrase, soldul tipărit de bancă e cea mai bună
 * plasă de siguranță: prinde ce B1 nu vede — extras importat, dar cu tranzacții
 * șterse, marcate greșit ca duplicat sau editate. B1 răspunde la „am extrasul?",
 * asta răspunde la „e întreg ce am importat din el?".
 *
 * Modul pur: primește extrasul, tranzacțiile contului și contul; nu atinge DB.
 */
import { getBankStatementsForAccount } from './bankStatements';
import { getFinancialAccount } from './financialAccounts';
import { createTransaction, getTransactions, unmarkDuplicate } from './transactions';

import type { BankStatement, FinancialAccount, Transaction } from '@/types';

/** Un ban. Sub atât, diferența e zgomot de virgulă mobilă, nu o tranzacție. */
const TOLERANCE = 0.01;

export type BalanceDiagnosis =
  /** Ambele capete se potrivesc. */
  | 'ok'
  /** Extrasul nu tipărește soldurile (CSV, PDF generic, AI) — nu afirmăm nimic. */
  | 'unverifiable'
  /** Soldul de început nu bate: cauza e dinainte de acest extras. */
  | 'before_statement'
  /** Începutul bate, sfârșitul nu: ceva s-a pierdut din interiorul extrasului. */
  | 'inside_statement';

export interface BalanceCheck {
  diagnosis: BalanceDiagnosis;
  /** Soldul aplicației în ziua dinaintea perioadei, în valuta contului. */
  app_opening: number | null;
  statement_opening: number | null;
  /** `extras − aplicație` la începutul perioadei. */
  opening_diff: number | null;
  app_closing: number | null;
  statement_closing: number | null;
  /** `extras − aplicație` la sfârșitul perioadei. */
  closing_diff: number | null;
  /**
   * Tranzacție marcată ca duplicat a cărei sumă explică exact diferența. Fiind
   * marcată, e scoasă din soldul aplicației — dacă suma ei e chiar diferența,
   * marcajul e aproape sigur greșit.
   */
  duplicate_suspect: { id: string; date: string; amount: number } | null;
  /** Câte tranzacții lipsesc față de câte a adus importul. */
  missing_transactions: number;
  message: string;
}

/** Descrierea tranzacției create de „Aliniază la extras". */
export const ADJUSTMENT_DESCRIPTION = 'Ajustare sold la extras';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function previousDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** „4215.3" → „4.215,30", fără Intl: pe Hermes nu e garantat complet. */
function formatAmount(value: number): string {
  const negative = value < 0;
  const [whole = '0', decimals = '00'] = Math.abs(value).toFixed(2).split('.');
  let grouped = '';
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += '.';
    grouped += whole[i];
  }
  return `${negative ? '−' : ''}${grouped},${decimals}`;
}

/**
 * Soldul aplicației la sfârșitul zilei `date`.
 *
 * Aceeași regulă ca `getCurrentBalance` — sold inițial plus sumele brute, fără
 * duplicate — cu două precizări: se oprește la data cerută, iar soldul inițial
 * intră doar dacă data lui e deja trecută. Transferurile interne rămân înăuntru:
 * banii chiar au plecat din cont, indiferent că au ajuns în alt cont al userului.
 */
function appBalanceAt(account: FinancialAccount, txs: Transaction[], date: string): number {
  const base =
    account.initial_balance_date == null || account.initial_balance_date <= date
      ? account.initial_balance
      : 0;
  const sum = txs
    .filter(t => t.duplicate_of_id == null && t.date <= date)
    .reduce((acc, t) => acc + t.amount, 0);
  return round2(base + sum);
}

/**
 * Compară soldurile tipărite pe extras cu ce calculează aplicația.
 *
 * @param statement extrasul importat, cu soldurile din antet dacă le are
 * @param accountTxs toate tranzacțiile contului (nu doar cele din extras):
 *   soldul la o dată depinde de tot istoricul de dinaintea ei
 * @param account contul, pentru soldul inițial și valută
 */
export function diagnoseBalance(
  statement: BankStatement,
  accountTxs: Transaction[],
  account: FinancialAccount
): BalanceCheck {
  const empty: BalanceCheck = {
    diagnosis: 'unverifiable',
    app_opening: null,
    statement_opening: null,
    opening_diff: null,
    app_closing: null,
    statement_closing: null,
    closing_diff: null,
    duplicate_suspect: null,
    missing_transactions: 0,
    message: 'Extrasul nu tipărește soldurile, deci nu poate fi verificat.',
  };

  const stOpening = statement.opening_balance;
  const stClosing = statement.closing_balance;
  if (stOpening === undefined || stClosing === undefined) return empty;

  const appOpening = appBalanceAt(account, accountTxs, previousDay(statement.period_from));
  const appClosing = appBalanceAt(account, accountTxs, statement.period_to);
  const openingDiff = round2(stOpening - appOpening);
  const closingDiff = round2(stClosing - appClosing);

  const base = {
    app_opening: appOpening,
    statement_opening: stOpening,
    opening_diff: openingDiff,
    app_closing: appClosing,
    statement_closing: stClosing,
    closing_diff: closingDiff,
  };

  if (Math.abs(openingDiff) > TOLERANCE) {
    return {
      ...base,
      diagnosis: 'before_statement',
      duplicate_suspect: null,
      missing_transactions: 0,
      message:
        `Soldul de la începutul extrasului nu se potrivește. La ${previousDay(statement.period_from)} ` +
        `extrasul pornește de la ${formatAmount(stOpening)} ${account.currency}, aplicația calculează ` +
        `${formatAmount(appOpening)} ${account.currency}. Diferența de ${formatAmount(Math.abs(openingDiff))} ` +
        `${account.currency} vine dinainte de acest extras.`,
    };
  }

  if (Math.abs(closingDiff) <= TOLERANCE) {
    return {
      ...base,
      diagnosis: 'ok',
      duplicate_suspect: null,
      missing_transactions: 0,
      message: `Soldul la ${statement.period_to} se potrivește cu extrasul (${formatAmount(stClosing)} ${account.currency}).`,
    };
  }

  const fromStatement = accountTxs.filter(t => t.statement_id === statement.id);
  const kept = fromStatement.filter(t => t.duplicate_of_id == null);
  const missing = Math.max(0, statement.transaction_count - kept.length);

  // O tranzacție marcată duplicat e scoasă din soldul aplicației. Dacă suma ei e
  // chiar diferența, marcajul explică singur nepotrivirea.
  const suspect =
    fromStatement.find(
      t => t.duplicate_of_id != null && Math.abs(t.amount - closingDiff) <= TOLERANCE
    ) ?? null;

  const head =
    `Soldul ${account.name} la ${statement.period_to}: extrasul spune ` +
    `${formatAmount(stClosing)} ${account.currency}, aplicația calculează ` +
    `${formatAmount(appClosing)} ${account.currency}. Diferență: ` +
    `${formatAmount(Math.abs(closingDiff))} ${account.currency}.`;

  let tail: string;
  if (suspect !== null) {
    tail =
      ` Tranzacția din ${suspect.date}, ${formatAmount(Math.abs(suspect.amount))} ${account.currency}, ` +
      `e marcată ca duplicat. Dacă nu e duplicat, anulează marcajul.`;
  } else if (missing > 0) {
    tail =
      ` Din extras lipsesc ${missing} ${missing === 1 ? 'tranzacție' : 'tranzacții'} față de câte a adus importul. ` +
      `Re-importă extrasul.`;
  } else {
    tail = ' Probabil o sumă editată manual. Re-importă extrasul.';
  }

  return {
    ...base,
    diagnosis: 'inside_statement',
    duplicate_suspect:
      suspect === null ? null : { id: suspect.id, date: suspect.date, amount: suspect.amount },
    missing_transactions: missing,
    message: head + tail,
  };
}

export interface StatementBalanceCheck {
  statement: BankStatement;
  check: BalanceCheck;
}

/**
 * Toate tranzacțiile contului, inclusiv cele marcate duplicat.
 *
 * `getTransactions` le ascunde implicit, dar aici sunt necesare de două ori: o
 * tranzacție marcată duplicat e scoasă din soldul aplicației (deci explică o
 * diferență), iar diagnosticul trebuie s-o poată numi.
 */
function allAccountTransactions(accountId: string): Promise<Transaction[]> {
  return getTransactions({ account_id: accountId, excludeDuplicates: false });
}

/**
 * Diagnosticul pentru cel mai recent extras al contului care tipărește solduri.
 *
 * Primește `accountId`, nu contul: ecranele îl apelează din `useFocusEffect`,
 * iar o dependență de obiectul contului s-ar schimba la fiecare reîmprospătare
 * și ar reporni efectul la nesfârșit.
 */
export async function loadLatestBalanceCheck(
  accountId: string
): Promise<StatementBalanceCheck | null> {
  const account = await getFinancialAccount(accountId);
  if (account === null) return null;

  // Lista vine ordonată descrescător după `period_to`.
  const statements = await getBankStatementsForAccount(accountId);
  const verifiable = statements.find(
    s => s.opening_balance !== undefined && s.closing_balance !== undefined
  );
  if (verifiable === undefined) return null;

  const txs = await allAccountTransactions(accountId);
  return { statement: verifiable, check: diagnoseBalance(verifiable, txs, account) };
}

/** Diagnosticul unui extras anume — folosit imediat după import. */
export async function loadBalanceCheckForStatement(
  statementId: string,
  accountId: string
): Promise<BalanceCheck | null> {
  const account = await getFinancialAccount(accountId);
  if (account === null) return null;

  const statement = (await getBankStatementsForAccount(accountId)).find(s => s.id === statementId);
  if (statement === undefined) return null;

  const txs = await allAccountTransactions(accountId);
  return diagnoseBalance(statement, txs, account);
}

/**
 * „Aliniază la extras": userul hotărăște că extrasul are dreptate.
 *
 * Creează o tranzacție cu exact diferența rămasă, pe ultima zi a perioadei.
 * `source = 'adjustment'` o ține în afara analizelor de cheltuieli și venituri:
 * corectează soldul, dar n-a fost o plată, ci recunoașterea că lipsea ceva.
 */
export async function alignToStatement(
  statement: BankStatement,
  accountId: string,
  diff: number
): Promise<void> {
  if (Math.abs(diff) <= TOLERANCE) return;
  const account = await getFinancialAccount(accountId);
  if (account === null) return;

  await createTransaction({
    account_id: accountId,
    date: statement.period_to,
    amount: diff,
    currency: account.currency,
    description: ADJUSTMENT_DESCRIPTION,
    source: 'adjustment',
    statement_id: statement.id,
  });
}

/** „Nu e duplicat": scoate marcajul de pe tranzacția numită de diagnostic. */
export async function clearDuplicateSuspect(check: BalanceCheck): Promise<void> {
  if (check.duplicate_suspect === null) return;
  await unmarkDuplicate(check.duplicate_suspect.id);
}
