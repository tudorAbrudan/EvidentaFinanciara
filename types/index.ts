// ────────────────────────────────────────────────────────────────────────────
// Conturi financiare
// ────────────────────────────────────────────────────────────────────────────

export type FinancialAccountType =
  | 'bank' // cont curent
  | 'cash' // numerar
  | 'card' // card de credit
  | 'savings' // cont de economii
  | 'investment' // investiții
  | 'other';

export interface FinancialAccount {
  id: string;
  name: string;
  type: FinancialAccountType;
  currency: string; // 'RON', 'EUR', 'USD', etc.
  initial_balance: number;
  initial_balance_date?: string; // YYYY-MM-DD
  iban?: string;
  bank_name?: string;
  color?: string; // hex pentru UI
  icon?: string; // numele icon-ului Ionicons
  archived: boolean;
  notes?: string;
  createdAt: string;
}

export const FINANCIAL_ACCOUNT_TYPE_LABELS: Record<FinancialAccountType, string> = {
  bank: 'Cont curent',
  cash: 'Numerar',
  card: 'Card de credit',
  savings: 'Economii',
  investment: 'Investiții',
  other: 'Altul',
};

// ────────────────────────────────────────────────────────────────────────────
// Categorii
// ────────────────────────────────────────────────────────────────────────────

export type CategoryKey =
  | 'food'
  | 'transport'
  | 'utilities'
  | 'health'
  | 'vehicle'
  | 'home'
  | 'entertainment'
  | 'subscriptions'
  | 'shopping'
  | 'education'
  | 'travel'
  | 'income'
  | 'transfer'
  | 'other';

export interface ExpenseCategory {
  id: string;
  key?: CategoryKey; // setat doar la categoriile sistem
  name: string;
  icon?: string;
  color?: string;
  parent_id?: string;
  is_system: boolean;
  monthly_limit?: number; // în RON; undefined = fără limită
  display_order: number;
  archived: boolean;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Tranzacții
// ────────────────────────────────────────────────────────────────────────────

export type TransactionSource = 'manual' | 'statement' | 'ocr' | 'demo';

/**
 * Tranzacție financiară: cheltuială (amount < 0), venit (amount > 0) sau transfer.
 *
 * Reguli:
 * - `account_id` NULL ⇒ cash sau orphan (nu apare în soldul niciunui cont)
 * - `category_id` NULL ⇒ necategorizat
 * - `is_internal_transfer = true` ⇒ se exclude din analitice;
 *   `linked_transaction_id` punctează cealaltă jumătate a transferului
 * - `is_refund = true` ⇒ retur (amount > 0 dar contra-categorizat la cheltuieli)
 * - `duplicate_of_id` ⇒ marchează duplicat detectat (păstrăm pentru audit; UI ascunde)
 */
export interface Transaction {
  id: string;
  account_id?: string;
  date: string; // YYYY-MM-DD
  amount: number; // negativ = cheltuială, pozitiv = venit
  currency: string;
  amount_ron?: number; // pre-calculat pentru agregări multi-currency
  description?: string;
  merchant?: string;
  category_id?: string;
  source: TransactionSource;
  statement_id?: string;
  is_internal_transfer: boolean;
  linked_transaction_id?: string;
  is_refund: boolean;
  duplicate_of_id?: string;
  notes?: string;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Extrase bancare
// ────────────────────────────────────────────────────────────────────────────

export interface BankStatement {
  id: string;
  account_id: string;
  period_from: string; // YYYY-MM-DD
  period_to: string; // YYYY-MM-DD
  file_path?: string;
  file_hash?: string;
  imported_at: string; // ISO
  transaction_count: number;
  total_inflow: number;
  total_outflow: number;
  notes?: string;
  createdAt: string;
}
