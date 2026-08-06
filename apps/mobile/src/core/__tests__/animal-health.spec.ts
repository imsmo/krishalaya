// apps/mobile/src/core/__tests__/animal-health.spec.ts · PC-55 B5. The health file and the prescription pad.
// These are the two mobile surfaces where a careless default hurts an animal — or a person drinking its milk — so
// every rule the screens rely on is pinned here.
import {
  HEALTH_EVENT_TYPES, isHealthEventType, batchNoExpected, nextDueExpected, isTerminal,
  buildHealthEvent, dueState, daysBetween, nextDue, overdueCount,
  buildPrescription, scheduleHCount, canWritePrescription, normaliseEarTag, RX_MAX_LINES,
} from '../../features/livestock/health';

const TODAY = '2026-08-06';

describe('health event vocabulary mirrors the seeded list (0009)', () => {
  it('is exactly the codes the server can resolve', () => {
    expect([...HEALTH_EVENT_TYPES]).toEqual(['vaccination', 'deworming', 'treatment', 'ai_insemination', 'pd_check', 'calving', 'injury', 'death']);
    expect(isHealthEventType('vaccination')).toBe(true);
    expect(isHealthEventType('checkup')).toBe(false);     // would be a 400 from the API
    expect(isHealthEventType(undefined)).toBe(false);
  });
  it('asks for a batch number where traceability depends on it', () => {
    expect(batchNoExpected('vaccination')).toBe(true);
    expect(batchNoExpected('deworming')).toBe(true);
    expect(batchNoExpected('treatment')).toBe(false);
    expect(batchNoExpected('calving')).toBe(false);
  });
  it('offers a next-due date only for the kinds that schedule one', () => {
    expect(nextDueExpected('vaccination')).toBe(true);
    expect(nextDueExpected('pd_check')).toBe(true);
    expect(nextDueExpected('injury')).toBe(false);
    expect(nextDueExpected('death')).toBe(false);
    expect(isTerminal('death')).toBe(true);
    expect(isTerminal('injury')).toBe(false);
  });
});

describe('buildHealthEvent', () => {
  it('sends only what was filled (the API schema is strict — a null would be rejected)', () => {
    expect(buildHealthEvent({ eventTypeCode: 'treatment' }, TODAY)).toEqual({ ok: true, value: { eventTypeCode: 'treatment' } });
    const full = buildHealthEvent({ eventTypeCode: 'vaccination', batchNo: ' FMD-22 ', diagnosis: ' fine ', outcome: ' dosed ', nextDueDate: '2026-09-06' }, TODAY);
    expect(full).toEqual({ ok: true, value: { eventTypeCode: 'vaccination', batchNo: 'FMD-22', diagnosis: 'fine', outcome: 'dosed', nextDueDate: '2026-09-06' } });
  });
  it('REFUSES a reminder dated in the past — a reminder dated yesterday is not a reminder', () => {
    expect(buildHealthEvent({ eventTypeCode: 'vaccination', nextDueDate: '2026-08-05' }, TODAY)).toEqual({ ok: false, error: 'nextDuePast' });
    expect(buildHealthEvent({ eventTypeCode: 'vaccination', nextDueDate: TODAY }, TODAY).ok).toBe(true);   // today is fine
  });
  it('refuses an unknown kind, a malformed date and over-long text', () => {
    expect(buildHealthEvent({ eventTypeCode: 'checkup' }, TODAY)).toEqual({ ok: false, error: 'type' });
    expect(buildHealthEvent({ eventTypeCode: 'vaccination', nextDueDate: '06-09-2026' }, TODAY)).toEqual({ ok: false, error: 'nextDue' });
    expect(buildHealthEvent({ eventTypeCode: 'treatment', diagnosis: 'x'.repeat(2001) }, TODAY)).toEqual({ ok: false, error: 'diagnosis' });
    expect(buildHealthEvent({ eventTypeCode: 'vaccination', batchNo: 'b'.repeat(81) }, TODAY)).toEqual({ ok: false, error: 'batchNo' });
    expect(buildHealthEvent({ eventTypeCode: 'treatment', vetBookingId: 'nope' }, TODAY)).toEqual({ ok: false, error: 'booking' });
  });
});

describe('what is due next — the reminder half of the file', () => {
  it('classifies a due date, treating TODAY as due rather than late', () => {
    expect(dueState('2026-08-05', TODAY)).toBe('overdue');
    expect(dueState(TODAY, TODAY)).toBe('due_today');
    expect(dueState('2026-08-13', TODAY)).toBe('due_soon');    // within 7 days
    expect(dueState('2026-08-14', TODAY)).toBe('scheduled');
    expect(dueState(null, TODAY)).toBe('none');
    expect(dueState('not a date', TODAY)).toBe('none');
  });
  it('counts days across month ends', () => {
    expect(daysBetween('2026-08-06', '2026-09-06')).toBe(31);
    expect(daysBetween('2026-08-06', '2026-08-06')).toBe(0);
  });
  it('surfaces the EARLIEST unmet due date, so an overdue vaccination cannot hide behind a later one', () => {
    const rows = [
      { id: 'a', eventTypeCode: 'deworming', nextDueDate: '2026-12-01' },
      { id: 'b', eventTypeCode: 'vaccination', nextDueDate: '2026-07-01' },   // overdue
      { id: 'c', eventTypeCode: 'treatment' },                                 // no date at all
    ];
    const due = nextDue(rows, TODAY);
    expect(due?.row.id).toBe('b');
    expect(due?.state).toBe('overdue');
    expect(overdueCount(rows, TODAY)).toBe(1);
  });
  it('says nothing is due when no row carries a date (never "nothing due" from a missing field)', () => {
    expect(nextDue([{ id: 'a', eventTypeCode: 'treatment' }], TODAY)).toBeNull();
    expect(nextDue([], TODAY)).toBeNull();
    expect(overdueCount([], TODAY)).toBe(0);
  });
});

describe('the prescription pad', () => {
  const line = (over: Partial<{ drugName: string; dosage: string; durationDays: string; isScheduleH: boolean }> = {}) =>
    ({ drugName: 'Oxytetracycline', dosage: '10 ml IM once daily', durationDays: '3', isScheduleH: false, ...over });

  it('builds a normal line and keeps Schedule H PER LINE', () => {
    const r = buildPrescription({ lines: [line({ isScheduleH: true }), line({ drugName: 'Calcium gel', dosage: '1 tube oral', durationDays: '', isScheduleH: false })] }, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([
      { drugName: 'Oxytetracycline', dosage: '10 ml IM once daily', durationDays: 3, isScheduleH: true },
      { drugName: 'Calcium gel', dosage: '1 tube oral' },
    ]);
    expect(scheduleHCount(r.value.items)).toBe(1);   // exactly one line, not the whole pad
  });

  it('drops a row the vet never touched, but REFUSES a half-filled one and names the line', () => {
    const withBlank = buildPrescription({ lines: [line(), { drugName: '', dosage: '', durationDays: '', isScheduleH: false }] }, TODAY);
    expect(withBlank.ok).toBe(true);
    if (withBlank.ok) expect(withBlank.value.items).toHaveLength(1);

    expect(buildPrescription({ lines: [line(), { drugName: 'Meloxicam', dosage: '', durationDays: '', isScheduleH: false }] }, TODAY))
      .toEqual({ ok: false, error: 'dosage', line: 2 });
    expect(buildPrescription({ lines: [{ drugName: '', dosage: '5 ml', durationDays: '', isScheduleH: false }] }, TODAY))
      .toEqual({ ok: false, error: 'drugName', line: 1 });
  });

  it('a medicine without a dose is never a prescription, and an empty pad is refused', () => {
    expect(buildPrescription({ lines: [] }, TODAY)).toEqual({ ok: false, error: 'noLines' });
    expect(buildPrescription({ lines: [{ drugName: '', dosage: '', durationDays: '', isScheduleH: false }] }, TODAY)).toEqual({ ok: false, error: 'noLines' });
  });

  it('keeps the API’s duration bounds and refuses a fractional day count', () => {
    expect(buildPrescription({ lines: [line({ durationDays: '365' })] }, TODAY).ok).toBe(true);
    expect(buildPrescription({ lines: [line({ durationDays: '366' })] }, TODAY)).toEqual({ ok: false, error: 'duration', line: 1 });
    expect(buildPrescription({ lines: [line({ durationDays: '0' })] }, TODAY)).toEqual({ ok: false, error: 'duration', line: 1 });
    expect(buildPrescription({ lines: [line({ durationDays: '3.5' })] }, TODAY)).toEqual({ ok: false, error: 'duration', line: 1 });
  });

  it('refuses a prescription that expired before it was written', () => {
    expect(buildPrescription({ validUntil: '2026-08-05', lines: [line()] }, TODAY)).toEqual({ ok: false, error: 'validUntilPast' });
    expect(buildPrescription({ validUntil: TODAY, lines: [line()] }, TODAY).ok).toBe(true);
    expect(buildPrescription({ validUntil: '06-08-2026', lines: [line()] }, TODAY)).toEqual({ ok: false, error: 'validUntil' });
  });

  it('caps the pad at the API’s line limit', () => {
    const many = Array.from({ length: RX_MAX_LINES + 1 }, (_, i) => line({ drugName: `Drug ${i}` }));
    expect(buildPrescription({ lines: many }, TODAY)).toEqual({ ok: false, error: 'tooManyLines' });
  });

  it('opens the pad only while the case is with the vet, and closes it once one exists', () => {
    expect(canWritePrescription('in_consult', null)).toBe(true);
    expect(canWritePrescription('prescribed', null)).toBe(true);
    expect(canWritePrescription('in_consult', { id: 'rx1' })).toBe(false);   // one per booking — an edit would 409
    expect(canWritePrescription('requested', null)).toBe(false);
    expect(canWritePrescription('completed', null)).toBe(false);             // the farmer's confirm-and-pay
    expect(canWritePrescription('cancelled', null)).toBe(false);
  });
});

describe('ear-tag normalisation', () => {
  it('accepts a 12-digit tag however it was written on the tag', () => {
    expect(normaliseEarTag('123456789012')).toBe('123456789012');
    expect(normaliseEarTag(' 1234 5678 9012 ')).toBe('123456789012');
    expect(normaliseEarTag('1234-5678-9012')).toBe('123456789012');
  });
  it('refuses anything that is not exactly 12 digits, so no bad query is ever sent', () => {
    expect(normaliseEarTag('12345678901')).toBeNull();
    expect(normaliseEarTag('1234567890123')).toBeNull();
    expect(normaliseEarTag('12345678901A')).toBeNull();
    expect(normaliseEarTag('')).toBeNull();
    expect(normaliseEarTag(null)).toBeNull();
  });
});
