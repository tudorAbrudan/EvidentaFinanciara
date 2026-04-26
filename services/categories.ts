import { db, generateId } from './db';
import type { CategoryKey, ExpenseCategory } from '@/types';

type Row = {
  id: string;
  key: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  parent_id: string | null;
  is_system: number;
  monthly_limit: number | null;
  display_order: number;
  archived: number;
  created_at: string;
};

function mapRow(r: Row): ExpenseCategory {
  return {
    id: r.id,
    key: (r.key as CategoryKey | null) ?? undefined,
    name: r.name,
    icon: r.icon ?? undefined,
    color: r.color ?? undefined,
    parent_id: r.parent_id ?? undefined,
    is_system: r.is_system === 1,
    monthly_limit: r.monthly_limit ?? undefined,
    display_order: r.display_order,
    archived: r.archived === 1,
    createdAt: r.created_at,
  };
}

export async function getCategories(includeArchived = false): Promise<ExpenseCategory[]> {
  const where = includeArchived ? '' : 'WHERE archived = 0';
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM expense_categories
     ${where}
     ORDER BY display_order ASC, name ASC`
  );
  return rows.map(mapRow);
}

export async function getCategory(id: string): Promise<ExpenseCategory | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM expense_categories WHERE id = ?', [id]);
  return row ? mapRow(row) : null;
}

export async function getCategoryByKey(key: CategoryKey): Promise<ExpenseCategory | null> {
  const row = await db.getFirstAsync<Row>(
    'SELECT * FROM expense_categories WHERE key = ? AND is_system = 1',
    [key]
  );
  return row ? mapRow(row) : null;
}

export interface CreateCategoryInput {
  name: string;
  icon?: string;
  color?: string;
  parent_id?: string;
  monthly_limit?: number;
  display_order?: number;
}

export async function createCategory(input: CreateCategoryInput): Promise<ExpenseCategory> {
  const id = generateId();
  const created_at = new Date().toISOString();

  // Plasare implicită la finalul listei (înainte de „Alte" care e display_order = 99)
  let order = input.display_order;
  if (order === undefined) {
    const max = await db.getFirstAsync<{ maxOrder: number | null }>(
      'SELECT MAX(display_order) AS maxOrder FROM expense_categories WHERE display_order < 99'
    );
    order = (max?.maxOrder ?? 0) + 1;
  }

  await db.runAsync(
    `INSERT INTO expense_categories
       (id, key, name, icon, color, parent_id, is_system, monthly_limit, display_order, archived, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, 0, ?, ?, 0, ?)`,
    [
      id,
      input.name.trim(),
      input.icon ?? null,
      input.color ?? null,
      input.parent_id ?? null,
      input.monthly_limit ?? null,
      order,
      created_at,
    ]
  );

  return {
    id,
    name: input.name.trim(),
    icon: input.icon,
    color: input.color,
    parent_id: input.parent_id,
    is_system: false,
    monthly_limit: input.monthly_limit,
    display_order: order,
    archived: false,
    createdAt: created_at,
  };
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string | null;
  color?: string | null;
  monthly_limit?: number | null;
  display_order?: number;
}

export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const push = (col: string, val: string | number | null | undefined) => {
    if (val === undefined) return;
    sets.push(`${col} = ?`);
    params.push(val);
  };
  push('name', input.name?.trim());
  push('icon', input.icon ?? null);
  push('color', input.color ?? null);
  push('monthly_limit', input.monthly_limit ?? null);
  push('display_order', input.display_order);

  if (sets.length === 0) return;

  params.push(id);
  await db.runAsync(`UPDATE expense_categories SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function archiveCategory(id: string, archived: boolean): Promise<void> {
  await db.runAsync('UPDATE expense_categories SET archived = ? WHERE id = ?', [
    archived ? 1 : 0,
    id,
  ]);
}

/**
 * Șterge o categorie. Categoriile sistem nu pot fi șterse, doar arhivate / setată limita.
 * Tranzacțiile asociate își păstrează `category_id` orfan (care va fi prins de detectorul de
 * orfani — vezi `docs/plans/orphan-documents.md`). Apelantul ar trebui să confirme explicit.
 */
export async function deleteCategory(id: string): Promise<void> {
  const cat = await db.getFirstAsync<{ is_system: number }>(
    'SELECT is_system FROM expense_categories WHERE id = ?',
    [id]
  );
  if (!cat) return;
  if (cat.is_system === 1) {
    throw new Error('Categoriile sistem nu pot fi șterse. Le poți ascunde din Setări.');
  }
  await db.runAsync('DELETE FROM expense_categories WHERE id = ?', [id]);
}

/**
 * Cheltuielile lunii curente (negative) per categorie, în RON. Cu limită activă.
 * Util pentru dashboard limite + secțiunea „Documente orfane" (categorii peste limită).
 */
export interface CategorySpending {
  category: ExpenseCategory;
  spent_ron: number; // suma absolută cheltuită (positivă) luna curentă
  remaining_ron?: number; // limită - cheltuit; undefined dacă nu e setată limita
  pct_used?: number; // 0..1 (sau peste 1 dacă a depășit)
}

export async function getMonthlySpending(yearMonth?: string): Promise<CategorySpending[]> {
  const ym = yearMonth ?? new Date().toISOString().slice(0, 7); // YYYY-MM
  const cats = await getCategories(false);

  const sums = await db.getAllAsync<{ category_id: string; total: number }>(
    `SELECT category_id, COALESCE(SUM(COALESCE(amount_ron, amount)), 0) AS total
     FROM transactions
     WHERE substr(date, 1, 7) = ?
       AND duplicate_of_id IS NULL
       AND is_internal_transfer = 0
       AND amount < 0
     GROUP BY category_id`,
    [ym]
  );

  const sumMap = new Map<string, number>();
  for (const r of sums) {
    if (r.category_id) sumMap.set(r.category_id, r.total);
  }

  return cats.map(cat => {
    const totalNegative = sumMap.get(cat.id) ?? 0;
    const spent = Math.abs(totalNegative);
    const result: CategorySpending = { category: cat, spent_ron: spent };
    if (cat.monthly_limit && cat.monthly_limit > 0) {
      result.remaining_ron = cat.monthly_limit - spent;
      result.pct_used = spent / cat.monthly_limit;
    }
    return result;
  });
}
