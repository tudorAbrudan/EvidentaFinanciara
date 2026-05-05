import { db, generateId } from './db';
import { getRateRon } from './fxRates';

import type { Transaction, TransactionSource } from '@/types';

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

  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM transactions ${whereSql} ORDER BY date DESC, created_at DESC ${limitSql} ${offsetSql}`,
    params
  );
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

  await db.runAsync(
    `INSERT INTO transactions
       (id, account_id, date, amount, currency, amount_ron, description, merchant,
        category_id, source, statement_id,
        is_internal_transfer, linked_transaction_id, is_refund, duplicate_of_id, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      input.account_id ?? null,
      input.date,
      input.amount,
      currency,
      amount_ron,
      input.description?.trim() || null,
      input.merchant?.trim() || null,
      input.category_id ?? null,
      input.source ?? 'manual',
      input.statement_id ?? null,
      input.is_internal_transfer ? 1 : 0,
      input.linked_transaction_id ?? null,
      input.is_refund ? 1 : 0,
      input.notes?.trim() || null,
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
    category_id: input.category_id,
    source: input.source ?? 'manual',
    statement_id: input.statement_id,
    is_internal_transfer: !!input.is_internal_transfer,
    linked_transaction_id: input.linked_transaction_id,
    is_refund: !!input.is_refund,
    cash_suggestion_dismissed: false,
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
  push('category_id', input.category_id ?? null);
  push('notes', input.notes ?? null);
  if (input.is_refund !== undefined) {
    sets.push('is_refund = ?');
    params.push(input.is_refund ? 1 : 0);
  }

  if (sets.length === 0) return;
  params.push(id);
  await db.runAsync(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);
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
export async function linkAsInternalTransfer(txId1: string, txId2: string): Promise<void> {
  if (txId1 === txId2) throw new Error('Trebuie 2 tranzacții diferite.');
  const t1 = await getTransaction(txId1);
  const t2 = await getTransaction(txId2);
  if (!t1 || !t2) throw new Error('Tranzacție inexistentă.');
  if (t1.account_id && t2.account_id && t1.account_id === t2.account_id) {
    throw new Error('Transferul intern presupune conturi diferite.');
  }
  if (Math.abs(t1.amount + t2.amount) > 0.01) {
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

function matchTransferCandidates(txs: Transaction[]): TransferCandidate[] {
  const outflows = txs.filter(t => t.amount < 0 && t.account_id);
  const inflows = txs.filter(t => t.amount > 0 && t.account_id);

  const result: TransferCandidate[] = [];
  const usedIn = new Set<string>();

  for (const out of outflows) {
    let bestMatch: Transaction | undefined;
    let bestDelta = Infinity;
    for (const inn of inflows) {
      if (usedIn.has(inn.id)) continue;
      if (inn.account_id === out.account_id) continue;
      if (Math.abs(out.amount + inn.amount) > 0.01) continue;
      const days = Math.abs(new Date(out.date).getTime() - new Date(inn.date).getTime()) / 86400000;
      if (days > 2) continue;
      if (days < bestDelta) {
        bestDelta = days;
        bestMatch = inn;
      }
    }
    if (bestMatch) {
      result.push({ outflow: out, inflow: bestMatch });
      usedIn.add(bestMatch.id);
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
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount > 0 THEN COALESCE(amount_ron, amount) ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN amount < 0 THEN COALESCE(amount_ron, amount) ELSE 0 END), 0) AS expense,
       COUNT(*) AS cnt
     FROM transactions
     WHERE ${whereSql}`,
    params
  );

  const income = row?.income ?? 0;
  const expense = Math.abs(row?.expense ?? 0);
  return {
    income_ron: income,
    expense_ron: expense,
    net_ron: income - expense,
    transaction_count: row?.cnt ?? 0,
  };
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
       SUM(COALESCE(t.amount_ron, t.amount)) AS total,
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

  const grandTotal = items.reduce((s, it) => s + it.total_ron, 0);
  if (grandTotal > 0) {
    for (const it of items) {
      it.percentage = Math.round((it.total_ron / grandTotal) * 1000) / 10;
    }
  }

  return items.sort((a, b) => b.total_ron - a.total_ron);
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
              SUM(COALESCE(amount_ron, amount)) AS total
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
