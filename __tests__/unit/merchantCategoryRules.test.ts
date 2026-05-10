import * as db from '@/services/db';
import {
  applyRulesToUncategorized,
  deleteRule,
  findMatchingRule,
  getRuleForMerchant,
  listRules,
  loadRulesIndex,
  normalizeMerchant,
  upsertRule,
  type MerchantRule,
} from '@/services/merchantCategoryRules';

jest.mock('@/services/db', () => ({
  __esModule: true,
  db: {
    runAsync: jest.fn(),
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
  },
}));

const runAsync = db.db.runAsync as jest.Mock;
const getAllAsync = db.db.getAllAsync as jest.Mock;
const getFirstAsync = db.db.getFirstAsync as jest.Mock;

beforeEach(() => {
  runAsync.mockReset();
  getAllAsync.mockReset();
  getFirstAsync.mockReset();
});

describe('normalizeMerchant', () => {
  it.each([
    ['Lidl', 'lidl'],
    ['LIDL', 'lidl'],
    ['  lidl  ', 'lidl'],
    ['Petrom', 'petrom'],
    ['Mâncare la birou', 'mancare la birou'],
    ['CARREFOUR  ROMANIA', 'carrefour romania'],
    ['Café Central', 'cafe central'],
    ['ăîâșț', 'aiast'],
  ])('normalizează %p → %p', (input, expected) => {
    expect(normalizeMerchant(input)).toBe(expected);
  });
});

describe('upsertRule', () => {
  it('insert când regula nu există', async () => {
    getFirstAsync.mockResolvedValueOnce(null);
    await upsertRule('Lidl', 'cat-sys-food');
    expect(runAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = runAsync.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO merchant_category_rules/);
    expect(params[0]).toBe('lidl');
    expect(params[1]).toBe('Lidl');
    expect(params[2]).toBe('cat-sys-food');
  });

  it('update + increment occurrences când regula există', async () => {
    getFirstAsync.mockResolvedValueOnce({ category_id: 'cat-old', occurrences: 3 });
    await upsertRule('Lidl', 'cat-sys-food');
    expect(runAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = runAsync.mock.calls[0];
    expect(sql).toMatch(/UPDATE merchant_category_rules/);
    expect(sql).toMatch(/occurrences = occurrences \+ 1/);
    expect(params[0]).toBe('cat-sys-food');
    expect(params[1]).toBe('Lidl');
  });

  it('skip când merchant gol după normalizare', async () => {
    await upsertRule('   ', 'cat-sys-food');
    expect(runAsync).not.toHaveBeenCalled();
  });
});

describe('findMatchingRule', () => {
  const rules: MerchantRule[] = [
    {
      merchant_normalized: 'lidl',
      merchant_display: 'Lidl',
      category_id: 'cat-food',
      occurrences: 1,
      created_at: '',
      updated_at: '',
    },
    {
      merchant_normalized: 'lidl bucuresti centru',
      merchant_display: 'Lidl Bucuresti Centru',
      category_id: 'cat-food-spec',
      occurrences: 1,
      created_at: '',
      updated_at: '',
    },
    {
      merchant_normalized: 'kaufland',
      merchant_display: 'Kaufland',
      category_id: 'cat-food',
      occurrences: 1,
      created_at: '',
      updated_at: '',
    },
  ];

  it('match exact câștigă peste prefix', () => {
    expect(findMatchingRule('lidl', rules)?.merchant_normalized).toBe('lidl');
  });

  it('match prefix pe cuvânt', () => {
    expect(findMatchingRule('lidl bucuresti', rules)?.merchant_normalized).toBe('lidl');
  });

  it('match exact câștigă peste prefix mai scurt', () => {
    expect(findMatchingRule('lidl bucuresti centru', rules)?.merchant_normalized).toBe(
      'lidl bucuresti centru'
    );
  });

  it('regula mai specifică câștigă la prefix multiplu', () => {
    const merged: MerchantRule[] = [
      ...rules,
      {
        merchant_normalized: 'lidl bucuresti',
        merchant_display: 'Lidl Bucuresti',
        category_id: 'cat-food-buc',
        occurrences: 1,
        created_at: '',
        updated_at: '',
      },
    ];
    expect(findMatchingRule('lidl bucuresti militari', merged)?.merchant_normalized).toBe(
      'lidl bucuresti'
    );
  });

  it('fără match', () => {
    expect(findMatchingRule('necunoscut', rules)).toBeNull();
  });

  it('nu match parțial fără cuvânt complet (lidlxyz nu e Lidl)', () => {
    expect(findMatchingRule('lidlxyz', rules)).toBeNull();
  });

  it('listă goală', () => {
    expect(findMatchingRule('lidl', [])).toBeNull();
  });
});

describe('getRuleForMerchant', () => {
  it('returnează regula pe match exact prin PK lookup', async () => {
    const rule = {
      merchant_normalized: 'lidl',
      merchant_display: 'Lidl',
      category_id: 'cat-sys-food',
      occurrences: 5,
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
    };
    getFirstAsync.mockResolvedValue(rule);

    expect(await getRuleForMerchant('LIDL')).toEqual(rule);
    expect(await getRuleForMerchant('  Lidl ')).toEqual(rule);
    expect(getAllAsync).not.toHaveBeenCalled();
  });

  it('cade pe prefix match când exact lookup nu returnează', async () => {
    getFirstAsync.mockResolvedValue(null);
    getAllAsync.mockResolvedValue([
      {
        merchant_normalized: 'lidl',
        merchant_display: 'Lidl',
        category_id: 'cat-food',
        occurrences: 3,
        created_at: '',
        updated_at: '',
      },
    ]);
    const result = await getRuleForMerchant('LIDL Bucuresti');
    expect(result?.category_id).toBe('cat-food');
  });

  it('returnează null pentru merchant gol', async () => {
    expect(await getRuleForMerchant('')).toBeNull();
    expect(await getRuleForMerchant('   ')).toBeNull();
    expect(getFirstAsync).not.toHaveBeenCalled();
  });

  it('returnează null când nici exact nici prefix', async () => {
    getFirstAsync.mockResolvedValue(null);
    getAllAsync.mockResolvedValue([]);
    expect(await getRuleForMerchant('Necunoscut')).toBeNull();
  });
});

describe('listRules', () => {
  it('returnează lista din DB sortată după occurrences', async () => {
    const rules = [
      { merchant_normalized: 'lidl', occurrences: 10 },
      { merchant_normalized: 'kaufland', occurrences: 3 },
    ];
    getAllAsync.mockResolvedValue(rules);
    const result = await listRules();
    expect(result).toEqual(rules);
    const [sql] = getAllAsync.mock.calls[0];
    expect(sql).toMatch(/ORDER BY occurrences DESC/);
  });

  it('returnează listă goală când DB returnează null', async () => {
    getAllAsync.mockResolvedValue(null);
    expect(await listRules()).toEqual([]);
  });
});

describe('deleteRule', () => {
  it('rulează DELETE pe merchant_normalized', async () => {
    await deleteRule('lidl');
    expect(runAsync).toHaveBeenCalledWith(
      'DELETE FROM merchant_category_rules WHERE merchant_normalized = ?',
      ['lidl']
    );
  });
});

describe('loadRulesIndex', () => {
  it('construiește Map normalized → category_id', async () => {
    getAllAsync.mockResolvedValue([
      { merchant_normalized: 'lidl', category_id: 'cat-food' },
      { merchant_normalized: 'petrom', category_id: 'cat-vehicle' },
    ]);
    const idx = await loadRulesIndex();
    expect(idx.get('lidl')).toBe('cat-food');
    expect(idx.get('petrom')).toBe('cat-vehicle');
    expect(idx.size).toBe(2);
  });
});

describe('applyRulesToUncategorized', () => {
  it('aplică reguli pe tranzacții fără categorie (cu match prefix)', async () => {
    getAllAsync
      // listRules
      .mockResolvedValueOnce([
        { merchant_normalized: 'lidl', category_id: 'cat-food' },
        { merchant_normalized: 'petrom', category_id: 'cat-vehicle' },
      ])
      // candidates
      .mockResolvedValueOnce([
        { id: 'tx-1', merchant: 'LIDL Bucuresti' },
        { id: 'tx-2', merchant: 'Petrom' },
        { id: 'tx-3', merchant: 'Necunoscut' },
      ]);

    const result = await applyRulesToUncategorized();
    expect(result.updated).toBe(2);
    expect(runAsync).toHaveBeenCalledWith(
      'UPDATE transactions SET category_id = ?, category_learned = 1 WHERE id = ?',
      ['cat-food', 'tx-1']
    );
    expect(runAsync).toHaveBeenCalledWith(
      'UPDATE transactions SET category_id = ?, category_learned = 1 WHERE id = ?',
      ['cat-vehicle', 'tx-2']
    );
    expect(runAsync).toHaveBeenCalledTimes(2);
  });

  it('returnează 0 când nu există reguli', async () => {
    getAllAsync.mockResolvedValueOnce([]);
    const result = await applyRulesToUncategorized();
    expect(result.updated).toBe(0);
    expect(runAsync).not.toHaveBeenCalled();
  });

  it('skip tranzacții cu merchant gol', async () => {
    getAllAsync
      .mockResolvedValueOnce([{ merchant_normalized: 'lidl', category_id: 'cat-food' }])
      .mockResolvedValueOnce([{ id: 'tx-1', merchant: '' }]);
    const result = await applyRulesToUncategorized();
    expect(result.updated).toBe(0);
  });
});
