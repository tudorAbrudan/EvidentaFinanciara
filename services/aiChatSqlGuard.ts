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

/**
 * Scoate citarea identificatorilor: "x", [x] și `x` devin x.
 *
 * Literalii cu apostrof sunt deja eliminați când ajungem aici, deci ce rămâne
 * între ghilimele duble e identificator, nu șir. Fără pasul ăsta, regex-ul de
 * extragere a tabelelor nu potrivea `FROM "chat_messages"` — și cum bucla de
 * validare verifică doar ce reușește să extragă, tabelul trecea nevalidat.
 */
function unquoteIdentifiers(sql: string): string {
  return sql
    .replace(/"([a-z_][a-z0-9_]*)"/g, '$1')
    .replace(/\[([a-z_][a-z0-9_]*)\]/g, '$1')
    .replace(/`([a-z_][a-z0-9_]*)`/g, '$1');
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

  const stripped = unquoteIdentifiers(stripStringLiterals(lowered));
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

  // Fail-closed: fiecare FROM/JOIN trebuie să fie urmat ori de `(` (subquery, al
  // cărui FROM interior e verificat de aceeași buclă), ori de o listă de
  // identificatori separați prin virgulă — fiecare tabel permis sau nume de CTE.
  // Orice altceva, inclusiv „n-am putut parsa", înseamnă respingere.
  const clauseRe = /\b(?:from|join)\b/g;
  let clause: RegExpExecArray | null;
  while ((clause = clauseRe.exec(stripped)) !== null) {
    const rest = stripped.slice(clause.index + clause[0].length);
    const after = rest.replace(/^\s+/, '');
    if (after.startsWith('(')) continue; // subquery

    // Lista de tabele: `a`, `a t`, `a, b`, `a AS x, b AS y`.
    const listMatch = after.match(/^[a-z0-9_,\s]+/);
    if (!listMatch) {
      return { ok: false, reason: 'Nu pot valida tabelele din interogare' };
    }
    // Oprim lista la primul cuvânt-cheie care încheie clauza FROM.
    const STOP = new Set([
      'where',
      'group',
      'order',
      'limit',
      'having',
      'union',
      'on',
      'using',
      'left',
      'right',
      'inner',
      'outer',
      'cross',
      'join',
      'as',
      'window',
      'returning',
    ]);
    const parts = listMatch[0].split(',');
    let sawTable = false;
    for (const part of parts) {
      const words = part.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      const tbl = words[0];
      if (STOP.has(tbl)) break;
      sawTable = true;
      if (cteNames.has(tbl)) continue;
      if (FORBIDDEN_TABLES.includes(tbl)) {
        return { ok: false, reason: `Tabel interzis: ${tbl}` };
      }
      if (!ALLOWED_TABLES.has(tbl)) {
        return { ok: false, reason: `Tabel necunoscut sau neacceptat: ${tbl}` };
      }
    }
    if (!sawTable) {
      return { ok: false, reason: 'Nu pot valida tabelele din interogare' };
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
