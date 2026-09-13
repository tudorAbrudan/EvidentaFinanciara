import { categorizeTransactionsWithAi } from './aiCategoryMapper';
import { amountRonSql, missingRateCountSql, IS_EXPENSE_SQL, IS_INCOME_SQL } from './amountSql';
import { applyDirectionHint, suggestCategory } from './bankStatementParser';
import {
  CASH_WITHDRAWN_CATEGORY_ID,
  CASH_WITHDRAWN_LABEL,
  loadCashBreakdownAdjustment,
  loadCashWithdrawals,
} from './cashSpending';
import { getCategoryByKey } from './categories';
import { db, generateId } from './db';
import { getRateRon } from './fxRates';
import { getRuleForMerchant, upsertRule } from './merchantCategoryRules';

import type { CategoryKey, Transaction, TransactionSource } from '@/types';

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

function mapRow(r: Row): Transaction {
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
    source: (r.source as TransactionSource) ?? 'manual',
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

export interface TransactionFilter {
  account_id?: string;
  category_id?: string;
  fromDate?: string; // YYYY-MM-DD inclusiv
  toDate?: string; // YYYY-MM-DD inclusiv
  search?: string; // în description / merchant
  minAmount?: number;
  maxAmount?: number;
  excludeDuplicates?: boolean; // default true
  excludeTransfers?: boolean; // default false (UI listă) — true pentru analitice
  source?: TransactionSource;
  limit?: number;
  offset?: number;
  uncategorized?: boolean; // filtru pe category_id IS NULL
  onlyExpenses?: boolean; // filtru pe amount < 0
  absAmountRange?: { min?: number; max?: number }; // valori absolute, prinde ambele semne
}

export async function getTransactions(filter: TransactionFilter = {}): Promise<Transaction[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.account_id) {
    where.push('account_id = ?');
    params.push(filter.account_id);
  }
  if (filter.category_id) {
    where.push('category_id = ?');
    params.push(filter.category_id);
  }
  if (filter.fromDate) {
    where.push('date >= ?');
    params.push(filter.fromDate);
  }
  if (filter.toDate) {
    where.push('date <= ?');
    params.push(filter.toDate);
  }
  if (filter.minAmount !== undefined) {
    where.push('amount >= ?');
    params.push(filter.minAmount);
  }
  if (filter.maxAmount !== undefined) {
    where.push('amount <= ?');
    params.push(filter.maxAmount);
  }
  if (filter.search) {
    where.push('(description LIKE ? OR merchant LIKE ?)');
    const q = `%${filter.search}%`;
    params.push(q, q);
  }
  if (filter.source) {
    where.push('source = ?');
    params.push(filter.source);
  }
  if (filter.excludeDuplicates !== false) {
    where.push('duplicate_of_id IS NULL');
  }
  if (filter.excludeTransfers === true) {
    where.push('is_internal_transfer = 0');
  }
  if (filter.uncategorized === true) {
    where.push('category_id IS NULL');
  }
  if (filter.onlyExpenses === true) {
    where.push('amount < 0');
  }
  if (filter.absAmountRange) {
    const { min, max } = filter.absAmountRange;
    if (min !== undefined && max !== undefined) {
      where.push('((amount BETWEEN ? AND ?) OR (amount BETWEEN ? AND ?))');
      params.push(-max, -min, min, max);
    } else if (min !== undefined) {
      where.push('(amount <= ? OR amount >= ?)');
      params.push(-min, min);
    } else if (max !== undefined) {
      where.push('amount BETWEEN ? AND ?');
      params.push(-max, max);
    }
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limitSql = filter.limit !== undefined ? `LIMIT ${Math.max(1, filter.limit | 0)}` : '';
  const offsetSql = filter.offset !== undefined ? `OFFSET ${Math.max(0, filter.offset | 0)}` : '';

  const rows =
    (await db.getAllAsync<Row>(
      `SELECT * FROM transactions ${whereSql} ORDER BY date DESC, created_at DESC ${limitSql} ${offsetSql}`,
      params
    )) ?? [];
  return rows.map(mapRow);
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM transactions WHERE id = ?', [id]);
  return row ? mapRow(row) : null;
}

export interface CreateTransactionInput {
  account_id?: string;
  date: string; // YYYY-MM-DD
  amount: number; // negativ = cheltuială, pozitiv = venit
  currency?: string;
  amount_ron?: number;
  description?: string;
  merchant?: string;
  category_id?: string;
  source?: TransactionSource;
  statement_id?: string;
  is_internal_transfer?: boolean;
  linked_transaction_id?: string;
  is_refund?: boolean;
  notes?: string;
}

export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  const id = generateId();
  const created_at = new Date().toISOString();
  const currency = input.currency || 'RON';
  // Pentru tranzacțiile RON, amount_ron === amount (evităm întrebarea „de ce e null")
  const amount_ron =
    input.amount_ron !== undefined ? input.amount_ron : currency === 'RON' ? input.amount : null;

  // Aplică reguli învățate doar dacă apelantul nu a setat deja category_id.
  // Regulile se aplică prin merchant; descrierea fără merchant nu match.
  let categoryId = input.category_id ?? null;
  let categoryLearned = false;
  const merchantTrimmed = input.merchant?.trim() || null;
  if (categoryId === null && merchantTrimmed) {
    const rule = await getRuleForMerchant(merchantTrimmed);
    if (rule) {
      categoryId = rule.category_id;
      categoryLearned = true;
    }
  }

  await db.runAsync(
    `INSERT INTO transactions
       (id, account_id, date, amount, currency, amount_ron, description, merchant,
        category_id, source, statement_id,
        is_internal_transfer, linked_transaction_id, is_refund, duplicate_of_id, notes,
        category_learned, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      id,
      input.account_id ?? null,
      input.date,
      input.amount,
      currency,
      amount_ron,
      input.description?.trim() || null,
      merchantTrimmed,
      categoryId,
      input.source ?? 'manual',
      input.statement_id ?? null,
      input.is_internal_transfer ? 1 : 0,
      input.linked_transaction_id ?? null,
      input.is_refund ? 1 : 0,
      input.notes?.trim() || null,
      categoryLearned ? 1 : 0,
      created_at,
    ]
  );

  return {
    id,
    account_id: input.account_id,
    date: input.date,
    amount: input.amount,
    currency,
    amount_ron: amount_ron ?? undefined,
    description: input.description,
    merchant: input.merchant,
    category_id: categoryId ?? undefined,
    source: input.source ?? 'manual',
    statement_id: input.statement_id,
    is_internal_transfer: !!input.is_internal_transfer,
    linked_transaction_id: input.linked_transaction_id,
    is_refund: !!input.is_refund,
    cash_suggestion_dismissed: false,
    category_learned: categoryLearned,
    notes: input.notes,
    createdAt: created_at,
  };
}

export interface UpdateTransactionInput {
  account_id?: string | null;
  date?: string;
  amount?: number;
  currency?: string;
  amount_ron?: number | null;
  description?: string | null;
  merchant?: string | null;
  category_id?: string | null;
  is_refund?: boolean;
  notes?: string | null;
}

export async function updateTransaction(id: string, input: UpdateTransactionInput): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const push = (col: string, val: string | number | null | undefined) => {
    if (val === undefined) return;
    sets.push(`${col} = ?`);
    params.push(val);
  };
  push('account_id', input.account_id ?? null);
  push('date', input.date);
  push('amount', input.amount);
  push('currency', input.currency);
  push('amount_ron', input.amount_ron ?? null);
  push('description', input.description ?? null);
  push('merchant', input.merchant ?? null);
  // Modificare manuală a categoriei → resetează flag-ul „învățat" (devine sursă
  // de adevăr pentru viitoarele reguli, nu mai e categorie atribuită automat).
  if (input.category_id !== undefined) {
    sets.push('category_id = ?');
    params.push(input.category_id ?? null);
    sets.push('category_learned = ?');
    params.push(0);
  }
  push('notes', input.notes ?? null);
  if (input.is_refund !== undefined) {
    sets.push('is_refund = ?');
    params.push(input.is_refund ? 1 : 0);
  }

  if (sets.length === 0) return;
  params.push(id);
  await db.runAsync(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);

  // Învață regulă din corecție manuală: dacă userul a atribuit o categorie
  // (non-null) unei tranzacții cu merchant non-vid, persistă maparea.
  if (input.category_id) {
    const merchantRow = await db.getFirstAsync<{ merchant: string | null }>(
      'SELECT merchant FROM transactions WHERE id = ?',
      [id]
    );
    const merchant = merchantRow?.merchant?.trim();
    if (merchant) {
      await upsertRule(merchant, input.category_id);
    }
  }
}

export async function deleteTransaction(id: string): Promise<void> {
  // Dacă e parte dintr-un transfer intern, dezleagă cealaltă jumătate (nu o șterge)
  const row = await db.getFirstAsync<{ linked: string | null; isTransfer: number }>(
    'SELECT linked_transaction_id AS linked, is_internal_transfer AS isTransfer FROM transactions WHERE id = ?',
    [id]
  );
  if (row?.isTransfer === 1 && row.linked) {
    await db.runAsync(
      'UPDATE transactions SET is_internal_transfer = 0, linked_transaction_id = NULL WHERE id = ?',
      [row.linked]
    );
  }
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
}

const BULK_CHUNK = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Șterge multiple tranzacții într-o singură tranzacție DB, cu cleanup:
 *   1. Colectează DISTINCT statement_id pentru tranzacțiile ce se șterg
 *      (load-bearing: trebuie să ruleze ÎNAINTE de DELETE — după DELETE
 *      referințele dispar și auto-purge-ul devine imposibil).
 *   2. Dezleagă transferuri interne — contraparte (linked_transaction_id IN ids)
 *      revine la tranzacție obișnuită.
 *   3. Dezmarchează duplicate care referă spre IDs ce se șterg.
 *   4. DELETE FROM transactions WHERE id IN ids (chunking la 500 — limita SQLite).
 *   5. Auto-purge bank_statements rămase fără tranzacții (din candidați la pasul 1).
 *
 * Returnează numărul de rânduri șterse efectiv (db.changes) și numărul de
 * statement-uri auto-purgate.
 */
export async function bulkDeleteTransactions(
  ids: string[]
): Promise<{ deletedCount: number; statementsRemoved: number }> {
  if (ids.length === 0) return { deletedCount: 0, statementsRemoved: 0 };

  let deletedCount = 0;
  let statementsRemoved = 0;

  await db.withTransactionAsync(async () => {
    // 1. IMPORTANT: must run BEFORE phase 4 — after DELETE, statement_id
    //    references are gone and auto-purge can no longer find candidates.
    const candidateStmtRows: { statement_id: string }[] = [];
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await db.getAllAsync<{ statement_id: string }>(
        `SELECT DISTINCT statement_id FROM transactions
          WHERE id IN (${placeholders}) AND statement_id IS NOT NULL`,
        chunk
      );
      candidateStmtRows.push(...rows);
    }
    const candidateStmtIds = Array.from(
      new Set(candidateStmtRows.map(r => r.statement_id).filter(Boolean))
    );

    // 2. Dezleagă transferuri interne (cealaltă jumătate)
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE transactions
            SET is_internal_transfer = 0, linked_transaction_id = NULL
          WHERE id IN (
            SELECT linked_transaction_id FROM transactions
             WHERE id IN (${placeholders}) AND linked_transaction_id IS NOT NULL
          )`,
        chunk
      );
    }

    // 3. Dezmarchează duplicate care pointează spre IDs ce se șterg
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE transactions SET duplicate_of_id = NULL
          WHERE duplicate_of_id IN (${placeholders})`,
        chunk
      );
    }

    // 4. DELETE FROM transactions
    for (const chunk of chunkArray(ids, BULK_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(',');
      const res = await db.runAsync(
        `DELETE FROM transactions WHERE id IN (${placeholders})`,
        chunk
      );
      deletedCount += res.changes;
    }

    // 5. Auto-purge statement-uri orfane
    if (candidateStmtIds.length > 0) {
      const stillReferencedRows: { statement_id: string }[] = [];
      for (const chunk of chunkArray(candidateStmtIds, BULK_CHUNK)) {
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await db.getAllAsync<{ statement_id: string }>(
          `SELECT DISTINCT statement_id FROM transactions
            WHERE statement_id IN (${placeholders})`,
          chunk
        );
        stillReferencedRows.push(...rows);
      }
      const stillReferenced = new Set(stillReferencedRows.map(r => r.statement_id));
      const orphanIds = candidateStmtIds.filter(id => !stillReferenced.has(id));
      if (orphanIds.length > 0) {
        for (const chunk of chunkArray(orphanIds, BULK_CHUNK)) {
          const placeholders = chunk.map(() => '?').join(',');
          const res = await db.runAsync(
            `DELETE FROM bank_statements WHERE id IN (${placeholders})`,
            chunk
          );
          statementsRemoved += res.changes;
        }
      }
    }
  });

  return { deletedCount, statementsRemoved };
}

export async function markAsDuplicate(id: string, originalId: string): Promise<void> {
  if (id === originalId) {
    throw new Error('O tranzacție nu poate fi duplicat al ei înseși.');
  }
  await db.runAsync('UPDATE transactions SET duplicate_of_id = ? WHERE id = ?', [originalId, id]);
}

export async function unmarkDuplicate(id: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET duplicate_of_id = NULL WHERE id = ?', [id]);
}

/**
 * Leagă două tranzacții ca transfer intern. Validări:
 * - sume opuse (una pozitivă, una negativă, valoare absolută egală cu toleranță 0.01)
 * - conturi diferite
 * - dată în interval ±2 zile
 *
 * Marchează ambele cu `is_internal_transfer = 1` și se referă reciproc prin `linked_transaction_id`.
 */
/**
 * `allowUnequal` e necesar pentru perechile deduse din comision sau din curs
 * valutar, unde sumele NU se anulează exact. Se folosește doar după confirmarea
 * utilizatorului — potrivirile automate rămân cele exacte.
 */
export async function linkAsInternalTransfer(
  txId1: string,
  txId2: string,
  opts: { allowUnequal?: boolean } = {}
): Promise<void> {
  if (txId1 === txId2) throw new Error('Trebuie 2 tranzacții diferite.');
  const t1 = await getTransaction(txId1);
  const t2 = await getTransaction(txId2);
  if (!t1 || !t2) throw new Error('Tranzacție inexistentă.');
  if (t1.account_id && t2.account_id && t1.account_id === t2.account_id) {
    throw new Error('Transferul intern presupune conturi diferite.');
  }
  if (t1.amount > 0 === t2.amount > 0) {
    throw new Error('Transferul cere o sumă pozitivă și una negativă.');
  }
  const sameCurrency = t1.currency === t2.currency;
  if (!opts.allowUnequal && sameCurrency && Math.abs(t1.amount + t2.amount) > 0.01) {
    throw new Error('Sumele transferului trebuie să fie opuse (una pozitivă, una negativă).');
  }
  const d1 = new Date(t1.date).getTime();
  const d2 = new Date(t2.date).getTime();
  const days = Math.abs(d1 - d2) / 86400000;
  if (days > 2) {
    throw new Error('Datele celor 2 tranzacții trebuie să fie la cel mult 2 zile distanță.');
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE transactions SET is_internal_transfer = 1, linked_transaction_id = ? WHERE id = ?',
      [txId2, txId1]
    );
    await db.runAsync(
      'UPDATE transactions SET is_internal_transfer = 1, linked_transaction_id = ? WHERE id = ?',
      [txId1, txId2]
    );
  });
}

export async function unlinkInternalTransfer(txId: string): Promise<void> {
  const tx = await getTransaction(txId);
  if (!tx || !tx.linked_transaction_id) return;
  const linkedId = tx.linked_transaction_id;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE transactions SET is_internal_transfer = 0, linked_transaction_id = NULL WHERE id = ?',
      [tx.id]
    );
    await db.runAsync(
      'UPDATE transactions SET is_internal_transfer = 0, linked_transaction_id = NULL WHERE id = ?',
      [linkedId]
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Detecție duplicate / transferuri candidate (pasiv — utilizatorul confirmă)
// ────────────────────────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  primary: Transaction;
  candidates: Transaction[];
}

/**
 * Două tranzacții pe același cont sunt potențial duplicate dacă:
 * - sume identice (toleranță 0.01)
 * - dată ±1 zi
 * - merchant identic SAU description identică (case-insensitive, trim)
 *
 * Returnează grupuri pentru ca UI-ul să propună merge / mark-as-duplicate.
 * Algoritm O(n²) — OK până la câteva mii de tranzacții.
 */
export async function findDuplicateCandidates(accountId?: string): Promise<DuplicateCandidate[]> {
  const txs = await getTransactions({
    account_id: accountId,
    excludeDuplicates: true,
    excludeTransfers: false,
  });

  const result: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < txs.length; i++) {
    if (seen.has(txs[i].id)) continue;
    const a = txs[i];
    const candidates: Transaction[] = [];
    for (let j = i + 1; j < txs.length; j++) {
      if (seen.has(txs[j].id)) continue;
      const b = txs[j];
      if (Math.abs(a.amount - b.amount) > 0.01) continue;
      const days = Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / 86400000;
      if (days > 1) continue;
      const sameMerchant =
        (a.merchant ?? '').trim().toLowerCase() === (b.merchant ?? '').trim().toLowerCase() &&
        (a.merchant ?? '').trim() !== '';
      const sameDesc =
        (a.description ?? '').trim().toLowerCase() === (b.description ?? '').trim().toLowerCase() &&
        (a.description ?? '').trim() !== '';
      if (!sameMerchant && !sameDesc) continue;
      candidates.push(b);
      seen.add(b.id);
    }
    if (candidates.length > 0) {
      result.push({ primary: a, candidates });
      seen.add(a.id);
    }
  }
  return result;
}

/**
 * Verifică, înainte de a insera o tranzacție nouă, dacă există deja una potențial
 * identică (același cont, sumă identică ±0.01, dată ±1 zi, merchant SAU description identic).
 *
 * Folosit pentru avertismente la insert manual sau import per-rând.
 * Returnează prima potrivire sau `null`.
 */
export async function findPossibleDuplicate(input: {
  account_id?: string;
  date: string;
  amount: number;
  merchant?: string;
  description?: string;
  excludeId?: string; // pt. update — exclude propria tranzacție
}): Promise<Transaction | null> {
  const day = 86400000;
  const ts = new Date(input.date).getTime();
  if (Number.isNaN(ts)) return null;
  const fromDate = new Date(ts - day).toISOString().slice(0, 10);
  const toDate = new Date(ts + day).toISOString().slice(0, 10);

  const where: string[] = [
    'duplicate_of_id IS NULL',
    'date >= ?',
    'date <= ?',
    'ABS(amount - ?) < 0.01',
  ];
  const params: (string | number)[] = [fromDate, toDate, input.amount];
  if (input.account_id) {
    where.push('account_id = ?');
    params.push(input.account_id);
  } else {
    where.push('account_id IS NULL');
  }
  if (input.excludeId) {
    where.push('id != ?');
    params.push(input.excludeId);
  }

  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC, created_at DESC LIMIT 20`,
    params
  );
  const merchant = (input.merchant ?? '').trim().toLowerCase();
  const desc = (input.description ?? '').trim().toLowerCase();
  for (const r of rows) {
    const rMerchant = (r.merchant ?? '').trim().toLowerCase();
    const rDesc = (r.description ?? '').trim().toLowerCase();
    if (merchant && rMerchant && merchant === rMerchant) return mapRow(r);
    if (desc && rDesc && desc === rDesc) return mapRow(r);
  }
  return null;
}

/**
 * Candidate transferuri interne: o tranzacție pozitivă într-un cont și una negativă
 * cu aceeași valoare absolută în alt cont, în ±2 zile, ambele necategorizate ca transfer.
 */
export interface TransferCandidate {
  outflow: Transaction; // amount < 0
  inflow: Transaction; // amount > 0
  /** Comisioane care explică diferența dintre sumele celor două laturi. */
  fees?: Transaction[];
  /**
   * `exact` — sumele se anulează la ±0.01: se poate lega automat.
   * `fee` / `fx` — potrivire prin toleranță: doar sugestie, cere confirmare,
   * fiindcă un fals pozitiv ascunde venit real din analize.
   */
  kind: 'exact' | 'fee' | 'fx';
}

export async function findInternalTransferCandidates(): Promise<TransferCandidate[]> {
  const txs = await getTransactions({
    excludeDuplicates: true,
    excludeTransfers: true,
  });
  return matchTransferCandidates(txs);
}

/**
 * Variantă „localizată": rulează detectorul doar pe tranzacțiile dintr-o
 * fereastră ±5 zile în jurul unei tranzacții pivot. Folosit la salvarea
 * manuală a unei tranzacții ca să prindem transferul intern fără să iterăm
 * întreg istoricul.
 */
export async function findInternalTransferCandidatesNear(
  pivotDate: string,
  windowDays = 5
): Promise<TransferCandidate[]> {
  const pivotMs = new Date(pivotDate).getTime();
  if (Number.isNaN(pivotMs)) return [];
  const fromIso = new Date(pivotMs - windowDays * 86400000).toISOString().slice(0, 10);
  const toIso = new Date(pivotMs + windowDays * 86400000).toISOString().slice(0, 10);
  const txs = await getTransactions({
    fromDate: fromIso,
    toDate: toIso,
    excludeDuplicates: true,
    excludeTransfers: true,
  });
  return matchTransferCandidates(txs);
}

const FEE_RE = /\b(comision|taxa|speze|fee)\b/i;
/** Spread bancar față de cursul BNR: 2% acoperă practica uzuală în RO. */
const FX_TOLERANCE = 0.02;

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function isFee(tx: Transaction): boolean {
  return FEE_RE.test(stripDiacritics(`${tx.description ?? ''} ${tx.merchant ?? ''}`));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

function matchTransferCandidates(
  txs: Transaction[],
  rates?: Map<string, number>
): TransferCandidate[] {
  const outflows = txs.filter(t => t.amount < 0 && t.account_id);
  const inflows = txs.filter(t => t.amount > 0 && t.account_id);
  const fees = outflows.filter(isFee);

  const result: TransferCandidate[] = [];
  const usedIn = new Set<string>();
  const usedFee = new Set<string>();

  // Conversia în RON pentru laturile în valute diferite. Fără curs disponibil
  // nu inventăm unul — perechea pur și simplu nu se formează.
  const toRon = (t: Transaction): number | undefined => {
    if (t.currency === 'RON') return t.amount;
    if (t.amount_ron !== undefined) return t.amount_ron;
    const rate = rates?.get(`${t.date.slice(0, 10)}|${t.currency}`);
    return rate === undefined ? undefined : t.amount * rate;
  };

  for (const out of outflows) {
    if (isFee(out)) continue; // comisionul nu e el însuși latura unui transfer
    let best: { inn: Transaction; kind: 'exact' | 'fee' | 'fx'; fees: Transaction[] } | undefined;
    let bestDelta = Infinity;

    for (const inn of inflows) {
      if (usedIn.has(inn.id)) continue;
      if (inn.account_id === out.account_id) continue;
      const days = daysBetween(out.date, inn.date);
      if (days > 2) continue;

      let kind: 'exact' | 'fee' | 'fx' | undefined;
      let matchedFees: Transaction[] = [];

      if (out.currency === inn.currency) {
        if (Math.abs(out.amount + inn.amount) <= 0.01) {
          kind = 'exact';
        } else {
          // Diferența poate fi explicată de comisioane din aceeași fereastră,
          // din contul sursă: 1000 ieșit = 995 intrat + 5 comision.
          const gap = Math.abs(out.amount) - Math.abs(inn.amount);
          if (gap > 0) {
            const nearby = fees.filter(
              f =>
                !usedFee.has(f.id) &&
                f.account_id === out.account_id &&
                f.id !== out.id &&
                daysBetween(f.date, out.date) <= 2
            );
            let acc = 0;
            const picked: Transaction[] = [];
            for (const f of nearby) {
              if (acc >= gap - 0.01) break;
              acc += Math.abs(f.amount);
              picked.push(f);
            }
            if (Math.abs(acc - gap) <= 0.01) {
              kind = 'fee';
              matchedFees = picked;
            }
          }
        }
      } else {
        // Valute diferite: comparăm valorile convertite în RON, cu toleranță
        // pentru spreadul băncii (cursul ei nu e cel BNR).
        const outRon = toRon(out);
        const innRon = toRon(inn);
        if (outRon !== undefined && innRon !== undefined) {
          const base = Math.max(Math.abs(outRon), Math.abs(innRon));
          if (base > 0 && Math.abs(outRon + innRon) / base <= FX_TOLERANCE) {
            kind = 'fx';
          }
        }
      }

      if (!kind) continue;
      // Potrivirea exactă bate orice potrivire prin toleranță, indiferent de dată.
      const rank = kind === 'exact' ? days : days + 100;
      if (rank < bestDelta) {
        bestDelta = rank;
        best = { inn, kind, fees: matchedFees };
      }
    }

    if (best) {
      result.push({
        outflow: out,
        inflow: best.inn,
        kind: best.kind,
        ...(best.fees.length > 0 ? { fees: best.fees } : {}),
      });
      usedIn.add(best.inn.id);
      for (const f of best.fees) usedFee.add(f.id);
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Agregări lunare
// ────────────────────────────────────────────────────────────────────────────

export interface MonthlyTotals {
  income_ron: number; // suma absolută venituri (positivă)
  expense_ron: number; // suma absolută cheltuieli (positivă)
  net_ron: number; // income - expense (poate fi negativ)
  transaction_count: number;
  /** Tranzacții în valută sărite din sume fiindcă le lipsește cursul. */
  missing_rate_count?: number;
  /**
   * Cât din `expense_ron` e numerar retras (convertit în transfer sau nu).
   * Prezent doar când există. UI-ul îl arată explicit, ca schimbarea cifrelor
   * față de versiunea anterioară să nu pară un bug.
   */
  cash_withdrawn_ron?: number;
}

/**
 * Totaluri pe o lună (YYYY-MM). Exclude duplicate și transferuri interne.
 * Pentru tranzacțiile multi-currency folosește `amount_ron` dacă există, altfel `amount`.
 */
export async function getMonthlyTotals(
  yearMonth: string,
  accountId?: string
): Promise<MonthlyTotals> {
  const where = ['substr(date, 1, 7) = ?', 'duplicate_of_id IS NULL', 'is_internal_transfer = 0'];
  const params: (string | number)[] = [yearMonth];
  if (accountId) {
    where.push('account_id = ?');
    params.push(accountId);
  }
  const whereSql = where.join(' AND ');

  const row = await db.getFirstAsync<{
    income: number | null;
    expense: number | null;
    cnt: number;
    missing_rate: number | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN ${IS_INCOME_SQL} THEN ${amountRonSql()} ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN ${IS_EXPENSE_SQL} THEN ${amountRonSql()} ELSE 0 END), 0) AS expense,
       COUNT(*) AS cnt,
       ${missingRateCountSql()} AS missing_rate
     FROM transactions
     WHERE ${whereSql}`,
    params
  );

  // Numerarul retras: retragerile convertite în transfer sunt excluse de
  // `is_internal_transfer = 0` din interogarea de mai sus, deci se adaugă aici.
  // Cele neconvertite sunt deja în `expense` și nu se adună a doua oară.
  const cash = await loadCashWithdrawals(yearMonth, accountId);

  const income = row?.income ?? 0;
  const expense = Math.abs(row?.expense ?? 0) + cash.added_ron;
  const missing = row?.missing_rate ?? 0;
  return {
    income_ron: income,
    expense_ron: expense,
    net_ron: income - expense,
    transaction_count: row?.cnt ?? 0,
    ...(missing > 0 ? { missing_rate_count: missing } : {}),
    ...(cash.total_ron > 0 ? { cash_withdrawn_ron: cash.total_ron } : {}),
  };
}

export interface MonthlyAmountPoint {
  yearMonth: string; // YYYY-MM
  total_ron: number; // sumă pozitivă în RON
}

/**
 * Evoluția VENITURILOR pe ultimele `monthsBack` luni (sumă lunară, RON).
 *
 * Exclude duplicate ȘI transferurile interne — astfel banii deja contabilizați
 * ca venit (ex. salariu în contul principal) nu se dublează când sunt mutați
 * într-alt cont propriu (ex. retragere în cont „cash"), pentru că perechea de
 * transfer e marcată `is_internal_transfer = 1`. Lunile fără venit apar cu 0.
 */
export async function getMonthlyIncomeSeries(
  monthsBack: number,
  accountId?: string
): Promise<MonthlyAmountPoint[]> {
  if (monthsBack <= 0) return [];

  const months: string[] = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const fromMonth = months[0];

  const where = [
    'substr(date, 1, 7) >= ?',
    'duplicate_of_id IS NULL',
    'is_internal_transfer = 0',
    'amount > 0',
  ];
  const params: (string | number)[] = [fromMonth];
  if (accountId) {
    where.push('account_id = ?');
    params.push(accountId);
  }

  const rows = await db.getAllAsync<{ ym: string; total: number | null }>(
    `SELECT substr(date, 1, 7) AS ym,
            SUM(${amountRonSql()}) AS total
     FROM transactions
     WHERE ${where.join(' AND ')}
     GROUP BY ym
     ORDER BY ym ASC`,
    params
  );

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.ym, r.total ?? 0);
  return months.map(ym => ({ yearMonth: ym, total_ron: map.get(ym) ?? 0 }));
}

// ────────────────────────────────────────────────────────────────────────────
// Breakdown pe categorii
// ────────────────────────────────────────────────────────────────────────────

export interface CategoryBreakdownItem {
  category_id: string | null; // null = necategorizat
  category_name: string;
  category_key: string | null;
  icon: string | null;
  color: string | null;
  total_ron: number; // sumă absolută cheltuieli (positivă)
  percentage: number; // 0..100, raportată la total cheltuieli
  transaction_count: number;
}

/**
 * Breakdown cheltuieli pe categorii pentru o lună (YYYY-MM).
 * Folosește `amount_ron` pentru tranzacții în alte valute.
 * Exclude duplicate, transferuri interne și venituri (amount > 0).
 * „Necategorizat" e returnat ca un item cu `category_id: null` dacă există tranzacții fără categorie.
 */
export async function getCategoryBreakdown(
  yearMonth: string,
  accountId?: string
): Promise<CategoryBreakdownItem[]> {
  const where = [
    'substr(t.date, 1, 7) = ?',
    't.duplicate_of_id IS NULL',
    't.is_internal_transfer = 0',
    't.amount < 0',
  ];
  const params: (string | number)[] = [yearMonth];
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  const whereSql = where.join(' AND ');

  const rows = await db.getAllAsync<{
    category_id: string | null;
    category_name: string | null;
    category_key: string | null;
    icon: string | null;
    color: string | null;
    total: number | null;
    cnt: number;
  }>(
    `SELECT
       t.category_id,
       c.name AS category_name,
       c.key AS category_key,
       c.icon,
       c.color,
       SUM(${amountRonSql('t')}) AS total,
       COUNT(*) AS cnt
     FROM transactions t
     LEFT JOIN expense_categories c ON c.id = t.category_id
     WHERE ${whereSql}
     GROUP BY t.category_id, c.name, c.key, c.icon, c.color
     ORDER BY total ASC`,
    params
  );

  const items = rows.map(r => ({
    category_id: r.category_id,
    category_name: r.category_name ?? 'Necategorizat',
    category_key: r.category_key,
    icon: r.icon,
    color: r.color,
    total_ron: Math.abs(r.total ?? 0),
    transaction_count: r.cnt,
    percentage: 0,
  }));

  // Numerarul retras intră ca pseudo-categorie. Retragerile neconvertite sunt
  // deja în categoriile lor, deci se scad de acolo înainte: altfel aceiași bani
  // ar apărea de două ori, iar suma categoriilor n-ar mai da totalul lunii.
  const cash = await loadCashBreakdownAdjustment(yearMonth, accountId);
  if (cash.total_ron > 0) {
    for (const deduction of cash.deductions) {
      const target = items.find(it => it.category_id === deduction.category_id);
      if (target === undefined) continue;
      target.total_ron = Math.max(
        0,
        Math.round((target.total_ron - deduction.amount_ron) * 100) / 100
      );
      target.transaction_count = Math.max(0, target.transaction_count - deduction.count);
    }
    items.push({
      category_id: CASH_WITHDRAWN_CATEGORY_ID,
      category_name: CASH_WITHDRAWN_LABEL,
      category_key: null,
      icon: 'cash-outline',
      color: null,
      total_ron: cash.total_ron,
      transaction_count: cash.count,
      percentage: 0,
    });
  }

  const visible = items.filter(it => it.total_ron > 0);
  items.length = 0;
  items.push(...visible);

  const grandTotal = items.reduce((s, it) => s + it.total_ron, 0);
  if (grandTotal > 0) {
    for (const it of items) {
      it.percentage = Math.round((it.total_ron / grandTotal) * 1000) / 10;
    }
  }

  return items.sort((a, b) => b.total_ron - a.total_ron);
}

export interface CategoryMonthlyPoint {
  yearMonth: string;
  category_id: string | null;
  category_name: string;
  /** Sumă absolută, pozitivă. */
  total_ron: number;
  transaction_count: number;
}

/**
 * Totalurile și numărul de tranzacții pe (lună, categorie), într-o interogare.
 *
 * Detectarea anomaliilor (B2) are nevoie de 13 luni deodată. `getCategoryEvolution`
 * nu poate servi: face câte o interogare per categorie și își calculează lunile
 * din `new Date()`, deci e legat de luna curentă. Aici intervalul e explicit, iar
 * numărul de tranzacții — necesar pentru `more_frequent` și `higher_ticket` —
 * vine din aceeași trecere.
 *
 * Lunile fără cheltuieli pe o categorie lipsesc din rezultat; apelantul decide
 * dacă absența înseamnă zero sau „nu știm".
 */
export async function getCategoryMonthlySeries(
  fromMonth: string,
  toMonth: string,
  accountId?: string
): Promise<CategoryMonthlyPoint[]> {
  const where = [
    'substr(t.date, 1, 7) >= ?',
    'substr(t.date, 1, 7) <= ?',
    't.duplicate_of_id IS NULL',
    't.is_internal_transfer = 0',
    't.amount < 0',
  ];
  const params: (string | number)[] = [fromMonth, toMonth];
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }

  const rows =
    (await db.getAllAsync<{
      ym: string;
      category_id: string | null;
      category_name: string | null;
      total: number | null;
      cnt: number;
    }>(
      `SELECT substr(t.date, 1, 7) AS ym,
              t.category_id,
              c.name AS category_name,
              SUM(${amountRonSql('t')}) AS total,
              COUNT(*) AS cnt
       FROM transactions t
       LEFT JOIN expense_categories c ON c.id = t.category_id
       WHERE ${where.join(' AND ')}
       GROUP BY ym, t.category_id, c.name
       ORDER BY ym ASC`,
      params
    )) ?? [];

  return rows.map(r => ({
    yearMonth: r.ym,
    category_id: r.category_id,
    category_name: r.category_name ?? 'Necategorizat',
    total_ron: Math.abs(r.total ?? 0),
    transaction_count: r.cnt,
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Evoluție multi-lună pe categorii
// ────────────────────────────────────────────────────────────────────────────

export interface CategoryEvolutionPoint {
  yearMonth: string; // YYYY-MM
  total_ron: number; // sumă absolută cheltuieli (positivă)
}

export interface CategoryEvolution {
  category_id: string | null;
  series: CategoryEvolutionPoint[]; // ordonată cronologic ascendent
}

/**
 * Evoluția cheltuielilor pe ultimele `monthsBack` luni pentru fiecare categorie.
 * Punctele lipsă sunt completate cu 0 (serie densă).
 */
export async function getCategoryEvolution(
  categoryIds: (string | null)[],
  monthsBack: number,
  accountId?: string
): Promise<CategoryEvolution[]> {
  if (categoryIds.length === 0 || monthsBack <= 0) return [];

  // Construim lista de luni dorite (YYYY-MM), de la cea mai veche la cea mai nouă
  const months: string[] = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const fromMonth = months[0];
  const where = [
    'substr(date, 1, 7) >= ?',
    'duplicate_of_id IS NULL',
    'is_internal_transfer = 0',
    'amount < 0',
  ];
  const params: (string | number | null)[] = [fromMonth];
  if (accountId) {
    where.push('account_id = ?');
    params.push(accountId);
  }

  // Pentru fiecare categorie cerută construim un IN (...) sau IS NULL
  const result: CategoryEvolution[] = [];

  for (const catId of categoryIds) {
    const localWhere = [...where];
    const localParams = [...params];
    if (catId === null) {
      localWhere.push('category_id IS NULL');
    } else {
      localWhere.push('category_id = ?');
      localParams.push(catId);
    }

    const rows = await db.getAllAsync<{ ym: string; total: number | null }>(
      `SELECT substr(date, 1, 7) AS ym,
              SUM(${amountRonSql()}) AS total
       FROM transactions
       WHERE ${localWhere.join(' AND ')}
       GROUP BY ym
       ORDER BY ym ASC`,
      localParams
    );

    const map = new Map<string, number>();
    for (const r of rows) map.set(r.ym, Math.abs(r.total ?? 0));

    result.push({
      category_id: catId,
      series: months.map(ym => ({ yearMonth: ym, total_ron: map.get(ym) ?? 0 })),
    });
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: format yearMonth din Date
// ────────────────────────────────────────────────────────────────────────────

export function formatYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Backfill cursuri pentru tranzacții non-RON cu amount_ron NULL
// ────────────────────────────────────────────────────────────────────────────

export interface BackfillResult {
  updated: number;
  failed: number;
  total: number;
}

/**
 * Numără tranzacțiile non-RON cu `amount_ron` lipsă. Folosit pentru a decide
 * dacă afișăm butonul de recalculare cursuri.
 */
export async function countMissingRates(accountId?: string): Promise<number> {
  const where = accountId
    ? "currency != 'RON' AND amount_ron IS NULL AND account_id = ?"
    : "currency != 'RON' AND amount_ron IS NULL";
  const params = accountId ? [accountId] : [];
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM transactions WHERE ${where}`,
    params
  );
  return row?.cnt ?? 0;
}

/**
 * Pentru fiecare tranzacție non-RON cu `amount_ron` NULL, încearcă fetch curs
 * BNR și UPDATE. Necesită internet pentru anii ne-cache.
 */
export interface ReanalyzeResult {
  total: number; // tranzacții non-transfer din extras
  updated: number; // câte au fost efectiv modificate
  signFlipped: number; // câte au avut semnul corectat
  aiUsed: number; // câte au primit categorie din apelul AI
}

/**
 * Re-analizează tranzacțiile unui extras DEJA importat, fără re-import PDF:
 * recalculează semnul (venit/cheltuială) și categoria pe baza câmpurilor deja
 * stocate (`merchant`, `description`, `amount`).
 *
 * Precedență categorie: regulă merchant învățată → keyword determinist →
 * (opțional) AI batch pentru ce rămâne neîncadrat. Transferurile interne sunt
 * excluse. Suprascrie automat (decizie de design) — dar nu șterge o categorie
 * existentă când nu poate deriva una nouă (nu „nullează").
 */
export async function reanalyzeStatement(
  statementId: string,
  opts: { useAi: boolean }
): Promise<ReanalyzeResult> {
  const txs = await db.getAllAsync<Row>(
    'SELECT * FROM transactions WHERE statement_id = ? AND is_internal_transfer = 0',
    [statementId]
  );
  if (txs.length === 0) return { total: 0, updated: 0, signFlipped: 0, aiUsed: 0 };

  // Cache cheie-categorie → category_id (evită query repetat).
  const keyIdCache = new Map<CategoryKey, string | null>();
  const resolveKeyId = async (key: CategoryKey): Promise<string | null> => {
    const cached = keyIdCache.get(key);
    if (cached !== undefined) return cached;
    const cat = await getCategoryByKey(key);
    const id = cat?.id ?? null;
    keyIdCache.set(key, id);
    return id;
  };

  interface Plan {
    id: string;
    newAmount: number;
    newAmountRon?: number; // setat doar dacă semnul s-a schimbat
    signFlipped: boolean;
    categoryId?: string; // undefined = lasă neschimbat
    categoryLearned: 0 | 1;
  }

  const plans: Plan[] = [];
  const needAi: { id: string; merchant?: string; description?: string }[] = [];

  for (const tx of txs) {
    // 1. Semn — guard determinist pe markeri neechivoci.
    const hinted = applyDirectionHint({
      date: tx.date,
      amount: tx.amount,
      currency: tx.currency || 'RON',
      description: tx.description ?? undefined,
      merchant: tx.merchant ?? undefined,
    });
    const signFlipped = hinted.amount !== tx.amount;
    let newAmountRon: number | undefined;
    if (signFlipped) {
      if ((tx.currency || 'RON') === 'RON') newAmountRon = hinted.amount;
      else if (tx.amount_ron !== null) newAmountRon = -tx.amount_ron;
    }

    // 2. Categorie: regulă merchant → keyword → (AI ulterior).
    let categoryId: string | undefined;
    let categoryLearned: 0 | 1 = 0;
    const merchant = tx.merchant?.trim();
    if (merchant) {
      const rule = await getRuleForMerchant(merchant);
      if (rule) {
        categoryId = rule.category_id;
        categoryLearned = 1;
      }
    }
    if (categoryId === undefined) {
      const key = suggestCategory(tx.description ?? '', merchant);
      if (key) {
        const id = await resolveKeyId(key);
        if (id) categoryId = id;
      }
    }
    if (categoryId === undefined && opts.useAi) {
      needAi.push({
        id: tx.id,
        merchant: merchant || undefined,
        description: tx.description ?? undefined,
      });
    }

    plans.push({
      id: tx.id,
      newAmount: hinted.amount,
      newAmountRon,
      signFlipped,
      categoryId,
      categoryLearned,
    });
  }

  // 3. AI batch pentru tranzacțiile rămase neîncadrate.
  let aiUsed = 0;
  if (opts.useAi && needAi.length > 0) {
    const aiMap = await categorizeTransactionsWithAi(needAi);
    for (const plan of plans) {
      if (plan.categoryId !== undefined) continue;
      const aiKey = aiMap.get(plan.id);
      if (!aiKey) continue;
      const id = await resolveKeyId(aiKey);
      if (id) {
        plan.categoryId = id;
        plan.categoryLearned = 0;
        aiUsed += 1;
      }
    }
  }

  // 4. Bulk update atomic.
  let updated = 0;
  let signFlippedCount = 0;
  await db.withTransactionAsync(async () => {
    for (const p of plans) {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      if (p.signFlipped) {
        sets.push('amount = ?');
        params.push(p.newAmount);
        if (p.newAmountRon !== undefined) {
          sets.push('amount_ron = ?');
          params.push(p.newAmountRon);
        }
      }
      if (p.categoryId !== undefined) {
        sets.push('category_id = ?');
        params.push(p.categoryId);
        sets.push('category_learned = ?');
        params.push(p.categoryLearned);
      }
      if (sets.length === 0) continue;
      params.push(p.id);
      await db.runAsync(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);
      updated += 1;
      if (p.signFlipped) signFlippedCount += 1;
    }
  });

  return { total: txs.length, updated, signFlipped: signFlippedCount, aiUsed };
}

export async function backfillMissingRates(accountId?: string): Promise<BackfillResult> {
  const where = accountId
    ? "currency != 'RON' AND amount_ron IS NULL AND account_id = ?"
    : "currency != 'RON' AND amount_ron IS NULL";
  const params = accountId ? [accountId] : [];
  const rows = await db.getAllAsync<{ id: string; date: string; amount: number; currency: string }>(
    `SELECT id, date, amount, currency FROM transactions WHERE ${where}`,
    params
  );

  let updated = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const rate = await getRateRon(r.date, r.currency);
      const amountRon = r.amount * rate;
      await db.runAsync('UPDATE transactions SET amount_ron = ? WHERE id = ?', [amountRon, r.id]);
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  return { updated, failed, total: rows.length };
}
