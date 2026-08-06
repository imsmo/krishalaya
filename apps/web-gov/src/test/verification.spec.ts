// apps/web-gov/src/test/verification.spec.ts · GW-4 (PC-55 B1). Pins every gate the console draws against the
// API's OWN law. If someone changes the server's state machine or the DB's uniqueness rule without updating this
// console, these specs are where it should hurt.
import {
  KYC_REVIEW_STATUSES, isKycReviewStatus, canVerifyKyc, canRejectKyc, evidenceMissing, buildKycDecision,
  VISIT_CLOSED_STATUSES, VISIT_SUBMITTABLE_STATUSES, VISIT_STATUSES, blocksNewVisit, isSubmittableVisit,
  canScheduleVisit, canSubmitVisit, buildVisitSubmission, parseMeasured,
} from '../features/verification/review';

describe('KYC review gates (mirror identity/domain/kyc-document.state.ts)', () => {
  it('knows the four reviewable statuses', () => {
    expect([...KYC_REVIEW_STATUSES]).toEqual(['pending', 'verified', 'rejected', 'expired']);
    expect(isKycReviewStatus('pending')).toBe(true);
    expect(isKycReviewStatus('none')).toBe(false);      // 'none' is a user state, never a queue box
    expect(isKycReviewStatus(undefined)).toBe(false);
  });

  it('EVIDENCE BEFORE DECISION: verify needs a document to look at', () => {
    expect(canVerifyKyc({ status: 'pending', mediaId: 'm1' })).toBe(true);
    expect(canVerifyKyc({ status: 'pending', mediaId: null })).toBe(false);
    expect(evidenceMissing({ status: 'pending', mediaId: null })).toBe(true);
    expect(evidenceMissing({ status: 'pending', mediaId: 'm1' })).toBe(false);
  });

  it('never offers verify on a case the API would refuse (only pending → verified is legal)', () => {
    for (const status of ['verified', 'rejected', 'expired', 'none', undefined]) {
      expect(canVerifyKyc({ status: status as string, mediaId: 'm1' })).toBe(false);
    }
  });

  it('offers reject on pending AND on verified — a later revocation is legal per the API state machine', () => {
    expect(canRejectKyc({ status: 'pending' })).toBe(true);
    expect(canRejectKyc({ status: 'verified' })).toBe(true);   // verified → rejected IS in TRANSITIONS
    expect(canRejectKyc({ status: 'rejected' })).toBe(false);  // moves only when the person re-submits
    expect(canRejectKyc({ status: 'expired' })).toBe(false);
  });

  it('a rejection cannot be submitted without a reason, and honours the API’s 500-char cap', () => {
    const pending = { status: 'pending', mediaId: 'm1' };
    expect(buildKycDecision({ decision: 'reject', reason: '   ' }, pending)).toEqual({ ok: false, error: 'reason' });
    expect(buildKycDecision({ decision: 'reject', reason: 'x'.repeat(501) }, pending)).toEqual({ ok: false, error: 'reasonLong' });
    expect(buildKycDecision({ decision: 'reject', reason: '  blurred photo  ' }, pending))
      .toEqual({ ok: true, value: { decision: 'reject', reason: 'blurred photo' } });
  });

  it('a verify with no evidence is refused locally rather than sent', () => {
    expect(buildKycDecision({ decision: 'verify', reason: '' }, { status: 'pending', mediaId: null }))
      .toEqual({ ok: false, error: 'noEvidence' });
    expect(buildKycDecision({ decision: 'verify', reason: '' }, { status: 'pending', mediaId: 'm1' }))
      .toEqual({ ok: true, value: { decision: 'verify' } });
  });

  it('rejecting an evidence-less submission stays possible (otherwise the case is trapped forever)', () => {
    expect(buildKycDecision({ decision: 'reject', reason: 'no document attached' }, { status: 'pending', mediaId: null }))
      .toEqual({ ok: true, value: { decision: 'reject', reason: 'no document attached' } });
  });

  it('refuses an unknown decision', () => {
    expect(buildKycDecision({ decision: 'approve', reason: '' }, { status: 'pending', mediaId: 'm1' }))
      .toEqual({ ok: false, error: 'decision' });
  });
});

describe('field-visit gates (mirror 0066’s unique index AND the repository UPDATE)', () => {
  it('the two status sets come from their own sources of truth and are NOT the same set', () => {
    expect([...VISIT_CLOSED_STATUSES]).toEqual(['synced', 'disputed']);                        // 0066 index
    expect([...VISIT_SUBMITTABLE_STATUSES]).toEqual(['scheduled', 'in_progress', 'pending_otp']); // repo UPDATE
    // Every DB status is accounted for by exactly one of the two ideas (no status silently unhandled).
    for (const s of VISIT_STATUSES) {
      expect(blocksNewVisit({ id: 'v', status: s }) || (VISIT_CLOSED_STATUSES as readonly string[]).includes(s)).toBe(true);
    }
  });

  it('a submitted or pending_otp visit STILL blocks a new one (the bug this spec exists to prevent)', () => {
    // 0066: UNIQUE ... WHERE status NOT IN ('synced','disputed'). Offering "Schedule" here would promise
    // something the database refuses with a 409.
    expect(canScheduleVisit('under_verification', [{ id: 'v1', status: 'submitted' }])).toBe(false);
    expect(canScheduleVisit('under_verification', [{ id: 'v1', status: 'pending_otp' }])).toBe(false);
    expect(canScheduleVisit('under_verification', [{ id: 'v1', status: 'scheduled' }])).toBe(false);
    // …and only a genuinely closed visit frees the application for another.
    expect(canScheduleVisit('under_verification', [{ id: 'v1', status: 'synced' }])).toBe(true);
    expect(canScheduleVisit('under_verification', [{ id: 'v1', status: 'disputed' }])).toBe(true);
  });

  it('schedules only while the application is actually under review', () => {
    for (const s of ['submitted', 'under_verification', 'appealed']) expect(canScheduleVisit(s, [])).toBe(true);
    for (const s of ['draft', 'approved', 'rejected', 'disbursed', 'closed', undefined]) {
      expect(canScheduleVisit(s as string, [])).toBe(false);
    }
  });

  it('OFFICER-OF-RECORD ONLY may submit — nobody else is shown a form the server will refuse', () => {
    const v = { id: 'v1', status: 'scheduled', officerId: 'officer-1' };
    expect(canSubmitVisit(v, 'officer-1')).toBe(true);
    expect(canSubmitVisit(v, 'officer-2')).toBe(false);
    expect(canSubmitVisit(v, undefined)).toBe(false);                       // viewer unknown ⇒ do not offer
    expect(canSubmitVisit({ ...v, officerId: null }, 'officer-1')).toBe(false);
    expect(isSubmittableVisit({ id: 'v', status: 'submitted' })).toBe(false); // already submitted
    expect(canSubmitVisit({ ...v, status: 'synced' }, 'officer-1')).toBe(false);
  });
});

describe('buildVisitSubmission', () => {
  const base = { mediaIds: ['m1', 'm2'], lat: '23.0225', lng: '72.5714', capturedAt: '2026-08-06T10:30', measured: '' };

  it('stamps ONE recorded location + time onto every photograph (never a coordinate we did not measure)', () => {
    const r = buildVisitSubmission(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.geotag).toHaveLength(2);
    expect(r.value.geotag.map((g) => g.mediaId)).toEqual(['m1', 'm2']);
    expect(new Set(r.value.geotag.map((g) => `${g.lat},${g.lng},${g.capturedAt}`)).size).toBe(1);
    expect(r.value.geotag[0].capturedAt).toBe(new Date('2026-08-06T10:30').toISOString()); // normalised to ISO
    expect(r.value.measuredValues).toEqual({});
  });

  it('refuses a submission with no photographs — evidence rides media ids', () => {
    expect(buildVisitSubmission({ ...base, mediaIds: [] })).toEqual({ ok: false, error: 'noPhotos' });
    expect(buildVisitSubmission({ ...base, mediaIds: ['  '] })).toEqual({ ok: false, error: 'noPhotos' });
  });

  it('refuses coordinates outside the real world, and a time it cannot read', () => {
    expect(buildVisitSubmission({ ...base, lat: '91' })).toEqual({ ok: false, error: 'lat' });
    expect(buildVisitSubmission({ ...base, lat: '' })).toEqual({ ok: false, error: 'lat' });
    expect(buildVisitSubmission({ ...base, lng: '-181' })).toEqual({ ok: false, error: 'lng' });
    expect(buildVisitSubmission({ ...base, capturedAt: 'sometime' })).toEqual({ ok: false, error: 'capturedAt' });
  });

  it('accepts the boundaries (0,0 and the poles are real places)', () => {
    expect(buildVisitSubmission({ ...base, lat: '0', lng: '0' }).ok).toBe(true);
    expect(buildVisitSubmission({ ...base, lat: '-90', lng: '180' }).ok).toBe(true);
  });

  it('carries a walk-trace media id only when one was captured', () => {
    const withTrace = buildVisitSubmission({ ...base, walkTraceMediaId: ' trace-1 ' });
    expect(withTrace.ok && withTrace.value.walkTraceMediaId).toBe('trace-1');
    const without = buildVisitSubmission({ ...base, walkTraceMediaId: '   ' });
    expect(without.ok && 'walkTraceMediaId' in without.value).toBe(false);
  });

  it('a malformed measurement line is REFUSED, never silently dropped from an evidence record', () => {
    expect(buildVisitSubmission({ ...base, measured: 'measured_ha 1.2' })).toEqual({ ok: false, error: 'measured' });
    const ok = buildVisitSubmission({ ...base, measured: 'measured_ha: 1.2\napproved_ha: 1.5\n' });
    expect(ok.ok && ok.value.measuredValues).toEqual({ measured_ha: '1.2', approved_ha: '1.5' });
  });

  it('parseMeasured tolerates blank lines and values containing colons, but not empty halves', () => {
    expect(parseMeasured('\n\nnote: seen at 10:30\n')).toEqual({ note: 'seen at 10:30' });
    expect(parseMeasured(': 1.2')).toBeNull();
    expect(parseMeasured('key:')).toBeNull();
    expect(parseMeasured('   ')).toBeNull();
  });
});
