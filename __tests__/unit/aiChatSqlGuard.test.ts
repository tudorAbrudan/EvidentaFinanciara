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
