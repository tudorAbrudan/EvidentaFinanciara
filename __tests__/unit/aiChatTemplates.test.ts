import { formatResponse } from '@/services/aiChatTemplates';

describe('category_evolution', () => {
  const ctx = {
    accounts: new Map(),
    categories: new Map([['cat-food', { id: 'cat-food', name: 'Mâncare' }]]),
  };

  it('folosește category_name din rows când SQL face JOIN', () => {
    const rows = [
      { ym: '2026-04', total: -500, category_name: 'Mâncare' },
      { ym: '2026-05', total: -300, category_name: 'Mâncare' },
    ];
    const out = formatResponse('category_evolution', rows, { category_key: 'food' }, ctx);
    expect(out.text).toContain('Mâncare');
    expect(out.text).not.toContain('categorie necunoscută');
  });

  it('cade pe nameCategory(params.category_id) când rows nu au category_name', () => {
    const rows = [{ ym: '2026-04', total: -500 }];
    const out = formatResponse('category_evolution', rows, { category_id: 'cat-food' }, ctx);
    expect(out.text).toContain('Mâncare');
  });

  it('„categorie necunoscută" doar când nici rows nici params nu rezolvă', () => {
    const rows = [{ ym: '2026-04', total: -500 }];
    const out = formatResponse('category_evolution', rows, { category_id: null }, ctx);
    expect(out.text).toContain('categorie necunoscută');
  });
});

const accountsLookup = new Map([
  ['acc-bt', { id: 'acc-bt', name: 'BT_curent_ron', type: 'bank' }],
  ['acc-cash', { id: 'acc-cash', name: 'Cash', type: 'cash' }],
]);
const categoriesLookup = new Map([
  ['cat-food', { id: 'cat-food', name: 'Mâncare' }],
  ['cat-home', { id: 'cat-home', name: 'Casă' }],
]);
const ctx = { accounts: accountsLookup, categories: categoriesLookup };

describe('formatResponse', () => {
  describe('search_merchant', () => {
    it('happy path with matches', () => {
      const rows = [
        {
          id: 't1',
          date: '2026-03-12',
          amount: -25.5,
          amount_ron: -25.5,
          merchant: 'MCDONALDS',
          account_id: 'acc-bt',
          category_id: 'cat-food',
          description: null,
        },
        {
          id: 't2',
          date: '2026-04-05',
          amount: -42.0,
          amount_ron: -42.0,
          merchant: 'MCDONALDS',
          account_id: 'acc-bt',
          category_id: 'cat-food',
          description: null,
        },
      ];
      const out = formatResponse(
        'search_merchant',
        rows,
        { merchant: 'MCDONALDS', account_id: 'acc-bt' },
        ctx
      );
      expect(out.text).toContain('2 tranzacții');
      expect(out.text).toContain('MCDONALDS');
      expect(out.text).toContain('BT_curent_ron');
      expect(out.text).toMatch(/67[,.]50.*RON/);
      expect(out.evidence).toHaveLength(2);
      expect(out.evidence[0].kind).toBe('transaction');
    });
    it('empty result', () => {
      const out = formatResponse('search_merchant', [], { merchant: 'PIZZAHUT' }, ctx);
      expect(out.text).toContain('Nu am găsit');
      expect(out.text).toContain('PIZZAHUT');
      expect(out.evidence).toEqual([]);
    });
    it('text reflects row sum exactly (anti-halucinare)', () => {
      const rows = [
        {
          id: 't1',
          date: '2026-03-01',
          amount: -10,
          amount_ron: -10,
          merchant: 'X',
          account_id: 'acc-bt',
          category_id: null,
          description: null,
        },
        {
          id: 't2',
          date: '2026-03-02',
          amount: -7.33,
          amount_ron: -7.33,
          merchant: 'X',
          account_id: 'acc-bt',
          category_id: null,
          description: null,
        },
        {
          id: 't3',
          date: '2026-03-03',
          amount: -2,
          amount_ron: -2,
          merchant: 'X',
          account_id: 'acc-bt',
          category_id: null,
          description: null,
        },
      ];
      const out = formatResponse('search_merchant', rows, { merchant: 'X' }, ctx);
      const m = out.text.match(/(\d+[,.]?\d*)\s+RON/);
      expect(m).not.toBeNull();
      const reported = parseFloat(m![1].replace(',', '.'));
      const actual = rows.reduce((s, r) => s + Math.abs(r.amount_ron), 0);
      expect(Math.abs(reported - actual)).toBeLessThan(0.01);
    });
  });

  describe('list_accounts', () => {
    it('happy path', () => {
      const rows = [
        {
          id: 'acc-bt',
          name: 'BT_curent_ron',
          type: 'bank',
          currency: 'RON',
          initial_balance: 1000,
        },
        { id: 'acc-cash', name: 'Cash', type: 'cash', currency: 'RON', initial_balance: 0 },
      ];
      const out = formatResponse('list_accounts', rows, {}, ctx);
      expect(out.text).toContain('2 conturi');
      expect(out.text).toContain('BT_curent_ron');
      expect(out.text).toContain('Cash');
      expect(out.evidence).toHaveLength(2);
      expect(out.evidence[0].kind).toBe('account');
    });
    it('empty', () => {
      const out = formatResponse('list_accounts', [], {}, ctx);
      expect(out.text).toContain('Nu ai niciun cont');
    });
  });

  describe('top_merchants', () => {
    it('happy path', () => {
      const rows = [
        { merchant: 'LIDL', total: -450, count: 12 },
        { merchant: 'KAUFLAND', total: -300, count: 8 },
        { merchant: 'MEGA', total: -150, count: 5 },
      ];
      const out = formatResponse('top_merchants', rows, {}, ctx);
      expect(out.text).toContain('LIDL');
      expect(out.text).toMatch(/450.*RON/);
      expect(out.evidence).toHaveLength(3);
      expect(out.evidence[0].kind).toBe('aggregate');
    });
    it('empty', () => {
      const out = formatResponse('top_merchants', [], {}, ctx);
      expect(out.text).toContain('Nu am găsit');
    });
  });

  describe('cannot_answer', () => {
    it('passes explanation through as the user-facing text', () => {
      const out = formatResponse(
        'cannot_answer',
        [],
        { explanation_short: 'Nu am date despre crypto.' },
        ctx
      );
      expect(out.text).toContain('Nu am date despre crypto');
      expect(out.evidence).toEqual([]);
    });
  });
});

describe('spend_total', () => {
  const ctx = {
    accounts: new Map([['acc-bt', { id: 'acc-bt', name: 'BT_curent_ron', type: 'bank' }]]),
    categories: new Map(),
  };

  it('compune sumă + filtre în text și evidence', () => {
    const rows = [{ total: 412.5, count: 7 }];
    const out = formatResponse(
      'spend_total',
      rows,
      { label: 'carburant', period_label: '1–20 iunie 2026', account_name: 'BT_curent_ron' },
      ctx
    );
    expect(out.text).toContain('412,50 RON');
    expect(out.text).toContain('carburant');
    expect(out.text).toContain('BT_curent_ron');
    expect(out.text).toContain('1–20 iunie 2026');
    expect(out.text).toContain('7 tranzacții');
    expect(out.evidence).toEqual([
      { kind: 'aggregate', label: 'carburant', period: '1–20 iunie 2026', total: 412.5, count: 7 },
    ]);
  });

  it('rezolvă numele contului din account_id când lipsește account_name', () => {
    const out = formatResponse(
      'spend_total',
      [{ total: 100, count: 1 }],
      { account_id: 'acc-bt' },
      ctx
    );
    expect(out.text).toContain('BT_curent_ron');
  });

  it('SUM negativ e afișat ca valoare absolută', () => {
    const out = formatResponse('spend_total', [{ total: -412.5, count: 7 }], {}, ctx);
    expect(out.text).toContain('412,50 RON');
  });

  it('zero rânduri repetă filtrele cerute, nu raportează eroare', () => {
    const out = formatResponse(
      'spend_total',
      [],
      { label: 'carburant', account_name: 'BT_curent_ron', period_label: 'iunie 2026' },
      ctx
    );
    expect(out.text).toContain('Nu ai cheltuieli');
    expect(out.text).toContain('carburant');
    expect(out.text).toContain('BT_curent_ron');
    expect(out.evidence).toEqual([]);
  });

  it('SUM NULL (rând agregat fără potriviri) e tratat ca zero rânduri', () => {
    const out = formatResponse(
      'spend_total',
      [{ total: null, count: 0 }],
      { label: 'carburant' },
      ctx
    );
    expect(out.text).toContain('Nu ai cheltuieli');
  });
});

describe('top_spending', () => {
  const ctx = { accounts: new Map(), categories: new Map() };

  it('randează ambele secțiuni, sortate cum vin din SQL', () => {
    const rows = [
      { dim: 'category', label: 'Casă', total: -3200, count: 12 },
      { dim: 'category', label: 'Mâncare', total: -1850, count: 40 },
      { dim: 'merchant', label: 'Lidl', total: -900, count: 15 },
      { dim: 'merchant', label: 'OMV', total: -620, count: 8 },
    ];
    const out = formatResponse('top_spending', rows, { period_label: 'mai 2026' }, ctx);
    expect(out.text).toContain('mai 2026');
    expect(out.text).toContain('Pe categorii');
    expect(out.text).toContain('De unde');
    expect(out.text).toContain('1. **Casă** — 3.200,00 RON (12 tranz.)');
    expect(out.text).toContain('1. **Lidl** — 900,00 RON (15 tranz.)');
    expect(out.evidence).toHaveLength(4);
  });

  it('taie fiecare secțiune la 5 intrări', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      dim: 'category',
      label: `C${i}`,
      total: -(100 - i),
      count: 1,
    }));
    const out = formatResponse('top_spending', rows, {}, ctx);
    expect(out.text).toContain('C4');
    expect(out.text).not.toContain('C5');
    expect(out.evidence).toHaveLength(5);
  });

  it('o singură secțiune când SQL întoarce un singur dim', () => {
    const rows = [{ dim: 'category', label: 'Casă', total: -100, count: 2 }];
    const out = formatResponse('top_spending', rows, {}, ctx);
    expect(out.text).toContain('Pe categorii');
    expect(out.text).not.toContain('De unde');
  });

  it('fallback pe listă unică dacă modelul omite coloana dim', () => {
    const rows = [{ label: 'Casă', total: -100, count: 2 }];
    const out = formatResponse('top_spending', rows, {}, ctx);
    expect(out.text).toContain('Top cheltuieli');
    expect(out.text).toContain('Casă');
    expect(out.evidence).toHaveLength(1);
  });

  it('zero rânduri → mesaj explicit cu perioada', () => {
    const out = formatResponse('top_spending', [], { period_label: 'mai 2026' }, ctx);
    expect(out.text).toContain('Nu am găsit cheltuieli');
    expect(out.text).toContain('mai 2026');
    expect(out.evidence).toEqual([]);
  });
});

describe('account_balance', () => {
  const ctx = { accounts: new Map(), categories: new Map() };

  it('un singur cont — sold în valuta contului', () => {
    const out = formatResponse(
      'account_balance',
      [{ name: 'BT_curent_ron', currency: 'RON', balance: 1234.5 }],
      {},
      ctx
    );
    expect(out.text).toContain('BT_curent_ron');
    expect(out.text).toContain('1.234,50 RON');
    expect(out.evidence).toHaveLength(1);
  });

  it('sold negativ nu e afișat ca valoare absolută', () => {
    const out = formatResponse(
      'account_balance',
      [{ name: 'Card credit', currency: 'RON', balance: -320 }],
      {},
      ctx
    );
    expect(out.text).toContain('-320,00 RON');
  });

  it('mai multe conturi, fiecare în valuta lui', () => {
    const out = formatResponse(
      'account_balance',
      [
        { name: 'BT RON', currency: 'RON', balance: 100 },
        { name: 'Revolut', currency: 'EUR', balance: 50 },
      ],
      {},
      ctx
    );
    expect(out.text).toContain('100,00 RON');
    expect(out.text).toContain('50,00 EUR');
    expect(out.evidence).toHaveLength(2);
  });

  it('zero rânduri → mesaj explicit', () => {
    const out = formatResponse('account_balance', [], {}, ctx);
    expect(out.text).toContain('Nu am găsit conturi');
  });
});
