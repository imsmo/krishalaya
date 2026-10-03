// modules/tenant-webhooks/domain/webhook-rules.ts · PURE review / verdict rules for the webhook chains — PC-56 TENANT-13a (W2832–W2838,
// W2829–W2831). The review page and the write ask the SAME questions here, so the form-error screen and the API's refusal can never
// disagree. Every refusal is a code by name, against the field to blame (or none).
import { randomBytes } from 'node:crypto';
import { catalogueEntry } from './webhook-catalog';
import type { GuardReason, TargetVerdict } from './webhook-ssrf';
import {
  DeliveryState, EndpointStatus, FAILED_STATES, REPLAYABLE_STATES, RESUMABLE_STATES, ROTATION_OVERLAP_HOURS, canEndpointMove,
} from './webhook-rail.state';
import type { WebhookRefusal } from './tenant-webhooks.errors';

export const REASON_MIN = 3;
export const REASON_MAX = 300;
export const URL_MAX = 500;
export const EVENTS_MAX = 50;
export const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;   // mirrors 0191's ck_webhook_endpoints_email
export const SECRET_PREFIX = 'whsec_';

/** `whsec_` + 32 random bytes, base64url (43 characters). */
export function generateSecret(): string { return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`; }
/** The masked hint stored apart from the ciphertext: the last 3 characters. */
export function secretHint(secret: string): string { return secret.slice(-3); }

export function reasonRefusal(reason: string | null | undefined): string | null {
  const s = (reason ?? '').trim();
  if (s.length < REASON_MIN) return 'REASON_REQUIRED';
  if (s.length > REASON_MAX) return 'REASON_TOO_LONG';
  return null;
}

export const URL_REFUSAL: Readonly<Record<GuardReason, string>> = {
  invalid_url: 'URL_INVALID', not_https: 'URL_NOT_HTTPS', has_credentials: 'URL_HAS_CREDENTIALS', bad_port: 'URL_BAD_PORT', no_host: 'URL_INVALID',
  blocked_host: 'URL_BLOCKED_HOST', single_label_host: 'URL_SINGLE_LABEL_HOST', private_address: 'URL_PRIVATE_ADDRESS', unresolvable: 'URL_UNRESOLVABLE',
  no_address: 'URL_UNRESOLVABLE',
};

export interface RegistrationInput { url?: string | null; eventTypes?: readonly string[] | null; developerEmail?: string | null }
export interface RegistrationReview {
  ready: boolean;
  refusals: WebhookRefusal[];
  url: { value: string; verdict: 'public' | 'refused' | 'not_checked'; reason: GuardReason | null; host: string | null; addresses: string[] };
  events: Array<{ name: string; payloadVersion: number; fields: readonly string[] }>;
  developerEmail: string;
}

/** The registration review (W2833) — the guard verdict is computed by the caller (it resolves DNS) and judged here. */
export function reviewRegistration(input: RegistrationInput, guard: TargetVerdict | null): RegistrationReview {
  const refusals: WebhookRefusal[] = [];
  const url = (input.url ?? '').trim();
  if (!url) refusals.push({ field: 'url', code: 'URL_REQUIRED' });
  else if (url.length > URL_MAX) refusals.push({ field: 'url', code: 'URL_TOO_LONG' });
  else if (guard && !guard.ok) refusals.push({ field: 'url', code: URL_REFUSAL[guard.reason] });

  const names = [...new Set((input.eventTypes ?? []).map((e) => String(e).trim()).filter(Boolean))];
  const events: RegistrationReview['events'] = [];
  if (names.length === 0) refusals.push({ field: 'eventTypes', code: 'EVENTS_REQUIRED' });
  if (names.length > EVENTS_MAX) refusals.push({ field: 'eventTypes', code: 'EVENTS_TOO_MANY' });
  for (const n of names) {
    const c = catalogueEntry(n);
    if (!c) refusals.push({ field: 'eventTypes', code: 'EVENT_UNKNOWN' });
    else events.push({ name: c.name, payloadVersion: c.version, fields: c.fields });
  }

  const email = (input.developerEmail ?? '').trim();
  if (!email) refusals.push({ field: 'developerEmail', code: 'EMAIL_REQUIRED' });
  else if (email.length > 254 || !EMAIL_RE.test(email)) refusals.push({ field: 'developerEmail', code: 'EMAIL_INVALID' });

  return {
    ready: refusals.length === 0, refusals,
    url: {
      value: url,
      verdict: !guard ? 'not_checked' : guard.ok ? 'public' : 'refused',
      reason: guard && !guard.ok ? guard.reason : null,
      host: guard ? (guard.ok ? guard.host : guard.host ?? null) : null,
      addresses: guard && guard.ok ? guard.addresses.map((a) => a.address) : [],
    },
    events, developerEmail: email,
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* acts (the mutate chains)                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------------------ */
export const ENDPOINT_ACTS = ['pause', 'resume', 'rotate', 'delete', 'replay-failed'] as const;
export type EndpointAct = (typeof ENDPOINT_ACTS)[number];
export function isEndpointAct(a: string): a is EndpointAct { return (ENDPOINT_ACTS as readonly string[]).includes(a); }

export interface ActSubject { status: EndpointStatus; deleted: boolean; prevExpiresAt: string | null }
export interface ActVerdict {
  allowed: boolean;
  refusals: string[];
  /** what confirming does, as facts the confirm screen states before anything is pressed */
  effect: { holds?: number; replays?: number; cancels?: number; previousSignsUntil?: string | null; guard?: { verdict: 'public' | 'refused'; reason: GuardReason | null } };
}

/** The verdict for an endpoint act. `counts` = this endpoint's deliveries per state; `guard` only for resuming a disabled endpoint. */
export function endpointActVerdict(act: EndpointAct, e: ActSubject, counts: Record<DeliveryState, number>, reason: string | null | undefined,
  now: Date, guard: TargetVerdict | null = null, requireReason = true): ActVerdict {
  const refusals: string[] = [];
  const effect: ActVerdict['effect'] = {};
  if (e.deleted) refusals.push('ENDPOINT_DELETED');
  const sum = (states: readonly DeliveryState[]) => states.reduce((n, s) => n + (counts[s] ?? 0), 0);
  switch (act) {
    case 'pause':
      if (!canEndpointMove(e.status, 'paused', 'manual')) refusals.push('NOT_ACTIVE');
      effect.holds = sum(['pending', 'retrying']);
      break;
    case 'resume':
      if (!canEndpointMove(e.status, 'active', null)) refusals.push('NOT_PAUSED');
      if (e.status === 'disabled') {
        effect.guard = { verdict: guard && guard.ok ? 'public' : 'refused', reason: guard && !guard.ok ? guard.reason : guard ? null : 'unresolvable' };
        if (!guard || !guard.ok) refusals.push('GUARD_STILL_REFUSES');
      }
      effect.replays = sum(RESUMABLE_STATES);
      break;
    case 'rotate': {
      const live = e.prevExpiresAt && Date.parse(e.prevExpiresAt) > now.getTime();
      if (live) refusals.push('ROTATION_OVERLAP_LIVE');
      effect.previousSignsUntil = new Date(now.getTime() + ROTATION_OVERLAP_HOURS * 3600_000).toISOString();
      break;
    }
    case 'delete':
      effect.cancels = sum(['pending', 'retrying', 'held', 'exhausted']);
      break;
    case 'replay-failed':
      if (e.status !== 'active') refusals.push('ENDPOINT_NOT_ACTIVE');
      effect.replays = sum(FAILED_STATES);
      if (effect.replays === 0) refusals.push('NOTHING_TO_REPLAY');
      break;
  }
  if (requireReason) { const r = reasonRefusal(reason); if (r) refusals.push(r); }
  return { allowed: refusals.length === 0, refusals, effect };
}

/** The verdict for replaying ONE delivery. */
export function replayVerdict(d: { state: DeliveryState; endpointStatus: EndpointStatus; endpointDeleted: boolean }, reason: string | null | undefined, requireReason = true): { allowed: boolean; refusals: string[] } {
  const refusals: string[] = [];
  if (d.endpointDeleted) refusals.push('ENDPOINT_DELETED');
  else if (d.endpointStatus !== 'active') refusals.push('ENDPOINT_NOT_ACTIVE');
  if (!REPLAYABLE_STATES.includes(d.state)) refusals.push('STATE_NOT_REPLAYABLE');
  if (requireReason) { const r = reasonRefusal(reason); if (r) refusals.push(r); }
  return { allowed: refusals.length === 0, refusals };
}
