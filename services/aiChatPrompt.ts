import type { ChatPair } from './aiChatRepo';
import type { AiMessage } from './aiProvider';

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

Întrebare: "Cum au evoluat cheltuielile cu întreținerea față de anul trecut?"
Răspuns: { "sql": "SELECT substr(t.date, 1, 7) AS ym, SUM(COALESCE(t.amount_ron, t.amount)) AS total, c.name AS category_name FROM transactions t JOIN expense_categories c ON c.id = t.category_id WHERE c.key = 'home' AND t.amount < 0 AND t.duplicate_of_id IS NULL AND t.is_internal_transfer = 0 AND t.date >= date('now', '-24 months') GROUP BY ym, c.name ORDER BY ym ASC LIMIT 24", "template": "category_evolution", "params": { "category_key": "home" }, "explanation_short": "evoluție categorie casă 24 luni" }

Întrebare: "De unde cumpăr cea mai multă mâncare luna asta?"
Răspuns: { "sql": "SELECT merchant, SUM(COALESCE(amount_ron, amount)) AS total, COUNT(*) AS count FROM transactions WHERE category_id = (SELECT id FROM expense_categories WHERE key = 'food') AND amount < 0 AND duplicate_of_id IS NULL AND is_internal_transfer = 0 AND substr(date, 1, 7) = strftime('%Y-%m', 'now') GROUP BY merchant ORDER BY total ASC LIMIT 5", "template": "top_merchants", "params": { "category_id": null, "period": "current_month" }, "explanation_short": "top merchants mâncare luna curentă" }

Întrebare: "Câte zile au fost săptămâna trecută cu vânt puternic?"
Răspuns: { "sql": null, "template": "cannot_answer", "params": { "explanation_short": "nu am date despre vreme" }, "explanation_short": "nu am date despre vreme" }
`.trim();

export function buildSystemPrompt(): string {
  return `Ești un asistent care traduce întrebări în limba română despre finanțele personale ale utilizatorului într-un query SQL pe o bază SQLite locală.

Schema disponibilă (citești doar):
${SCHEMA_DESCRIPTION}

Reguli SQL:
- Generezi DOAR SELECT (sau WITH ... SELECT). Niciun INSERT/UPDATE/DELETE/PRAGMA/ATTACH/DROP.
- Excludem mereu: duplicate_of_id IS NULL AND is_internal_transfer = 0 (excepție: dacă utilizatorul cere explicit transferuri/duplicate).
- Cheltuielile sunt amount < 0; veniturile amount > 0.
- Pentru sume folosește COALESCE(amount_ron, amount).
- LIMIT obligatoriu, max 500.
- Folosește exclusiv tabelele: financial_accounts, expense_categories, transactions. Niciun alt tabel.
- Pentru template-urile care țin de o categorie specifică (category_evolution, top_merchants), fă JOIN cu expense_categories și include "c.name AS category_name" în SELECT — template-ul afișează numele direct din rezultat.

Răspunzi STRICT cu un JSON valid, fără text suplimentar:
{
  "sql": "<SELECT ... LIMIT N>" sau null,
  "template": "search_merchant" | "top_merchants" | "monthly_total" | "category_evolution" | "period_compare" | "list_accounts" | "list_categories" | "raw_list" | "cannot_answer",
  "params": { ... },
  "explanation_short": "<sumar 5-10 cuvinte despre răspuns>"
}

Dacă întrebarea nu poate fi mapată pe schemă, răspunzi cu template="cannot_answer", sql=null și explanation_short cu motivul.

${FEW_SHOT_EXAMPLES}`.trim();
}

export function buildMessages(history: ChatPair[], userQuestion: string): AiMessage[] {
  const msgs: AiMessage[] = [{ role: 'system', content: buildSystemPrompt() }];
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
