import { detectCashWithdrawal } from '@/services/cashSuggestion';
import type { Transaction } from '@/types';

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    date: '2026-05-01',
    amount: -500,
    currency: 'RON',
    source: 'manual',
    is_internal_transfer: false,
    is_refund: false,
    cash_suggestion_dismissed: false,
    createdAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('detectCashWithdrawal', () => {
  it.each([
    ['RETRAGERE NUMERAR ATM BCR BUCURESTI', null],
    ['retragere atm', null],
    ['bancomat OTP', null],
    ['atm transilvania', null],
    [null, 'ATM Revolut'],
    ['cash withdrawal', null],
    ['extragere numerar', null],
    ['Extrăgere Numerar', null], // diacritice normalizate
  ])('detectează match pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectCashWithdrawal(tx)).toBe(true);
  });

  it.each([
    ['atmosferă restaurant', null],
    ['caratm SRL', null],
    ['cumpărare card MEGA IMAGE', null],
    [null, null], // gol
    ['', ''],
  ])('NU match pe %p / %p', (description, merchant) => {
    const tx = makeTx({
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });

  it('returnează false pentru tranzacții pozitive', () => {
    const tx = makeTx({ amount: 500, description: 'RETRAGERE ATM' });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });

  it('returnează false pentru transferuri interne (deja convertite)', () => {
    const tx = makeTx({ is_internal_transfer: true, description: 'ATM BCR' });
    expect(detectCashWithdrawal(tx)).toBe(false);
  });
});
