// apps/mobile/src/features/livestock/health.ts · PURE rules for the animal HEALTH FILE and the vet's
// PRESCRIPTION PAD (PC-55 B5, on PC-54 W54-4). No IO, no React — mirrors of the server's zod DTOs
// (RecordHealthEventSchema, WritePrescriptionSchema) so a screen refuses locally exactly what the API refuses,
// and a farmer standing in a shed with one bar of signal learns immediately.
//
// WHY A HEALTH FILE IS WRITTEN CAREFULLY: it follows the animal for life. It decides when the next vaccination is
// due, whether a milk withdrawal period is still running, and — at sale — what a buyer is told. A guessed date or
// a silently-dropped line here becomes somebody's loss later.
//
// THE PRESCRIPTION RULE THAT MATTERS MOST: Schedule H (Drugs and Cosmetics Rules) drugs may only be supplied
// against a prescription, and the flag is PER LINE — one prescription routinely mixes a Schedule-H antibiotic with
// an ordinary supplement. So the pad flags each line on its own and never applies one toggle to the whole pad.
// This app does not decide WHICH drugs are Schedule H (no such list ships here, and inventing one would be
// dangerous): the veterinarian marks the line, because they are the person who is licensed to know.

/** The seeded 'animal_health_event' vocabulary (0009's own DDL comment). The server resolves the code to an id and
 *  REFUSES an unknown one, so offering anything outside this list would just produce a 400. */
export const HEALTH_EVENT_TYPES = ['vaccination', 'deworming', 'treatment', 'ai_insemination', 'pd_check', 'calving', 'injury', 'death'] as const;
export type HealthEventType = (typeof HEALTH_EVENT_TYPES)[number];
export function isHealthEventType(v: string | undefined | null): v is HealthEventType {
  return !!v && (HEALTH_EVENT_TYPES as readonly string[]).includes(v);
}

/** Event kinds where a BATCH number is the point of the record: a vaccine or dewormer without its batch cannot be
 *  traced if the batch is later recalled, and traceability is the whole reason the field exists. Not enforced as
 *  mandatory (a farmer may genuinely not have the vial any more) — the UI asks for it, and says why. */
export function batchNoExpected(type: HealthEventType): boolean {
  return type === 'vaccination' || type === 'deworming';
}
/** Kinds that normally schedule a NEXT visit — the reminder half of the health file. */
export function nextDueExpected(type: HealthEventType): boolean {
  return type === 'vaccination' || type === 'deworming' || type === 'ai_insemination' || type === 'pd_check';
}
/** A death event ends the file; the animal is retired separately (that is a registry act, not a health note). */
export function isTerminal(type: HealthEventType): boolean { return type === 'death'; }

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type HealthEventInput = {
  eventTypeCode: HealthEventType; vetBookingId?: string; batchNo?: string;
  diagnosis?: string; outcome?: string; nextDueDate?: string;
};
export type HealthEventError = 'type' | 'batchNo' | 'diagnosis' | 'outcome' | 'nextDue' | 'nextDuePast' | 'booking';
export type HealthEventResult = { ok: true; value: HealthEventInput } | { ok: false; error: HealthEventError };

/** Build the health-event write. Empty optionals are OMITTED (the API's schema is .strict(), so a null would be
 *  rejected), and `nextDueDate` cannot be in the past — a reminder dated yesterday is not a reminder. */
export function buildHealthEvent(raw: {
  eventTypeCode: string; vetBookingId?: string; batchNo?: string; diagnosis?: string; outcome?: string; nextDueDate?: string;
}, todayIso: string): HealthEventResult {
  if (!isHealthEventType(raw.eventTypeCode)) return { ok: false, error: 'type' };
  const value: HealthEventInput = { eventTypeCode: raw.eventTypeCode };

  const booking = (raw.vetBookingId ?? '').trim();
  if (booking) {
    if (!/^[0-9a-fA-F-]{36}$/.test(booking)) return { ok: false, error: 'booking' };
    value.vetBookingId = booking;
  }
  const batchNo = (raw.batchNo ?? '').trim();
  if (batchNo) {
    if (batchNo.length > 80) return { ok: false, error: 'batchNo' };
    value.batchNo = batchNo;
  }
  const diagnosis = (raw.diagnosis ?? '').trim();
  if (diagnosis) {
    if (diagnosis.length > 2000) return { ok: false, error: 'diagnosis' };
    value.diagnosis = diagnosis;
  }
  const outcome = (raw.outcome ?? '').trim();
  if (outcome) {
    if (outcome.length > 2000) return { ok: false, error: 'outcome' };
    value.outcome = outcome;
  }
  const nextDue = (raw.nextDueDate ?? '').trim();
  if (nextDue) {
    if (!DATE.test(nextDue)) return { ok: false, error: 'nextDue' };
    if (nextDue < todayIso) return { ok: false, error: 'nextDuePast' };
    value.nextDueDate = nextDue;
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Reading the file back: the reminder that actually matters
// ---------------------------------------------------------------------------
export interface HealthEventRow {
  id?: string; eventTypeCode?: string | null; eventType?: string | null; batchNo?: string | null;
  diagnosis?: string | null; outcome?: string | null; nextDueDate?: string | null; createdAt?: string | null;
}

/** Where a due date stands. 'overdue' is deliberately generous by ONE day: something due today is due, not late. */
export function dueState(nextDueDate: string | null | undefined, todayIso: string): 'overdue' | 'due_today' | 'due_soon' | 'scheduled' | 'none' {
  const d = (nextDueDate ?? '').trim();
  if (!DATE.test(d)) return 'none';
  if (d < todayIso) return 'overdue';
  if (d === todayIso) return 'due_today';
  return daysBetween(todayIso, d) <= 7 ? 'due_soon' : 'scheduled';
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The single next thing this animal needs: the EARLIEST unmet due date across the whole file. Overdue beats
 *  upcoming, because a missed vaccination is the fact a farmer must see first. Rows without a due date are
 *  ignored rather than treated as "nothing due" for the animal. */
export function nextDue(rows: readonly HealthEventRow[], todayIso: string): { date: string; state: 'overdue' | 'due_today' | 'due_soon' | 'scheduled'; row: HealthEventRow } | null {
  const dated = rows.filter((r) => DATE.test((r.nextDueDate ?? '').trim()));
  if (dated.length === 0) return null;
  const sorted = [...dated].sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate)));
  const row = sorted[0];
  const date = String(row.nextDueDate);
  const state = dueState(date, todayIso);
  return state === 'none' ? null : { date, state, row };
}

/** Count of reminders that have already passed — the badge a herd screen shows. */
export function overdueCount(rows: readonly HealthEventRow[], todayIso: string): number {
  return rows.filter((r) => dueState(r.nextDueDate, todayIso) === 'overdue').length;
}

// ---------------------------------------------------------------------------
// The prescription pad (vet side)
// ---------------------------------------------------------------------------
export interface RxLineInput { drugName: string; dosage: string; durationDays?: number; isScheduleH?: boolean }
export interface PrescriptionInput { validUntil?: string; items: RxLineInput[] }
export type RxError = 'noLines' | 'tooManyLines' | 'drugName' | 'dosage' | 'duration' | 'validUntil' | 'validUntilPast';
export type RxResult = { ok: true; value: PrescriptionInput } | { ok: false; error: RxError; line?: number };

export const RX_MAX_LINES = 30;

/** Build the prescription. Mirrors WritePrescriptionSchema exactly:
 *  • at least one line, at most 30;
 *  • drugName AND dosage are both REQUIRED on every line — "give the white tablet" is not a prescription, and a
 *    line with a drug but no dose is the kind of ambiguity that gets an animal (or a person drinking its milk)
 *    hurt. A line the vet left completely blank is DROPPED (they were adding a row and changed their mind); a
 *    half-filled line is REFUSED and named by number, never silently discarded;
 *  • durationDays 1..365 when present;
 *  • Schedule-H is per line, exactly as the API stores it.
 *  `validUntil` cannot be in the past — a prescription that expired before it was written cannot be dispensed. */
export function buildPrescription(raw: { validUntil?: string; lines: ReadonlyArray<{ drugName: string; dosage: string; durationDays?: string; isScheduleH?: boolean }> }, todayIso: string): RxResult {
  const items: RxLineInput[] = [];
  for (let i = 0; i < raw.lines.length; i++) {
    const l = raw.lines[i];
    const drugName = (l.drugName ?? '').trim();
    const dosage = (l.dosage ?? '').trim();
    const durationRaw = (l.durationDays ?? '').trim();
    const blank = !drugName && !dosage && !durationRaw && !l.isScheduleH;
    if (blank) continue;                                            // an untouched row is not an error
    if (!drugName || drugName.length > 200) return { ok: false, error: 'drugName', line: i + 1 };
    if (!dosage || dosage.length > 200) return { ok: false, error: 'dosage', line: i + 1 };
    const item: RxLineInput = { drugName, dosage };
    if (durationRaw) {
      if (!/^\d{1,3}$/.test(durationRaw)) return { ok: false, error: 'duration', line: i + 1 };
      const n = Number.parseInt(durationRaw, 10);
      if (n < 1 || n > 365) return { ok: false, error: 'duration', line: i + 1 };
      item.durationDays = n;
    }
    if (l.isScheduleH) item.isScheduleH = true;
    items.push(item);
  }
  if (items.length === 0) return { ok: false, error: 'noLines' };
  if (items.length > RX_MAX_LINES) return { ok: false, error: 'tooManyLines' };

  const value: PrescriptionInput = { items };
  const validUntil = (raw.validUntil ?? '').trim();
  if (validUntil) {
    if (!DATE.test(validUntil)) return { ok: false, error: 'validUntil' };
    if (validUntil < todayIso) return { ok: false, error: 'validUntilPast' };
    value.validUntil = validUntil;
  }
  return { ok: true, value };
}

/** How many lines carry a Schedule-H drug — shown on the pad so the vet sees what they are signing, and on the
 *  farmer's copy so a pharmacy knows the prescription must be retained. */
export function scheduleHCount(items: ReadonlyArray<{ isScheduleH?: boolean }>): number {
  return items.filter((i) => i.isScheduleH === true).length;
}

/** A prescription may be written only while the case is with the vet. `completed` is the FARMER's confirm-and-pay,
 *  and the API allows exactly one prescription per booking — so an existing one closes the pad rather than
 *  offering an edit that would 409. */
export function canWritePrescription(status: string | null | undefined, existing: unknown): boolean {
  if (existing) return false;
  return status === 'in_consult' || status === 'prescribed';
}

// ---------------------------------------------------------------------------
// Ear-tag / Pashu Aadhaar lookup (the ops-facing search)
// ---------------------------------------------------------------------------
/** INAPH ear tags are 12 digits. Spaces and dashes are stripped first, because that is how the number is printed
 *  on the tag and how a person reads it aloud at a gate. Anything else is refused rather than sent as a query that
 *  the API would reject with a 422. */
export function normaliseEarTag(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[\s-]/g, '');
  return /^\d{12}$/.test(digits) ? digits : null;
}
