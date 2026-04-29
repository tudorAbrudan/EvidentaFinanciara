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
  const cat =
    nameCategory(ctx, params.category_id as string | undefined) ?? 'categorie necunoscută';
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
