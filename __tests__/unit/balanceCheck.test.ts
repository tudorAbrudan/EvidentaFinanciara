import { diagnoseBalance } from '@/services/balanceCheck';
import type { BankStatement, FinancialAccount, Transaction } from '@/types';

function account(over: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: 'acc',
    name: 'BT RON',
    type: 'bank',
    currency: 'RON',
    initial_balance: 1000,
    initial_balance_date: '2026-07-01',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function statement(over: Partial<BankStatement> = {}): BankStatement {
  return {
    id: 'st-08',
    account_id: 'acc',
    period_from: '2026-08-01',
    period_to: '2026-08-31',
    period_source: 'header',
    opening_balance: 1000,
    closing_balance: 900,
    imported_at: '2026-09-01T00:00:00.000Z',
    transaction_count: 2,
    total_inflow: 0,
    total_outflow: 100,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    account_id: 'acc',
    date: '2026-08-10',
    amount: -50,
    currency: 'RON',
    source: 'statement',
    statement_id: 'st-08',
    is_internal_transfer: false,
    is_refund: false,
    cash_suggestion_dismissed: false,
    category_learned: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** Două cheltuieli de 50 în august: 1000 → 900, exact ca extrasul. */
const txsComplete = [tx({ id: 't1', date: '2026-08-10' }), tx({ id: 't2', date: '2026-08-20' })];

describe('diagnoseBalance', () => {
  it('extras cu toate tranzacțiile → ok', () => {
    const result = diagnoseBalance(statement(), txsComplete, account());
    expect(result.diagnosis).toBe('ok');
    expect(result.closing_diff).toBe(0);
    expect(result.message).toContain('se potrivește');
  });

  it('extras fără solduri tipărite → nu afirmă nimic', () => {
    const result = diagnoseBalance(
      statement({ opening_balance: undefined, closing_balance: undefined }),
      txsComplete,
      account()
    );
    expect(result.diagnosis).toBe('unverifiable');
    expect(result.closing_diff).toBeNull();
  });

  it('sold inițial greșit cu 100 → before_statement', () => {
    const result = diagnoseBalance(statement(), txsComplete, account({ initial_balance: 900 }));
    expect(result.diagnosis).toBe('before_statement');
    expect(result.opening_diff).toBe(100);
    expect(result.message).toContain('vine dinainte de acest extras');
  });

  it('corectarea soldului inițial aduce diagnosticul la ok', () => {
    const result = diagnoseBalance(statement(), txsComplete, account({ initial_balance: 1000 }));
    expect(result.diagnosis).toBe('ok');
  });

  it('o tranzacție marcată duplicat cu exact suma diferenței → o numește', () => {
    // A doua tranzacție e marcată duplicat, deci aplicația o scoate din sold:
    // aplicația ajunge la 950, extrasul spune 900. Diferența = −50, adică ea.
    const txs = [tx({ id: 't1' }), tx({ id: 't2', date: '2026-08-20', duplicate_of_id: 't1' })];
    const result = diagnoseBalance(statement(), txs, account());
    expect(result.diagnosis).toBe('inside_statement');
    expect(result.closing_diff).toBe(-50);
    expect(result.duplicate_suspect).toEqual({ id: 't2', date: '2026-08-20', amount: -50 });
    expect(result.message).toContain('marcată ca duplicat');
  });

  it('tranzacții șterse după import → numărul lipsă e corect', () => {
    // Importul a adus 3, în DB mai sunt 1.
    const result = diagnoseBalance(
      statement({ transaction_count: 3, closing_balance: 850 }),
      [tx({ id: 't1' })],
      account()
    );
    expect(result.diagnosis).toBe('inside_statement');
    expect(result.missing_transactions).toBe(2);
    expect(result.message).toContain('lipsesc 2 tranzacții');
  });

  it('nicio cauză identificabilă → propune re-importul', () => {
    // O sumă editată manual: numărul de tranzacții e corect, niciun duplicat.
    const txs = [tx({ id: 't1', amount: -70 }), tx({ id: 't2', date: '2026-08-20' })];
    const result = diagnoseBalance(statement(), txs, account());
    expect(result.diagnosis).toBe('inside_statement');
    expect(result.duplicate_suspect).toBeNull();
    expect(result.missing_transactions).toBe(0);
    expect(result.message).toContain('Re-importă extrasul');
  });

  it('contul EUR se compară în EUR, nu în RON', () => {
    const eur = account({ currency: 'EUR', initial_balance: 500, name: 'BT EUR' });
    const st = statement({ opening_balance: 500, closing_balance: 400 });
    const txs = [
      tx({ id: 't1', currency: 'EUR', amount: -50 }),
      tx({ id: 't2', currency: 'EUR', amount: -50, date: '2026-08-20' }),
    ];
    const result = diagnoseBalance(st, txs, eur);
    expect(result.diagnosis).toBe('ok');
    expect(result.message).toContain('EUR');
  });

  it('soldul inițial cu dată ulterioară perioadei nu intră în calcul', () => {
    const later = account({ initial_balance_date: '2026-12-01' });
    const result = diagnoseBalance(statement(), txsComplete, later);
    // Fără soldul inițial, aplicația pornește de la 0: capătul de început nu bate.
    expect(result.diagnosis).toBe('before_statement');
    expect(result.app_opening).toBe(0);
  });

  it('tranzacțiile de dinaintea extrasului intră în soldul de început', () => {
    const txs = [tx({ id: 't0', date: '2026-07-15', amount: -200 }), ...txsComplete];
    const result = diagnoseBalance(statement(), txs, account());
    // 1000 − 200 = 800 la 31 iulie, dar extrasul pornește de la 1000.
    expect(result.app_opening).toBe(800);
    expect(result.diagnosis).toBe('before_statement');
  });

  it('formatează sumele românește, cu separator de mii', () => {
    const result = diagnoseBalance(
      statement({ closing_balance: 4215.3 }),
      txsComplete,
      account({ initial_balance: 1000 })
    );
    expect(result.message).toContain('4.215,30');
  });
});
