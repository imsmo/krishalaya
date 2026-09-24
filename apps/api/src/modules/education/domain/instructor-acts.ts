// modules/education/domain/instructor-acts.ts · PC-56 TENANT-7d · the acts on an instructor and their credentials, as
// verdicts — the instructor-mutate chain (W2640 confirm → W2641 success → W2642 failure) and W419's badges.
// Same shape as 7a's `course-acts.ts`, 7b's `lesson-acts.ts`, 7c's `live-class-acts.ts`: the confirm screen asks the
// verdict, the act RE-TAKES it on the locked row, and the reasons come in the order a person wants to hear them:
// permission → who may act → the row's stage → what the act needs → the reason.
//
// THE BADGE IS A TRUST SURFACE. W419 draws `is_verified` and W410 says *"verified instructor"*. Since 0012 the column
// was INSERTed false and written by nothing, so the badge could never have been true. Law 12 of this programme (render
// only verified truth) means the badge is drawn only after WHO verifies and HOW it is revoked exist:
//
//   verify      the desk (course.publish) verifies an instructor — never THEMSELVES (`MAKER_IS_CHECKER`, 0173's trigger
//               behind the door), only on the strength of at least one ACCEPTED credential (`NO_ACCEPTED_CREDENTIAL`:
//               W419 *"Add at least one qualification to apply for verified-instructor status"*).
//   unverify    the desk revokes it, with a reason. Never themselves either.
//   accept      the desk accepts a SUBMITTED credential whose document scan is CLEAN (`DOCUMENT_NOT_CLEAN` while pending
//               or failed — the desk cannot have looked at a file core/media has not served). Never their own.
//   reject      the desk rejects a SUBMITTED credential; the reason IS the note the instructor reads (W419 *"Reason: the
//               certificate photo was too blurred …"*).
//   withdraw    the instructor (or the desk) withdraws a credential — but not the LAST ACCEPTED one while the instructor
//               is verified (`LAST_ACCEPTED_CREDENTIAL`): a verification stands on a document; the desk unverifies first.
//
// W2640's *"Retry"* is NOT an act: W419's *"Couldn't verify the credential … Retry"* describes an automated check this
// platform does not run (nothing matches a face or reads a certificate); it is refused by name on the page. There is no
// `deactivate`: the canon names none, and `deleted_at` is written by nothing — named, not built.
import { MIN_ACT_REASON, MAX_ACT_REASON } from './course-acts';
import { CredentialStatus, canCredentialTransition } from './instructor-credential.entity';

export const INSTRUCTOR_ACTS = ['verify', 'unverify', 'accept', 'reject', 'withdraw'] as const;
export type InstructorAct = (typeof INSTRUCTOR_ACTS)[number];
export function isInstructorAct(s: string): s is InstructorAct { return (INSTRUCTOR_ACTS as readonly string[]).includes(s); }
/** The acts on a CREDENTIAL (they need `credentialId`); the other two are on the instructor row. */
export const CREDENTIAL_ACTS: ReadonlySet<InstructorAct> = new Set(['accept', 'reject', 'withdraw']);
/** The acts only the desk performs. */
export const DESK_ACTS: ReadonlySet<InstructorAct> = new Set(['verify', 'unverify', 'accept', 'reject']);

export const INSTRUCTOR_ACT_REFUSALS = [
  'NO_PERMISSION', 'NOT_DESK', 'NOT_OWNER', 'MAKER_IS_CHECKER', 'PLATFORM_INSTRUCTOR',
  'ALREADY_VERIFIED', 'NOT_VERIFIED', 'NO_ACCEPTED_CREDENTIAL',
  'CREDENTIAL_REQUIRED', 'CREDENTIAL_UNKNOWN', 'ILLEGAL_FROM_STATUS', 'DOCUMENT_NOT_CLEAN', 'LAST_ACCEPTED_CREDENTIAL',
  'REASON_REQUIRED',
] as const;
export type InstructorActRefusal = (typeof INSTRUCTOR_ACT_REFUSALS)[number];

export interface InstructorActInput {
  act: InstructorAct;
  canAuthor: boolean; canPublish: boolean;
  /** The caller is the user behind the instructor row. */
  isSelf: boolean;
  /** The instructor row belongs to a tenant (a platform instructor's record is admin-api's, Law 11). */
  isTenantInstructor: boolean;
  isVerified: boolean;
  /** Every credential's status (withdrawn ones included; the count of accepted ones is what `verify` and `withdraw` ask). */
  credentialStatuses: readonly CredentialStatus[];
  /** For the credential acts: the credential named (undefined = nothing named; null = named and not this instructor's). */
  credential: { status: CredentialStatus; documentScanStatus: string } | null | undefined;
  reason: string | null | undefined;
}
export interface InstructorActVerdict { act: InstructorAct; allowed: boolean; refusals: InstructorActRefusal[]; to: CredentialStatus | 'verified' | 'unverified' | null }

const reasonUsable = (r: string | null | undefined) => { const s = (r ?? '').trim(); return s.length >= MIN_ACT_REASON && s.length <= MAX_ACT_REASON; };

export function instructorActVerdict(i: InstructorActInput): InstructorActVerdict {
  const refusals: InstructorActRefusal[] = [];
  const desk = DESK_ACTS.has(i.act);
  if (!(i.canAuthor || i.canPublish)) refusals.push('NO_PERMISSION');
  if (desk && !i.canPublish) refusals.push('NOT_DESK');
  if (desk && i.isSelf) refusals.push('MAKER_IS_CHECKER');
  if (i.act === 'withdraw' && !i.isSelf && !i.canPublish) refusals.push('NOT_OWNER');
  if (!i.isTenantInstructor) refusals.push('PLATFORM_INSTRUCTOR');
  const accepted = i.credentialStatuses.filter((s) => s === 'accepted').length;
  let to: InstructorActVerdict['to'] = null;
  switch (i.act) {
    case 'verify':
      to = 'verified';
      if (i.isVerified) refusals.push('ALREADY_VERIFIED');
      if (accepted === 0) refusals.push('NO_ACCEPTED_CREDENTIAL');
      break;
    case 'unverify':
      to = 'unverified';
      if (!i.isVerified) refusals.push('NOT_VERIFIED');
      break;
    case 'accept': case 'reject': case 'withdraw': {
      const target: CredentialStatus = i.act === 'accept' ? 'accepted' : i.act === 'reject' ? 'rejected' : 'withdrawn';
      to = target;
      if (i.credential === undefined) refusals.push('CREDENTIAL_REQUIRED');
      else if (i.credential === null) refusals.push('CREDENTIAL_UNKNOWN');
      else {
        if (!canCredentialTransition(i.credential.status, target)) refusals.push('ILLEGAL_FROM_STATUS');
        if (i.act === 'accept' && i.credential.documentScanStatus !== 'clean') refusals.push('DOCUMENT_NOT_CLEAN');
        if (i.act === 'withdraw' && i.isVerified && i.credential.status === 'accepted' && accepted <= 1) refusals.push('LAST_ACCEPTED_CREDENTIAL');
      }
      break;
    }
  }
  if (!reasonUsable(i.reason)) refusals.push('REASON_REQUIRED');
  return { act: i.act, allowed: refusals.length === 0, refusals, to };
}

/**
 * Every act's verdict for the page that offers buttons — the two instructor acts once, the three credential acts once
 * PER credential. The reason is the confirm step's question.
 */
export function allInstructorVerdicts(base: Omit<InstructorActInput, 'act' | 'reason' | 'credential'>, credentials: ReadonlyArray<{ id: string; status: CredentialStatus; documentScanStatus: string }>): Array<InstructorActVerdict & { credentialId: string | null }> {
  const out: Array<InstructorActVerdict & { credentialId: string | null }> = [];
  for (const act of ['verify', 'unverify'] as const) out.push({ ...instructorActVerdict({ ...base, act, credential: undefined, reason: 'placeholder' }), credentialId: null });
  for (const c of credentials) for (const act of ['accept', 'reject', 'withdraw'] as const) out.push({ ...instructorActVerdict({ ...base, act, credential: { status: c.status, documentScanStatus: c.documentScanStatus }, reason: 'placeholder' }), credentialId: c.id });
  return out;
}
