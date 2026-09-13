import { buildInsightsFromAnomalies, computeMonthlyInsights } from '@/services/insights';
import type { SpendingAnomaly } from '@/services/spendingAnomalies';
import * as coverage from '@/services/statementCoverage';
import * as txService from '@/services/transactions';

// `spendingAnomalies` importă `formatMonthLabel` de aici: fără el în mock,
// detectorul ar primi `undefined` și ar arunca la prima anomalie, iar testul ar
// părea că demonstrează altceva.
jest.mock('@/services/statementCoverage', () => ({
  __esModule: true,
  loadCoverageReport: jest.fn(),
  isMonthComplete: jest.fn(),
  formatMonthLabel: (ym: string) => ym,
}));

jest.mock('@/services/transactions', () => ({
  __esModule: true,
  getCategoryMonthlySeries: jest.fn(),
  getTransactions: jest.fn(),
}));

function anomaly(over: Partial<SpendingAnomaly> = {}): SpendingAnomaly {
  return {
    id: 'anomaly:cat-food:2026-08',
    category_id: 'cat-food',
    category_name: 'Mâncare',
    month: '2026-08',
    direction: 'up',
    severity: 'warning',
    explanation: 'single_large',
    current_ron: 2100,
    median_ron: 1200,
    excess_ron: 900,
    z: 5,
    message: 'Mâncare: 2.100 RON în august 2026, față de 1.200 RON obișnuit.',
    evidence_tx_ids: ['t1'],
    ...over,
  };
}

describe('buildInsightsFromAnomalies', () => {
  it('păstrează mesajul detectorului, nu îl rescrie', () => {
    // Cifrele și explicația sunt deja decise acolo; aici doar se potrivește forma.
    const result = buildInsightsFromAnomalies(null, [anomaly()]);
    expect(result[0]?.message).toBe(
      'Mâncare: 2.100 RON în august 2026, față de 1.200 RON obișnuit.'
    );
    expect(result[0]?.type).toBe('category_change');
    expect(result[0]?.category_name).toBe('Mâncare');
  });

  it('procentul se raportează la mediană, nu la medie', () => {
    const result = buildInsightsFromAnomalies(null, [anomaly()]);
    expect(Math.round(result[0]?.delta_pct ?? 0)).toBe(75); // 900 / 1200
  });

  it('totalul trece primul, înaintea categoriilor', () => {
    const total = anomaly({ category_id: null, category_name: 'Total', excess_ron: 500 });
    const result = buildInsightsFromAnomalies(total, [anomaly()]);
    expect(result[0]?.type).toBe('total_change');
    expect(result[0]?.id).toBe('total');
    expect(result[1]?.type).toBe('category_change');
  });

  it('păstrează severitatea neutră a anomaliilor sezoniere', () => {
    const result = buildInsightsFromAnomalies(null, [anomaly({ severity: 'neutral' })]);
    expect(result[0]?.severity).toBe('neutral');
  });

  it('cap de 3 carduri, ca înainte', () => {
    const many = ['a', 'b', 'c', 'd'].map(id =>
      anomaly({ category_id: `cat-${id}`, category_name: id.toUpperCase() })
    );
    expect(buildInsightsFromAnomalies(anomaly(), many)).toHaveLength(3);
  });

  it('fără anomalii → niciun card', () => {
    expect(buildInsightsFromAnomalies(null, [])).toEqual([]);
  });
});

describe('computeMonthlyInsights', () => {
  const COMPLETE = new Set([
    '2025-09',
    '2025-10',
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
  ]);

  beforeEach(() => {
    jest.clearAllMocks();
    (coverage.loadCoverageReport as jest.Mock).mockResolvedValue({
      accounts: [],
      last_closed_month: '2026-08',
    });
    (coverage.isMonthComplete as jest.Mock).mockImplementation((_r: unknown, ym: string) =>
      COMPLETE.has(ym)
    );
    (txService.getTransactions as jest.Mock).mockResolvedValue([]);
    (txService.getCategoryMonthlySeries as jest.Mock).mockResolvedValue([]);
  });

  it('lună incompletă → niciun card, fără să atingă baza', async () => {
    (coverage.isMonthComplete as jest.Mock).mockReturnValue(false);
    const result = await computeMonthlyInsights('2026-08');
    expect(result).toEqual([]);
    // Poarta e înainte de orice interogare: pe date parțiale nu calculăm nimic.
    expect(txService.getCategoryMonthlySeries).not.toHaveBeenCalled();
  });

  it('fără nicio lună completă înainte → niciun card', async () => {
    (coverage.isMonthComplete as jest.Mock).mockImplementation(
      (_r: unknown, ym: string) => ym === '2026-08'
    );
    expect(await computeMonthlyInsights('2026-08')).toEqual([]);
  });

  it('categorie mult peste obicei → card cu mesajul detectorului', async () => {
    const history = [...COMPLETE]
      .filter(ym => ym !== '2026-08')
      .map(ym => ({
        yearMonth: ym,
        category_id: 'cat-food',
        category_name: 'Mâncare',
        total_ron: 1200,
        transaction_count: 10,
      }));
    (txService.getCategoryMonthlySeries as jest.Mock).mockResolvedValue([
      ...history,
      {
        yearMonth: '2026-08',
        category_id: 'cat-food',
        category_name: 'Mâncare',
        total_ron: 2100,
        transaction_count: 10,
      },
    ]);

    const result = await computeMonthlyInsights('2026-08');
    const food = result.find(i => i.category_id === 'cat-food');
    expect(food).toBeDefined();
    expect(food?.severity).toBe('warning');
    expect(food?.delta_ron).toBe(900);
    expect(food?.message).toContain('Mâncare');
    expect(food?.message).toContain('2.100');
  });

  it('lună în tipar → niciun card', async () => {
    const flat = [...COMPLETE].map(ym => ({
      yearMonth: ym,
      category_id: 'cat-food',
      category_name: 'Mâncare',
      total_ron: 1200,
      transaction_count: 10,
    }));
    (txService.getCategoryMonthlySeries as jest.Mock).mockResolvedValue(flat);
    expect(await computeMonthlyInsights('2026-08')).toEqual([]);
  });
});
