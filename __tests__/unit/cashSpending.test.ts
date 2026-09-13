import {
  computeCashWithdrawals,
  loadCashBreakdownAdjustment,
  CASH_WITHDRAWN_CATEGORY_ID,
} from '@/services/cashSpending';
import * as db from '@/services/db';
import * as accounts from '@/services/financialAccounts';
import type { FinancialAccount, Transaction } from '@/types';

jest.mock('@/services/db', () => ({
  __esModule: true,
  db: { getAllAsync: jest.fn(), getFirstAsync: jest.fn(), runAsync: jest.fn() },
  generateId: () => 'test-id',
}));

jest.mock('@/services/financialAccounts', () => ({
  __esModule: true,
  getFinancialAccounts: jest.fn(),
}));

function account(over: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: 'bank',
    name: 'BT RON',
    type: 'bank',
    currency: 'RON',
    initial_balance: 0,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const ACCOUNTS = [account(), account({ id: 'cash', name: 'Numerar', type: 'cash' })];

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    account_id: 'bank',
    date: '2026-08-10',
    amount: -100,
    currency: 'RON',
    source: 'statement',
    is_internal_transfer: false,
    is_refund: false,
    cash_suggestion_dismissed: false,
    category_learned: false,
    createdAt: '2026-08-10T00:00:00.000Z',
    ...over,
  };
}

/** Perechea creată de „convertToTransfer": banca scade, contul cash crește. */
function converted(amount: number, id: string, date = '2026-08-05'): Transaction[] {
  return [
    tx({ id: `${id}-out`, account_id: 'bank', amount: -amount, date, is_internal_transfer: true }),
    tx({ id: `${id}-in`, account_id: 'cash', amount, date, is_internal_transfer: true }),
  ];
}

describe('computeCashWithdrawals', () => {
  it('retragerea convertită în transfer se adaugă la cheltuieli', () => {
    // Azi dispare complet din agregări: e transfer intern.
    const result = computeCashWithdrawals(converted(500, 'w1'), ACCOUNTS, '2026-08');
    expect(result.added_ron).toBe(500);
    expect(result.relocated_ron).toBe(0);
    expect(result.total_ron).toBe(500);
  });

  it('depunerile înapoi la bancă scad numerarul scos', () => {
    const txs = [
      ...converted(500, 'w1'),
      // Userul duce 200 înapoi: ies din contul cash, intră în bancă.
      tx({ id: 'b-out', account_id: 'cash', amount: -200, is_internal_transfer: true }),
      tx({ id: 'b-in', account_id: 'bank', amount: 200, is_internal_transfer: true }),
    ];
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').added_ron).toBe(300);
  });

  it('depunere înapoi mai mare decât retragerile dă 0, nu negativ', () => {
    const txs = [
      ...converted(100, 'w1'),
      tx({ id: 'b-out', account_id: 'cash', amount: -400, is_internal_transfer: true }),
    ];
    // Altfel numerarul ar apărea ca „venit", ceea ce nu e.
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').added_ron).toBe(0);
  });

  it('dacă userul notează cheltuieli pe contul cash, transferul rămâne neutru', () => {
    const txs = [
      ...converted(500, 'w1'),
      tx({ id: 'spent', account_id: 'cash', amount: -120, is_internal_transfer: false }),
    ];
    // Cheltuiala proprie se numără singură; adunarea transferului ar dubla banii.
    const result = computeCashWithdrawals(txs, ACCOUNTS, '2026-08');
    expect(result.added_ron).toBe(0);
    expect(result.total_ron).toBe(0);
  });

  it('retragerea neconvertită se mută, nu se adună a doua oară', () => {
    const txs = [tx({ id: 'atm', amount: -300, description: 'Retragere numerar ATM Bd. Unirii' })];
    const result = computeCashWithdrawals(txs, ACCOUNTS, '2026-08');
    expect(result.added_ron).toBe(0); // era deja cheltuială
    expect(result.relocated_ron).toBe(300);
    expect(result.relocated_tx_ids).toEqual(['atm']);
    expect(result.total_ron).toBe(300);
  });

  it('aceeași lună dă același total, convertită sau nu', () => {
    const convertita = computeCashWithdrawals(converted(300, 'w1'), ACCOUNTS, '2026-08');
    const neconvertita = computeCashWithdrawals(
      [tx({ id: 'atm', amount: -300, description: 'Ridicare numerar bancomat' })],
      ACCOUNTS,
      '2026-08'
    );
    // Scopul regulii: cifra nu depinde de dacă userul a acceptat sugestia.
    expect(convertita.total_ron).toBe(neconvertita.total_ron);
  });

  it('nu confundă o plată obișnuită cu o retragere', () => {
    const txs = [tx({ id: 'shop', amount: -300, description: 'Kaufland Bucuresti' })];
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').total_ron).toBe(0);
  });

  it('ignoră tranzacțiile din alte luni', () => {
    const txs = converted(500, 'w1', '2026-07-20');
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').total_ron).toBe(0);
  });

  it('ignoră duplicatele marcate', () => {
    const txs = [
      tx({ id: 'atm', amount: -300, description: 'Retragere ATM', duplicate_of_id: 'x' }),
    ];
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').total_ron).toBe(0);
  });

  it('sare peste valuta fără curs în loc să adune suma brută', () => {
    // 100 EUR fără curs nu sunt 100 RON; totalul devine incomplet, nu greșit.
    const txs = converted(0, 'w1').concat(
      tx({
        id: 'eur-in',
        account_id: 'cash',
        amount: 100,
        currency: 'EUR',
        amount_ron: undefined,
        is_internal_transfer: true,
      })
    );
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').added_ron).toBe(0);
  });

  it('folosește amount_ron când există', () => {
    const txs = [
      tx({
        id: 'eur-in',
        account_id: 'cash',
        amount: 100,
        currency: 'EUR',
        amount_ron: 498,
        is_internal_transfer: true,
      }),
    ];
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').added_ron).toBe(498);
  });

  it('fără conturi cash, doar retragerile neconvertite contează', () => {
    const doarBanca = [account()];
    const txs = [
      ...converted(500, 'w1'),
      tx({ id: 'atm', amount: -200, description: 'Retragere numerar' }),
    ];
    const result = computeCashWithdrawals(txs, doarBanca, '2026-08');
    expect(result.added_ron).toBe(0);
    expect(result.relocated_ron).toBe(200);
  });

  it('drilldown-ul acoperă și retragerile convertite, și pe cele mutate', () => {
    const txs = [
      ...converted(500, 'w1'),
      tx({ id: 'atm', amount: -200, description: 'Retragere numerar' }),
    ];
    const result = computeCashWithdrawals(txs, ACCOUNTS, '2026-08');
    // Fără ambele liste, cardul „Numerar retras" s-ar deschide într-o listă goală.
    expect(result.counted_tx_ids).toEqual(['w1-in']);
    expect(result.relocated_tx_ids).toEqual(['atm']);
  });

  it('contul cash cu cheltuieli proprii nu contribuie la drilldown', () => {
    const txs = [
      ...converted(500, 'w1'),
      tx({ id: 'spent', account_id: 'cash', amount: -120, is_internal_transfer: false }),
    ];
    expect(computeCashWithdrawals(txs, ACCOUNTS, '2026-08').counted_tx_ids).toEqual([]);
  });

  it('pseudo-categoria are id de sistem, fără rând în DB', () => {
    expect(CASH_WITHDRAWN_CATEGORY_ID).toBe('cat-sys-cash-withdrawn');
  });
});

/** Rândul brut, așa cum vine din SQLite (numere, nu booleeni). */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r1',
    account_id: 'bank',
    date: '2026-08-10',
    amount: -300,
    currency: 'RON',
    amount_ron: null,
    description: 'Retragere numerar ATM',
    merchant: null,
    category_id: 'cat-food',
    source: 'statement',
    statement_id: null,
    is_internal_transfer: 0,
    linked_transaction_id: null,
    is_refund: 0,
    duplicate_of_id: null,
    cash_suggestion_dismissed: 0,
    category_learned: 0,
    notes: null,
    created_at: '2026-08-10T00:00:00.000Z',
    ...over,
  };
}

describe('loadCashBreakdownAdjustment', () => {
  beforeEach(() => {
    (db.db.getAllAsync as jest.Mock).mockReset();
    (accounts.getFinancialAccounts as jest.Mock).mockReset();
    (accounts.getFinancialAccounts as jest.Mock).mockResolvedValue(ACCOUNTS);
  });

  it('scade retragerea din categoria ei originală', async () => {
    // Altfel aceiași 300 de lei ar aparea de doua ori in breakdown: o data la
    // Mancare, o data la Numerar retras, iar suma categoriilor n-ar mai da totalul.
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([row()]);
    const result = await loadCashBreakdownAdjustment('2026-08');
    expect(result.total_ron).toBe(300);
    expect(result.count).toBe(1);
    expect(result.deductions).toEqual([{ category_id: 'cat-food', amount_ron: 300, count: 1 }]);
  });

  it('retragerea necategorizată se scade din „Necategorizat"', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([row({ category_id: null })]);
    const result = await loadCashBreakdownAdjustment('2026-08');
    expect(result.deductions).toEqual([{ category_id: null, amount_ron: 300, count: 1 }]);
  });

  it('retragerea convertită se adaugă, dar nu se scade din nicio categorie', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([
      row({ id: 'out', amount: -500, is_internal_transfer: 1, description: 'Retragere' }),
      row({
        id: 'in',
        account_id: 'cash',
        amount: 500,
        is_internal_transfer: 1,
        description: 'Retragere',
      }),
    ]);
    const result = await loadCashBreakdownAdjustment('2026-08');
    expect(result.total_ron).toBe(500);
    expect(result.deductions).toEqual([]); // nu era în nicio categorie de cheltuieli
  });

  it('fără numerar, nu cere nicio ajustare', async () => {
    (db.db.getAllAsync as jest.Mock).mockResolvedValue([
      row({ description: 'Kaufland', category_id: 'cat-food' }),
    ]);
    const result = await loadCashBreakdownAdjustment('2026-08');
    expect(result.total_ron).toBe(0);
    expect(result.deductions).toEqual([]);
  });
});
