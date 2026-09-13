/**
 * Numerarul retras — cheltuiala care azi dispare din cifre.
 *
 * Userul nu notează cheltuielile în numerar. Când acceptă sugestia „transfer
 * intern cash", retragerea devine `is_internal_transfer = 1` și iese din toate
 * agregările: banii scoși de la bancomat nu mai apar nicăieri, iar luna pare
 * mai ieftină decât a fost. Regula de aici îi readuce, ca pseudo-categorie.
 *
 * Se aplică **doar în agregări**; baza de date rămâne neatinsă.
 *
 * Modul pur: primește tranzacțiile și conturile, nu atinge DB.
 */
import { db } from './db';
import { getFinancialAccounts } from './financialAccounts';
import { detectTransferType } from './internalTransferSuggestion';

import type { FinancialAccount, Transaction } from '@/types';

/** Id sintetic, nu un rând în DB: pseudo-categoria nu se salvează nicăieri. */
export const CASH_WITHDRAWN_CATEGORY_ID = 'cat-sys-cash-withdrawn';
export const CASH_WITHDRAWN_LABEL = 'Numerar retras';

export interface CashWithdrawalResult {
  /**
   * Cât se **adaugă** la cheltuielile lunii (RON, pozitiv).
   *
   * Provine doar din retragerile convertite în transfer intern: acelea sunt
   * astăzi excluse din totaluri. Retragerile neconvertite sunt deja numărate,
   * deci nu se adună a doua oară.
   */
  added_ron: number;
  /**
   * Retrageri neconvertite: deja cheltuieli, dar stau în altă categorie. Se
   * **mută** în pseudo-categorie, ca numerarul să fie comparabil lună de lună
   * indiferent dacă userul a acceptat sugestia sau nu.
   */
  relocated_ron: number;
  relocated_tx_ids: string[];
  /**
   * Retragerile convertite care au fost numărate (partea pozitivă de pe contul
   * cash). Împreună cu `relocated_tx_ids` formează drilldown-ul pseudo-categoriei:
   * fără ele, cardul s-ar deschide într-o listă goală.
   */
  counted_tx_ids: string[];
  /** Totalul afișat pe pseudo-categorie: adăugat + mutat. */
  total_ron: number;
}

const EMPTY: CashWithdrawalResult = {
  added_ron: 0,
  relocated_ron: 0,
  relocated_tx_ids: [],
  counted_tx_ids: [],
  total_ron: 0,
};

/**
 * Suma în RON, sau `null` când lipsește cursul.
 *
 * Aceeași regulă ca `amountRonSql`: pentru o tranzacție în valută fără curs nu
 * cădem pe suma brută — 100 EUR adunați ca 100 RON ar fi o cifră greșită, nu
 * una incompletă.
 */
function ron(tx: Transaction): number | null {
  if (tx.currency === 'RON') return tx.amount;
  return tx.amount_ron ?? null;
}

function inMonth(tx: Transaction, yearMonth: string): boolean {
  return tx.date.slice(0, 7) === yearMonth;
}

/**
 * Cât numerar a ieșit efectiv din bani, pe o lună.
 *
 * @param txs tranzacțiile lunii (se filtrează oricum după `yearMonth`)
 * @param accounts conturile, pentru a ști care sunt de tip `cash`
 * @param yearMonth luna analizată, YYYY-MM
 */
export function computeCashWithdrawals(
  txs: Transaction[],
  accounts: FinancialAccount[],
  yearMonth: string
): CashWithdrawalResult {
  const cashIds = new Set(accounts.filter(a => a.type === 'cash').map(a => a.id));
  const month = txs.filter(t => t.duplicate_of_id == null && inMonth(t, yearMonth));
  if (month.length === 0) return { ...EMPTY };

  let added = 0;
  const countedIds: string[] = [];
  for (const accountId of cashIds) {
    const own = month.filter(t => t.account_id === accountId);

    // Dacă userul chiar notează cheltuieli pe contul cash, acelea se numără
    // singure. Transferul rămâne neutru, altfel aceiași bani ar intra de două
    // ori — o dată ca retragere, o dată ca plată.
    const hasOwnExpenses = own.some(t => !t.is_internal_transfer && t.amount < 0);
    if (hasOwnExpenses) continue;

    let inbound = 0;
    let outbound = 0;
    for (const t of own) {
      if (!t.is_internal_transfer) continue;
      const value = ron(t);
      if (value === null) continue;
      if (value > 0) {
        inbound += value;
        countedIds.push(t.id);
      } else {
        outbound += -value;
      }
    }

    // Depunerile înapoi la bancă scad numerarul scos. Dacă userul a dus înapoi
    // mai mult decât a scos, rezultatul e 0, nu un „venit" din numerar.
    added += Math.max(0, inbound - outbound);
  }

  // Retragerile pe care userul nu le-a convertit sunt deja cheltuieli obișnuite
  // pe contul bancar. Nu se adună din nou; doar se mută, ca să apară lângă
  // celelalte în aceeași pseudo-categorie.
  let relocated = 0;
  const relocatedIds: string[] = [];
  for (const t of month) {
    if (t.is_internal_transfer) continue;
    if (t.amount >= 0) continue;
    if (t.account_id !== undefined && cashIds.has(t.account_id)) continue;
    if (detectTransferType(t) !== 'cash') continue;
    const value = ron(t);
    if (value === null) continue;
    relocated += -value;
    relocatedIds.push(t.id);
  }

  return {
    added_ron: Math.round(added * 100) / 100,
    relocated_ron: Math.round(relocated * 100) / 100,
    relocated_tx_ids: relocatedIds,
    counted_tx_ids: countedIds,
    total_ron: Math.round((added + relocated) * 100) / 100,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Stratul de date
//
// Interogarea e proprie, nu prin `services/transactions.ts`: acela va importa
// modulul de față pentru a aplica regula, iar un import invers ar închide un
// ciclu pe care `madge --circular` îl respinge. Prețul e o mapare de rânduri în
// plus — același compromis pe care `internalTransferSuggestion` îl face deja.
// ────────────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  account_id: string | null;
  date: string;
  amount: number;
  currency: string;
  amount_ron: number | null;
  description: string | null;
  merchant: string | null;
  category_id: string | null;
  source: string;
  statement_id: string | null;
  is_internal_transfer: number;
  linked_transaction_id: string | null;
  is_refund: number;
  duplicate_of_id: string | null;
  cash_suggestion_dismissed: number;
  category_learned: number;
  notes: string | null;
  created_at: string;
};

function rowToTx(r: Row): Transaction {
  return {
    id: r.id,
    account_id: r.account_id ?? undefined,
    date: r.date,
    amount: r.amount,
    currency: r.currency || 'RON',
    amount_ron: r.amount_ron ?? undefined,
    description: r.description ?? undefined,
    merchant: r.merchant ?? undefined,
    category_id: r.category_id ?? undefined,
    source: (r.source as Transaction['source']) ?? 'manual',
    statement_id: r.statement_id ?? undefined,
    is_internal_transfer: r.is_internal_transfer === 1,
    linked_transaction_id: r.linked_transaction_id ?? undefined,
    is_refund: r.is_refund === 1,
    duplicate_of_id: r.duplicate_of_id ?? undefined,
    cash_suggestion_dismissed: r.cash_suggestion_dismissed === 1,
    category_learned: r.category_learned === 1,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

/**
 * Tranzacțiile lunii, **inclusiv** transferurile interne: fără ele n-am vedea
 * tocmai retragerile convertite, care sunt subiectul regulii.
 */
async function monthTransactions(yearMonth: string, accountId?: string): Promise<Transaction[]> {
  const where = ['substr(date, 1, 7) = ?', 'duplicate_of_id IS NULL'];
  const params: (string | number)[] = [yearMonth];
  if (accountId) {
    where.push('account_id = ?');
    params.push(accountId);
  }
  // `?? []` nu e paranoia: în teste `getAllAsync` e un mock fără valoare, iar o
  // agregare nu are voie să arunce fiindcă n-a găsit rânduri.
  const rows =
    (await db.getAllAsync<Row>(
      `SELECT * FROM transactions WHERE ${where.join(' AND ')}`,
      params
    )) ?? [];
  return rows.map(rowToTx);
}

/**
 * Numerarul retras pe o lună, citit din baza de date.
 *
 * Când `accountId` e dat, filtrarea cade natural: partea de pe contul cash nu
 * mai intră în interogare, deci `added_ron` devine 0 și rămân doar retragerile
 * neconvertite ale contului filtrat. Nu e nevoie de un caz special.
 */
export async function loadCashWithdrawals(
  yearMonth: string,
  accountId?: string
): Promise<CashWithdrawalResult> {
  const [txs, accounts] = await Promise.all([
    monthTransactions(yearMonth, accountId),
    getFinancialAccounts(true),
  ]);
  return computeCashWithdrawals(txs, accounts, yearMonth);
}

export interface CashCategoryAdjustment {
  /** Cât afișează pseudo-categoria. */
  total_ron: number;
  /** Câte tranzacții stau în spatele ei. */
  count: number;
  /**
   * Cât se scade din fiecare categorie de unde provin retragerile neconvertite.
   * Fără scăderea asta, aceiași bani ar apărea de două ori în breakdown: o dată
   * în categoria lor originală, o dată în „Numerar retras".
   */
  deductions: { category_id: string | null; amount_ron: number; count: number }[];
}

/** Ajustarea de breakdown pentru o lună: cât se mută și de unde. */
export async function loadCashBreakdownAdjustment(
  yearMonth: string,
  accountId?: string
): Promise<CashCategoryAdjustment> {
  const [txs, accounts] = await Promise.all([
    monthTransactions(yearMonth, accountId),
    getFinancialAccounts(true),
  ]);
  const result = computeCashWithdrawals(txs, accounts, yearMonth);

  const relocated = new Set(result.relocated_tx_ids);
  const byCategory = new Map<string | null, { amount: number; count: number }>();
  for (const t of txs) {
    if (!relocated.has(t.id)) continue;
    const value = ron(t);
    if (value === null) continue;
    const key = t.category_id ?? null;
    const prev = byCategory.get(key) ?? { amount: 0, count: 0 };
    byCategory.set(key, { amount: prev.amount - value, count: prev.count + 1 });
  }

  return {
    total_ron: result.total_ron,
    count: result.counted_tx_ids.length + result.relocated_tx_ids.length,
    deductions: [...byCategory].map(([category_id, v]) => ({
      category_id,
      amount_ron: Math.round(v.amount * 100) / 100,
      count: v.count,
    })),
  };
}

/**
 * Tranzacțiile din spatele pseudo-categoriei „Numerar retras".
 *
 * `TransactionFilter` nu le poate exprima: sunt transferuri interne (pe care
 * filtrul le exclude) plus retrageri care au propria categorie reală. Fără
 * funcția asta, cardul s-ar deschide într-o listă goală.
 */
export async function getCashWithdrawalTransactions(
  yearMonth: string,
  accountId?: string
): Promise<Transaction[]> {
  const [txs, accounts] = await Promise.all([
    monthTransactions(yearMonth, accountId),
    getFinancialAccounts(true),
  ]);
  const result = computeCashWithdrawals(txs, accounts, yearMonth);
  const ids = new Set([...result.counted_tx_ids, ...result.relocated_tx_ids]);
  return txs.filter(t => ids.has(t.id));
}
