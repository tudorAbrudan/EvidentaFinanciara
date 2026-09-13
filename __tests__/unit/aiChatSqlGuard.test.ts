import { validateAndNormalizeSql } from '@/services/aiChatSqlGuard';

describe('aiChatSqlGuard', () => {
  describe('ACCEPT', () => {
    it.each([
      ['SELECT * FROM transactions LIMIT 100', 'SELECT * FROM transactions LIMIT 100'],
      [
        "SELECT * FROM transactions WHERE merchant LIKE '%MCD%' LIMIT 100",
        "SELECT * FROM transactions WHERE merchant LIKE '%MCD%' LIMIT 100",
      ],
      [
        "SELECT SUM(amount_ron) FROM transactions WHERE date >= '2026-01-01' LIMIT 1",
        "SELECT SUM(amount_ron) FROM transactions WHERE date >= '2026-01-01' LIMIT 1",
      ],
      [
        'WITH cte AS (SELECT * FROM transactions LIMIT 50) SELECT * FROM cte LIMIT 50',
        'WITH cte AS (SELECT * FROM transactions LIMIT 50) SELECT * FROM cte LIMIT 50',
      ],
      [
        'SELECT t.*, c.name FROM transactions t LEFT JOIN expense_categories c ON c.id = t.category_id LIMIT 100',
        'SELECT t.*, c.name FROM transactions t LEFT JOIN expense_categories c ON c.id = t.category_id LIMIT 100',
      ],
    ])('accepts %s', (input, expected) => {
      const r = validateAndNormalizeSql(input);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toBe(expected);
    });
  });

  describe('REJECT', () => {
    it.each([
      'DROP TABLE transactions',
      'SELECT * FROM transactions; DELETE FROM transactions',
      'SELECT * FROM transactions /* sneaky */ INTO outfile',
      'PRAGMA table_info(transactions)',
      "ATTACH DATABASE 'evil.db' AS evil",
      'SELECT * FROM bank_statements LIMIT 10',
      'SELECT * FROM settings LIMIT 10',
      'SELECT * FROM chat_messages LIMIT 10',
      '-- comment\nDELETE FROM transactions',
      "SELECT load_extension('evil.so') LIMIT 1",
      'INSERT INTO transactions VALUES (1)',
      'UPDATE transactions SET amount = 0',
      'CREATE TABLE x (a INT)',
      'SELECT * FROM transactions UNION SELECT * FROM bank_statements LIMIT 10',
    ])('rejects %s', input => {
      const r = validateAndNormalizeSql(input);
      expect(r.ok).toBe(false);
    });
  });

  describe('LIMIT injection / clamp', () => {
    it('adds LIMIT 500 when missing', () => {
      const r = validateAndNormalizeSql('SELECT * FROM transactions');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toBe('SELECT * FROM transactions LIMIT 500');
    });
    it('clamps LIMIT > 500 to 500', () => {
      const r = validateAndNormalizeSql('SELECT * FROM transactions LIMIT 9999');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toMatch(/LIMIT 500\s*$/);
    });
    it('preserves LIMIT under 500', () => {
      const r = validateAndNormalizeSql('SELECT * FROM transactions LIMIT 50');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sql).toMatch(/LIMIT 50\s*$/);
    });
  });
});

describe('SQL-ul din few-shot pentru template-urile noi trece guard-ul', () => {
  it('spend_total: agregat cu BETWEEN pe interval', () => {
    const sql =
      "SELECT SUM(ABS(COALESCE(t.amount_ron, t.amount))) AS total, COUNT(*) AS count FROM transactions t JOIN financial_accounts a ON a.id = t.account_id JOIN expense_categories c ON c.id = t.category_id WHERE c.key = 'vehicle' AND a.name = 'BT_curent_ron' AND t.amount < 0 AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND t.date BETWEEN '2026-06-01' AND '2026-06-20' LIMIT 1";
    const r = validateAndNormalizeSql(sql);
    expect(r.ok).toBe(true);
  });

  it('top_spending: UNION ALL între categorii și comercianți', () => {
    const sql =
      "SELECT 'category' AS dim, c.name AS label, SUM(ABS(COALESCE(t.amount_ron, t.amount))) AS total, COUNT(*) AS count FROM transactions t JOIN expense_categories c ON c.id = t.category_id WHERE t.amount < 0 AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND substr(t.date, 1, 7) = '2026-05' GROUP BY c.name UNION ALL SELECT 'merchant' AS dim, COALESCE(t.merchant, 'Necunoscut') AS label, SUM(ABS(COALESCE(t.amount_ron, t.amount))) AS total, COUNT(*) AS count FROM transactions t WHERE t.amount < 0 AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND substr(t.date, 1, 7) = '2026-05' GROUP BY label ORDER BY dim ASC, total DESC LIMIT 40";
    const r = validateAndNormalizeSql(sql);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sql).toContain('UNION ALL');
  });
});

describe('guard fail-closed: identificatori citați și comma-join', () => {
  const blocked: [string, string][] = [
    ['ghilimele duble', 'SELECT * FROM "chat_messages" LIMIT 1'],
    ['paranteze drepte', 'SELECT * FROM [chat_messages] LIMIT 1'],
    ['backtick', 'SELECT * FROM `chat_messages` LIMIT 1'],
    ['citat pe bank_statements', 'SELECT * FROM "bank_statements" LIMIT 1'],
    ['comma-join ascuns', 'SELECT * FROM transactions, chat_messages LIMIT 1'],
    ['comma-join citat', 'SELECT * FROM transactions, "chat_messages" LIMIT 1'],
    ['join citat', 'SELECT * FROM transactions t JOIN "chat_messages" c ON 1=1 LIMIT 1'],
    ['tabel necunoscut citat', 'SELECT * FROM "sqlite_master" LIMIT 1'],
  ];
  for (const [name, sql] of blocked) {
    it(`respinge ${name}`, () => {
      expect(validateAndNormalizeSql(sql).ok).toBe(false);
    });
  }

  const allowed: [string, string][] = [
    ['tabel permis citat', 'SELECT * FROM "transactions" LIMIT 1'],
    ['comma-join legitim', 'SELECT * FROM transactions t, expense_categories c LIMIT 1'],
    ['subquery în FROM', 'SELECT * FROM (SELECT id FROM transactions) x LIMIT 1'],
    ['CTE', 'WITH x AS (SELECT id FROM transactions) SELECT * FROM x LIMIT 1'],
    [
      'JOIN clasic',
      'SELECT * FROM transactions t JOIN financial_accounts a ON a.id = t.account_id LIMIT 1',
    ],
    [
      'LEFT JOIN (folosit de account_balance)',
      'SELECT * FROM financial_accounts a LEFT JOIN transactions t ON t.account_id = a.id LIMIT 1',
    ],
    [
      'UNION ALL (folosit de top_spending)',
      'SELECT id FROM transactions UNION ALL SELECT id FROM expense_categories LIMIT 5',
    ],
    [
      'cuvânt de tabel doar în literal',
      "SELECT id FROM transactions WHERE merchant = 'from chat_messages' LIMIT 1",
    ],
  ];
  for (const [name, sql] of allowed) {
    it(`acceptă ${name}`, () => {
      expect(validateAndNormalizeSql(sql).ok).toBe(true);
    });
  }
});
