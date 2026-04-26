import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { db, generateId } from './db';
import * as financialAccounts from './financialAccounts';
import * as categories from './categories';
import * as transactions from './transactions';
import type {
  FinancialAccount,
  FinancialAccountType,
  ExpenseCategory,
  Transaction,
  TransactionSource,
  BankStatement,
} from '@/types';

const BACKUP_VERSION = 1;
const APP_TAG = 'finante';

export interface BackupPayload {
  version: number;
  app: typeof APP_TAG;
  exportDate: string;
  financialAccounts: FinancialAccount[];
  expenseCategories: ExpenseCategory[];
  transactions: Transaction[];
  bankStatements: BankStatement[];
  fxRates: { date: string; currency: string; rate: number; fetched_at: string }[];
}

export interface BackupSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

type AnyRecord = Record<string, unknown>;

async function getAllBankStatements(): Promise<BankStatement[]> {
  const rows =
    (await db.getAllAsync<{
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
    }>('SELECT * FROM bank_statements ORDER BY period_to DESC, imported_at DESC')) ?? [];
  return rows.map(r => ({
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
  }));
}

export async function exportBackup(): Promise<string> {
  const fxRows =
    (await db.getAllAsync<{
      date: string;
      currency: string;
      rate: number;
      fetched_at: string;
    }>('SELECT date, currency, rate, fetched_at FROM fx_rates')) ?? [];

  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    app: APP_TAG,
    exportDate: new Date().toISOString(),
    financialAccounts: await financialAccounts.getFinancialAccounts(true),
    expenseCategories: await categories.getCategories(true),
    transactions: await transactions.getTransactions({ excludeDuplicates: false }),
    bankStatements: await getAllBankStatements(),
    fxRates: fxRows,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const path = `${FileSystem.documentDirectory}finante_backup_${stamp}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'application/json',
      dialogTitle: 'Backup Finanțe',
    });
  }
  return path;
}

export async function importBackup(path: string): Promise<BackupSummary> {
  const text = await FileSystem.readAsStringAsync(path);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Fișierul nu este un JSON valid.');
  }
  const payload = (raw ?? {}) as Record<string, unknown>;
  if (payload.app !== APP_TAG) {
    throw new Error('Backup-ul nu provine din aplicația Finanțe.');
  }
  const version = payload.version;
  if (typeof version !== 'number' || version > BACKUP_VERSION) {
    throw new Error('Versiune backup neacceptată.');
  }

  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  const accountMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const statementMap = new Map<string, string>();
  const transactionMap = new Map<string, string>();

  // 1. Conturi — dedupe după (name lowercase, type)
  const existingAccounts = await financialAccounts.getFinancialAccounts(true);
  const existingAccountByKey = new Map(
    existingAccounts.map(a => [`${a.name.toLowerCase().trim()}|${a.type}`, a.id])
  );

  for (const a of (payload.financialAccounts as AnyRecord[] | undefined) ?? []) {
    try {
      const name = ((a.name as string) || '').trim() || 'Cont';
      const type = (a.type as FinancialAccountType) || 'bank';
      const key = `${name.toLowerCase()}|${type}`;
      const existingId = existingAccountByKey.get(key);
      if (existingId) {
        if (a.id) accountMap.set(a.id as string, existingId);
        skipped++;
        continue;
      }
      const created = await financialAccounts.createFinancialAccount({
        name,
        type,
        currency: (a.currency as string) || 'RON',
        initial_balance: (a.initial_balance as number) ?? 0,
        initial_balance_date: a.initial_balance_date as string | undefined,
        iban: a.iban as string | undefined,
        bank_name: a.bank_name as string | undefined,
        color: a.color as string | undefined,
        icon: a.icon as string | undefined,
        notes: a.notes as string | undefined,
      });
      if (a.archived === true || a.archived === 1) {
        await financialAccounts.archiveFinancialAccount(created.id, true);
      }
      if (a.id) accountMap.set(a.id as string, created.id);
      existingAccountByKey.set(key, created.id);
      imported++;
    } catch (e) {
      errors.push(`Cont „${a.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // 2. Categorii — sistem după `key`, custom după `name`
  const existingCategories = await categories.getCategories(true);
  const existingCategoryByKey = new Map<string, string>();
  const existingCategoryByName = new Map<string, string>();
  for (const c of existingCategories) {
    if (c.is_system && c.key) existingCategoryByKey.set(`sys:${c.key}`, c.id);
    else existingCategoryByName.set(c.name.toLowerCase().trim(), c.id);
  }

  for (const c of (payload.expenseCategories as AnyRecord[] | undefined) ?? []) {
    try {
      const oldId = c.id as string | undefined;
      const isSystem = c.is_system === true || c.is_system === 1;
      const key = c.key as string | undefined;

      if (isSystem && key) {
        const existingId = existingCategoryByKey.get(`sys:${key}`);
        if (existingId) {
          if (oldId) categoryMap.set(oldId, existingId);
          if (typeof c.monthly_limit === 'number') {
            await db.runAsync('UPDATE expense_categories SET monthly_limit = ? WHERE id = ?', [
              c.monthly_limit,
              existingId,
            ]);
          }
          skipped++;
        }
        continue;
      }

      const name = ((c.name as string) || '').trim() || 'Categorie';
      const nameKey = name.toLowerCase();
      const existingId = existingCategoryByName.get(nameKey);
      if (existingId) {
        if (oldId) categoryMap.set(oldId, existingId);
        skipped++;
      } else {
        const created = await categories.createCategory({
          name,
          icon: c.icon as string | undefined,
          color: c.color as string | undefined,
          monthly_limit: c.monthly_limit as number | undefined,
          display_order: c.display_order as number | undefined,
        });
        if (c.archived === true || c.archived === 1) {
          await categories.archiveCategory(created.id, true);
        }
        if (oldId) categoryMap.set(oldId, created.id);
        existingCategoryByName.set(nameKey, created.id);
        imported++;
      }
    } catch (e) {
      errors.push(`Categorie „${c.name}": ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // 3. Extrase bancare — dedupe după (account_id + period_from + period_to + file_hash)
  const existingStatements = await db.getAllAsync<{
    id: string;
    account_id: string;
    period_from: string;
    period_to: string;
    file_hash: string | null;
  }>('SELECT id, account_id, period_from, period_to, file_hash FROM bank_statements');
  const existingStatementByKey = new Map(
    existingStatements.map(s => [
      `${s.account_id}|${s.period_from}|${s.period_to}|${s.file_hash ?? ''}`,
      s.id,
    ])
  );

  for (const s of (payload.bankStatements as AnyRecord[] | undefined) ?? []) {
    try {
      const oldAccountId = s.account_id as string | undefined;
      if (!oldAccountId) continue;
      const newAccountId = accountMap.get(oldAccountId);
      if (!newAccountId) continue;

      const periodFrom = s.period_from as string;
      const periodTo = s.period_to as string;
      const fileHash = (s.file_hash as string | null) ?? '';
      const key = `${newAccountId}|${periodFrom}|${periodTo}|${fileHash}`;
      const existingId = existingStatementByKey.get(key);
      if (existingId) {
        if (s.id) statementMap.set(s.id as string, existingId);
        skipped++;
        continue;
      }

      const newId = generateId();
      await db.runAsync(
        `INSERT INTO bank_statements
           (id, account_id, period_from, period_to, file_path, file_hash,
            imported_at, transaction_count, total_inflow, total_outflow, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          newAccountId,
          periodFrom,
          periodTo,
          (s.file_path as string | null) ?? null,
          (s.file_hash as string | null) ?? null,
          (s.imported_at as string) || new Date().toISOString(),
          (s.transaction_count as number) ?? 0,
          (s.total_inflow as number) ?? 0,
          (s.total_outflow as number) ?? 0,
          (s.notes as string | null) ?? null,
          (s.created_at as string) || new Date().toISOString(),
        ]
      );
      if (s.id) statementMap.set(s.id as string, newId);
      existingStatementByKey.set(key, newId);
      imported++;
    } catch (e) {
      errors.push(`Extras bancar: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // 4. Tranzacții — pas 1: insert (cu remap conturi/categorii/extrase)
  const existingTransactions = await transactions.getTransactions({ excludeDuplicates: false });
  const txKey = (t: {
    account_id?: string;
    date: string;
    amount: number;
    description?: string;
    merchant?: string;
  }) =>
    `${t.account_id ?? ''}|${t.date}|${t.amount.toFixed(2)}|${(t.description ?? '').toLowerCase().trim()}|${(t.merchant ?? '').toLowerCase().trim()}`;
  const existingTxByKey = new Map(existingTransactions.map(t => [txKey(t), t.id]));

  const txWithLink: { newId: string; oldLinkedId: string }[] = [];
  const txDuplicates: { newId: string; oldOriginalId: string }[] = [];

  for (const t of (payload.transactions as AnyRecord[] | undefined) ?? []) {
    try {
      const oldId = t.id as string | undefined;
      const oldAccountId = t.account_id as string | undefined;
      const newAccountId = oldAccountId ? accountMap.get(oldAccountId) : undefined;
      const oldCategoryId = t.category_id as string | undefined;
      const newCategoryId = oldCategoryId ? categoryMap.get(oldCategoryId) : undefined;
      const oldStatementId = t.statement_id as string | undefined;
      const newStatementId = oldStatementId ? statementMap.get(oldStatementId) : undefined;

      const candidate = {
        account_id: newAccountId,
        date: t.date as string,
        amount: t.amount as number,
        description: t.description as string | undefined,
        merchant: t.merchant as string | undefined,
      };
      const existingId = existingTxByKey.get(txKey(candidate));
      if (existingId) {
        if (oldId) transactionMap.set(oldId, existingId);
        skipped++;
        continue;
      }

      const created = await transactions.createTransaction({
        account_id: newAccountId,
        date: t.date as string,
        amount: t.amount as number,
        currency: (t.currency as string) || 'RON',
        amount_ron: t.amount_ron as number | undefined,
        description: t.description as string | undefined,
        merchant: t.merchant as string | undefined,
        category_id: newCategoryId,
        source: (t.source as TransactionSource) || 'manual',
        statement_id: newStatementId,
        is_refund: t.is_refund === true || t.is_refund === 1,
        notes: t.notes as string | undefined,
      });

      if (oldId) transactionMap.set(oldId, created.id);
      existingTxByKey.set(txKey(candidate), created.id);

      const oldLinkedId = t.linked_transaction_id as string | undefined;
      const isTransfer = t.is_internal_transfer === true || t.is_internal_transfer === 1;
      if (isTransfer && oldLinkedId) {
        txWithLink.push({ newId: created.id, oldLinkedId });
      }
      const oldOriginalId = t.duplicate_of_id as string | undefined;
      if (oldOriginalId) {
        txDuplicates.push({ newId: created.id, oldOriginalId });
      }
      imported++;
    } catch (e) {
      errors.push(`Tranzacție: ${e instanceof Error ? e.message : 'eroare'}`);
    }
  }

  // 5. Tranzacții — pas 2: leagă transferurile interne și marchează duplicate
  for (const link of txWithLink) {
    const newLinkedId = transactionMap.get(link.oldLinkedId);
    if (!newLinkedId) continue;
    try {
      await db.runAsync(
        'UPDATE transactions SET is_internal_transfer = 1, linked_transaction_id = ? WHERE id = ?',
        [newLinkedId, link.newId]
      );
    } catch {
      // best-effort
    }
  }
  for (const dup of txDuplicates) {
    const newOriginalId = transactionMap.get(dup.oldOriginalId);
    if (!newOriginalId) continue;
    try {
      await db.runAsync('UPDATE transactions SET duplicate_of_id = ? WHERE id = ?', [
        newOriginalId,
        dup.newId,
      ]);
    } catch {
      // best-effort
    }
  }

  // 6. Cursuri valutare — best-effort
  for (const r of (payload.fxRates as AnyRecord[] | undefined) ?? []) {
    try {
      await db.runAsync(
        'INSERT OR IGNORE INTO fx_rates (date, currency, rate, fetched_at) VALUES (?, ?, ?, ?)',
        [
          r.date as string,
          r.currency as string,
          r.rate as number,
          (r.fetched_at as string) || new Date().toISOString(),
        ]
      );
    } catch {
      // ignorăm
    }
  }

  return { imported, skipped, errors };
}
