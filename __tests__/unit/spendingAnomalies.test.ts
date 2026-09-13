import {
  detectCategoryAnomaly,
  detectSpendingAnomalies,
  type CategoryAnomalyInput,
  type CategoryMonthPoint,
} from '@/services/spendingAnomalies';

function months(values: number[], count = 10, startYm = '2026-01'): CategoryMonthPoint[] {
  const year = Number(startYm.slice(0, 4));
  const first = Number(startYm.slice(5, 7));
  return values.map((total, i) => {
    const d = new Date(Date.UTC(year, first - 1 + i, 1));
    return {
      yearMonth: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      total_ron: total,
      transaction_count: count,
    };
  });
}

function input(over: Partial<CategoryAnomalyInput> = {}): CategoryAnomalyInput {
  return {
    category_id: 'cat-food',
    category_name: 'Mâncare',
    history: months([1200, 1150, 1250, 1180, 1220, 1200]),
    current: { yearMonth: '2026-08', total_ron: 2100, transaction_count: 10 },
    current_transactions: [{ id: 't1', amount_ron: 300, merchant: 'Lidl' }],
    known_merchants: ['Lidl', 'Kaufland'],
    ...over,
  };
}

describe('detectCategoryAnomaly', () => {
  it('cheltuială mult peste obicei → anomalie', () => {
    const result = detectCategoryAnomaly(input());
    expect(result).not.toBeNull();
    expect(result?.direction).toBe('up');
    expect(result?.severity).toBe('warning');
    expect(result?.median_ron).toBe(1200);
    expect(result?.excess_ron).toBe(900);
    expect(result?.message).toContain('Mâncare: 2.100 RON în august 2026');
    expect(result?.message).toContain('1.200 RON obișnuit');
  });

  it('chirie fixă cu variație mică → nimic', () => {
    // MAD = 0; fără podeaua de dispersie, 60 de lei ar da un z infinit.
    const result = detectCategoryAnomaly(
      input({
        category_name: 'Casă',
        history: months([2500, 2500, 2500, 2500, 2500, 2500]),
        current: { yearMonth: '2026-08', total_ron: 2560, transaction_count: 1 },
      })
    );
    expect(result).toBeNull();
  });

  it('sub patru luni de istoric → nu emite nimic', () => {
    const result = detectCategoryAnomaly(input({ history: months([1200, 1150, 1250]) }));
    expect(result).toBeNull();
  });

  it('o singură plată mare explică diferența', () => {
    const result = detectCategoryAnomaly(
      input({
        current_transactions: [
          { id: 'big', amount_ron: 900, merchant: 'eMAG' },
          { id: 't2', amount_ron: 120, merchant: 'Lidl' },
        ],
      })
    );
    expect(result?.explanation).toBe('single_large');
    expect(result?.message).toContain('O singură plată de 900 RON la eMAG');
    expect(result?.evidence_tx_ids).toEqual(['big']);
  });

  it('comercianți noi explică diferența', () => {
    const result = detectCategoryAnomaly(
      input({
        current_transactions: [
          { id: 'n1', amount_ron: 300, merchant: 'Dedeman' },
          { id: 'n2', amount_ron: 260, merchant: 'Leroy Merlin' },
          { id: 't3', amount_ron: 100, merchant: 'Lidl' },
        ],
      })
    );
    expect(result?.explanation).toBe('new_merchant');
    expect(result?.message).toContain('Dedeman');
    expect(result?.evidence_tx_ids).toEqual(['n1', 'n2']);
  });

  it('mai multe tranzacții decât de obicei', () => {
    const result = detectCategoryAnomaly(
      input({
        current: { yearMonth: '2026-08', total_ron: 2100, transaction_count: 24 },
        current_transactions: [
          { id: 'a', amount_ron: 100, merchant: 'Lidl' },
          { id: 'b', amount_ron: 90, merchant: 'Kaufland' },
        ],
      })
    );
    expect(result?.explanation).toBe('more_frequent');
    expect(result?.message).toContain('24 tranzacții');
  });

  it('valoare medie mai mare pe tranzacție', () => {
    const result = detectCategoryAnomaly(
      input({
        current: { yearMonth: '2026-08', total_ron: 2100, transaction_count: 7 },
        current_transactions: [
          { id: 'a', amount_ron: 200, merchant: 'Lidl' },
          { id: 'b', amount_ron: 180, merchant: 'Kaufland' },
        ],
      })
    );
    expect(result?.explanation).toBe('higher_ticket');
    expect(result?.message).toContain('Valoarea medie a crescut');
  });

  it('la fel ca aceeași lună de anul trecut → ton neutru, nu avertisment', () => {
    const result = detectCategoryAnomaly(
      input({
        category_name: 'Cadouri',
        current: { yearMonth: '2026-12', total_ron: 2100, transaction_count: 10 },
        same_month_last_year_ron: 2050,
      })
    );
    expect(result?.severity).toBe('neutral');
    expect(result?.message).toContain('Similar cu decembrie 2025');
  });

  it('scăderea mare se raportează ca pozitivă', () => {
    const result = detectCategoryAnomaly(
      input({ current: { yearMonth: '2026-08', total_ron: 300, transaction_count: 2 } })
    );
    expect(result?.direction).toBe('down');
    expect(result?.severity).toBe('positive');
  });

  it('categorie mică: procent mare, dar sub pragul absolut → nimic', () => {
    const result = detectCategoryAnomaly(
      input({
        category_name: 'Mărunțișuri',
        history: months([40, 45, 38, 42, 41, 39]),
        current: { yearMonth: '2026-08', total_ron: 180, transaction_count: 3 },
      })
    );
    // 180 față de 40,5 e +344%, dar diferența de 139,5 RON împărțită la podeaua
    // de dispersie (50 RON) dă z = 2,79 — sub prag. Podeaua e cea care tace aici,
    // nu pragul absolut: acela ar fi fost trecut abia la 150 RON.
    expect(result).toBeNull();
  });
});

describe('detectSpendingAnomalies', () => {
  it('creșterile trec înaintea scăderilor, apoi după mărimea diferenței', () => {
    const scadere = input({
      category_id: 'cat-fun',
      category_name: 'Distracție',
      current: { yearMonth: '2026-08', total_ron: 200, transaction_count: 2 },
    });
    const crestereMica = input({
      category_id: 'cat-transport',
      category_name: 'Transport',
      history: months([500, 520, 480, 510, 495, 505]),
      current: { yearMonth: '2026-08', total_ron: 1000, transaction_count: 10 },
    });
    const crestereMare = input();

    const result = detectSpendingAnomalies([scadere, crestereMica, crestereMare]);
    expect(result.map(a => a.category_name)).toEqual(['Mâncare', 'Transport', 'Distracție']);
  });

  it('lista goală → fără anomalii', () => {
    expect(detectSpendingAnomalies([])).toEqual([]);
  });
});
