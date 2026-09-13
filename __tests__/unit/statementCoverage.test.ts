import {
  describeIncompleteMonth,
  findCoverageGaps,
  formatMonthLabel,
  isMonthComplete,
  lastClosedMonthYM,
  monthStatus,
} from '@/services/statementCoverage';
import type { BankStatement, FinancialAccount } from '@/types';

function account(over: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: 'acc-ron',
    name: 'BT RON',
    type: 'bank',
    currency: 'RON',
    initial_balance: 0,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function statement(from: string, to: string, over: Partial<BankStatement> = {}): BankStatement {
  return {
    id: `st-${from}`,
    account_id: 'acc-ron',
    period_from: from,
    period_to: to,
    period_source: 'header',
    imported_at: '2026-09-01T00:00:00.000Z',
    transaction_count: 10,
    total_inflow: 0,
    total_outflow: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

// Azi = septembrie 2026, deci ultima lună închisă e august.
const TODAY = new Date(Date.UTC(2026, 8, 15));

describe('lastClosedMonthYM', () => {
  it('ia luna dinaintea celei curente', () => {
    expect(lastClosedMonthYM(TODAY)).toBe('2026-08');
    expect(lastClosedMonthYM(new Date(Date.UTC(2026, 0, 3)))).toBe('2025-12');
  });
});

describe('findCoverageGaps', () => {
  it('extras cu perioada din antet acoperă luna, deși tranzacțiile încep mai târziu', () => {
    // Cazul care ar fi alertat fals la fiecare lună: antet 01–30, plăți 03–28.
    const report = findCoverageGaps([account()], [statement('2026-08-01', '2026-08-31')], TODAY);
    const cov = report.accounts[0];
    expect(cov?.missing_months).toEqual([]);
    expect(cov?.partial_gaps).toEqual([]);
    expect(cov?.last_covered_to).toBe('2026-08-31');
  });

  it('raportează luna sărită dintre două importuri', () => {
    const report = findCoverageGaps(
      [account()],
      [statement('2026-06-01', '2026-06-30'), statement('2026-08-01', '2026-08-31')],
      TODAY
    );
    expect(report.accounts[0]?.missing_months).toEqual(['2026-07']);
    expect(report.accounts[0]?.messages[0]).toBe('Lipsește extrasul pe iulie 2026.');
  });

  it('prinde extrasul exportat înainte de sfârșitul lunii', () => {
    // 29–31 august nu apar în niciun extras: tranzacții pierdute, nu formalitate.
    const report = findCoverageGaps(
      [account()],
      [
        statement('2026-07-01', '2026-07-31'),
        statement('2026-08-01', '2026-08-28'), // exportat înainte de sfârșitul lunii
        statement('2026-09-01', '2026-09-30'),
      ],
      new Date(Date.UTC(2026, 9, 5)) // octombrie → septembrie e ultima lună închisă
    );
    const gaps = report.accounts[0]?.partial_gaps ?? [];
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.from).toBe('2026-08-29');
    expect(gaps[0]?.to).toBe('2026-08-31');
    expect(gaps[0]?.days).toBe(3);
    expect(gaps[0]?.message).toBe(
      'Extrasul din august se oprește pe 28; lipsesc 29–31 august. Re-exportă luna întreagă.'
    );
    expect(report.accounts[0]?.missing_months).toEqual([]);
  });

  it('un rând vechi `inferred` care acoperă aproape toată luna nu produce gol', () => {
    const report = findCoverageGaps(
      [account()],
      [statement('2026-08-02', '2026-08-29', { period_source: 'inferred' })],
      TODAY
    );
    expect(report.accounts[0]?.missing_months).toEqual([]);
    expect(report.accounts[0]?.partial_gaps).toEqual([]);
    expect(report.accounts[0]?.uncovered_days_by_month['2026-08']).toBe(0);
  });

  it('un `inferred` scurt rămâne cum e, deci luna apare ca lipsă', () => {
    const report = findCoverageGaps(
      [account()],
      [statement('2026-08-10', '2026-08-14', { period_source: 'inferred' })],
      TODAY
    );
    expect(report.accounts[0]?.missing_months).toEqual(['2026-08']);
  });

  it('lipește intervalele despărțite de cel mult o zi', () => {
    const report = findCoverageGaps(
      [account()],
      [
        statement('2026-08-01', '2026-08-14'),
        statement('2026-08-16', '2026-08-31'), // 15 august lipsește: o zi
      ],
      TODAY
    );
    expect(report.accounts[0]?.partial_gaps).toEqual([]);
    expect(report.accounts[0]?.missing_months).toEqual([]);
  });

  it('ignoră golurile sub trei zile, le raportează de la trei în sus', () => {
    const douaZile = findCoverageGaps(
      [account()],
      [
        statement('2026-08-01', '2026-08-14'),
        statement('2026-08-17', '2026-08-31'), // 15–16
      ],
      TODAY
    );
    expect(douaZile.accounts[0]?.partial_gaps).toEqual([]);

    const treiZile = findCoverageGaps(
      [account()],
      [
        statement('2026-08-01', '2026-08-14'),
        statement('2026-08-18', '2026-08-31'), // 15–17
      ],
      TODAY
    );
    expect(treiZile.accounts[0]?.partial_gaps).toHaveLength(1);
    expect(treiZile.accounts[0]?.partial_gaps[0]?.message).toBe(
      'Extrasul din august se oprește pe 14; lipsesc 15–17 august. Re-exportă luna întreagă.'
    );
  });

  it('nu verifică nimic înainte de primul extras al contului', () => {
    // Fereastra începe la primul extras: lunile de dinainte nu erau așteptate.
    const report = findCoverageGaps([account()], [statement('2026-08-01', '2026-08-31')], TODAY);
    expect(report.accounts[0]?.uncovered_days_by_month['2026-07']).toBeUndefined();
  });

  it('nu cere extras pentru luna curentă', () => {
    const report = findCoverageGaps([account()], [statement('2026-08-01', '2026-08-31')], TODAY);
    expect(report.accounts[0]?.uncovered_days_by_month['2026-09']).toBeUndefined();
    expect(report.last_closed_month).toBe('2026-08');
  });

  it('cont cu extrase doar în luna curentă nu e reproșat', () => {
    const report = findCoverageGaps([account()], [statement('2026-09-01', '2026-09-10')], TODAY);
    expect(report.accounts[0]?.missing_months).toEqual([]);
    expect(report.accounts[0]?.uncovered_days_by_month).toEqual({});
  });

  it('sare peste conturi arhivate, numerar, fără extrase sau tăcute', () => {
    const arhivat = account({ id: 'a1', name: 'Vechi', archived: true });
    const numerar = account({ id: 'a2', name: 'Cash', type: 'cash' });
    const faraExtrase = account({ id: 'a3', name: 'Economii', type: 'savings' });
    const tacut = account({ id: 'a4', name: 'BT EUR', currency: 'EUR' });
    const statements = [
      statement('2026-06-01', '2026-06-30', { account_id: 'a1' }),
      statement('2026-06-01', '2026-06-30', { account_id: 'a2' }),
      statement('2026-06-01', '2026-06-30', { account_id: 'a4' }),
    ];

    const report = findCoverageGaps([arhivat, numerar, faraExtrase, tacut], statements, TODAY, [
      'a4',
    ]);
    expect(report.accounts).toEqual([]);
  });

  it('ignoră extrasele cu date imposibile', () => {
    const report = findCoverageGaps(
      [account()],
      [
        statement('2026-08-31', '2026-08-01'), // inversat
        statement('nu-i data', '2026-08-31'),
        statement('2026-08-01', '2026-08-31'),
      ],
      TODAY
    );
    expect(report.accounts[0]?.missing_months).toEqual([]);
    expect(report.accounts[0]?.last_covered_to).toBe('2026-08-31');
  });
});

describe('isMonthComplete', () => {
  const ron = account({ id: 'ron', name: 'BT RON' });
  const eur = account({ id: 'eur', name: 'BT EUR', currency: 'EUR' });

  it('cere extrasul de la toate conturile care așteptau luna', () => {
    const report = findCoverageGaps(
      [ron, eur],
      [
        statement('2026-07-01', '2026-07-31', { account_id: 'ron' }),
        statement('2026-08-01', '2026-08-31', { account_id: 'ron' }),
        statement('2026-07-01', '2026-07-31', { account_id: 'eur' }),
        // Pe august, BT EUR lipsește.
      ],
      TODAY
    );
    expect(isMonthComplete(report, '2026-07')).toBe(true);
    expect(isMonthComplete(report, '2026-08')).toBe(false);
    expect(report.accounts.find(a => a.account_id === 'eur')?.missing_months).toEqual(['2026-08']);
  });

  it('luna curentă și cele viitoare nu sunt niciodată complete', () => {
    const report = findCoverageGaps(
      [ron],
      [statement('2026-08-01', '2026-08-31', { account_id: 'ron' })],
      TODAY
    );
    expect(isMonthComplete(report, '2026-09')).toBe(false);
  });

  it('fără conturi care să aștepte luna, răspunsul e „nu"', () => {
    const report = findCoverageGaps([], [], TODAY);
    expect(isMonthComplete(report, '2026-08')).toBe(false);
  });

  it('un gol parțial lasă luna incompletă', () => {
    const report = findCoverageGaps(
      [ron],
      [statement('2026-08-01', '2026-08-24', { account_id: 'ron' })],
      TODAY
    );
    expect(isMonthComplete(report, '2026-08')).toBe(false);
  });
});

describe('monthStatus', () => {
  const ron = account({ id: 'ron', name: 'BT RON' });
  const eur = account({ id: 'eur', name: 'BT EUR', currency: 'EUR' });

  it('spune ce cont acoperă luna și care lipsește', () => {
    const report = findCoverageGaps(
      [ron, eur],
      [
        statement('2026-07-01', '2026-07-31', { account_id: 'ron' }),
        statement('2026-08-01', '2026-08-31', { account_id: 'ron' }),
        statement('2026-07-01', '2026-07-31', { account_id: 'eur' }),
      ],
      TODAY
    );
    expect(monthStatus(report, '2026-08')).toEqual([
      { account_id: 'ron', account_name: 'BT RON', covered: true },
      { account_id: 'eur', account_name: 'BT EUR', covered: false },
    ]);
  });

  it('nu pomenește conturile care nu așteptau luna', () => {
    const report = findCoverageGaps(
      [ron, eur],
      [
        statement('2026-07-01', '2026-08-31', { account_id: 'ron' }),
        // BT EUR intră în verificare abia din august.
        statement('2026-08-01', '2026-08-31', { account_id: 'eur' }),
      ],
      TODAY
    );
    expect(monthStatus(report, '2026-07').map(s => s.account_id)).toEqual(['ron']);
  });
});

describe('describeIncompleteMonth', () => {
  const ron = account({ id: 'ron', name: 'BT RON' });
  const eur = account({ id: 'eur', name: 'BT EUR', currency: 'EUR' });

  it('tace când luna e acoperită de toate conturile', () => {
    const report = findCoverageGaps(
      [ron],
      [statement('2026-08-01', '2026-08-31', { account_id: 'ron' })],
      TODAY
    );
    expect(describeIncompleteMonth(report, '2026-08')).toBeNull();
  });

  it('numește contul căruia îi lipsește extrasul', () => {
    const report = findCoverageGaps(
      [ron, eur],
      [
        statement('2026-07-01', '2026-08-31', { account_id: 'ron' }),
        statement('2026-07-01', '2026-07-31', { account_id: 'eur' }),
      ],
      TODAY
    );
    expect(describeIncompleteMonth(report, '2026-08')).toBe(
      'Lipsește extrasul pentru BT EUR. Cifrele pe august 2026 sunt parțiale.'
    );
  });

  it('spune că luna curentă nu s-a încheiat', () => {
    const report = findCoverageGaps(
      [ron],
      [statement('2026-08-01', '2026-08-31', { account_id: 'ron' })],
      TODAY
    );
    expect(describeIncompleteMonth(report, '2026-09')).toBe(
      'Septembrie 2026 nu s-a încheiat — cifrele se completează după importul extraselor.'
    );
  });

  it('tace pentru userul care nu importă extrase deloc', () => {
    // Fără niciun extras nu există „lipsă": nu ține evidența așa.
    const report = findCoverageGaps([ron, eur], [], TODAY);
    expect(describeIncompleteMonth(report, '2026-08')).toBeNull();
  });
});

describe('formatMonthLabel', () => {
  it('scrie luna în română', () => {
    expect(formatMonthLabel('2026-08')).toBe('august 2026');
    expect(formatMonthLabel('2026-01')).toBe('ianuarie 2026');
  });
});
