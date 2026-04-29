import * as fs from 'fs';
import * as path from 'path';

describe('schema DB', () => {
  const dbSource = fs.readFileSync(path.join(__dirname, '../../services/db.ts'), 'utf8');

  it('include tabela chat_messages cu coloanele corecte', () => {
    expect(dbSource).toMatch(/CREATE TABLE IF NOT EXISTS chat_messages/);
    expect(dbSource).toMatch(/role TEXT NOT NULL/);
    expect(dbSource).toMatch(/content TEXT NOT NULL/);
    expect(dbSource).toMatch(/template TEXT/);
    expect(dbSource).toMatch(/sql_used TEXT/);
    expect(dbSource).toMatch(/evidence_json TEXT/);
    expect(dbSource).toMatch(/explanation_short TEXT/);
    expect(dbSource).toMatch(/error_kind TEXT/);
  });

  it('include index pe chat_messages.created_at DESC', () => {
    expect(dbSource).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages\(created_at DESC\)/
    );
  });
});
