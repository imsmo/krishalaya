// apps/web-tenant/src/features/studio/instructor.ts · PURE helpers for the instructor — PC-56 TENANT-7d.
//
// Two canon screens and three chains over the instructor's row: **W410** (the studio home — *"Your teaching, in one
// place"*), **W419** (profile & credentials — *"Learners trust the person before the playlist"*), **W2636–W2639** (the
// instructor FORM: *Save profile · Add credential*), **W2640–W2642** (the instructor MUTATE: *Retry*) and **W2775–W2778**
// (the studio FORM: *Start from template*). The API computes every verdict and every review; this file turns them into
// hrefs, keys and states, and holds the rulings the pages rely on:
//
//   • THE BADGE IS A TRUST SURFACE. *"verified instructor"* / `is_verified` is drawn ONLY from the API's `isVerified`,
//     which since 0173 is written by the desk's `verify` act alone (maker ≠ checker, on an accepted credential) and
//     revoked by `unverify`. Before 0173 the column was written by nothing; a page drawing it would have drawn a lie.
//   • REFUSED BY NAME, because nothing on this platform performs them: W419's *"Rating 4.8 / 5 from enrolled learners"*
//     (no table — `rating` is typed `null` by the API), *"verified against the certificate face"* (no face is matched;
//     the desk's accept is a person's act), the *"Couldn't verify the credential … Retry"* (no automated check to
//     retry) and *"Watch-hours THIS MONTH"* (lesson_progress has no timestamp — the LIFETIME sum is the fact, and the
//     month is named as unmeasured). W410's *"Earnings MTD"* tile is W418's number since 7d-money (0174): this tile
//     prints the share on record and LINKS to the earnings desk, where every figure is a sum over the royalty ledger.
//   • NO ARITHMETIC THIS FILE INVENTS beyond integer conversion of the API's sums: `watchHours` is seconds ÷ 3600 in
//     integer arithmetic on a string the API sent (a bigint as text), rounded down and never averaged.
import type { CompletenessCheck, CredentialStatus, CredentialView, InstructorAct, InstructorActVerdict, InstructorView, StudioView } from '@krishalaya/sdk-js';

/* --------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export const STUDIO_PATH = '/studio';
export function studioHref(): string { return STUDIO_PATH; }
export const PROFILE_PATH = `${STUDIO_PATH}/profile`;
/** W419: the caller's own profile, or — for the desk — another instructor's by id. */
export function profileHref(instructorId?: string | null): string { return instructorId ? `${PROFILE_PATH}?instructor=${encodeURIComponent(instructorId)}` : PROFILE_PATH; }
export const PROFILE_FORM_PATH = `${PROFILE_PATH}/edit`;
export type InstructorForm = 'profile' | 'credential';
export function instructorForm(raw: string | null | undefined): InstructorForm { return raw === 'credential' ? 'credential' : 'profile'; }
/** The instructor FORM chain: *Save profile*, *Add credential*, or `?credential=` for a re-upload of a rejected one. */
export function editProfileHref(): string { return PROFILE_FORM_PATH; }
export function addCredentialHref(): string { return `${PROFILE_FORM_PATH}?form=credential`; }
export function reuploadHref(credentialId: string): string { return `${PROFILE_FORM_PATH}?form=credential&credential=${encodeURIComponent(credentialId)}`; }
export const PROFILE_ACT_PATH = `${PROFILE_PATH}/act`;
/** The instructor MUTATE chain's confirm step — the reason travels in the URL until it is written. */
export function instructorActHref(instructorId: string, act: InstructorAct, credentialId?: string | null): string {
  const sp = new URLSearchParams({ step: 'confirm', instructor: instructorId, act });
  if (credentialId) sp.set('credentialId', credentialId);
  return `${PROFILE_ACT_PATH}?${sp.toString()}`;
}
export const TEMPLATE_FORM_PATH = `${STUDIO_PATH}/from-template`;
export function fromTemplateHref(templateCode?: string | null): string { return templateCode ? `${TEMPLATE_FORM_PATH}?templateCode=${encodeURIComponent(templateCode)}` : TEMPLATE_FORM_PATH; }
export const INSTRUCTORS_PATH = `${STUDIO_PATH}/instructors`;
export function instructorsHref(q: { verified?: string; cursor?: string | null } = {}): string {
  const sp = new URLSearchParams();
  if (q.verified === 'true' || q.verified === 'false') sp.set('verified', q.verified);
  if (q.cursor) sp.set('cursor', q.cursor);
  const s = sp.toString();
  return s.length ? `${INSTRUCTORS_PATH}?${s}` : INSTRUCTORS_PATH;
}

/* --------------------------------------------------------------------------------------------------------- */
/* W410 · THE STUDIO HOME                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export type StudioState = 'ready' | 'noProfile' | 'restricted' | 'notEnabled' | 'error';
/** The six states, from the transport and the view: no education verb → restricted; a verb and no row → the honest "create your profile" desk. */
export function studioState(code: string | null | undefined, status: number | undefined, view: StudioView | null): StudioState {
  if (view) return view.instructor ? 'ready' : 'noProfile';
  if (code === 'FORBIDDEN' || code === 'EDUCATION_FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function studioStateKey(s: StudioState): string { return `studio.state.${s}`; }

/** Whole watch-hours from a bigint-as-text of seconds; never a decimal, never an average. */
export function watchHoursText(watchSeconds: string): string {
  if (!/^\d+$/.test(watchSeconds)) return '0';
  return String(BigInt(watchSeconds) / 3600n);
}
export const COURSE_STATE_ORDER = ['draft', 'review', 'published', 'paused', 'archived'] as const;
/** W410's "My courses" by state, in the order a course moves through them; zero rows are still listed so the desk reads whole. */
export function coursesByState(byStatus: Record<string, number>): Array<{ status: string; n: number }> {
  return COURSE_STATE_ORDER.map((status) => ({ status, n: byStatus[status] ?? 0 }));
}
/** W410's four tiles — three measured here; earnings is measured on W418 (7d-money) and this tile links to it. */
export const STUDIO_TILES = ['learners', 'watchHours', 'certificates', 'earnings'] as const;
export type StudioTile = (typeof STUDIO_TILES)[number];
export function tileKey(t: StudioTile, part: 'label' | 'sub'): string { return `studio.tile.${t}.${part}`; }
export function tileMeasured(t: StudioTile): boolean { return t !== 'earnings'; }
export function completenessKey(c: CompletenessCheck): string { return `studio.completeness.${c}`; }
export function completenessDone(view: Pick<InstructorView, 'completeness'>): { done: number; of: number } {
  return { done: view.completeness.filter((c) => c.done).length, of: view.completeness.length };
}
/** Everything W410/W419 draw that this platform does not perform — printed by name, never as a control or a figure. */
export const REFUSED_BY_NAME = ['watchMonth', 'rating', 'faceMatch', 'retry', 'learnerInsights', 'tenantTemplates', 'deactivate'] as const;
export function refusedKey(name: (typeof REFUSED_BY_NAME)[number]): string { return `studio.refused.${name}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* W419 · THE PROFILE                                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

export const CREDENTIAL_STATUS_VALUES: readonly CredentialStatus[] = ['submitted', 'accepted', 'rejected', 'withdrawn'];
export function credentialStatusKey(s: CredentialStatus): string { return `profile.credential.status.${s}`; }
export type DocumentState = 'pending' | 'clean' | 'infected' | 'failed' | 'unknown';
/** The scan state of the credential's document: what core/media knows, never a face match. */
export function documentState(c: Pick<CredentialView, 'document'>): DocumentState {
  const s = c.document?.scanStatus;
  return s === 'clean' || s === 'infected' || s === 'failed' || s === 'pending' ? s : 'unknown';
}
export function documentStateKey(s: DocumentState): string { return `profile.document.${s}`; }
export function visibilityKey(v: string): string { return `profile.visibility.${v}`; }
export const INSTRUCTOR_ACT_VALUES: readonly InstructorAct[] = ['verify', 'unverify', 'accept', 'reject', 'withdraw'];
export function actLabelKey(act: InstructorAct): string { return `profile.act.${act}`; }
export function actDoneKey(act: InstructorAct): string { return `profile.done.${act}`; }
export function verdictFor(acts: readonly InstructorActVerdict[], act: InstructorAct, credentialId: string | null): InstructorActVerdict | null {
  return acts.find((v) => v.act === act && (v.credentialId ?? null) === credentialId) ?? null;
}
/** The acts a page offers as buttons: allowed, or refused WITH the first reason printed; `REASON_REQUIRED` is the confirm step's question. */
export function offeredActs(acts: readonly InstructorActVerdict[], credentialId: string | null): Array<{ act: InstructorAct; allowed: boolean; why: string | null }> {
  const mine = acts.filter((v) => (v.credentialId ?? null) === credentialId);
  return mine
    .map((v) => { const refusals = v.refusals.filter((r) => r !== 'REASON_REQUIRED'); return { act: v.act, allowed: refusals.length === 0, why: refusals[0] ?? null }; })
    // acts whose only refusal is the row's stage are not offered at all — a withdrawn credential has no "Reject" button
    .filter((a) => a.allowed || a.why !== 'ILLEGAL_FROM_STATUS');
}
/** Whether the page draws the badge: only the API's fact, never a local inference. */
export function verifiedBadge(view: Pick<InstructorView, 'instructor'>): boolean { return view.instructor.isVerified === true; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE CHAINS                                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

export const PROFILE_FORM = 'profile';
export const CREDENTIAL_FORM = 'credential';
export const TEMPLATE_FORM = 'template';
export const PROFILE_FIELDS = ['displayName', 'bio', 'languages', 'visibility'] as const;
export const CREDENTIAL_FIELDS = ['title', 'issuer', 'yearAwarded', 'documentMediaId'] as const;
export const TEMPLATE_FIELDS = ['templateCode', 'title'] as const;
export const INSTRUCTOR_MUTATE_FIELDS = ['act', 'reason', 'credentialId', 'instructor'] as const;
/** The bio travels in the URL (6d-4's ruling); it may run to 2,000 characters, so this chain declares its own ceiling as 7b's did. */
export const MAX_CARRIED_LENGTH_PROFILE = 3000;
/** The languages come off the form as repeated checkboxes; they travel as ONE comma-joined value the API parses. */
export function joinLanguages(raw: string | string[] | undefined): string | undefined {
  const arr = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const codes: string[] = [];
  for (const v of arr) for (const c of v.split(',')) { const t = c.trim().toLowerCase(); if (t.length > 0 && !codes.includes(t)) codes.push(t); }
  return codes.length ? codes.join(',') : undefined;
}
export function languageChecked(values: Record<string, string | undefined>, code: string): boolean { return (values.languages ?? '').split(',').map((s) => s.trim()).includes(code); }
export function formDoneKey(form: InstructorForm, isRefile: boolean): string { return form === 'profile' ? 'form.profile.done' : isRefile ? 'form.credential.doneRefile' : 'form.credential.done'; }
/** Where a chain's *Back to the screen* goes: the profile (the desk's, when it is another instructor's). */
export function backFromChain(instructorId: string | null, isSelf: boolean): string { return isSelf || !instructorId ? profileHref() : profileHref(instructorId); }
/** Which acts need a credential named on the confirm step. */
export function actNeedsCredential(act: InstructorAct): boolean { return act === 'accept' || act === 'reject' || act === 'withdraw'; }
