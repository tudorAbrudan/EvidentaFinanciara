import { z } from 'zod';

/**
 * Validare pentru fișierul de backup.
 *
 * `importBackup` făcea `JSON.parse` și apoi cast-uri TypeScript (`a.name as string`),
 * care la runtime nu verifică nimic: un `initial_balance: "abc"` ajungea direct în
 * baza de date. Scrierile sunt parametrizate, deci nu era SQL injection — dar era
 * coruperea tăcută a datelor dintr-un fișier venit din exterior.
 *
 * Reguli deliberate:
 * - Câmpurile necunoscute sunt ignorate, nu resping elementul: backup-urile mai noi
 *   trebuie să rămână importabile în versiuni mai vechi.
 * - Tipurile greșite resping *elementul*, care e raportat și sărit — nu abandonează
 *   tot importul, păstrând comportamentul per-element de azi.
 * - Nicio coerciție tăcută: un număr scris ca text e o eroare vizibilă, nu un 0 inventat.
 */

const id = z.string().min(1);
const optionalText = z.string().optional();
/** SQLite scrie boolean ca 0/1; backup-urile mai vechi pot avea ambele forme. */
const flexBool = z.union([z.boolean(), z.literal(0), z.literal(1)]).optional();

export const AccountSchema = z.object({
  id: id.optional(),
  name: z.string().optional(),
  type: optionalText,
  currency: optionalText,
  initial_balance: z.number().optional(),
  initial_balance_date: optionalText,
  iban: optionalText,
  bank_name: optionalText,
  color: optionalText,
  icon: optionalText,
  notes: optionalText,
  archived: flexBool,
});

export const CategorySchema = z.object({
  id: id.optional(),
  key: optionalText,
  name: z.string().optional(),
  icon: optionalText,
  color: optionalText,
  parent_id: optionalText,
  monthly_limit: z.number().optional(),
  display_order: z.number().optional(),
  archived: flexBool,
});

export const StatementSchema = z.object({
  id: id.optional(),
  account_id: optionalText,
  period_from: optionalText,
  period_to: optionalText,
  file_path: optionalText,
  file_hash: optionalText,
  imported_at: optionalText,
  transaction_count: z.number().optional(),
  total_inflow: z.number().optional(),
  total_outflow: z.number().optional(),
  notes: optionalText,
  /**
   * Apărute după primele backup-uri. Când lipsesc, perioada extrasului a fost
   * dedusă din tranzacții (`inferred`) și nu există solduri de comparat.
   *
   * Deliberat `string`, nu `enum`: o valoare necunoscută nu are voie să arunce
   * tot extrasul din backup. Importul o mapează la `inferred` — varianta
   * prudentă, care doar pierde informație.
   */
  period_source: optionalText,
  opening_balance: z.number().nullable().optional(),
  closing_balance: z.number().nullable().optional(),
});

export const TransactionSchema = z.object({
  id: id.optional(),
  account_id: optionalText,
  date: z.string().optional(),
  amount: z.number().optional(),
  currency: optionalText,
  amount_ron: z.number().nullable().optional(),
  description: optionalText,
  merchant: optionalText,
  category_id: optionalText,
  source: optionalText,
  statement_id: optionalText,
  is_internal_transfer: flexBool,
  linked_transaction_id: optionalText,
  is_refund: flexBool,
  duplicate_of_id: optionalText,
  notes: optionalText,
});

export const FxRateSchema = z.object({
  date: z.string(),
  currency: z.string(),
  rate: z.number(),
  fetched_at: optionalText,
});

export const MerchantRuleSchema = z.object({
  merchant_pattern: z.string().optional(),
  merchant: optionalText,
  category_id: optionalText,
  created_at: optionalText,
});

/** Anvelopa: doar ce trebuie verificat înainte de a atinge baza de date. */
export const BackupEnvelopeSchema = z.object({
  app: z.string(),
  version: z.number(),
  exportDate: optionalText,
});

/**
 * Validează un element; la eșec întoarce un mesaj scurt în română, ca elementul
 * să poată fi sărit și raportat fără să oprească restul importului.
 */
export function validateItem<T>(
  schema: z.ZodType<T>,
  value: unknown
): { ok: true; data: T } | { ok: false; reason: string } {
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0];
  const path = first?.path.join('.') || 'element';
  return { ok: false, reason: `câmp invalid „${path}": ${first?.message ?? 'tip greșit'}` };
}
