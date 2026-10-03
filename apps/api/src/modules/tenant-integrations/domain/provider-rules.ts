// modules/tenant-integrations/domain/provider-rules.ts · PC-56 TENANT-13c (F-8, founder decision 2026-10-03: credentials VERIFIED against
// the provider before vaulting; a platform allow-list of tenant-ownable providers; DIRECT SETTLEMENT REFUSED BY NAME). PURE.
//
// THE TRUTH THIS FILE CARRIES: a tenant connection is stored, verified and re-verified — and READ BY NO PLATFORM PATH. Payments run on
// the platform's Razorpay account and SMS on the platform's route; nothing in apps/api or apps/worker reads `tenant_integrations.
// secret_ref` except the verification job. So the console never says "active": it says `verified` / `verify_failed` / `disconnected`
// and prints the consumers list below, which is EMPTY for every provider today. A spec scans the code for SECRET_READER injections so
// the day a payment path starts reading a tenant's credential, this list (and the founder's Law 9 review) has to change with it.

export interface CredentialField { name: string; secret: boolean; pattern: string }
export type VerifyClass = 'auth' | 'network' | 'unknown';
export interface VerifyResult { ok: boolean; errorClass: VerifyClass | null; detail: string; httpStatus: number | null; durationMs: number }

/** The code paths that READ a tenant's connection, per provider. Empty for all: connected and verified, not yet used. */
export const INTEGRATION_CONSUMERS: Readonly<Record<string, readonly string[]>> = Object.freeze({ razorpay: [], gupshup: [], inaph: [] });
export function consumersOf(providerCode: string): readonly string[] { return INTEGRATION_CONSUMERS[providerCode] ?? []; }
/** The ONLY files allowed to inject SECRET_READER (pinned by the unit spec). */
export const SECRET_READER_ALLOWED_FILES: readonly string[] = Object.freeze([
  'modules/tenant-integrations/tenant-integrations.module.ts',
  'modules/tenant-integrations/services/tenant-integration.service.ts',
]);

/** "Direct settlement to your own account" — refused by name (Law 9: a payments / MONEY change, its own wave). */
export const DIRECT_SETTLEMENT = Object.freeze({ available: false as const, reason: 'law9_own_wave' as const });

export const REASON_MIN = 20;
export const REASON_MAX = 500;
export function reasonRefusal(reason: string | null | undefined): string | null {
  const r = String(reason ?? '').trim();
  return r.length < REASON_MIN || r.length > REASON_MAX ? 'reason_length' : null;
}

/** Parse the provider's credential field list (DB `credential_fields`); anything malformed is dropped (never trusted as a pattern). */
export function credentialFieldsOf(raw: unknown): CredentialField[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f: any) => (f && typeof f.name === 'string' && typeof f.pattern === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(f.name)
    ? [{ name: f.name, secret: Boolean(f.secret), pattern: f.pattern }] : []));
}

/** Every refusal the credential earns, per field (the values never appear in a refusal). */
export function credentialRefusals(fields: readonly CredentialField[], input: Record<string, unknown> | null | undefined): { field: string; code: string }[] {
  const out: { field: string; code: string }[] = [];
  const given = input ?? {};
  for (const k of Object.keys(given)) if (!fields.some((f) => f.name === k)) out.push({ field: k, code: 'field_unknown' });
  for (const f of fields) {
    const v = given[f.name];
    if (typeof v !== 'string' || !v.trim()) { out.push({ field: f.name, code: 'field_required' }); continue; }
    let re: RegExp;
    try { re = new RegExp(f.pattern); } catch { out.push({ field: f.name, code: 'field_invalid' }); continue; }
    if (v.length > 600 || !re.test(v.trim())) out.push({ field: f.name, code: 'field_invalid' });
  }
  if (fields.length === 0) out.push({ field: 'credential', code: 'provider_has_no_credential_fields' });
  return out;
}

export function cleanCredential(fields: readonly CredentialField[], input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, String(input[f.name] ?? '').trim()]));
}
/** The non-secret part of a credential (an account / sender id) — kept as config so the console can print it. */
export function nonSecretConfig(fields: readonly CredentialField[], cred: Record<string, string>): Record<string, string> {
  return Object.fromEntries(fields.filter((f) => !f.secret).map((f) => [f.name, cred[f.name]]));
}
/** A hint that tells two credentials apart without revealing one: the last 4 of the first non-secret field, else `••` + the last 2
 *  of the first secret field. ≤ 12 characters. */
export function credentialHint(fields: readonly CredentialField[], cred: Record<string, string>): string {
  const open = fields.find((f) => !f.secret && cred[f.name]);
  if (open) return `…${cred[open.name].slice(-4)}`;
  const sec = fields.find((f) => f.secret && cred[f.name]);
  return sec ? `••${cred[sec.name].slice(-2)}` : '••';
}
/** The vault reference as the API returns it: `…••41` — never the ARN. */
export function maskedRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return `…••${String(ref).slice(-2)}`;
}

/** An HTTP answer from a verification endpoint → its class. 2xx ok; 401/403 auth; 408/429/5xx network; the rest unknown. */
export function classifyStatus(status: number): VerifyClass | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'network';
  return 'unknown';
}

/** The masked, storable form of a verification (never a credential, never a response body). */
export function storableResult(r: VerifyResult, at: string) {
  return { ok: r.ok, errorClass: r.errorClass, detail: r.detail.slice(0, 200), httpStatus: r.httpStatus, durationMs: r.durationMs, at };
}

/** Health (24 h) from the check rows — a COUNT and the last good instant, never a rate of calls nobody makes. */
export function healthLine(h: { checks24h: number; ok24h: number; lastOkAt: string | null; lastCheckAt: string | null }) {
  return { checks24h: h.checks24h, ok24h: h.ok24h, failed24h: h.checks24h - h.ok24h, lastOkAt: h.lastOkAt, lastCheckAt: h.lastCheckAt };
}
