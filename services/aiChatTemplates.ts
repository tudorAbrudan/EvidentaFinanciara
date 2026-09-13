import type { ChatTemplate, EvidenceItem } from '@/types';

const RO_MONTHS_SHORT = [
  'ian',
  'feb',
  'mar',
  'apr',
  'mai',
  'iun',
  'iul',
  'aug',
  'sep',
  'oct',
  'noi',
  'dec',
];

function fmtRon(value: number): string {
  return (
    new Intl.NumberFormat('ro-RO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(value)) + ' RON'
  );
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso
    .slice(0, 10)
    .split('-')
    .map(n => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  return `${d} ${RO_MONTHS_SHORT[m - 1]} ${y}`;
}

export interface CtxLookups {
  accounts: Map<string, { id: string; name: string; type: string }>;
  categories: Map<string, { id: string; name: string }>;
}

export interface FormattedResponse {
  text: string;
  evidence: EvidenceItem[];
}

type Row = Record<string, unknown>;

function nameAccount(ctx: CtxLookups, id: string | null | undefined): string {
  if (!id) return '—';
  return ctx.accounts.get(id)?.name ?? id;
}
function nameCategory(ctx: CtxLookups, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return ctx.categories.get(id)?.name ?? undefined;
}

export function formatResponse(
  template: ChatTemplate,
  rows: Row[],
  params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  switch (template) {
    case 'search_merchant':
      return formatSearchMerchant(rows, params, ctx);
    case 'top_merchants':
      return formatTopMerchants(rows, params, ctx);
    case 'monthly_total':
      return formatMonthlyTotal(rows, params, ctx);
    case 'category_evolution':
      return formatCategoryEvolution(rows, params, ctx);
    case 'period_compare':
      return formatPeriodCompare(rows, params, ctx);
    case 'list_accounts':
      return formatListAccounts(rows);
    case 'list_categories':
      return formatListCategories(rows);
    case 'raw_list':
      return formatRawList(rows, params, ctx);
    case 'spend_total':
      return formatSpendTotal(rows, params, ctx);
    case 'top_spending':
      return formatTopSpending(rows, params, ctx);
    case 'account_balance':
      return formatAccountBalance(rows, params, ctx);
    case 'cannot_answer':
      return {
        text:
          typeof params.explanation_short === 'string' && params.explanation_short.length > 0
            ? `Nu pot răspunde la asta: ${params.explanation_short}`
            : 'Nu pot răspunde la întrebarea ta cu datele actuale.',
        evidence: [],
      };
  }
}

function formatSearchMerchant(
  rows: Row[],
  params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  const merchant = String(params.merchant ?? '');
  const accountFilter = params.account_id ? nameAccount(ctx, String(params.account_id)) : undefined;
  if (rows.length === 0) {
    const where = accountFilter ? ` în ${accountFilter}` : '';
    return { text: `Nu am găsit tranzacții la **${merchant}**${where}.`, evidence: [] };
  }
  const total = rows.reduce((s, r) => s + Math.abs(Number(r.amount_ron) || 0), 0);
  const dates = rows.map(r => String(r.date)).sort();
  const where = accountFilter ? ` în **${accountFilter}**` : '';
  const evidence: EvidenceItem[] = rows.map(r => ({
    kind: 'transaction',
    id: String(r.id),
    date: fmtDate(String(r.date)),
    amount: Number(r.amount) || 0,
    merchant: String(r.merchant ?? ''),
    account: nameAccount(ctx, r.account_id as string | undefined),
    category: nameCategory(ctx, r.category_id as string | undefined),
  }));
  return {
    text: `Da, ai **${rows.length} tranzacții** la **${merchant}**${where}, total **${fmtRon(total)}**, între **${fmtDate(dates[0])}** și **${fmtDate(dates[dates.length - 1])}**.`,
    evidence,
  };
}

function formatTopMerchants(
  rows: Row[],
  _params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  if (rows.length === 0)
    return { text: 'Nu am găsit tranzacții pentru top merchants.', evidence: [] };
  const items = rows.slice(0, 5);
  const lines = items.map((r, i) => {
    const m = String(r.merchant ?? 'Necunoscut');
    const total = Math.abs(Number(r.total) || 0);
    const count = Number(r.count) || 0;
    return `${i + 1}. **${m}** — ${fmtRon(total)} (${count} tranz.)`;
  });
  const evidence: EvidenceItem[] = items.map(r => ({
    kind: 'aggregate',
    label: String(r.merchant ?? 'Necunoscut'),
    period: 'all',
    total: Math.abs(Number(r.total) || 0),
    count: Number(r.count) || 0,
  }));
  return { text: `Top ${items.length} merchants:\n${lines.join('\n')}`, evidence };
}

function formatMonthlyTotal(
  rows: Row[],
  params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  const month = String(params.month ?? '');
  if (rows.length === 0) {
    return { text: `În **${month}** nu există cheltuieli înregistrate.`, evidence: [] };
  }
  const total = rows.reduce((s, r) => s + Math.abs(Number(r.amount_ron) || 0), 0);
  const evidence: EvidenceItem[] = [
    { kind: 'aggregate', label: 'Total cheltuieli', period: month, total, count: rows.length },
  ];
  return {
    text: `În **${month}** ai cheltuit **${fmtRon(total)}** din **${rows.length} tranzacții**.`,
    evidence,
  };
}

function formatCategoryEvolution(
  rows: Row[],
  params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  // Preferăm numele din rows (SQL face JOIN cu expense_categories) — mai
  // robust decât params.category_id, care în few-shot e adesea null când
  // SQL-ul folosește subquery `(SELECT id FROM ... WHERE key=...)`.
  const nameFromRows = rows.find(r => typeof r.category_name === 'string' && r.category_name)
    ?.category_name as string | undefined;
  const cat =
    nameFromRows ??
    nameCategory(ctx, params.category_id as string | undefined) ??
    'categorie necunoscută';
  if (rows.length === 0) return { text: `Nu există date pe categoria **${cat}**.`, evidence: [] };
  const series = rows.map(r => ({ ym: String(r.ym), total: Math.abs(Number(r.total) || 0) }));
  const total = series.reduce((s, p) => s + p.total, 0);
  const evidence: EvidenceItem[] = series.map(p => ({
    kind: 'aggregate',
    label: cat,
    period: p.ym,
    total: p.total,
    count: 0,
  }));
  const minP = series.reduce((a, b) => (a.total < b.total ? a : b));
  const maxP = series.reduce((a, b) => (a.total > b.total ? a : b));
  return {
    text: `Pe categoria **${cat}**: total **${fmtRon(total)}** pe ${series.length} luni. Minim: ${fmtRon(minP.total)} (${minP.ym}), maxim: ${fmtRon(maxP.total)} (${maxP.ym}).`,
    evidence,
  };
}

function formatPeriodCompare(
  rows: Row[],
  params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  const label = String(params.label ?? 'subiect');
  if (rows.length === 0)
    return {
      text: `Nu am date pentru a compara perioadele cerute pe **${label}**.`,
      evidence: [],
    };
  const lines: string[] = [];
  const evidence: EvidenceItem[] = [];
  for (const r of rows) {
    const period = String(r.period ?? '');
    const total = Math.abs(Number(r.total) || 0);
    const count = Number(r.count) || 0;
    lines.push(`**${period}**: ${fmtRon(total)} (${count} tranz.)`);
    evidence.push({ kind: 'aggregate', label, period, total, count });
  }
  return { text: `**${label}** — ${lines.join(' vs ')}.`, evidence };
}

function formatListAccounts(rows: Row[]): FormattedResponse {
  if (rows.length === 0) return { text: 'Nu ai niciun cont configurat.', evidence: [] };
  const lines = rows.map((r, i) => {
    const bal = Number(r.initial_balance) || 0;
    return `${i + 1}. **${r.name}** (${r.type}, ${r.currency}, sold inițial ${fmtRon(bal)})`;
  });
  const evidence: EvidenceItem[] = rows.map(r => ({
    kind: 'account',
    id: String(r.id),
    name: String(r.name ?? ''),
    type: String(r.type ?? ''),
  }));
  return { text: `Ai **${rows.length} conturi**:\n${lines.join('\n')}`, evidence };
}

function formatListCategories(rows: Row[]): FormattedResponse {
  if (rows.length === 0) return { text: 'Nu ai categorii.', evidence: [] };
  const lines = rows.map((r, i) => `${i + 1}. **${r.name}**`);
  const evidence: EvidenceItem[] = rows.map(r => ({
    kind: 'category',
    id: String(r.id),
    name: String(r.name ?? ''),
    parent: r.parent_id ? String(r.parent_id) : undefined,
  }));
  return { text: `Categorii (${rows.length}):\n${lines.join('\n')}`, evidence };
}

function formatRawList(
  rows: Row[],
  _params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  if (rows.length === 0) return { text: 'Nu am găsit tranzacții.', evidence: [] };
  const total = rows.reduce(
    (s, r) => s + Math.abs(Number(r.amount_ron) || Number(r.amount) || 0),
    0
  );
  const evidence: EvidenceItem[] = rows.slice(0, 20).map(r => ({
    kind: 'transaction',
    id: String(r.id),
    date: fmtDate(String(r.date)),
    amount: Number(r.amount) || 0,
    merchant: String(r.merchant ?? ''),
    account: nameAccount(ctx, r.account_id as string | undefined),
    category: nameCategory(ctx, r.category_id as string | undefined),
  }));
  return {
    text: `Am găsit **${rows.length} tranzacții**, total **${fmtRon(total)}**. Vezi Sursa pentru detalii.`,
    evidence,
  };
}

/**
 * Sumă pe filtre arbitrare (categorie și/sau cont și/sau interval de date).
 * SQL-ul agregă deja: așteptăm un singur rând cu `total` și `count`.
 */
function formatSpendTotal(
  rows: Row[],
  params: Record<string, unknown>,
  ctx: CtxLookups
): FormattedResponse {
  const label = typeof params.label === 'string' && params.label ? params.label : undefined;
  const periodLabel =
    typeof params.period_label === 'string' && params.period_label
      ? params.period_label
      : undefined;
  const accountName =
    typeof params.account_name === 'string' && params.account_name
      ? params.account_name
      : params.account_id
        ? nameAccount(ctx, String(params.account_id))
        : undefined;

  // Fragmentele se compun identic pe ramura cu date și pe cea goală, ca mesajul
  // de "nimic găsit" să repete exact filtrele cerute — altfel userul nu știe
  // dacă n-a cheltuit nimic sau dacă filtrul a fost înțeles greșit.
  const onWhat = label ? ` pe **${label}**` : '';
  const where = accountName ? ` în **${accountName}**` : '';
  const when = periodLabel ? ` în **${periodLabel}**` : '';

  const first = rows[0] ?? {};
  const total = Math.abs(Number(first.total) || 0);
  const count = Number(first.count) || 0;

  if (rows.length === 0 || count === 0) {
    return { text: `Nu ai cheltuieli${onWhat}${where}${when}.`, evidence: [] };
  }

  const evidence: EvidenceItem[] = [
    {
      kind: 'aggregate',
      label: label ?? 'Total cheltuieli',
      period: periodLabel ?? 'all',
      total,
      count,
    },
  ];
  return {
    text: `Ai cheltuit **${fmtRon(total)}**${onWhat}${where}${when}, din **${count} tranzacții**.`,
    evidence,
  };
}

/**
 * „Pe ce am cheltuit cei mai mulți bani" — un singur query cu UNION ALL, unde
 * coloana `dim` separă gruparea pe categorii de cea pe comercianți.
 */
function formatTopSpending(
  rows: Row[],
  params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  const periodLabel =
    typeof params.period_label === 'string' && params.period_label
      ? params.period_label
      : undefined;
  const when = periodLabel ? ` în **${periodLabel}**` : '';

  if (rows.length === 0) {
    return { text: `Nu am găsit cheltuieli${when}.`, evidence: [] };
  }

  const pick = (dim: string) => rows.filter(r => String(r.dim ?? '') === dim).slice(0, 5);
  const byCategory = pick('category');
  const byMerchant = pick('merchant');

  const evidence: EvidenceItem[] = [];
  const section = (title: string, items: Row[]): string | undefined => {
    if (items.length === 0) return undefined;
    const lines = items.map((r, i) => {
      const lbl = String(r.label ?? 'Necunoscut');
      const total = Math.abs(Number(r.total) || 0);
      const count = Number(r.count) || 0;
      evidence.push({
        kind: 'aggregate',
        label: lbl,
        period: periodLabel ?? 'all',
        total,
        count,
      });
      return `${i + 1}. **${lbl}** — ${fmtRon(total)} (${count} tranz.)`;
    });
    return `${title}:\n${lines.join('\n')}`;
  };

  const parts = [section('Pe categorii', byCategory), section('De unde', byMerchant)].filter(
    (p): p is string => p !== undefined
  );

  // Fallback: SQL fără coloana `dim` (model care a ignorat UNION-ul) — tratăm
  // rândurile ca o listă unică, în loc să răspundem "nu am găsit nimic".
  if (parts.length === 0) {
    const flat = section('Top cheltuieli', rows.slice(0, 5));
    if (!flat) return { text: `Nu am găsit cheltuieli${when}.`, evidence: [] };
    return { text: `Cheltuieli${when}:\n${flat}`, evidence };
  }

  return { text: `Cheltuieli${when}:\n\n${parts.join('\n\n')}`, evidence };
}

/**
 * Sold curent pe cont. Spre deosebire de restul template-urilor, aici
 * transferurile interne **se includ**: un transfer chiar scoate banii din
 * contul sursă, deci excluderea lor ar raporta un sold umflat.
 */
function formatAccountBalance(
  rows: Row[],
  _params: Record<string, unknown>,
  _ctx: CtxLookups
): FormattedResponse {
  if (rows.length === 0)
    return { text: 'Nu am găsit conturi pentru care să calculez soldul.', evidence: [] };

  const fmt = (v: number, cur: string) =>
    new Intl.NumberFormat('ro-RO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v) + ` ${cur}`;

  const evidence: EvidenceItem[] = [];
  const lines = rows.map(r => {
    const name = String(r.name ?? r.account_name ?? 'Cont');
    const cur = String(r.currency ?? 'RON');
    const bal = Number(r.balance) || 0;
    evidence.push({ kind: 'aggregate', label: name, period: 'now', total: bal, count: 0 });
    return `**${name}**: ${fmt(bal, cur)}`;
  });

  if (rows.length === 1) return { text: `Sold curent — ${lines[0]}.`, evidence };
  return { text: `Solduri curente:\n${lines.join('\n')}`, evidence };
}
