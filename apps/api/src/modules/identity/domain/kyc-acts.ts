// modules/identity/domain/kyc-acts.ts · PC-56 TENANT-9a · THE DESK'S ACTS AS VERDICTS (W2323–W2325).
//
// Four acts on one document: VERIFY · REJECT (coded reason) · REQUEST MORE (coded reason — the canon's "rejected →
// fixable") · REVEAL the evidence (recorded, reasoned — 1b's shape). The verdict is taken on the confirm page AND re-taken
// on the locked row by the writer; the confirm page is never an authorisation token.
//
// THE RULES, EACH ONE A NAMED REFUSAL:
//   • the desk verb `kyc.review` decides; the reveal is `member.pii.reveal` (0128 kept it narrow; it is not widened here);
//   • MAKER ≠ CHECKER — the submitter never decides; nobody decides their own document; the organisation's own
//     tenant_admin never certifies the organisation (0180's trigger is the same three rules, `23514`);
//   • EVIDENCE BEFORE DECISION — a document with an uploaded file is decided only by someone who has opened it (a recorded
//     reveal by THIS person); a verify needs a CLEAN scan; a lapsed document cannot be verified;
//   • a refusal carries a code from the `kyc_decision_reason` vocabulary that admits the act, with words when it asks.
//   • "Retry" on the canon's chain is a page load, refused by name (`retryIsMutation() === false`).
import { isLapsed } from './kyc-expiry';

export const KYC_ACTS = ['verify', 'reject', 'request_more', 'reveal'] as const;
export type KycAct = (typeof KYC_ACTS)[number];

export function isKycAct(v: string): v is KycAct { return (KYC_ACTS as readonly string[]).includes(v); }

export type ActRefusal =
  | 'NO_PERMISSION' | 'NOT_PENDING' | 'MAKER_IS_CHECKER' | 'OWN_DOCUMENT' | 'SELF_CERTIFICATION' | 'EVIDENCE_NOT_REVEALED'
  | 'EVIDENCE_NOT_CLEAN' | 'ALREADY_LAPSED' | 'REASON_REQUIRED' | 'REASON_UNKNOWN' | 'REASON_NOT_FOR_ACT' | 'NOTE_REQUIRED'
  | 'NOTE_TOO_LONG' | 'NO_EVIDENCE' | 'REVEAL_REASON_TOO_SHORT'
  // PC-56 TENANT-SW-c (A3): the two recusal rules the founder decided — judged by the DATABASE (`kv_kyc_recusal`, the same function
  // the 0199 trigger raises from) and printed here so the record page says why — and a document another reviewer holds a live claim on.
  | 'KYC_RECUSED_DECLARED' | 'KYC_RECUSED_ONBOARDER' | 'CLAIMED_BY_OTHER';

export interface ActDoc {
  status: string; subjectKind: string; userId: string | null; submittedBy: string;
  hasMedia: boolean; scanStatus: string | null; validUntil: string | null;
}
export interface ActActor { userId: string; canReview: boolean; canReveal: boolean; isTenantAdmin: boolean }
export interface ReasonRule { acts: string[]; needsNote: boolean }

export const MIN_REVEAL_REASON = 20;
export const MAX_NOTE = 500;

export interface ActVerdict { act: KycAct; allowed: boolean; refusals: ActRefusal[]; to: 'verified' | 'rejected' | null }

export function actVerdict(
  act: KycAct, doc: ActDoc, actor: ActActor,
  opts: { revealedByActor: boolean; reasonCode?: string | null; note?: string | null; reasons: ReadonlyMap<string, ReasonRule>; today: string; judgeWords?: boolean;
    /** PC-56 TENANT-SW-c: the database's recusal verdict for (actor, subject), and whether someone else holds a live claim. */
    recusal?: string | null; claimedByOther?: boolean },
): ActVerdict {
  const r: ActRefusal[] = [];
  const note = (opts.note ?? '').replace(/\s+/g, ' ').trim();
  const judge = opts.judgeWords !== false;
  if (act === 'reveal') {
    if (!actor.canReveal) r.push('NO_PERMISSION');
    if (!doc.hasMedia) r.push('NO_EVIDENCE');
    else if (doc.scanStatus !== 'clean') r.push('EVIDENCE_NOT_CLEAN');
    if (judge && note.length < MIN_REVEAL_REASON) r.push('REVEAL_REASON_TOO_SHORT');
    if (judge && note.length > MAX_NOTE) r.push('NOTE_TOO_LONG');
    return { act, allowed: r.length === 0, refusals: r, to: null };
  }
  if (!actor.canReview) r.push('NO_PERMISSION');
  if (doc.status !== 'pending') r.push('NOT_PENDING');
  if (actor.userId === doc.submittedBy) r.push('MAKER_IS_CHECKER');
  if (doc.subjectKind === 'user' && actor.userId === doc.userId) r.push('OWN_DOCUMENT');
  if (doc.subjectKind === 'organisation' && actor.isTenantAdmin) r.push('SELF_CERTIFICATION');
  if (doc.subjectKind === 'user' && (opts.recusal === 'KYC_RECUSED_DECLARED' || opts.recusal === 'KYC_RECUSED_ONBOARDER')) r.push(opts.recusal);
  if (opts.claimedByOther) r.push('CLAIMED_BY_OTHER');
  if (doc.hasMedia && !opts.revealedByActor) r.push('EVIDENCE_NOT_REVEALED');
  if (act === 'verify') {
    if (doc.hasMedia && doc.scanStatus !== 'clean') r.push('EVIDENCE_NOT_CLEAN');
    if (isLapsed(doc.validUntil, opts.today)) r.push('ALREADY_LAPSED');
  }
  if (judge) {
    if (act === 'reject' || act === 'request_more') {
      const code = (opts.reasonCode ?? '').trim();
      const rule = code ? opts.reasons.get(code) : undefined;
      if (!code) r.push('REASON_REQUIRED');
      else if (!rule) r.push('REASON_UNKNOWN');
      else if (!rule.acts.includes(act)) r.push('REASON_NOT_FOR_ACT');
      else if (rule.needsNote && note.length < 3) r.push('NOTE_REQUIRED');
    }
    if (note.length > MAX_NOTE) r.push('NOTE_TOO_LONG');
  }
  return { act, allowed: r.length === 0, refusals: r, to: act === 'verify' ? 'verified' : 'rejected' };
}

/** The canon's "Retry" (W121/W122 couldn't-load → W2323) re-reads a page; it is not a state change. Refused by name. */
export function retryIsMutation(): false { return false; }
