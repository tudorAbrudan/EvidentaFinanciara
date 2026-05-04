import * as SQLite from 'expo-sqlite';

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const db = SQLite.openDatabaseSync('finante.db');

db.execSync(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS financial_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'bank',
    currency TEXT NOT NULL DEFAULT 'RON',
    initial_balance REAL NOT NULL DEFAULT 0,
    initial_balance_date TEXT,
    iban TEXT,
    bank_name TEXT,
    color TEXT,
    icon TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    key TEXT,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    parent_id TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    monthly_limit REAL,
    display_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RON',
    amount_ron REAL,
    description TEXT,
    merchant TEXT,
    category_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    statement_id TEXT,
    is_internal_transfer INTEGER NOT NULL DEFAULT 0,
    linked_transaction_id TEXT,
    is_refund INTEGER NOT NULL DEFAULT 0,
    duplicate_of_id TEXT,
    notes TEXT,
    cash_suggestion_dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_statements (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    file_path TEXT,
    file_hash TEXT,
    imported_at TEXT NOT NULL,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    total_inflow REAL NOT NULL DEFAULT 0,
    total_outflow REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fx_rates (
    date TEXT NOT NULL,
    currency TEXT NOT NULL,
    rate REAL NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (date, currency)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    template TEXT,
    sql_used TEXT,
    evidence_json TEXT,
    explanation_short TEXT,
    error_kind TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_fa_archived ON financial_accounts(archived);
  CREATE INDEX IF NOT EXISTS idx_cat_system ON expense_categories(is_system, archived);
  CREATE INDEX IF NOT EXISTS idx_cat_parent ON expense_categories(parent_id);
  CREATE INDEX IF NOT EXISTS idx_cat_order ON expense_categories(display_order);
  CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
  CREATE INDEX IF NOT EXISTS idx_tx_statement ON transactions(statement_id);
  CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(linked_transaction_id);
  CREATE INDEX IF NOT EXISTS idx_tx_cash_pending
    ON transactions(date DESC)
    WHERE is_internal_transfer = 0
      AND cash_suggestion_dismissed = 0
      AND amount < 0;
  CREATE INDEX IF NOT EXISTS idx_bs_account_period ON bank_statements(account_id, period_to DESC);
  CREATE INDEX IF NOT EXISTS idx_fx_rates_currency_date ON fx_rates(currency, date DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
`);

try {
  db.execSync(`
    INSERT OR IGNORE INTO expense_categories
      (id, key, name, icon, color, is_system, display_order, created_at)
    VALUES
      ('cat-sys-food',          'food',          'Mâncare',      'fast-food',             '#F2994A', 1,  0,  datetime('now')),
      ('cat-sys-transport',     'transport',     'Transport',    'bus',                   '#56CCF2', 1,  1,  datetime('now')),
      ('cat-sys-utilities',     'utilities',     'Utilități',    'flash',                 '#F2C94C', 1,  2,  datetime('now')),
      ('cat-sys-health',        'health',        'Sănătate',     'medkit',                '#EB5757', 1,  3,  datetime('now')),
      ('cat-sys-vehicle',       'vehicle',       'Mașină',       'car-sport',             '#2D9CDB', 1,  4,  datetime('now')),
      ('cat-sys-home',          'home',          'Casă',         'home',                  '#BB6BD9', 1,  5,  datetime('now')),
      ('cat-sys-entertainment', 'entertainment', 'Distracție',   'happy',                 '#F2C94C', 1,  6,  datetime('now')),
      ('cat-sys-subscriptions', 'subscriptions', 'Abonamente',   'repeat',                '#6FCF97', 1,  7,  datetime('now')),
      ('cat-sys-shopping',      'shopping',      'Cumpărături',  'bag-handle',            '#F2994A', 1,  8,  datetime('now')),
      ('cat-sys-education',     'education',     'Educație',     'school',                '#27AE60', 1,  9,  datetime('now')),
      ('cat-sys-travel',        'travel',        'Călătorii',    'airplane',              '#56CCF2', 1,  10, datetime('now')),
      ('cat-sys-income',        'income',        'Venituri',     'cash',                  '#27AE60', 1,  11, datetime('now')),
      ('cat-sys-transfer',      'transfer',      'Transfer',     'swap-horizontal',       '#828282', 1,  12, datetime('now')),
      ('cat-sys-other',         'other',         'Alte',         'ellipsis-horizontal',   '#9F9F9F', 1,  99, datetime('now'))
  `);
} catch {
  // seed deja aplicat
}

try {
  db.execSync(
    `ALTER TABLE transactions ADD COLUMN cash_suggestion_dismissed INTEGER NOT NULL DEFAULT 0`
  );
} catch {
  // coloana există deja
}
