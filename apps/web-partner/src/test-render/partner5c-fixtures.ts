// apps/web-partner/src/test-render/partner5c-fixtures.ts · PC-56 PARTNER-5c · THE PROMISE THE PLATFORM SETS — the render tests' shared
// fixtures: the dashboard read's `sla` block as the API answers it (whole hours, whole seconds, counts; null when nothing is published or
// decided), the canon's false words as one visible-text regex, and the mailbox fact. No person, bank, place, hash or avatar.
import type { SlaShape } from '../features/partner5/figures';

/** A published 24 h promise; 2 decided in 30 days — one at 10 h (inside), one at 30 h 15 min (outside). */
export const SLA: SlaShape = { decisionPromiseHours: 24, windowDays: 30, decided: 2, medianSec: 36_000, p90Sec: 108_900, withinPromise: 1 };
/** No promise published; the same decisions. */
export const SLA_NONE: SlaShape = { ...SLA, decisionPromiseHours: null, withinPromise: null };
/** Nothing decided in the window (production today: no consent is recorded) — a promise is published. */
export const SLA_EMPTY: SlaShape = { decisionPromiseHours: 24, windowDays: 30, decided: 0, medianSec: null, p90Sec: null, withinPromise: 0 };
export const COMPUTED_AT = '2026-11-05T06:30:00.000Z';
export const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;

/** The canon's false words as they would appear in VISIBLE text (the refusal list is stripped first — it names what it refuses). */
export const FALSE_5C = /%|CSAT|\d\s*\/\s*5\b|conduct flags?|clean quarter|your contract|contract|same scoreboard|one scoreboard|provider[- ]health|monthly (performance |report )?packs?|report packs? (yet|\()|sha256|\bPAR\b|consent registry|partner desk|partnership manager|quarterly review|\d+\s*h response|same[- ]day|disbursal SLA|volume[- ]surge|docs_pending|immutable|re-?downloadable|on the 1st|compliance role|see plan settings|percent|\brate\b|\bratio\b|\bbreach|lending is (switched )?off|\bAJ\b|Saurashtra|RBI ref/i;
