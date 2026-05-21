import { buildRecurringSeries, type TxLite } from '@/services/recurring';

function tx(
  merchant: string,
  amount_ron: number,
  date: string,
  extras: Partial<TxLite> = {}
): TxLite {
  return { merchant, amount_ron, date, ...extras };
}

describe('buildRecurringSeries — detecție lunară', () => {
  it('detectează serie cu 3 apariții lunare în toleranță sumă', () => {
    const series = buildRecurringSeries(
      [
        tx('Netflix', -49.99, '2026-02-15'),
        tx('Netflix', -49.99, '2026-03-15'),
        tx('Netflix', -49.99, '2026-04-15'),
      ],
      '2026-04-25'
    );
    expect(series).toHaveLength(1);
    expect(series[0].merchant_normalized).toBe('netflix');
    expect(series[0].occurrences).toBe(3);
    expect(series[0].cadence_days).toBe(30); // median([28, 31]) = 29.5 → round 30
    expect(series[0].median_amount_ron).toBeCloseTo(49.99, 1);
    expect(series[0].status).toBe('active');
  });

  it('toleră variații sub 10% în sumă', () => {
    const series = buildRecurringSeries(
      [
        tx('Spotify', -22.99, '2026-02-10'),
        tx('Spotify', -23.99, '2026-03-10'), // +4%
        tx('Spotify', -22.99, '2026-04-10'),
      ],
      '2026-04-15'
    );
    expect(series).toHaveLength(1);
    expect(series[0].merchant_normalized).toBe('spotify');
  });

  it('respinge serie cu doar 2 apariții', () => {
    const series = buildRecurringSeries(
      [tx('HBO', -29.99, '2026-03-10'), tx('HBO', -29.99, '2026-04-10')],
      '2026-04-15'
    );
    expect(series).toHaveLength(0);
  });

  it('respinge serie cu sume foarte diferite (>10% variație)', () => {
    const series = buildRecurringSeries(
      [
        tx('Magazin', -100, '2026-02-10'),
        tx('Magazin', -200, '2026-03-10'),
        tx('Magazin', -50, '2026-04-10'),
      ],
      '2026-04-15'
    );
    expect(series).toHaveLength(0);
  });

  it('respinge serie cu cadență neregulată (out of 25-35 zile)', () => {
    const series = buildRecurringSeries(
      [
        tx('Random', -50, '2026-02-10'),
        tx('Random', -50, '2026-02-20'), // 10 zile
        tx('Random', -50, '2026-04-10'), // 49 zile
      ],
      '2026-04-15'
    );
    expect(series).toHaveLength(0);
  });

  it('case-insensitive + diacritice strip pe merchant', () => {
    const series = buildRecurringSeries(
      [
        tx('Carrefour', -150, '2026-02-15'),
        tx('CARREFOUR', -150, '2026-03-15'),
        tx('carrefour', -150, '2026-04-15'),
      ],
      '2026-04-25'
    );
    expect(series).toHaveLength(1);
    expect(series[0].occurrences).toBe(3);
  });
});

describe('buildRecurringSeries — cadență bi-monthly', () => {
  it('detectează serie cu cadență ~60 zile (utilități/asigurări bi-monthly)', () => {
    const series = buildRecurringSeries(
      [
        tx('Vodafone', -150, '2026-01-15'),
        tx('Vodafone', -150, '2026-03-15'), // 59 zile
        tx('Vodafone', -150, '2026-05-15'), // 61 zile
      ],
      '2026-05-25'
    );
    expect(series).toHaveLength(1);
    expect(series[0].merchant_normalized).toBe('vodafone');
    expect(series[0].cadence_days).toBe(60); // median([59,61]) = 60
    expect(series[0].status).toBe('active');
  });

  it('respinge cadență intermediară (între lunar și bi-monthly, gol)', () => {
    // 45 zile între tranzacții — nu monthly, nu bi-monthly
    const series = buildRecurringSeries(
      [
        tx('Aleator', -50, '2026-02-01'),
        tx('Aleator', -50, '2026-03-17'), // 44
        tx('Aleator', -50, '2026-05-02'), // 46
      ],
      '2026-05-10'
    );
    expect(series).toHaveLength(0);
  });
});

describe('buildRecurringSeries — status', () => {
  it('active: ultima apariție în ultimele 35 zile', () => {
    const series = buildRecurringSeries(
      [
        tx('Netflix', -49.99, '2026-02-15'),
        tx('Netflix', -49.99, '2026-03-15'),
        tx('Netflix', -49.99, '2026-04-15'),
      ],
      '2026-05-01' // 16 zile după last_seen
    );
    expect(series[0].status).toBe('active');
  });

  it('missing: 35-70 zile', () => {
    const series = buildRecurringSeries(
      [
        tx('Netflix', -49.99, '2026-01-15'),
        tx('Netflix', -49.99, '2026-02-15'),
        tx('Netflix', -49.99, '2026-03-15'),
      ],
      '2026-05-01' // 47 zile după last_seen
    );
    expect(series[0].status).toBe('missing');
  });

  it('expired: > 70 zile', () => {
    const series = buildRecurringSeries(
      [
        tx('Netflix', -49.99, '2025-12-15'),
        tx('Netflix', -49.99, '2026-01-15'),
        tx('Netflix', -49.99, '2026-02-15'),
      ],
      '2026-05-01' // 75 zile după last_seen
    );
    expect(series[0].status).toBe('expired');
  });
});

describe('buildRecurringSeries — expected_next', () => {
  it('expected_next = last_seen + cadence median', () => {
    const series = buildRecurringSeries(
      [
        tx('Netflix', -49.99, '2026-02-01'),
        tx('Netflix', -49.99, '2026-03-01'), // 28
        tx('Netflix', -49.99, '2026-03-31'), // 30
      ],
      '2026-04-10'
    );
    // median cadence = 29 zile
    expect(series[0].cadence_days).toBe(29);
    expect(series[0].expected_next).toBe('2026-04-29');
  });
});

describe('buildRecurringSeries — multiple series', () => {
  it('mai multe series, sortate active primele apoi după sumă desc', () => {
    const series = buildRecurringSeries(
      [
        // Active, sumă mică
        tx('Netflix', -49.99, '2026-03-01'),
        tx('Netflix', -49.99, '2026-04-01'),
        tx('Netflix', -49.99, '2026-05-01'),
        // Active, sumă mare
        tx('Chirie', -2000, '2026-03-01'),
        tx('Chirie', -2000, '2026-04-01'),
        tx('Chirie', -2000, '2026-05-01'),
      ],
      '2026-05-10'
    );
    expect(series).toHaveLength(2);
    // Both active, then by amount desc
    expect(series[0].merchant_normalized).toBe('chirie');
    expect(series[1].merchant_normalized).toBe('netflix');
  });

  it('active înainte de missing/expired', () => {
    const series = buildRecurringSeries(
      [
        // Expired
        tx('Old', -100, '2025-11-01'),
        tx('Old', -100, '2025-12-01'),
        tx('Old', -100, '2026-01-01'),
        // Active sumă mai mică
        tx('New', -10, '2026-03-01'),
        tx('New', -10, '2026-04-01'),
        tx('New', -10, '2026-05-01'),
      ],
      '2026-05-10'
    );
    expect(series[0].merchant_normalized).toBe('new'); // active first
    expect(series[1].merchant_normalized).toBe('old');
  });
});

describe('buildRecurringSeries — category info', () => {
  it('atașează ultima categorie cunoscută', () => {
    const series = buildRecurringSeries(
      [
        tx('Netflix', -49.99, '2026-03-01'),
        tx('Netflix', -49.99, '2026-04-01', {
          category_id: 'cat-sub',
          category_name: 'Abonamente',
        }),
        tx('Netflix', -49.99, '2026-05-01', {
          category_id: 'cat-sub',
          category_name: 'Abonamente',
        }),
      ],
      '2026-05-10'
    );
    expect(series[0].category_id).toBe('cat-sub');
    expect(series[0].category_name).toBe('Abonamente');
  });

  it('category absent dacă nicio tranzacție nu are categorie', () => {
    const series = buildRecurringSeries(
      [
        tx('Netflix', -49.99, '2026-03-01'),
        tx('Netflix', -49.99, '2026-04-01'),
        tx('Netflix', -49.99, '2026-05-01'),
      ],
      '2026-05-10'
    );
    expect(series[0].category_id).toBeUndefined();
  });
});

describe('buildRecurringSeries — edge cases', () => {
  it('listă goală', () => {
    expect(buildRecurringSeries([], '2026-05-10')).toEqual([]);
  });

  it('ignoră tranzacții cu merchant gol', () => {
    const series = buildRecurringSeries(
      [tx('', -50, '2026-03-01'), tx('   ', -50, '2026-04-01')],
      '2026-05-10'
    );
    expect(series).toEqual([]);
  });
});
