// apps/web-gov/src/features/verification/review.ts · PURE gates + builders for GW-4 verification (PC-55 B1).
// Framework-free (no React, no Next, no SDK runtime) so every rule below is unit-provable. The API re-checks all
// of it — this REFLECTS the server's law, it never grants anything (Law 5).
//
// KYC decision gates mirror apps/api/src/modules/identity/domain/kyc-document.state.ts EXACTLY:
//   none → pending | pending → verified|rejected | verified → expired|rejected | rejected → pending | expired → pending
// Note the one that surprises people: `verified → rejected` IS legal — a document accepted today can be revoked
// tomorrow when fraud surfaces. So a verified case still shows Reject (with a reason), and never shows Verify.
//
// EVIDENCE BEFORE DECISION (Ledger Appendix 6, the reason W54-1 was built at all): a reviewer must not be able to
// APPROVE a submission that carries no document to look at. `canVerifyKyc` therefore requires a mediaId. Rejecting
// without evidence stays allowed — "you submitted nothing we can read" is a legitimate, explainable refusal, and
// blocking it would trap the case forever.

export const KYC_REVIEW_STATUSES = ['pending', 'verified', 'rejected', 'expired'] as const;
export type KycReviewStatus = (typeof KYC_REVIEW_STATUSES)[number];
export function isKycReviewStatus(v: string | undefined | null): v is KycReviewStatus {
  return !!v && (KYC_REVIEW_STATUSES as readonly string[]).includes(v);
}

export interface KycCaseFacts { status?: string | null; mediaId?: string | null }

/** Verify is offered ONLY on a pending case that actually has evidence attached. */
export function canVerifyKyc(c: KycCaseFacts): boolean {
  return c.status === 'pending' && !!c.mediaId;
}
/** Reject is offered on pending (the ordinary refusal) and on verified (a later revocation — legal per the API's
 *  state machine). Never on rejected/expired: those move only when the person re-submits. */
export function canRejectKyc(c: KycCaseFacts): boolean {
  return c.status === 'pending' || c.status === 'verified';
}
/** True when a pending case has nothing to look at — the page must SAY this rather than silently hiding Verify. */
export function evidenceMissing(c: KycCaseFacts): boolean {
  return c.status === 'pending' && !c.mediaId;
}

export type KycDecisionResult =
  | { ok: true; value: { decision: 'verify' | 'reject'; reason?: string } }
  | { ok: false; error: 'decision' | 'reason' | 'reasonLong' | 'noEvidence' };

/** Build the review write. A rejection ALWAYS carries a reason — a person must be able to learn why they failed,
 *  and 500 chars is the API's own cap (ReviewKycSchema), enforced here so the officer sees it before the round trip. */
export function buildKycDecision(raw: { decision: string; reason: string }, c: KycCaseFacts): KycDecisionResult {
  const decision = raw.decision === 'verify' ? 'verify' : raw.decision === 'reject' ? 'reject' : null;
  if (!decision) return { ok: false, error: 'decision' };
  const reason = raw.reason.trim();
  if (decision === 'verify') {
    if (!canVerifyKyc(c)) return { ok: false, error: 'noEvidence' };
    return { ok: true, value: { decision } };
  }
  if (!reason) return { ok: false, error: 'reason' };
  if (reason.length > 500) return { ok: false, error: 'reasonLong' };
  return { ok: true, value: { decision, reason } };
}

// ---------------------------------------------------------------------------
// Field visits (W54-3 · schemes/applications/:id/field-visits)
// ---------------------------------------------------------------------------
// Server law being reflected (modules/schemes/services/field-verification.service.ts):
//   • scheme.process permission (the console's session already carries it or the write 409/403s);
//   • ONE OPEN VISIT per application (DB unique) — a second schedule attempt is a 409, so the UI offers Schedule
//     only when no open visit exists;
//   • OFFICER-OF-RECORD ONLY may submit — the officer who scheduled it, nobody else. The UI hides Submit for
//     anyone else instead of letting them fill a form the server will refuse;
//   • evidence rides MEDIA IDS (geotag: [{mediaId,lat,lng,capturedAt}]) — never inline bytes;
//   • the farmer-side OTP sign-off is NOT built (the service header says so explicitly). The canon screen W337
//     draws "Send OTP to farmer"/"Submit — needs farmer OTP"; we do not draw a button that cannot work. The page
//     states plainly that presence sign-off is not yet available, and the visit records the officer's attestation.

// TWO DIFFERENT "OPEN"S, and conflating them was a real bug caught while building this (the first draft called a
// visit open only while 'scheduled'|'in_progress'):
//   • BLOCKS A NEW SCHEDULE — migration 0066's partial unique index is `WHERE status NOT IN ('synced','disputed')`,
//     so a visit sitting at pending_otp or submitted STILL blocks a second one. Offering "Schedule" there would
//     promise something the database will refuse with a 409.
//   • STILL SUBMITTABLE — the repository's UPDATE says `status IN ('scheduled','in_progress','pending_otp')`.
// Each set is mirrored from its own source of truth, not guessed from the other.
export const VISIT_STATUSES = ['scheduled', 'in_progress', 'pending_otp', 'submitted', 'synced', 'disputed'] as const;
export const VISIT_CLOSED_STATUSES = ['synced', 'disputed'] as const;          // 0066 unique-index exclusion
export const VISIT_SUBMITTABLE_STATUSES = ['scheduled', 'in_progress', 'pending_otp'] as const; // repo UPDATE
export interface FieldVisitFacts { id: string; status?: string | null; officerId?: string | null }

/** "Open" in the sense the DB uses to forbid a second visit on the same application. */
export function blocksNewVisit(v: FieldVisitFacts): boolean {
  return !(VISIT_CLOSED_STATUSES as readonly string[]).includes(String(v.status ?? ''));
}
export function isSubmittableVisit(v: FieldVisitFacts): boolean {
  return (VISIT_SUBMITTABLE_STATUSES as readonly string[]).includes(String(v.status ?? ''));
}
/** A visit is worth scheduling once the application is actually under review, and only if none is still open. */
export function canScheduleVisit(appStatus: string | undefined | null, visits: readonly FieldVisitFacts[]): boolean {
  const reviewable = appStatus === 'submitted' || appStatus === 'under_verification' || appStatus === 'appealed';
  return reviewable && !visits.some(blocksNewVisit);
}
/** Submit is offered ONLY to the officer of record, on a submittable visit — mirroring the server's identity rule
 *  (field-verification.service.ts throws 'officer-of-record only (W335/W337)' for anyone else). */
export function canSubmitVisit(v: FieldVisitFacts, viewerUserId: string | undefined | null): boolean {
  return isSubmittableVisit(v) && !!viewerUserId && v.officerId === viewerUserId;
}

export interface VisitSubmission {
  geotag: Array<{ mediaId: string; lat: number; lng: number; capturedAt: string }>;
  measuredValues: Record<string, unknown>;
  walkTraceMediaId?: string;
}
export type VisitSubmissionResult =
  | { ok: true; value: VisitSubmission }
  | { ok: false; error: 'noPhotos' | 'lat' | 'lng' | 'capturedAt' | 'measured' };

/** Build the visit submission from the form.
 *  ONE LOCATION PER VISIT, STAMPED ON EVERY PHOTO: the browser cannot be trusted to read EXIF GPS out of each
 *  file, so the officer records the location of the visit once (or captures it from the device) and it is stamped
 *  onto each photo's geotag entry. The UI says exactly that — a per-photo coordinate we did not actually measure
 *  would be a fabricated fact in an evidence record. */
export function buildVisitSubmission(raw: {
  mediaIds: readonly string[]; lat: string; lng: string; capturedAt: string; measured: string; walkTraceMediaId?: string;
}): VisitSubmissionResult {
  const mediaIds = raw.mediaIds.map((m) => m.trim()).filter(Boolean);
  if (mediaIds.length === 0) return { ok: false, error: 'noPhotos' };

  const lat = Number.parseFloat(raw.lat);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'lat' };
  const lng = Number.parseFloat(raw.lng);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'lng' };

  const capturedAt = raw.capturedAt.trim();
  const ts = Date.parse(capturedAt);
  if (!Number.isFinite(ts)) return { ok: false, error: 'capturedAt' };
  const iso = new Date(ts).toISOString();

  let measuredValues: Record<string, unknown> = {};
  const measured = raw.measured.trim();
  if (measured) {
    const parsed = parseMeasured(measured);
    if (!parsed) return { ok: false, error: 'measured' };
    measuredValues = parsed;
  }

  const value: VisitSubmission = {
    geotag: mediaIds.map((mediaId) => ({ mediaId, lat, lng, capturedAt: iso })),
    measuredValues,
  };
  const walkTraceMediaId = raw.walkTraceMediaId?.trim();
  if (walkTraceMediaId) value.walkTraceMediaId = walkTraceMediaId;
  return { ok: true, value };
}

/** `key: value` per line → a flat object. Kept deliberately dumb: an officer types what they measured, we do not
 *  invent a schema for it, and a malformed line is REFUSED rather than silently dropped from an evidence record. */
export function parseMeasured(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0 || idx === trimmed.length - 1) return null;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!key || !val || key.length > 60 || val.length > 200) return null;
    out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}
