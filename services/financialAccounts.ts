import { db, generateId } from './db';
import type { FinancialAccount, FinancialAccountType } from '@/types';

type Row = {
  id: string;
  name: string;
  type: string;
  currency: string;
  initial_balance: number;
  initial_balance_date: string | null;
  iban: string | null;
  bank_name: string | null;
  color: string | null;
  icon: string | null;
  archived: number;
  notes: string | null;
  created_at: string;
};

function mapRow(r: Row): FinancialAccount {
  return {
    id: r.id,
    name: r.name,
    type: (r.type as FinancialAccountType) ?? 'bank',
    currency: r.currency || 'RON',
    initial_balance: r.initial_balance ?? 0,
    initial_balance_date: r.initial_balance_date ?? undefined,
    iban: r.iban ?? undefined,
    bank_name: r.bank_name ?? undefined,
    color: r.color ?? undefined,
    icon: r.icon ?? undefined,
    archived: r.archived === 1,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

export async function getFinancialAccounts(includeArchived = false): Promise<FinancialAccount[]> {
  const where = includeArchived ? '' : 'WHERE archived = 0';
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM financial_accounts ${where} ORDER BY created_at DESC`
  );
  return rows.map(mapRow);
}

export async function getFinancialAccount(id: string): Promise<FinancialAccount | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM financial_accounts WHERE id = ?', [id]);
  return row ? mapRow(row) : null;
}

export interface CreateFinancialAccountInput {
  name: string;
  type: FinancialAccountType;
  currency?: string;
  initial_balance?: number;
  initial_balance_date?: string;
  iban?: string;
  bank_name?: string;
  color?: string;
  icon?: string;
  notes?: string;
}

export async function createFinancialAccount(
  input: CreateFinancialAccountInput
): Promise<FinancialAccount> {
  const id = generateId();
  const created_at = new Date().toISOString();
  const currency = input.currency || 'RON';
  const initial_balance = input.initial_balance ?? 0;
  await db.runAsync(
    `INSERT INTO financial_accounts
       (id, name, type, currency, initial_balance, initial_balance_date,
        iban, bank_name, color, icon, archived, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      input.name.trim(),
      input.type,
      currency,
      initial_balance,
      input.initial_balance_date ?? null,
      input.iban?.trim() || null,
      input.bank_name?.trim() || null,
      input.color ?? null,
      input.icon ?? null,
      input.notes?.trim() || null,
      created_at,
    ]
  );
  return {
    id,
    name: input.name.trim(),
    type: input.type,
    currency,
    initial_balance,
    initial_balance_date: input.initial_balance_date,
    iban: input.iban,
    bank_name: input.bank_name,
    color: input.color,
    icon: input.icon,
    archived: false,
    notes: input.notes,
    createdAt: created_at,
  };
}

export interface UpdateFinancialAccountInput {
  name?: string;
  type?: FinancialAccountType;
  currency?: string;
  initial_balance?: number;
  initial_balance_date?: string | null;
  iban?: string | null;
  bank_name?: string | null;
  color?: string | null;
  icon?: string | null;
  notes?: string | null;
}

export async function updateFinancialAccount(
  id: string,
  input: UpdateFinancialAccountInput
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const push = (col: string, val: string | number | null | undefined) => {
    if (val === undefined) return;
    sets.push(`${col} = ?`);
    params.push(val);
  };
  push('name', input.name?.trim());
  push('type', input.type);
  push('currency', input.currency);
  push('initial_balance', input.initial_balance);
  push('initial_balance_date', input.initial_balance_date ?? null);
  push('iban', input.iban ?? null);
  push('bank_name', input.bank_name ?? null);
  push('color', input.color ?? null);
  push('icon', input.icon ?? null);
  push('notes', input.notes ?? null);

  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE financial_accounts SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function archiveFinancialAccount(id: string, archived: boolean): Promise<void> {
  await db.runAsync('UPDATE financial_accounts SET archived = ? WHERE id = ?', [
    archived ? 1 : 0,
    id,
  ]);
}

/**
 * Șterge contul. Tranzacțiile asociate NU se șterg, dar:
 * - `account_id` devine NULL (apar ca „fără cont" în liste/sumare)
 * - extrasele bancare (`bank_statements`) ale contului sunt șterse (au sens
 *   doar legate de un cont; tranzacțiile lor pierd doar `statement_id`)
 * - transferurile interne în care una din jumătăți era pe acest cont sunt
 *   dezlegate (cealaltă jumătate redevine tranzacție obișnuită)
 *
 * Tot procesul rulează într-o tranzacție SQLite — atomic.
 */
export async function deleteFinancialAccount(id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    // Dezleagă transferuri interne unde cealaltă jumătate va rămâne (account_id != id)
    await db.runAsync(
      `UPDATE transactions
          SET is_internal_transfer = 0, linked_transaction_id = NULL
        WHERE id IN (
          SELECT linked_transaction_id FROM transactions
           WHERE account_id = ? AND linked_transaction_id IS NOT NULL
        )`,
      [id]
    );
    // Setează account_id = NULL pe tranzacțiile contului (nu le ștergem)
    await db.runAsync('UPDATE transactions SET account_id = NULL WHERE account_id = ?', [id]);
    // Sterge extrasele bancare asociate (își pierd sensul fără cont)
    await db.runAsync('DELETE FROM bank_statements WHERE account_id = ?', [id]);
    // Sterge contul efectiv
    await db.runAsync('DELETE FROM financial_accounts WHERE id = ?', [id]);
  });
}

/**
 * Verifică dacă utilizatorul are date financiare (conturi sau tranzacții).
 * Folosit la dezactivarea hub-ului din Setări — dacă întoarce `true`, userul
 * primește dialog cu opțiunea de a șterge istoricul.
 */
export async function hasFinancialData(): Promise<boolean> {
  const accounts = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM financial_accounts'
  );
  if ((accounts?.count ?? 0) > 0) return true;
  const tx = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM transactions'
  );
  return (tx?.count ?? 0) > 0;
}

/**
 * Șterge complet istoricul financiar: tranzacții, conturi, extrase bancare,
 * categoriile create de utilizator (cele system rămân). Ireversibil.
 */
export async function wipeFinancialData(): Promise<void> {
  await db.execAsync(`
    DELETE FROM transactions;
    DELETE FROM bank_statements;
    DELETE FROM financial_accounts;
    DELETE FROM expense_categories WHERE is_system = 0;
  `);
}

/**
 * Soldul curent al contului = initial_balance + Σ(transactions.amount).
 * Tranzacțiile marcate ca duplicat sunt excluse.
 */
export async function getCurrentBalance(accountId: string): Promise<number> {
  const account = await db.getFirstAsync<{ initial_balance: number }>(
    'SELECT initial_balance FROM financial_accounts WHERE id = ?',
    [accountId]
  );
  if (!account) return 0;

  const sum = await db.getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE account_id = ? AND duplicate_of_id IS NULL`,
    [accountId]
  );

  return account.initial_balance + (sum?.total ?? 0);
}

/**
 * Sold curent pentru toate conturile (sau lista dată), într-un singur query.
 * Returnează o hartă accountId → sold curent. Util pentru lista de entități.
 */
export async function getCurrentBalances(): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ id: string; total: number }>(
    `SELECT fa.id,
            fa.initial_balance + COALESCE((
              SELECT SUM(amount)
              FROM transactions t
              WHERE t.account_id = fa.id AND t.duplicate_of_id IS NULL
            ), 0) AS total
     FROM financial_accounts fa`
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.id, r.total ?? 0);
  }
  return map;
}
