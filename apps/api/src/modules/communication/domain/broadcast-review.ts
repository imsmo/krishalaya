// modules/communication/domain/broadcast-review.ts · PC-56 TENANT-8e · THE BROADCAST FORM'S REVIEW (W2841–W2844). PURE.
//
// The canon's form chain on the `whatsapp` module has ONE act — *Save draft* — and on this platform the draft it saves is
// an IN-APP ANNOUNCEMENT, because that is the only broadcast the platform can make (no WhatsApp provider — F-15). The
// review is what the writer will store and every reason it would refuse, computed from the facts the writer uses:
//   • the words — plain text (no `<` / `>`: they are rendered into an in-app item and a push, never as markup), title ≤160,
//     body ≤2000, both required (0048's bounds, 0179's `ck_tb_words_plain`);
//   • the audience — everyone, or a role the `roles` registry holds as an ACTIVE TENANT role (F-16), and not empty;
//   • the channel — `inapp`; `whatsapp` is refused by name while `whatsapp_provider_connected()` is false (0179's CHECK
//     refuses it underneath);
//   • the schedule — optional; a wall-clock `YYYY-MM-DDTHH:MM` read in the COOPERATIVE's zone (7c's resolution), a
//     wall-clock that does not exist in that zone (a DST gap) refused by name, at least `MIN_LEAD_MINUTES` ahead and at most
//     `MAX_LEAD_DAYS`;
//   • for an edit: the draft must still be a draft, and something must change.
// What a draft does NOT need (and the review says, without refusing): templates that serve. A missing frame refuses the
// SEND (`broadcast-acts.ts`, and 0179's trigger at enqueue) — the draft can be written and waits.
import { localParts, wallToInstant } from './quiet-window';
import { ReviewDiffRow, ReviewField, ReviewRefusal, field } from '../../../shared/form-review';

export const BROADCAST_TITLE_MAX = 160;
export const BROADCAST_BODY_MAX = 2000;
export const MIN_LEAD_MINUTES = 5;
export const MAX_LEAD_DAYS = 30;
export const BROADCAST_FORM_FIELDS = ['title', 'body', 'audienceRoleCode', 'scheduledAt', 'channel'] as const;
export type BroadcastFormField = (typeof BROADCAST_FORM_FIELDS)[number];

export const BROADCAST_FORM_REFUSALS = [
  'NO_PERMISSION', 'NOT_EDITABLE', 'NOTHING_CHANGED',
  'TITLE_REQUIRED', 'TITLE_TOO_LONG', 'BODY_REQUIRED', 'BODY_TOO_LONG', 'TEXT_HAS_MARKUP',
  'ROLE_UNKNOWN', 'AUDIENCE_EMPTY',
  'CHANNEL_UNKNOWN', 'CHANNEL_NO_PROVIDER',
  'SCHEDULE_INVALID', 'SCHEDULE_NOT_ON_CLOCK', 'SCHEDULE_TOO_SOON', 'SCHEDULE_TOO_FAR', 'ZONE_UNKNOWN',
] as const;
export type BroadcastFormRefusal = (typeof BROADCAST_FORM_REFUSALS)[number];

const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/** Collapse runs of spaces/tabs on each line, trim the whole; blank → null. Line breaks are the author's and stay. */
export function cleanWords(raw: string | null | undefined): string | null {
  const s = (raw ?? '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').trim();
  return s.length === 0 ? null : s;
}
export function hasMarkup(s: string | null): boolean { return s !== null && /[<>]/.test(s); }

export type ScheduleParse =
  | { kind: 'none' }
  | { kind: 'ok'; at: Date; local: string }
  | { kind: 'invalid' } | { kind: 'not_on_clock' } | { kind: 'no_zone' };

/** `YYYY-MM-DDTHH:MM` in `zone` → the instant, or why not. The wall-clock must read back unchanged (no DST gap). */
export function parseSchedule(raw: string | null | undefined, zone: string | null): ScheduleParse {
  const s = (raw ?? '').trim();
  if (s.length === 0) return { kind: 'none' };
  const m = WALL.exec(s);
  if (!m) return { kind: 'invalid' };
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return { kind: 'invalid' };
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return { kind: 'invalid' };
  if (!zone) return { kind: 'no_zone' };
  const at = wallToInstant(y, mo, d, h * 60 + mi, zone);
  const back = localParts(at, zone);
  if (back.y !== y || back.m !== mo || back.d !== d || back.minutes !== h * 60 + mi) return { kind: 'not_on_clock' };
  return { kind: 'ok', at, local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` };
}

/** The instant as the cooperative's wall-clock (`YYYY-MM-DDTHH:MM`) — what the form shows back. */
export function toLocalWall(at: Date, zone: string): string {
  const p = localParts(at, zone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${two(p.m)}-${two(p.d)}T${two(Math.floor(p.minutes / 60))}:${two(p.minutes % 60)}`;
}

export interface BroadcastFormInput { title?: string; body?: string; audienceRoleCode?: string; scheduledAt?: string; channel?: string }
export interface BroadcastDraftFacts {
  canSend: boolean;
  /** The registry's answer for the normalised role (null when none was named). */
  roleKnown: boolean | null;
  audienceSize: number;
  whatsappConnected: boolean;
  zone: string | null;
  now: Date;
  /** The draft being edited, or null for a new one. */
  existing: { status: string; title: string; body: string; audienceRoleCode: string | null; scheduledAt: Date | null; channel: string } | null;
}
export interface BroadcastStored {
  title: string | null; body: string | null; audienceRoleCode: string | null; scheduledAt: Date | null; channel: 'inapp' | 'whatsapp' | null;
}
export interface BroadcastFormReview {
  ready: boolean; fields: ReviewField[]; refusals: ReviewRefusal[]; diff: ReviewDiffRow[] | null; entityType: 'tenant_broadcast';
  stored: BroadcastStored; mode: 'create' | 'update';
}

export function reviewBroadcastDraft(input: BroadcastFormInput, f: BroadcastDraftFacts): BroadcastFormReview {
  const refusals: ReviewRefusal[] = [];
  const refuse = (fieldName: BroadcastFormField | null, code: BroadcastFormRefusal) => {
    if (!refusals.some((r) => r.field === fieldName && r.code === code)) refusals.push({ field: fieldName, code });
  };
  if (!f.canSend) refuse(null, 'NO_PERMISSION');
  if (f.existing && f.existing.status !== 'draft') refuse(null, 'NOT_EDITABLE');

  const title = cleanWords((input.title ?? '').replace(/\s*\n\s*/g, ' '));   // a title is one line
  const body = cleanWords(input.body);
  if (title === null) refuse('title', 'TITLE_REQUIRED');
  else {
    if (title.length > BROADCAST_TITLE_MAX) refuse('title', 'TITLE_TOO_LONG');
    if (hasMarkup(title)) refuse('title', 'TEXT_HAS_MARKUP');
  }
  if (body === null) refuse('body', 'BODY_REQUIRED');
  else {
    if (body.length > BROADCAST_BODY_MAX) refuse('body', 'BODY_TOO_LONG');
    if (hasMarkup(body)) refuse('body', 'TEXT_HAS_MARKUP');
  }

  const role = (input.audienceRoleCode ?? '').trim().toLowerCase() || null;
  if (role !== null && f.roleKnown !== true) refuse('audienceRoleCode', 'ROLE_UNKNOWN');
  else if (f.audienceSize <= 0) refuse('audienceRoleCode', 'AUDIENCE_EMPTY');

  const channelRaw = (input.channel ?? '').trim().toLowerCase();
  let channel: 'inapp' | 'whatsapp' | null = 'inapp';
  if (channelRaw === 'whatsapp') { channel = 'whatsapp'; if (!f.whatsappConnected) refuse('channel', 'CHANNEL_NO_PROVIDER'); }
  else if (channelRaw !== '' && channelRaw !== 'inapp') { channel = null; refuse('channel', 'CHANNEL_UNKNOWN'); }

  const sched = parseSchedule(input.scheduledAt, f.zone);
  let scheduledAt: Date | null = null;
  if (sched.kind === 'invalid') refuse('scheduledAt', 'SCHEDULE_INVALID');
  else if (sched.kind === 'not_on_clock') refuse('scheduledAt', 'SCHEDULE_NOT_ON_CLOCK');
  else if (sched.kind === 'no_zone') refuse('scheduledAt', 'ZONE_UNKNOWN');
  else if (sched.kind === 'ok') {
    scheduledAt = sched.at;
    const lead = sched.at.getTime() - f.now.getTime();
    if (lead < MIN_LEAD_MINUTES * 60_000) refuse('scheduledAt', 'SCHEDULE_TOO_SOON');
    else if (lead > MAX_LEAD_DAYS * 86_400_000) refuse('scheduledAt', 'SCHEDULE_TOO_FAR');
  }

  const wall = (d: Date | null) => (d && f.zone ? toLocalWall(d, f.zone) : null);
  const fields: ReviewField[] = [
    field('title', input.title ?? null, title),
    field('body', input.body ?? null, body),
    field('audienceRoleCode', input.audienceRoleCode ?? null, role),
    field('scheduledAt', input.scheduledAt ?? null, wall(scheduledAt)),
    field('channel', input.channel ?? null, channel),
  ];

  let diff: ReviewDiffRow[] | null = null;
  if (f.existing) {
    const e = f.existing;
    diff = [];
    const row = (name: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: name, before, after }); };
    row('title', e.title, title); row('body', e.body, body); row('audienceRoleCode', e.audienceRoleCode, role);
    row('scheduledAt', wall(e.scheduledAt), wall(scheduledAt)); row('channel', e.channel, channel);
    if (diff.length === 0 && e.status === 'draft') refuse(null, 'NOTHING_CHANGED');
  }
  return {
    ready: refusals.length === 0, fields, refusals, diff, entityType: 'tenant_broadcast',
    stored: { title, body, audienceRoleCode: role, scheduledAt, channel }, mode: f.existing ? 'update' : 'create',
  };
}
