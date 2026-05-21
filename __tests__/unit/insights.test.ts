import { buildInsightsFromBreakdowns } from '@/services/insights';
import type { CategoryBreakdownItem } from '@/services/transactions';

function cat(category_id: string | null, name: string, total_ron: number): CategoryBreakdownItem {
  return {
    category_id,
    category_name: name,
    category_key: null,
    icon: null,
    color: null,
    total_ron,
    percentage: 0,
    transaction_count: 1,
  };
}

describe('buildInsightsFromBreakdowns — total general', () => {
  it('detectează creștere semnificativă > 20%', () => {
    const insights = buildInsightsFromBreakdowns(
      1500,
      [1000, 1000, 1000],
      [cat('cat-food', 'Mâncare', 800), cat('cat-other', 'Altceva', 700)],
      [
        [cat('cat-food', 'Mâncare', 600), cat('cat-other', 'Altceva', 400)],
        [cat('cat-food', 'Mâncare', 600), cat('cat-other', 'Altceva', 400)],
        [cat('cat-food', 'Mâncare', 600), cat('cat-other', 'Altceva', 400)],
      ]
    );
    const total = insights.find(i => i.type === 'total_change');
    expect(total).toBeDefined();
    expect(total?.severity).toBe('warning');
    expect(total?.delta_ron).toBe(500);
    expect(Math.round(total?.delta_pct ?? 0)).toBe(50);
    expect(total?.message).toMatch(/cu 50% mai mult/);
    expect(total?.message).toMatch(/500 RON/);
  });

  it('detectează scădere semnificativă cu severity positive', () => {
    const insights = buildInsightsFromBreakdowns(500, [1000, 1000, 1000], [], []);
    const total = insights.find(i => i.type === 'total_change');
    expect(total?.severity).toBe('positive');
    expect(total?.delta_ron).toBe(-500);
    expect(total?.message).toMatch(/cu 50% mai puțin/);
  });

  it('ignoră schimbări sub 20%', () => {
    const insights = buildInsightsFromBreakdowns(1100, [1000, 1000, 1000], [], []);
    expect(insights.find(i => i.type === 'total_change')).toBeUndefined();
  });

  it('ignoră schimbări sub 50 RON absolut', () => {
    // 30 / 100 = 30% (peste prag relativ), dar absolut sub 50 RON
    const insights = buildInsightsFromBreakdowns(130, [100, 100, 100], [], []);
    expect(insights.find(i => i.type === 'total_change')).toBeUndefined();
  });

  it('istoric gol → fără insight total', () => {
    const insights = buildInsightsFromBreakdowns(1500, [], [], []);
    expect(insights.find(i => i.type === 'total_change')).toBeUndefined();
  });

  it('istoric cu zerouri → folosește doar lunile non-zero', () => {
    // doar 1000 e valid; 1500 vs 1000 = +50%
    const insights = buildInsightsFromBreakdowns(1500, [1000, 0, 0], [], []);
    const total = insights.find(i => i.type === 'total_change');
    expect(total).toBeDefined();
    expect(Math.round(total?.delta_pct ?? 0)).toBe(50);
  });
});

describe('buildInsightsFromBreakdowns — categorii', () => {
  it('detectează creștere categorie peste 20% și ≥ 100 RON', () => {
    const insights = buildInsightsFromBreakdowns(
      0,
      [0, 0, 0],
      [cat('cat-food', 'Mâncare', 600)],
      [
        [cat('cat-food', 'Mâncare', 400)],
        [cat('cat-food', 'Mâncare', 400)],
        [cat('cat-food', 'Mâncare', 400)],
      ]
    );
    const food = insights.find(i => i.id === 'cat:cat-food');
    expect(food).toBeDefined();
    expect(food?.severity).toBe('warning');
    expect(food?.message).toMatch(/Mai mult la Mâncare/);
    expect(Math.round(food?.delta_pct ?? 0)).toBe(50);
    expect(Math.round(food?.delta_ron ?? 0)).toBe(200);
  });

  it('ignoră categorii sub 100 RON luna curentă', () => {
    const insights = buildInsightsFromBreakdowns(
      0,
      [0, 0, 0],
      [cat('cat-rare', 'Rare', 80)],
      [[cat('cat-rare', 'Rare', 10)], [cat('cat-rare', 'Rare', 10)], [cat('cat-rare', 'Rare', 10)]]
    );
    expect(insights.find(i => i.id === 'cat:cat-rare')).toBeUndefined();
  });

  it('detectează categorie nouă cu cheltuieli >= 200 RON ca insight category_new', () => {
    const insights = buildInsightsFromBreakdowns(
      0,
      [0, 0, 0],
      [cat('cat-new', 'Veterinar', 500)],
      [[], [], []]
    );
    const newCat = insights.find(i => i.id === 'cat:cat-new');
    expect(newCat).toBeDefined();
    expect(newCat?.type).toBe('category_new');
    expect(newCat?.severity).toBe('neutral');
    expect(newCat?.delta_ron).toBe(500);
    expect(newCat?.message).toMatch(/Categorie nouă: Veterinar cu 500 RON/);
  });

  it('ignoră categorie nouă sub pragul 200 RON', () => {
    const insights = buildInsightsFromBreakdowns(
      0,
      [0, 0, 0],
      [cat('cat-new', 'Nouă', 150)],
      [[], [], []]
    );
    expect(insights.find(i => i.id === 'cat:cat-new')).toBeUndefined();
  });

  it('ignoră necategorizat (category_id null)', () => {
    const insights = buildInsightsFromBreakdowns(
      0,
      [0, 0, 0],
      [cat(null, 'Necategorizat', 500)],
      [[cat(null, 'Necategorizat', 100)]]
    );
    expect(insights.find(i => i.id === 'cat:null')).toBeUndefined();
  });

  it('detectează scădere categorie cu severity positive', () => {
    const insights = buildInsightsFromBreakdowns(
      0,
      [0, 0, 0],
      [cat('cat-food', 'Mâncare', 200)],
      [
        [cat('cat-food', 'Mâncare', 500)],
        [cat('cat-food', 'Mâncare', 500)],
        [cat('cat-food', 'Mâncare', 500)],
      ]
    );
    const food = insights.find(i => i.id === 'cat:cat-food');
    expect(food?.severity).toBe('positive');
    expect(food?.message).toMatch(/Mai puțin la Mâncare/);
  });
});

describe('buildInsightsFromBreakdowns — selecție și ordine', () => {
  it('total e mereu primul, apoi categorii ordonate descrescător după delta', () => {
    const insights = buildInsightsFromBreakdowns(
      2000,
      [1000, 1000, 1000],
      [
        cat('cat-food', 'Mâncare', 800),
        cat('cat-fuel', 'Combustibil', 600),
        cat('cat-fun', 'Distracție', 600),
      ],
      [
        [
          cat('cat-food', 'Mâncare', 400),
          cat('cat-fuel', 'Combustibil', 200),
          cat('cat-fun', 'Distracție', 500),
        ],
        [
          cat('cat-food', 'Mâncare', 400),
          cat('cat-fuel', 'Combustibil', 200),
          cat('cat-fun', 'Distracție', 500),
        ],
        [
          cat('cat-food', 'Mâncare', 400),
          cat('cat-fuel', 'Combustibil', 200),
          cat('cat-fun', 'Distracție', 500),
        ],
      ]
    );

    expect(insights.length).toBeLessThanOrEqual(3);
    expect(insights[0].type).toBe('total_change');
    // următoarele sunt sortate descrescător după magnitudine
    const cats = insights.slice(1);
    if (cats.length >= 2) {
      expect(Math.abs(cats[0].delta_ron)).toBeGreaterThanOrEqual(Math.abs(cats[1].delta_ron));
    }
  });

  it('cap 3 insights chiar dacă există mai multe candidate', () => {
    const insights = buildInsightsFromBreakdowns(
      2000,
      [1000, 1000, 1000],
      [cat('a', 'A', 500), cat('b', 'B', 500), cat('c', 'C', 500), cat('d', 'D', 500)],
      [
        [cat('a', 'A', 200), cat('b', 'B', 200), cat('c', 'C', 200), cat('d', 'D', 200)],
        [cat('a', 'A', 200), cat('b', 'B', 200), cat('c', 'C', 200), cat('d', 'D', 200)],
        [cat('a', 'A', 200), cat('b', 'B', 200), cat('c', 'C', 200), cat('d', 'D', 200)],
      ]
    );
    expect(insights.length).toBe(3);
  });
});
