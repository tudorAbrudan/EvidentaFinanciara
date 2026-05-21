import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildRecapSummary,
  currentMonthYM,
  markRecapShown,
  pickNextRecapMonth,
  previousMonthYM,
  shouldShowRecap,
} from '@/services/monthlyRecap';
import type { CategoryBreakdownItem, MonthlyTotals } from '@/services/transactions';

function tot(expense: number, income: number, count: number): MonthlyTotals {
  return {
    income_ron: income,
    expense_ron: expense,
    net_ron: income - expense,
    transaction_count: count,
  };
}

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

describe('previousMonthYM', () => {
  it('întoarce luna trecută în format YYYY-MM', () => {
    expect(previousMonthYM(new Date(Date.UTC(2026, 4, 10)))).toBe('2026-04');
    expect(previousMonthYM(new Date(Date.UTC(2026, 0, 5)))).toBe('2025-12'); // ianuarie → decembrie
  });
});

describe('currentMonthYM', () => {
  it('întoarce luna curentă', () => {
    expect(currentMonthYM(new Date(Date.UTC(2026, 4, 10)))).toBe('2026-05');
  });
});

describe('buildRecapSummary', () => {
  it('returnează null sub 5 tranzacții (lună sub-populată)', () => {
    const result = buildRecapSummary('2026-04', tot(500, 0, 3), [cat('cat-food', 'Mâncare', 500)]);
    expect(result).toBeNull();
  });

  it('returnează recap cu top 3 categorii sortate desc', () => {
    const result = buildRecapSummary('2026-04', tot(1500, 5000, 20), [
      cat('cat-food', 'Mâncare', 800),
      cat('cat-transport', 'Transport', 400),
      cat('cat-fun', 'Distracție', 200),
      cat('cat-other', 'Altele', 100),
    ]);
    expect(result).not.toBeNull();
    expect(result?.top_categories).toHaveLength(3);
    expect(result?.top_categories[0].name).toBe('Mâncare');
    expect(result?.top_categories[1].name).toBe('Transport');
    expect(result?.top_categories[2].name).toBe('Distracție');
  });

  it('include delta față de luna anterioară când prevExpense > 0', () => {
    const result = buildRecapSummary(
      '2026-04',
      tot(1200, 0, 10),
      [cat('cat-food', 'Mâncare', 1200)],
      1000
    );
    expect(result?.delta_vs_previous_pct).toBeCloseTo(20, 1);
  });

  it('omite delta când prevExpense lipsește sau e 0', () => {
    const noPrev = buildRecapSummary('2026-04', tot(1200, 0, 10), [
      cat('cat-food', 'Mâncare', 1200),
    ]);
    expect(noPrev?.delta_vs_previous_pct).toBeUndefined();

    const zeroPrev = buildRecapSummary(
      '2026-04',
      tot(1200, 0, 10),
      [cat('cat-food', 'Mâncare', 1200)],
      0
    );
    expect(zeroPrev?.delta_vs_previous_pct).toBeUndefined();
  });

  it('atașează highlight insight când e furnizat', () => {
    const result = buildRecapSummary(
      '2026-04',
      tot(1500, 0, 10),
      [cat('cat-food', 'Mâncare', 1500)],
      undefined,
      'Cheltuiești cu 50% mai mult la Mâncare.'
    );
    expect(result?.highlight_insight).toBe('Cheltuiești cu 50% mai mult la Mâncare.');
  });

  it('income și total tranzacții sunt expuse', () => {
    const result = buildRecapSummary('2026-04', tot(1500, 5000, 30), [
      cat('cat-food', 'Mâncare', 1500),
    ]);
    expect(result?.expense_ron).toBe(1500);
    expect(result?.income_ron).toBe(5000);
    expect(result?.net_ron).toBe(3500);
    expect(result?.transaction_count).toBe(30);
  });
});

describe('pickNextRecapMonth', () => {
  it('niciodată citit → luna trecută', () => {
    expect(pickNextRecapMonth(new Date(Date.UTC(2026, 4, 5)), null)).toBe('2026-04');
  });

  it('luna trecută deja citită → null', () => {
    expect(pickNextRecapMonth(new Date(Date.UTC(2026, 4, 5)), '2026-04')).toBe(null);
  });

  it('userul a sărit o lună → returnează luna pierdută, nu cea trecută', () => {
    // Azi mai 2026, ultima vizionare ianuarie 2026 (a sărit feb, mar, apr).
    // Returnează februarie (cea mai veche nevăzută între ian și apr).
    const result = pickNextRecapMonth(new Date(Date.UTC(2026, 4, 5)), '2026-01');
    expect(result).toBe('2026-02');
  });

  it('userul a sărit două luni — următoarea vizită aduce a doua lună', () => {
    // Simulez fluxul: după citirea februarie (commit prin markRecapShown), userul
    // redeschide → următoarea ar fi martie.
    const result = pickNextRecapMonth(new Date(Date.UTC(2026, 4, 5)), '2026-02');
    expect(result).toBe('2026-03');
  });
});

describe('shouldShowRecap', () => {
  // AsyncStorage e mock global cu valori statice; instalăm un mock în-memorie
  // local pentru aceste teste ca getItem/setItem să se vadă unul pe altul.
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      async (key: string) => store[key] ?? null
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      store[key] = value;
    });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
      delete store[key];
    });
  });

  it('returnează luna trecută la prima rulare (storage gol)', async () => {
    const result = await shouldShowRecap();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returnează null când luna trecută a fost deja shown', async () => {
    const target = previousMonthYM(new Date());
    await markRecapShown(target);
    const result = await shouldShowRecap();
    expect(result).toBeNull();
  });

  it('returnează target nou când storage are valoare mai veche', async () => {
    await markRecapShown('2025-01'); // foarte vechi
    const result = await shouldShowRecap();
    expect(result).not.toBeNull();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });
});
