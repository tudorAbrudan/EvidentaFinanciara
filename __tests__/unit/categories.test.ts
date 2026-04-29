import { getMonthlySpending, deleteCategory } from '@/services/categories';
import * as db from '@/services/db';

jest.mock('@/services/db', () => ({
  __esModule: true,
  db: {
    runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
  },
  generateId: () => 'cat-test-id',
}));

describe('getMonthlySpending', () => {
  it('returns categories with spent_ron and pct_used when limit is set', async () => {
    const cats = [
      {
        id: 'c1',
        key: 'food',
        name: 'Mâncare',
        icon: '🍔',
        color: null,
        parent_id: null,
        is_system: 1,
        monthly_limit: 1000,
        display_order: 1,
        archived: 0,
        created_at: '2026-04-01T00:00:00.000Z',
      },
      {
        id: 'c2',
        key: 'transport',
        name: 'Transport',
        icon: '🚗',
        color: null,
        parent_id: null,
        is_system: 1,
        monthly_limit: null,
        display_order: 2,
        archived: 0,
        created_at: '2026-04-01T00:00:00.000Z',
      },
    ];

    (db.db.getAllAsync as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('FROM expense_categories')) return Promise.resolve(cats);
      // Sums query
      return Promise.resolve([
        { category_id: 'c1', total: -800 },
        { category_id: 'c2', total: -150 },
      ]);
    });

    const result = await getMonthlySpending('2026-04');
    expect(result).toHaveLength(2);
    const food = result.find(r => r.category.id === 'c1')!;
    expect(food.spent_ron).toBe(800);
    expect(food.remaining_ron).toBe(200);
    expect(food.pct_used).toBeCloseTo(0.8, 2);

    const transport = result.find(r => r.category.id === 'c2')!;
    expect(transport.spent_ron).toBe(150);
    expect(transport.remaining_ron).toBeUndefined();
    expect(transport.pct_used).toBeUndefined();
  });

  it('returns 0 spent for categories without transactions', async () => {
    const cats = [
      {
        id: 'c1',
        key: 'food',
        name: 'Mâncare',
        icon: null,
        color: null,
        parent_id: null,
        is_system: 1,
        monthly_limit: null,
        display_order: 1,
        archived: 0,
        created_at: '2026-04-01T00:00:00.000Z',
      },
    ];
    (db.db.getAllAsync as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('FROM expense_categories')) return Promise.resolve(cats);
      return Promise.resolve([]);
    });
    const result = await getMonthlySpending('2026-04');
    expect(result).toHaveLength(1);
    expect(result[0].spent_ron).toBe(0);
  });

  it('marks pct_used > 1 when over limit', async () => {
    const cats = [
      {
        id: 'c1',
        key: 'food',
        name: 'Mâncare',
        icon: null,
        color: null,
        parent_id: null,
        is_system: 1,
        monthly_limit: 500,
        display_order: 1,
        archived: 0,
        created_at: '2026-04-01T00:00:00.000Z',
      },
    ];
    (db.db.getAllAsync as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('FROM expense_categories')) return Promise.resolve(cats);
      return Promise.resolve([{ category_id: 'c1', total: -750 }]);
    });
    const result = await getMonthlySpending('2026-04');
    expect(result[0].spent_ron).toBe(750);
    expect(result[0].remaining_ron).toBe(-250);
    expect(result[0].pct_used).toBeCloseTo(1.5, 2);
  });
});

describe('deleteCategory', () => {
  it('throws if category is system', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({ is_system: 1 });
    await expect(deleteCategory('c1')).rejects.toThrow(/Categoriile sistem nu pot fi șterse/);
  });

  it('deletes if category is user-defined', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue({ is_system: 0 });
    (db.db.runAsync as jest.Mock).mockResolvedValue({ changes: 1, lastInsertRowId: 1 });
    await expect(deleteCategory('c1')).resolves.toBeUndefined();
  });

  it('does nothing if category does not exist', async () => {
    (db.db.getFirstAsync as jest.Mock).mockResolvedValue(null);
    await expect(deleteCategory('c1')).resolves.toBeUndefined();
  });
});
