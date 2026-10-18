// modules/partner-console/domain/partner-keys.rules.ts · PC-56 PARTNER-1b · founder D1 / D2 — THE PARTNER'S OWN KEYS AND ENDPOINTS, PURE (no I/O).
//
//   • the REVOKE REASON rule: 20–300 characters after whitespace is collapsed (0227's `partner_console_revoke_key` refuses the same bounds
//     — the database is the wall, this is the friendly answer before a round trip);
//   • the REVOKE TRANSITION over `{ revokedAt, isActive }`: a key that is not revoked may be revoked (an inactive-but-unrevoked key too —
//     revocation is the permanent fact, `is_active` alone is not); a revoked key is `already_revoked` (there is no un-revoke path);
//   • the PROJECTIONS: what a key / an endpoint / a delivery IS on the partner's console, built FIELD BY FIELD from an allow-list — a key
//     row never carries `keyHash` (or `key_hash`, or anything else not listed) whatever the input holds, an endpoint never carries its
//     `secret_enc`, a delivery never carries its `payload` or the originating `tenant_id`. The SQL never selects those columns either
//     (0227's definers and column grants); this is the second line, and the unit spec proves it for arbitrary input.
import { DELIVERY_STATES, type DeliveryState } from '../../tenant-webhooks/domain/webhook-rail.state';

export const KEY_REVOKE_REASON_MIN = 20;
export const KEY_REVOKE_REASON_MAX = 300;

/** The reason as it is stored: whitespace runs collapsed, trimmed. */
export function cleanKeyReason(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}
/** true when the reason is acceptable (20–300 characters once cleaned). */
export function keyReasonOk(raw: unknown): boolean {
  const r = cleanKeyReason(raw);
  return r.length >= KEY_REVOKE_REASON_MIN && r.length <= KEY_REVOKE_REASON_MAX;
}

export type RevokeVerdict = 'ok' | 'already_revoked';
/** The revoke transition — permanent: once `revokedAt` is set, nothing (not even `isActive = true`) makes the key revocable or usable again. */
export function revokeTransition(k: { revokedAt: string | Date | null | undefined; isActive: boolean }): RevokeVerdict {
  return k.revokedAt ? 'already_revoked' : 'ok';
}

export type KeyStatus = 'active' | 'inactive' | 'revoked';
export function keyStatus(k: { revokedAt: string | null; isActive: boolean }): KeyStatus {
  if (k.revokedAt) return 'revoked';
  return k.isActive ? 'active' : 'inactive';
}

/** What the partner console shows of one key. There is no hash field on this type, by construction. */
export interface PartnerKeyView {
  id: string; name: string; keyPrefix: string; scopes: string[]; rateLimitPerHour: number; status: KeyStatus;
  lastUsedAt: string | null; revokedAt: string | null; revokedReason: string | null; createdAt: string | null;
}
const iso = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : new Date(v as string).toISOString());
const pick = (x: Record<string, unknown>, camel: string, snake: string): unknown => (camel in x ? x[camel] : x[snake]);

/** A key row (snake_case from SQL or camelCase) → the console's view. Only the listed fields are copied; anything else is dropped. */
export function projectKey(row: Record<string, unknown>): PartnerKeyView {
  const revokedAt = iso(pick(row, 'revokedAt', 'revoked_at'));
  const isActive = pick(row, 'isActive', 'is_active') === true;
  const scopes = pick(row, 'scopes', 'scopes');
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    keyPrefix: String(pick(row, 'keyPrefix', 'key_prefix') ?? ''),
    scopes: Array.isArray(scopes) ? scopes.map(String) : [],
    rateLimitPerHour: Number(pick(row, 'rateLimitPerHour', 'rate_limit_per_hour') ?? 0),
    status: keyStatus({ revokedAt, isActive }),
    lastUsedAt: iso(pick(row, 'lastUsedAt', 'last_used_at')),
    revokedAt,
    revokedReason: (pick(row, 'revokedReason', 'revoked_reason') as string | null | undefined) ?? null,
    createdAt: iso(pick(row, 'createdAt', 'created_at')),
  };
}

/** What the partner console shows of one of its endpoints: the URL as stored (it is the partner's own), the events, active — never a secret. */
export interface PartnerEndpointView { id: string; url: string; eventTypes: string[]; active: boolean; createdAt: string | null }
export function projectEndpoint(row: Record<string, unknown>): PartnerEndpointView {
  const ev = pick(row, 'eventTypes', 'event_types');
  return {
    id: String(row.id ?? ''), url: String(row.url ?? ''), eventTypes: Array.isArray(ev) ? ev.map(String) : [],
    active: pick(row, 'active', 'is_active') === true, createdAt: iso(pick(row, 'createdAt', 'created_at')),
  };
}

/** One delivery on the console: no payload body (the partner received it on the wire) and never the originating tenant. */
export interface PartnerDeliveryView {
  id: string; endpointId: string; eventType: string; state: DeliveryState | string; attempts: number; lastStatusCode: number | null;
  lastError: string | null; createdAt: string; lastAttemptAt: string | null; deliveredAt: string | null; replayCount: number;
}
export function projectDelivery(row: Record<string, unknown>): PartnerDeliveryView {
  return {
    id: String(row.id ?? ''), endpointId: String(pick(row, 'endpointId', 'endpoint_id') ?? ''), eventType: String(pick(row, 'eventType', 'event_type') ?? ''),
    state: String(row.state ?? ''), attempts: Number(pick(row, 'attempts', 'attempt') ?? 0),
    lastStatusCode: (pick(row, 'lastStatusCode', 'status_code') as number | null | undefined) ?? null,
    lastError: (pick(row, 'lastError', 'last_error') as string | null | undefined) ?? null,
    createdAt: iso(pick(row, 'createdAt', 'created_at')) ?? '', lastAttemptAt: iso(pick(row, 'lastAttemptAt', 'last_attempt_at')),
    deliveredAt: iso(pick(row, 'deliveredAt', 'delivered_at')), replayCount: Number(pick(row, 'replayCount', 'replay_count') ?? 0),
  };
}
/** One attempt of a delivery: the outcome, the HTTP code, how long, the error class text, when it was signed — never the signature. */
export interface PartnerAttemptView { attemptNo: number; outcome: string; statusCode: number | null; durationMs: number; error: string | null; signedAt: string | null; createdAt: string | null }
export function projectAttempt(row: Record<string, unknown>): PartnerAttemptView {
  return {
    attemptNo: Number(pick(row, 'attemptNo', 'attempt_no') ?? 0), outcome: String(row.outcome ?? ''),
    statusCode: (pick(row, 'statusCode', 'status_code') as number | null | undefined) ?? null, durationMs: Number(pick(row, 'durationMs', 'duration_ms') ?? 0),
    error: (row.error as string | null | undefined) ?? null, signedAt: iso(pick(row, 'signedAt', 'signed_at')), createdAt: iso(pick(row, 'createdAt', 'created_at')),
  };
}

/** The deliveries list's filters: a state from the rail's own vocabulary, or nothing. */
export const isDeliveryState = (v: unknown): v is DeliveryState => typeof v === 'string' && (DELIVERY_STATES as readonly string[]).includes(v);
