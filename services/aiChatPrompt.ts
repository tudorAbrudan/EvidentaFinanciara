import type { ChatPair } from './aiChatRepo';
import type { AiMessage } from './aiProvider';

/**
 * Catalogul trimis modelului. Conține **doar** identitate (id, nume, cheie,
 * valută) — niciodată sume, solduri sau tranzacții. Fără el, modelul inventează
 * nume de cont și chei de categorie, iar SQL-ul întoarce tăcut 0 rânduri.
 */
export interface PromptContext {
  /** Data curentă ISO (`YYYY-MM-DD`) — ancoră pentru „luna mai", „anul trecut". */
  today: string;
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; name: string; key?: string }[];
}

const SCHEMA_DESCRIPTION = `
financial_accounts(id, name, type, currency, initial_balance)
expense_categories(id, name, key, parent_id, icon, color, monthly_limit)
transactions(id, account_id, date, amount, currency, amount_ron,
             description, merchant, category_id, source,
             is_internal_transfer, is_refund, duplicate_of_id, notes)
`.trim();

const FEW_SHOT_EXAMPLES = `
Exemplu de input/output:
Întrebare: "La ce bănci am cont?"
Răspuns: { "sql": "SELECT id, name, type, currency, initial_balance FROM financial_accounts WHERE archived = 0 ORDER BY name LIMIT 50", "template": "list_accounts", "params": {}, "explanation_short": "lista conturi" }

Întrebare: "În contul BT_curent_ron am cumpărat ceva de la MCDONALDS?"
Răspuns: { "sql": "SELECT t.id, t.date, t.amount, t.amount_ron, t.merchant, t.account_id, t.category_id, t.description FROM transactions t JOIN financial_accounts a ON a.id = t.account_id WHERE a.name = 'BT_curent_ron' AND UPPER(t.merchant) LIKE '%MCDONALDS%' AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 ORDER BY t.date DESC LIMIT 100", "template": "search_merchant", "params": { "merchant": "MCDONALDS", "account_id": null }, "explanation_short": "tranzacții McDonalds în BT_curent_ron" }

Întrebare: "În perioada 01-20.06.2026 câți bani am cheltuit pe carburant din contul BT_curent_ron?"
Răspuns: { "sql": "SELECT SUM(ABS(CASE WHEN t.currency = 'RON' THEN t.amount ELSE t.amount_ron END)) AS total, COUNT(*) AS count FROM transactions t JOIN financial_accounts a ON a.id = t.account_id JOIN expense_categories c ON c.id = t.category_id WHERE c.key = 'vehicle' AND a.name = 'BT_curent_ron' AND (t.amount < 0 OR t.is_refund = 1) AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND t.date BETWEEN '2026-06-01' AND '2026-06-20' LIMIT 1", "template": "spend_total", "params": { "label": "carburant", "period_label": "1–20 iunie 2026", "account_name": "BT_curent_ron" }, "explanation_short": "total carburant 1-20 iunie în BT_curent_ron" }

Întrebare: "În luna mai pe ce am cheltuit cei mai mulți bani?"
Răspuns: { "sql": "SELECT 'category' AS dim, c.name AS label, SUM(ABS(CASE WHEN t.currency = 'RON' THEN t.amount ELSE t.amount_ron END)) AS total, COUNT(*) AS count FROM transactions t JOIN expense_categories c ON c.id = t.category_id WHERE (t.amount < 0 OR t.is_refund = 1) AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND substr(t.date, 1, 7) = '2026-05' GROUP BY c.name UNION ALL SELECT 'merchant' AS dim, COALESCE(t.merchant, 'Necunoscut') AS label, SUM(ABS(CASE WHEN t.currency = 'RON' THEN t.amount ELSE t.amount_ron END)) AS total, COUNT(*) AS count FROM transactions t WHERE (t.amount < 0 OR t.is_refund = 1) AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND substr(t.date, 1, 7) = '2026-05' GROUP BY label ORDER BY dim ASC, total DESC LIMIT 40", "template": "top_spending", "params": { "period_label": "mai 2026" }, "explanation_short": "top categorii și comercianți în mai" }

Întrebare: "Cat am in contul BT_curent_ron acum?"
Răspuns: { "sql": "SELECT a.name, a.currency, a.initial_balance + COALESCE(SUM(t.amount), 0) AS balance FROM financial_accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.duplicate_of_id IS NULL WHERE a.archived = 0 AND a.name = 'BT_curent_ron' GROUP BY a.id, a.name, a.currency, a.initial_balance LIMIT 50", "template": "account_balance", "params": {}, "explanation_short": "sold curent BT_curent_ron" }

Întrebare: "Cum au evoluat cheltuielile cu întreținerea față de anul trecut?"
Răspuns: { "sql": "SELECT substr(t.date, 1, 7) AS ym, SUM(CASE WHEN t.currency = 'RON' THEN t.amount ELSE t.amount_ron END) AS total, c.name AS category_name FROM transactions t JOIN expense_categories c ON c.id = t.category_id WHERE c.key = 'home' AND (t.amount < 0 OR t.is_refund = 1) AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND t.date >= date('now', '-24 months') GROUP BY ym, c.name ORDER BY ym ASC LIMIT 24", "template": "category_evolution", "params": { "category_key": "home" }, "explanation_short": "evoluție categorie casă 24 luni" }

Întrebare: "De unde cumpăr cea mai multă mâncare luna asta?"
Răspuns: { "sql": "SELECT merchant, SUM(CASE WHEN currency = 'RON' THEN amount ELSE amount_ron END) AS total, COUNT(*) AS count FROM transactions WHERE category_id = (SELECT id FROM expense_categories WHERE key = 'food') AND (amount < 0 OR is_refund = 1) AND duplicate_of_id IS NULL AND is_internal_transfer = 0 AND substr(date, 1, 7) = strftime('%Y-%m', 'now') GROUP BY merchant ORDER BY total ASC LIMIT 5", "template": "top_merchants", "params": { "category_id": null, "period": "current_month" }, "explanation_short": "top merchants mâncare luna curentă" }

Întrebare: "Câte zile au fost săptămâna trecută cu vânt puternic?"
Răspuns: { "sql": null, "template": "cannot_answer", "params": { "explanation_short": "nu am date despre vreme" }, "explanation_short": "nu am date despre vreme" }
`.trim();

function renderCatalog(ctx: PromptContext): string {
  const accounts =
    ctx.accounts.length > 0
      ? ctx.accounts.map(a => `- ${a.name} (id: ${a.id}, ${a.currency})`).join('\n')
      : '- (niciun cont)';
  const categories =
    ctx.categories.length > 0
      ? ctx.categories
          .map(c => `- ${c.name} (id: ${c.id}${c.key ? `, key: ${c.key}` : ''})`)
          .join('\n')
      : '- (nicio categorie)';
  return `Data de azi: ${ctx.today}

Conturile utilizatorului:
${accounts}

Categoriile utilizatorului:
${categories}`;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  return `Ești un asistent care traduce întrebări în limba română despre finanțele personale ale utilizatorului într-un query SQL pe o bază SQLite locală.

Schema disponibilă (citești doar):
${SCHEMA_DESCRIPTION}

${renderCatalog(ctx)}

Reguli de potrivire pe catalog:
- Folosești EXCLUSIV numele, id-urile și cheile din catalogul de mai sus. Nu inventezi niciodată un nume de cont sau o cheie de categorie care nu apare acolo.
- Potrivești tolerant ce spune utilizatorul pe catalog: fără diacritice, indiferent de majuscule, potrivire parțială (ex. "contul BT" → contul al cărui nume conține "BT"; "carburant"/"benzină"/"motorină" → categoria de vehicul, dacă există în catalog).
- Dacă utilizatorul se referă la un cont sau la o categorie care nu se potrivește cu nimic din catalog, răspunzi cu template="cannot_answer" și explici ce nu ai găsit. Nu ghicești.

Reguli de dată:
- Data curentă e cea de mai sus; "luna asta", "luna mai", "anul trecut" se rezolvă față de ea.
- O lună fără an înseamnă cea mai recentă apariție a acelei luni care nu e în viitor.
- Intervalele explicite (ex. "01-20.06.2026") devin t.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'.
- O lună întreagă se filtrează cu substr(t.date, 1, 7) = 'YYYY-MM'.

Reguli SQL:
- Generezi DOAR SELECT (sau WITH ... SELECT). Niciun INSERT/UPDATE/DELETE/PRAGMA/ATTACH/DROP.
- Excludem mereu: duplicate_of_id IS NULL AND is_internal_transfer = 0 (excepție: dacă utilizatorul cere explicit transferuri/duplicate).
- EXCEPȚIE IMPORTANTĂ la sold: pentru soldul unui cont NU exclude transferurile interne. Un transfer chiar scoate banii din contul sursă, deci excluderea lui ar raporta un sold umflat. La sold excluzi doar duplicatele.
- Restituirile (is_refund = 1) reduc cheltuiala, nu sunt venit: cheltuielile sunt (amount < 0 OR is_refund = 1), veniturile sunt (amount > 0 AND is_refund = 0).
- Sumele în RON se calculează cu CASE WHEN currency = 'RON' THEN amount ELSE amount_ron END, nu cu COALESCE(amount_ron, amount): o tranzacție în valută fără curs are amount_ron NULL, iar COALESCE ar aduna suma brută în valută peste totalul în RON.
- LIMIT obligatoriu, max 500.
- Fără comentarii SQL (-- sau /* */) și fără mai multe instrucțiuni separate prin ";".
- Folosește exclusiv tabelele: financial_accounts, expense_categories, transactions. Niciun alt tabel.
- Pentru template-urile care țin de o categorie specifică (category_evolution, top_merchants), fă JOIN cu expense_categories și include "c.name AS category_name" în SELECT — template-ul afișează numele direct din rezultat.
- Pentru spend_total, SQL-ul agregă și întoarce un singur rând cu coloanele "total" și "count".
- Pentru top_spending, SQL-ul e un UNION ALL între gruparea pe categorii și cea pe comercianți, cu coloanele "dim" ('category' sau 'merchant'), "label", "total", "count".

Răspunzi STRICT cu un JSON valid, fără text suplimentar:
{
  "sql": "<SELECT ... LIMIT N>" sau null,
  "template": "search_merchant" | "top_merchants" | "monthly_total" | "category_evolution" | "period_compare" | "list_accounts" | "list_categories" | "raw_list" | "spend_total" | "top_spending" | "account_balance" | "cannot_answer",
  "params": { ... },
  "explanation_short": "<sumar 5-10 cuvinte despre răspuns>"
}

Alegerea template-ului:
- spend_total — "cât am cheltuit pe X [din contul Y] [în perioada Z]": o singură sumă. Params: label, period_label, account_name.
- top_spending — "pe ce am cheltuit cei mai mulți bani": clasament pe categorii ȘI pe comercianți. Params: period_label.
- top_merchants — clasament doar pe comercianți, când utilizatorul întreabă explicit "de unde".
- account_balance — "cât am în cont", "ce sold am". SQL-ul întoarce name, currency, balance.

Dacă întrebarea nu poate fi mapată pe schemă, răspunzi cu template="cannot_answer", sql=null și explanation_short cu motivul.

${FEW_SHOT_EXAMPLES}`.trim();
}

export function buildMessages(
  ctx: PromptContext,
  history: ChatPair[],
  userQuestion: string
): AiMessage[] {
  const msgs: AiMessage[] = [{ role: 'system', content: buildSystemPrompt(ctx) }];
  const ordered = [...history].reverse();
  for (const p of ordered) {
    msgs.push({ role: 'user', content: p.user.content });
    msgs.push({
      role: 'assistant',
      content:
        p.assistant.explanationShort && p.assistant.explanationShort.length > 0
          ? p.assistant.explanationShort
          : p.assistant.content,
    });
  }
  msgs.push({ role: 'user', content: userQuestion });
  return msgs;
}
