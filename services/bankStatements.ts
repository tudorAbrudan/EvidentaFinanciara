import { db } from './db';
import type { BankStatement } from '@/types';

type Row = {
  id: string;
  account_id: string;
  period_from: string;
  period_to: string;
  file_path: string | null;
  file_hash: string | null;
  imported_at: string;
  transaction_count: number;
  total_inflow: number;
  total_outflow: number;
  notes: string | null;
  created_at: string;
};

function mapRow(r: Row): BankStatement {
  return {
    id: r.id,
    account_id: r.account_id,
    period_from: r.period_from,
    period_to: r.period_to,
    file_path: r.file_path ?? undefined,
    file_hash: r.file_hash ?? undefined,
    imported_at: r.imported_at,
    transaction_count: r.transaction_count,
    total_inflow: r.total_inflow,
    total_outflow: r.total_outflow,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

export async function getBankStatementsForAccount(accountId: string): Promise<BankStatement[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM bank_statements
       WHERE account_id = ?
       ORDER BY period_to DESC, imported_at DESC`,
    [accountId]
  );
  return rows.map(mapRow);
}

/**
 * Șterge un import de extras: opțional și tranzacțiile importate prin el.
 *
 * - „doar importul" → tranzacțiile rămân, doar `statement_id` devine NULL.
 * - „cu tranzacții" → înainte de DELETE, dezlegăm relațiile spre alte tranzacții
 *   (transferuri interne, duplicate marcate, refunds) ca să nu rămână FK-uri
 *   moarte: partea cealaltă a transferului devine din nou tranzacție obișnuită,
 *   duplicatele își pierd marcajul, etc.
 */
export async function deleteBankStatement(
  statementId: string,
  alsoDeleteTransactions: boolean
): Promise<void> {
  if (alsoDeleteTransactions) {
    await db.withTransactionAsync(async () => {
      // 1. Pentru fiecare tranzacție din statement care e parte dintr-un transfer
      //    intern, dezleagă cealaltă jumătate (revine la tranzacție obișnuită).
      await db.runAsync(
        `UPDATE transactions
            SET is_internal_transfer = 0, linked_transaction_id = NULL
          WHERE id IN (
            SELECT linked_transaction_id FROM transactions
             WHERE statement_id = ? AND linked_transaction_id IS NOT NULL
          )`,
        [statementId]
      );
      // 2. Tranzacții care marchează ca duplicat tranzacții ce urmează a fi șterse:
      //    le scoatem marcajul (devin tranzacții vizibile din nou).
      await db.runAsync(
        `UPDATE transactions
            SET duplicate_of_id = NULL
          WHERE duplicate_of_id IN (
            SELECT id FROM transactions WHERE statement_id = ?
          )`,
        [statementId]
      );
      // 3. Apoi ștergem efectiv.
      await db.runAsync('DELETE FROM transactions WHERE statement_id = ?', [statementId]);
      await db.runAsync('DELETE FROM bank_statements WHERE id = ?', [statementId]);
    });
  } else {
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE transactions SET statement_id = NULL WHERE statement_id = ?', [
        statementId,
      ]);
      await db.runAsync('DELETE FROM bank_statements WHERE id = ?', [statementId]);
    });
  }
}
