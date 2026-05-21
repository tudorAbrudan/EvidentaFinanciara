import { db } from './db';

export interface MerchantRule {
  merchant_normalized: string;
  merchant_display: string;
  category_id: string;
  occurrences: number;
  created_at: string;
  updated_at: string;
}

/**
 * Tokeni „de zgomot" pe care îi eliminăm înainte de a stoca/match-ui regula:
 *   - cifre singure sau secvențe de cifre (cod magazin, ID tranzacție)
 *   - `#xxx` (cod sucursală), `*nnn` (mascat card)
 *   - prefixe pos / atm / bcr-bucuresti reziduale
 *   - tokeni de 1-2 caractere non-alfa
 *
 * Asta permite ca „LIDL #182 BUC" și „LIDL Bucuresti" să cadă pe aceeași
 * cheie „lidl bucuresti" (după strip noise + trunc trailing single-letter).
 */
const NOISE_TOKEN_RE = /^([#*][\dxX]+|[*#]+|\d+|[-_/\\.]+|x{3,})$/;

export function normalizeMerchant(raw: string): string {
  const lowered = raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // separatori → spațiu (înlocuim virgule, slash-uri, puncte, asteriscuri, # alipiți)
    .replace(/[,./\\|]+/g, ' ')
    .replace(/[#*]+(?=\S)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!lowered) return '';
  const tokens = lowered.split(' ').filter(t => !NOISE_TOKEN_RE.test(t));
  return tokens.join(' ');
}

export async function upsertRule(merchantDisplay: string, categoryId: string): Promise<void> {
  const normalized = normalizeMerchant(merchantDisplay);
  if (normalized.length === 0) return;
  const now = new Date().toISOString();

  const existing = await db.getFirstAsync<{ category_id: string; occurrences: number }>(
    'SELECT category_id, occurrences FROM merchant_category_rules WHERE merchant_normalized = ?',
    [normalized]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE merchant_category_rules
       SET category_id = ?,
           merchant_display = ?,
           occurrences = occurrences + 1,
           updated_at = ?
       WHERE merchant_normalized = ?`,
      [categoryId, merchantDisplay, now, normalized]
    );
  } else {
    await db.runAsync(
      `INSERT INTO merchant_category_rules
        (merchant_normalized, merchant_display, category_id, occurrences, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [normalized, merchantDisplay, categoryId, now, now]
    );
  }
}

/**
 * Match strategie:
 *   1. Exact pe `merchant_normalized`.
 *   2. Prefix-pe-cuvânt: regula e prefix urmat de spațiu al merchant-ului
 *      tranzacției (ex. regulă „lidl" match „lidl bucuresti"). Dacă mai
 *      multe reguli match prin prefix, câștigă cea mai lungă (mai specifică).
 */
export function findMatchingRule(
  txMerchantNormalized: string,
  rules: MerchantRule[]
): MerchantRule | null {
  if (txMerchantNormalized.length === 0) return null;
  const exact = rules.find(r => r.merchant_normalized === txMerchantNormalized);
  if (exact) return exact;
  const prefixed = rules
    .filter(r => txMerchantNormalized.startsWith(r.merchant_normalized + ' '))
    .sort((a, b) => b.merchant_normalized.length - a.merchant_normalized.length);
  return prefixed[0] ?? null;
}

export async function getRuleForMerchant(merchantRaw: string): Promise<MerchantRule | null> {
  const normalized = normalizeMerchant(merchantRaw);
  if (normalized.length === 0) return null;

  // Exact match e ieftin (PK lookup); încercăm întâi.
  const exact = await db.getFirstAsync<MerchantRule>(
    `SELECT merchant_normalized, merchant_display, category_id, occurrences, created_at, updated_at
     FROM merchant_category_rules
     WHERE merchant_normalized = ?`,
    [normalized]
  );
  if (exact) return exact;

  // Fallback: prefix-pe-cuvânt. Fetch toate regulile (în mod normal sub 1000)
  // și aplicăm match-ul în memorie.
  const rules = await listRules();
  return findMatchingRule(normalized, rules);
}

export async function listRules(): Promise<MerchantRule[]> {
  const rows =
    (await db.getAllAsync<MerchantRule>(
      `SELECT merchant_normalized, merchant_display, category_id, occurrences, created_at, updated_at
       FROM merchant_category_rules
       ORDER BY occurrences DESC, merchant_display ASC`
    )) ?? [];
  return rows;
}

export async function deleteRule(merchantNormalized: string): Promise<void> {
  await db.runAsync('DELETE FROM merchant_category_rules WHERE merchant_normalized = ?', [
    merchantNormalized,
  ]);
}

/**
 * Aplică regulile învățate pe tranzacțiile fără categorie. Folosit după import
 * și după restore din backup ca să categorizeze retroactiv. Returnează numărul
 * de rânduri actualizate.
 */
export async function applyRulesToUncategorized(): Promise<{ updated: number }> {
  const rules = await listRules();
  if (rules.length === 0) return { updated: 0 };

  const candidates =
    (await db.getAllAsync<{ id: string; merchant: string | null }>(
      `SELECT id, merchant FROM transactions
       WHERE category_id IS NULL AND merchant IS NOT NULL AND TRIM(merchant) <> ''`
    )) ?? [];

  let updated = 0;
  for (const tx of candidates) {
    if (!tx.merchant) continue;
    const key = normalizeMerchant(tx.merchant);
    const rule = findMatchingRule(key, rules);
    if (!rule) continue;
    await db.runAsync(
      'UPDATE transactions SET category_id = ?, category_learned = 1 WHERE id = ?',
      [rule.category_id, tx.id]
    );
    updated++;
  }
  return { updated };
}

/**
 * Variantă batch a `getRuleForMerchant` — încarcă toate regulile o dată,
 * util pentru loop-uri (ex. import-ul unui extras).
 */
export async function loadRulesIndex(): Promise<Map<string, string>> {
  const rules = await listRules();
  const idx = new Map<string, string>();
  for (const r of rules) idx.set(r.merchant_normalized, r.category_id);
  return idx;
}
