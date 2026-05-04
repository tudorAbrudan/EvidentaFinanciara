import { db, generateId } from './db';
import { getRateRon } from './fxRates';

import type { Transaction } from '@/types';

export type TransferType = 'cash' | 'savings_out' | 'savings_in';

const CASH_RE = /\b(retragere|extragere|atm|bancomat|cash\s*withdrawal|numerar)\b/i;
const SAVINGS_OUT_RE =
  /\b(transfer\s+(la|spre|catre)\s+(economii|depozit)|alimentare\s+(cont\s+)?economii|constituire\s+depozit|economisire)\b/i;
const SAVINGS_IN_RE =
  /\b(transfer\s+(din|de\s+la)\s+(economii|depozit)|retragere\s+(din\s+)?economii|lichidare\s+depozit)\b/i;

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function detectTransferType(tx: Transaction): TransferType | null {
  if (tx.is_internal_transfer) return null;
  const haystack = normalize(`${tx.description ?? ''} ${tx.merchant ?? ''}`);
  if (tx.amount < 0) {
    if (CASH_RE.test(haystack)) return 'cash';
    if (SAVINGS_OUT_RE.test(haystack)) return 'savings_out';
    return null;
  }
  if (tx.amount > 0) {
    if (SAVINGS_IN_RE.test(haystack)) return 'savings_in';
    return null;
  }
  return null;
}

export interface PendingTransferSuggestion extends Transaction {
  suggested_type: TransferType;
}

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
    source: (r.source ?? 'manual') as Transaction['source'],
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

interface ListOptions {
  limit?: number;
  sinceDays?: number;
}

async function fetchCandidates(sinceDays: number): Promise<PendingTransferSuggestion[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM transactions
       WHERE is_internal_transfer = 0
         AND cash_suggestion_dismissed = 0
         AND duplicate_of_id IS NULL
         AND date >= date('now', ?)
       ORDER BY date DESC, created_at DESC`,
    [`-${sinceDays} days`]
  );
  const out: PendingTransferSuggestion[] = [];
  for (const r of rows) {
    const tx = rowToTx(r);
    const type = detectTransferType(tx);
    if (type) out.push({ ...tx, suggested_type: type });
  }
  return out;
}

export async function listPendingTransferSuggestions(
  opts: ListOptions = {}
): Promise<PendingTransferSuggestion[]> {
  const limit = opts.limit ?? 10;
  const sinceDays = opts.sinceDays ?? 365;
  const candidates = await fetchCandidates(sinceDays);
  return candidates.slice(0, limit);
}

export async function countPendingTransferSuggestions(opts: ListOptions = {}): Promise<number> {
  const sinceDays = opts.sinceDays ?? 365;
  const candidates = await fetchCandidates(sinceDays);
  return candidates.length;
}

export async function dismissTransferSuggestion(txId: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET cash_suggestion_dismissed = 1 WHERE id = ?', [txId]);
}

const TRANSFER_CATEGORY_ID = 'cat-sys-transfer';

export async function convertToTransfer(
  sourceTxId: string,
  targetAccountId: string
): Promise<void> {
  const sourceRow = await db.getFirstAsync<Row>('SELECT * FROM transactions WHERE id = ?', [
    sourceTxId,
  ]);
  if (!sourceRow) throw new Error('Tranzacția sursă nu există.');
  const source = rowToTx(sourceRow);
  if (source.is_internal_transfer) {
    throw new Error('Tranzacția este deja transfer intern.');
  }
  if (source.amount === 0) {
    throw new Error('Tranzacția are sumă zero, nu poate fi convertită.');
  }

  const target = await db.getFirstAsync<{
    id: string;
    type: string;
    currency: string;
  }>('SELECT id, type, currency FROM financial_accounts WHERE id = ?', [targetAccountId]);
  if (!target) throw new Error('Contul destinație nu există.');

  if (source.amount < 0) {
    if (target.type !== 'cash' && target.type !== 'savings') {
      throw new Error('Contul destinație trebuie să fie de tip cash sau economii.');
    }
  } else {
    if (target.type !== 'savings') {
      throw new Error('Pentru transferurile inbound, contul destinație trebuie să fie economii.');
    }
  }

  if (target.currency !== source.currency) {
    throw new Error(
      `Valuta nu se potrivește: sursa e ${source.currency}, contul destinație e ${target.currency}.`
    );
  }

  const pairId = generateId();
  const pairAmount = -source.amount;
  let pairAmountRon: number | null = source.currency === 'RON' ? pairAmount : null;
  if (source.currency !== 'RON') {
    try {
      const rate = await getRateRon(source.date, source.currency);
      pairAmountRon = pairAmount * rate;
    } catch {
      pairAmountRon = null;
    }
  }
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE transactions
         SET is_internal_transfer = 1,
             linked_transaction_id = ?,
             category_id = ?,
             cash_suggestion_dismissed = 1
         WHERE id = ?`,
      [pairId, TRANSFER_CATEGORY_ID, sourceTxId]
    );

    await db.runAsync(
      `INSERT INTO transactions
         (id, account_id, date, amount, currency, amount_ron, description, merchant,
          category_id, source, statement_id,
          is_internal_transfer, linked_transaction_id, is_refund, duplicate_of_id,
          cash_suggestion_dismissed, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, 0, NULL, 0, ?, ?)`,
      [
        pairId,
        targetAccountId,
        source.date,
        pairAmount,
        source.currency,
        pairAmountRon,
        source.description ?? null,
        source.merchant ?? null,
        TRANSFER_CATEGORY_ID,
        source.source,
        sourceTxId,
        source.notes ?? null,
        now,
      ]
    );
  });
}
