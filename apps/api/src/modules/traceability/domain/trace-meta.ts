// modules/traceability/domain/trace-meta.ts · PC-56 HOTFIX-7 · B10 (projection half) + B15 — WHAT A JOURNEY EVENT MAY SAY IN PUBLIC. PURE.
//
// Before HOTFIX-7 an event's `meta` was `z.record(z.unknown())` (anything the author typed) and 0028's `trace_scan` published it verbatim to an
// anonymous QR scan — a phone number or a GPS pair typed into meta went public, while canon W303 promises "never a phone number, an exact field
// location … village-level only" (survey STORE-5 F-8). ONE list, per step, read by three places:
//   • the AUTHOR's door — `AppendEventSchema` (dto/create-trace-event.dto.ts) is a strict object per step built from `traceMetaSchema(step)`:
//     a key outside the list → 422, a value outside its rule → 422;
//   • the DATABASE — migration 0217 `trace_scan_v2` keeps only these keys per step (its CASE is this list's SQL mirror; `trace-meta.spec.ts`
//     parses the migration and asserts the arrays are equal);
//   • the PUBLIC ANSWER — `publicMeta(step, meta)` re-applies each key's VALUE rule, so a row written before the author's door existed (or by
//     hand) is still published only within the rule (the SQL keeps keys; values are judged here).
// The keys come from what canon W303 prints per step (the crop's variety and season, a grade label, the quantity and its unit, a pack, the
// transport mode, a recall reason code) — never a person, a phone, a coordinate, an address or a free note. Each string value is short and may
// not carry a run of six digits (a phone or an account number cannot hide in a "variety").
import { z } from 'zod';
import { TRACE_STEPS, TraceStep } from './traceability.events';

export const TRACE_META_ALLOW: Readonly<Record<TraceStep, readonly string[]>> = Object.freeze({
  harvested:  Object.freeze(['variety', 'season', 'gradeLabel', 'quantity', 'unit']),
  listed:     Object.freeze(['gradeLabel', 'quantity', 'unit']),
  sold:       Object.freeze(['quantity', 'unit']),
  packed:     Object.freeze(['packType', 'packCount', 'quantity', 'unit']),
  picked:     Object.freeze(['quantity', 'unit']),
  in_transit: Object.freeze(['mode']),
  delivered:  Object.freeze(['quantity', 'unit']),
  recalled:   Object.freeze(['reasonCode']),
});

/** Keys that may NEVER be allow-listed for any step (a regression guard the spec asserts over the list above). */
export const TRACE_META_NEVER: readonly string[] = Object.freeze(['phone', 'mobile', 'gps', 'lat', 'lng', 'lon', 'latitude', 'longitude', 'name', 'farmerName',
  'address', 'village', 'note', 'notes', 'email', 'aadhaar', 'userId', 'farmerUserId', 'listingId']);

const NO_DIGIT_RUN = /\d{6,}/;
const shortText = (max: number) => z.string().trim().min(1).max(max).refine((v) => !NO_DIGIT_RUN.test(v), { message: 'must not contain a run of six digits' });
const code = (max: number) => z.string().regex(new RegExp(`^[a-z][a-z0-9_]{0,${max - 1}}$`), `a lower-case code of at most ${max} characters`);

/** The VALUE rule of each allow-listed key (one rule per key, whatever the step). */
export const TRACE_META_VALUE: Readonly<Record<string, z.ZodTypeAny>> = Object.freeze({
  variety: shortText(60),
  season: shortText(40),
  gradeLabel: shortText(40),
  packType: shortText(40),
  quantity: z.number().finite().positive().max(1_000_000_000),
  packCount: z.number().int().positive().max(1_000_000),
  unit: code(16),
  mode: code(24),
  reasonCode: code(40),
});

/** The author's strict object for one step's meta: only the step's keys, each by its value rule, all optional. */
export function traceMetaSchema(step: TraceStep) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const k of TRACE_META_ALLOW[step]) shape[k] = TRACE_META_VALUE[k].optional();
  return z.object(shape).strict();
}

/** The PUBLIC meta of one event: the step's allow-listed keys whose value passes its rule; anything else is dropped (never an error — the
 *  public page shows less, never more). An unknown step publishes nothing. */
export function publicMeta(step: string, meta: unknown): Record<string, string | number> {
  const allow = (TRACE_META_ALLOW as Record<string, readonly string[] | undefined>)[step];
  if (!allow || meta === null || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const out: Record<string, string | number> = {};
  for (const k of allow) {
    const v = (meta as Record<string, unknown>)[k];
    if (v === undefined) continue;
    const ok = TRACE_META_VALUE[k].safeParse(v);
    if (ok.success) out[k] = ok.data as string | number;
  }
  return out;
}

export const TRACE_META_STEPS: readonly TraceStep[] = TRACE_STEPS;
