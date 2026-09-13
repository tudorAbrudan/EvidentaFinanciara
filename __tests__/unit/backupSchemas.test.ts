import {
  AccountSchema,
  BackupEnvelopeSchema,
  FxRateSchema,
  StatementSchema,
  TransactionSchema,
  validateItem,
} from '@/services/backupSchemas';

describe('backupSchemas', () => {
  it('acceptă un cont valid', () => {
    const r = validateItem(AccountSchema, {
      id: 'a1',
      name: 'BT',
      type: 'bank',
      currency: 'RON',
      initial_balance: 100.5,
    });
    expect(r.ok).toBe(true);
  });

  it('respinge un sold scris ca text, în loc să-l coerciteze tăcut', () => {
    const r = validateItem(AccountSchema, { name: 'BT', initial_balance: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('initial_balance');
  });

  it('acceptă boolean-uri scrise ca 0/1, cum le scrie SQLite', () => {
    expect(validateItem(AccountSchema, { name: 'BT', archived: 1 }).ok).toBe(true);
    expect(validateItem(TransactionSchema, { amount: -5, is_refund: 0 }).ok).toBe(true);
    expect(validateItem(TransactionSchema, { amount: -5, is_refund: true }).ok).toBe(true);
  });

  it('respinge un flag cu valoare aberantă', () => {
    expect(validateItem(TransactionSchema, { amount: -5, is_refund: 7 }).ok).toBe(false);
  });

  it('ignoră câmpurile necunoscute — backup mai nou în app mai veche', () => {
    const r = validateItem(AccountSchema, { name: 'BT', camp_nou_din_viitor: 'x' });
    expect(r.ok).toBe(true);
  });

  it('amount_ron acceptă null (tranzacție în valută fără curs)', () => {
    expect(validateItem(TransactionSchema, { amount: -5, amount_ron: null }).ok).toBe(true);
  });

  it('cursul valutar cere date, valută și rată', () => {
    expect(validateItem(FxRateSchema, { date: '2026-05-01', currency: 'EUR', rate: 4.97 }).ok).toBe(
      true
    );
    expect(validateItem(FxRateSchema, { date: '2026-05-01', currency: 'EUR' }).ok).toBe(false);
    expect(
      validateItem(FxRateSchema, { date: '2026-05-01', currency: 'EUR', rate: '4.97' }).ok
    ).toBe(false);
  });

  it('anvelopa cere app și version de tipul corect', () => {
    expect(BackupEnvelopeSchema.safeParse({ app: 'x', version: 1 }).success).toBe(true);
    expect(BackupEnvelopeSchema.safeParse({ app: 'x', version: '1' }).success).toBe(false);
    expect(BackupEnvelopeSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('respinge valori care nu sunt obiecte', () => {
    expect(validateItem(AccountSchema, null).ok).toBe(false);
    expect(validateItem(AccountSchema, 'text').ok).toBe(false);
    expect(validateItem(AccountSchema, 42).ok).toBe(false);
  });

  it('extras cu perioada din antet și soldurile băncii', () => {
    const r = validateItem(StatementSchema, {
      account_id: 'a1',
      period_from: '2026-06-01',
      period_to: '2026-06-30',
      period_source: 'header',
      opening_balance: 298.15,
      closing_balance: 2120.31,
    });
    expect(r.ok).toBe(true);
  });

  it('extras din backup vechi, fără câmpurile noi, rămâne valid', () => {
    const r = validateItem(StatementSchema, {
      account_id: 'a1',
      period_from: '2026-06-03',
      period_to: '2026-06-28',
    });
    expect(r.ok).toBe(true);
  });

  it('o sursă de perioadă necunoscută nu aruncă extrasul din backup', () => {
    // Importul o mapează la `inferred`; a respinge tot extrasul ar pierde mai mult.
    const r = validateItem(StatementSchema, {
      account_id: 'a1',
      period_from: '2026-06-01',
      period_to: '2026-06-30',
      period_source: 'ghicit',
    });
    expect(r.ok).toBe(true);
  });
});
