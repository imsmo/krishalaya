// modules/fintech/domain/lending-day.ts · PC-56 PARTNER-5c · founder 5c-4 (door Q6, LAW 9; survey_partner5.md P5-B9, F-5, F-12) — THE LENDING
// DAY IS THE INDIA-TIME CALENDAR DAY. PURE (no I/O).
//
// ONE named zone for every calendar day the lending plane computes: the day a repayment is recorded against (`loan_repayments.due_date`,
// written by services/loan.service.ts on both rails — the repay route and the milk-bill deduction) and "today" in the cooperative desk's
// days-past-due arithmetic (repositories/servicing.repository.ts). Before this file the first was the UTC calendar day of the payment
// (`now.toISOString().slice(0, 10)`) and the second the database SESSION's `CURRENT_DATE`, so a farmer who paid between 00:00 and 05:29
// India time was recorded a day BEFORE the day she paid — and the PARTNER-1a dashboard, which tests `(paid_at AT TIME ZONE 'Asia/Kolkata')
// ::date <= due_date`, counted her late to her lender (survey C-8 / F-5); and one loan could be N days past due to the cooperative and N + 1
// to its lender (F-12).
//
// THIS VALUE MUST EQUAL THE PARTNER SIDE'S. Migration 0232 (`partner_loan_dpd()`, db/migrations/0232_partner4b_lender_servicing.sql:39-43,
// :117-121) and the 1a dashboard shard (modules/partner-console/repositories/partner-console.repository.ts, the on-time count) both write the
// zone as the literal 'Asia/Kolkata'. The unit spec (`__tests__/partner5c-lending-day.spec.ts`) reads 0232 and fails if they diverge.
//
// RULE ZERO — OWED, NOT DONE (a founder question): the zone belongs in `countries.timezone` (db/migrations/0001_*.sql:139, default
// 'Asia/Kolkata'), read per tenant's country on BOTH planes. It is not done here because the partner side's arithmetic lives inside a shipped
// SECURITY DEFINER (0232) and moving it would need a migration; a launch market outside India would need it first.
//
// NO BACKFILL: rows already written with a UTC due date stay as they are (`loan_repayments` is append-only by trigger, 0079); whether
// production rows are corrected is a founder question. Nothing else on the money path changes: amounts, ledger calls and consent gates.
export const LENDING_DAY_TZ = 'Asia/Kolkata';

/** "Today" on the lending plane, computed BY THE DATABASE from `now()` — never the session's `CURRENT_DATE`. Interpolates only the constant. */
export const LENDING_TODAY_SQL = `(now() AT TIME ZONE '${LENDING_DAY_TZ}')::date`;

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: LENDING_DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The lending day (`YYYY-MM-DD`, India time) an instant falls on — the same answer under any process time zone. */
export function lendingDayOf(instant: Date): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) throw new Error('lendingDayOf: not a valid instant');
  const parts = DAY_FMT.formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
