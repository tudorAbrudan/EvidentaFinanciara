/**
 * Expresii SQL pentru sumele în RON.
 *
 * De ce nu `COALESCE(amount_ron, amount)`: pentru o tranzacție non-RON al cărei
 * curs n-a putut fi obținut, `amount_ron` e NULL, iar COALESCE cade pe `amount`
 * — suma brută în valută — și o adună la un total în RON. 100 EUR intrau ca
 * 100 RON, tăcut. Că NULL-ul chiar apare o dovedește `countMissingRates()`.
 *
 * Varianta de aici întoarce NULL pentru non-RON fără curs, iar `SUM` sare peste
 * NULL-uri. Totalul devine *incomplet*, nu greșit — iar cine îl folosește
 * raportează separat câte tranzacții a sărit (vezi `missingRateCountSql`).
 */
export function amountRonSql(alias?: string): string {
  const p = alias ? `${alias}.` : '';
  return `CASE WHEN ${p}currency = 'RON' THEN ${p}amount ELSE ${p}amount_ron END`;
}

/** Numără tranzacțiile sărite din sumă fiindcă le lipsește cursul. */
export function missingRateCountSql(alias?: string): string {
  const p = alias ? `${alias}.` : '';
  return `SUM(CASE WHEN ${p}currency != 'RON' AND ${p}amount_ron IS NULL THEN 1 ELSE 0 END)`;
}

/**
 * O tranzacție intră la cheltuieli dacă e negativă SAU e o restituire.
 * Restituirea (`is_refund = 1`, sumă pozitivă) reduce cheltuiala pe categoria
 * ei, în loc să apară ca venit: cumperi 500, returnezi 100 → 400 cheltuiți.
 */
export const IS_EXPENSE_SQL = "(source != 'adjustment' AND (amount < 0 OR is_refund = 1))";

/** Venit real: pozitiv, care nu e restituire și nu e ajustare de sold. */
export const IS_INCOME_SQL = "(source != 'adjustment' AND amount > 0 AND is_refund = 0)";
