const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'drop',
  'create',
  'alter',
  'replace',
  'vacuum',
  'reindex',
  'pragma',
  'attach',
  'detach',
  'load_extension',
];

const ALLOWED_TABLES = new Set(['transactions', 'expense_categories', 'financial_accounts']);

const FORBIDDEN_TABLES = ['bank_statements', 'settings', 'fx_rates', 'chat_messages'];

const MAX_LIMIT = 500;

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

function stripStringLiterals(sql: string): string {
  return sql.replace(/'[^']*'/g, "''");
}

export function validateAndNormalizeSql(rawInput: string): GuardResult {
  const trimmed = rawInput.trim();
  if (!trimmed) return { ok: false, reason: 'SQL gol' };

  const lowered = trimmed.toLowerCase();
  if (!/^(select|with)\b/.test(lowered)) {
    return { ok: false, reason: 'Trebuie să înceapă cu SELECT sau WITH' };
  }

  if (trimmed.replace(/;\s*$/, '').includes(';')) {
    return { ok: false, reason: 'Multi-statement nu e permis' };
  }

  if (/--/.test(trimmed) || /\/\*/.test(trimmed)) {
    return { ok: false, reason: 'Comentariile SQL nu sunt permise' };
  }

  const stripped = stripStringLiterals(lowered);
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(stripped)) {
      return { ok: false, reason: `Keyword interzis: ${kw}` };
    }
  }

  if (/\binto\b/.test(stripped)) {
    return { ok: false, reason: 'SELECT INTO nu e permis' };
  }

  const cteNames = new Set<string>();
  const cteMatches = stripped.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\s*\(/g);
  for (const m of cteMatches) cteNames.add(m[1]);

  const tableMatches = stripped.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/g);
  for (const m of tableMatches) {
    const tbl = m[1];
    if (cteNames.has(tbl)) continue;
    if (FORBIDDEN_TABLES.includes(tbl)) {
      return { ok: false, reason: `Tabel interzis: ${tbl}` };
    }
    if (!ALLOWED_TABLES.has(tbl)) {
      return { ok: false, reason: `Tabel necunoscut sau neacceptat: ${tbl}` };
    }
  }

  const stmtNoSemi = trimmed.replace(/;\s*$/, '');
  const limitMatch = stmtNoSemi.match(/\blimit\s+(\d+)\s*$/i);
  let normalized: string;
  if (!limitMatch) {
    normalized = `${stmtNoSemi} LIMIT ${MAX_LIMIT}`;
  } else {
    const n = parseInt(limitMatch[1], 10);
    if (n > MAX_LIMIT) {
      normalized = stmtNoSemi.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${MAX_LIMIT}`);
    } else {
      normalized = stmtNoSemi;
    }
  }

  return { ok: true, sql: normalized };
}
