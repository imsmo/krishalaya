// apps/web-admin/src/features/integrations/api-oversight.ts · W106 / W007 view logic (PC-56 ADMIN-11c).
//
// **FOUR PAIRS THIS CONSOLE MUST KEEP APART**, and each of them rendered as one thing before the wave:
//   • a registry with no keys yet and a registry with no ISSUER (`api_keys`, untouched by any code since 0002);
//   • a rate LIMIT (a column) and hourly USAGE (a Redis counter this realm cannot reach);
//   • a delivery retrying and a delivery that will never arrive again (8 attempts, then silence);
//   • a signature that failed and a secret WE never configured — our outage in a security error's clothes.

export type Registry = 'tenant' | 'partner';
export type KeyState = 'active' | 'revoked' | 'dormant' | 'never_used';

export interface KeyRow {
  id: string;
  registry: Registry;
  ownerId: string;
  ownerName: string | null;
  name: string;
  keyPrefix: string;
  scopes: string[];
  ratePerHour: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  state: KeyState;
  idleDays: number | null;
  hourlyUsage: number | null;
}

/* ------------------------------------------------------------------------------------------------ */
/* WHICH REGISTRY IS REAL                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** **THE LABEL THAT STOPS A READER ADDING TWO NUMBERS TOGETHER.** `partner_api_keys` (PC-55 A10) is hashed, scoped,
 *  rate-limited and enforced by a live guard. `api_keys` has existed since migration 0002 and no code has ever written a
 *  row: no issuer, no gateway, no last-used stamp, no tenant console screen. One count over both would present a live
 *  partner integration and a dormant table as the same fact. */
export function registryKey(registry: Registry): string {
  return registry === 'partner' ? 'ap11.reg.partner' : 'ap11.reg.tenant';
}

export function registryNoticeKey(registry: Registry): string | null {
  return registry === 'tenant' ? 'ap11.reg.noIssuer' : null;
}

/** The empty state for the tenant registry. **"NO KEYS YET" WOULD BE THE WRONG SENTENCE** — it invites the reader to
 *  conclude tenants have not got round to it, when the truth is that nothing on this platform can create one. */
export function tenantEmptyKey(hasNoIssuer: boolean): string {
  return hasNoIssuer ? 'ap11.keys.emptyNoIssuer' : 'ap11.keys.empty';
}

/* ------------------------------------------------------------------------------------------------ */
/* KEY STATE                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export function keyStateKey(state: KeyState): string {
  const known = ['active', 'revoked', 'dormant', 'never_used'];
  return known.includes(state) ? `ap11.key.${state}` : 'ap11.key.unknown';
}

export function keyStateClass(state: KeyState): string {
  if (state === 'revoked') return 'kv-badge';
  if (state === 'dormant') return 'kv-badge is-warn';
  // **A KEY NOBODY HAS EVER USED IS A WARNING, NOT A NEUTRAL FACT.** On a live registry it is an integration that never
  // shipped, and an unused credential is a credential nobody would notice being stolen.
  return state === 'never_used' ? 'kv-badge is-warn' : 'kv-badge is-ok';
}

/** W106's own phrasing: "04 Apr (100d unused)". The number is the lever an operator pulls to decide on revocation. */
export function idleKey(k: Pick<KeyRow, 'lastUsedAt' | 'idleDays'>): string {
  if (!k.lastUsedAt) return 'ap11.key.neverUsedCell';
  return (k.idleDays ?? 0) >= 90 ? 'ap11.key.idleLong' : 'ap11.key.idle';
}

/** Whether the revoke control is offered. Absent on an already-revoked key rather than disabled: a second revocation
 *  would overwrite the reason the first one recorded, which is the only record of why an integration stopped. */
export function canRevoke(k: Pick<KeyRow, 'revokedAt'>): boolean {
  return k.revokedAt === null;
}

export function revokeWithheldKey(k: Pick<KeyRow, 'revokedAt' | 'revokedReason'>): string | null {
  if (k.revokedAt === null) return null;
  return k.revokedReason ? 'ap11.key.revokedWithReason' : 'ap11.key.revokedNoReason';
}

/** The usage cell. **RENDERED ABSENT, NEVER APPROXIMATED**: the hourly counter lives in Redis inside apps/api and this
 *  realm has no Redis client, so any number here would be a different quantity wearing a rate limit's label. */
export function usageKey(k: Pick<KeyRow, 'hourlyUsage'>): string {
  return k.hourlyUsage === null ? 'ap11.usage.noSource' : 'ap11.usage.count';
}

/* ------------------------------------------------------------------------------------------------ */
/* OUTBOUND DELIVERY                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export interface DeliveryHealth {
  endpoints: number;
  activeEndpoints: number;
  attempted24h: number;
  succeeded24h: number;
  pendingRetry: number;
  exhausted24h: number;
  successRateBp: number | null;
}

/** **UNKNOWN IS NOT 100%.** With nothing attempted there is no success rate, and a hopeful number over an empty window
 *  is how a dead dispatcher looks healthy — the same trap ADMIN-10's dashboard had to avoid. */
export function successKey(bp: number | null): string {
  if (bp === null) return 'ap11.deliv.noTraffic';
  if (bp < 9_000) return 'ap11.deliv.poor';
  return bp < 9_900 ? 'ap11.deliv.ok' : 'ap11.deliv.good';
}

export function successClass(bp: number | null): string {
  if (bp === null) return 'kv-note is-warn';
  return bp < 9_000 ? 'kv-note is-danger' : 'kv-note';
}

/** **A BACKLOG AND AN EXHAUSTED DELIVERY ARE DIFFERENT PROBLEMS, AND THE SECOND HAS NO OTHER SURFACE.** A pending retry
 *  is the system working: the worker backs off and tries again, up to eight times. A delivery past that ceiling is an
 *  event the tenant will never receive and that nothing else on this platform will mention again. */
export function backlogKey(d: Pick<DeliveryHealth, 'pendingRetry' | 'exhausted24h'>): string {
  if (d.exhausted24h > 0) return 'ap11.deliv.exhausted';
  return d.pendingRetry > 0 ? 'ap11.deliv.backlog' : 'ap11.deliv.clear';
}

export function backlogClass(d: Pick<DeliveryHealth, 'pendingRetry' | 'exhausted24h'>): string {
  if (d.exhausted24h > 0) return 'kv-note is-danger';
  return d.pendingRetry > 500 ? 'kv-note is-warn' : 'kv-note';
}

/* ------------------------------------------------------------------------------------------------ */
/* INBOUND RECEIPTS                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export interface InboundRow {
  id: string;
  providerCode: string;
  eventType: string | null;
  signatureOk: boolean | null;
  signatureReason: string | null;
  processingStatus: string;
  truncated: boolean;
  rawBytes: number | null;
  createdAt: string;
}

/** The verdict. **FIVE REASONS THAT A BOOLEAN COLLAPSES INTO ONE**, and W106's diagnosis ("all from one stale Gupshup
 *  secret") is only reachable if they stay apart. The sharpest is `secret_unconfigured`: OUR missing environment
 *  variable, which counted as a signature failure would send an operator to rotate a provider's secret. */
export function verdictKey(r: Pick<InboundRow, 'signatureOk' | 'signatureReason'>): string {
  if (r.signatureOk === true) return 'ap11.sig.ok';
  if (r.signatureOk === null) return 'ap11.sig.undecided';
  const known = ['absent', 'mismatch', 'secret_unconfigured', 'unsupported_provider', 'unparseable'];
  return known.includes(r.signatureReason ?? '') ? `ap11.sig.${r.signatureReason}` : 'ap11.sig.failedUnknown';
}

export function verdictClass(r: Pick<InboundRow, 'signatureOk'>): string {
  if (r.signatureOk === true) return 'kv-badge is-ok';
  // An undecided verdict is a receipt that was written and never settled: the process died mid-handling. A finding.
  return r.signatureOk === null ? 'kv-badge is-warn' : 'kv-badge is-danger';
}

/** **A REFUSED CALLBACK IS `ignored`, NOT `failed`.** "Failed" says the platform tried and could not; what happened is
 *  that the platform declined — a defence working, not an incident. */
export function outcomeKey(status: string): string {
  const known = ['received', 'processed', 'ignored', 'failed'];
  return known.includes(status) ? `ap11.out.${status}` : 'ap11.out.other';
}

export function payloadNoteKey(r: Pick<InboundRow, 'truncated'>): string | null {
  // A truncated row is honest about being partial. Not saying so would let a reviewer read a 2 KB head as the whole
  // callback — useless for a replay and misleading as evidence.
  return r.truncated ? 'ap11.payload.truncated' : null;
}

/* ------------------------------------------------------------------------------------------------ */
/* W007 · CIRCUIT STATE                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export interface CircuitCard {
  dep: string;
  displayName: string | null;
  category: string | null;
  providerCode: string | null;
  fallbackStrategy: string | null;
  isMoney: boolean;
  fleetState: string;
  instancesOpen: number;
  instancesReporting: number;
  fallbackActive: boolean;
  p95LatencyMs: number | null;
  errorRateBp: number | null;
}

export function circuitKey(state: string): string {
  const known = ['closed', 'open', 'half_open'];
  // **'unknown' IS ITS OWN LABEL AND IS NOT 'closed'.** No transition recorded means either nothing has ever failed or
  // nothing is reporting, and those are opposite conclusions. Reading silence as health is how a monitoring surface
  // lies.
  return known.includes(state) ? `ap11.circ.${state}` : 'ap11.circ.unknown';
}

export function circuitClass(state: string): string {
  if (state === 'open') return 'kv-badge is-danger';
  if (state === 'half_open') return 'kv-badge is-warn';
  if (state === 'closed') return 'kv-badge is-ok';
  return 'kv-badge is-warn';
}

/** **THE SENTENCE THAT KEEPS THIS COLUMN HONEST.** A breaker is per-process: with eight pods, one open breaker means an
 *  eighth of traffic is failing fast and seven eighths is still trying. "3 of 8 instances" is the true shape; a single
 *  badge would be a fiction in either direction. */
export function fleetKey(c: Pick<CircuitCard, 'instancesOpen' | 'instancesReporting'>): string {
  if (c.instancesReporting === 0) return 'ap11.circ.noReports';
  if (c.instancesOpen === 0) return 'ap11.circ.allClosed';
  return c.instancesOpen === c.instancesReporting ? 'ap11.circ.allOpen' : 'ap11.circ.someOpen';
}

/** The Fallback column. **A BLANK MEANS TWO OPPOSITE THINGS**: a money call has no fallback BY RULE — `ResilienceService`
 *  throws if one is passed with `money: true`, because a failed debit must fail rather than silently succeed — while an
 *  ordinary dependency with no fallback is simply undefended. */
export function fallbackKey(c: Pick<CircuitCard, 'fallbackStrategy' | 'isMoney' | 'fallbackActive'>): string {
  if (c.fallbackStrategy) return c.fallbackActive ? 'ap11.fb.active' : 'ap11.fb.declared';
  return c.isMoney ? 'ap11.fb.forbidden' : 'ap11.fb.none';
}

export function fallbackClass(c: Pick<CircuitCard, 'fallbackStrategy' | 'isMoney' | 'fallbackActive'>): string {
  if (c.fallbackActive) return 'kv-badge is-warn';
  if (!c.fallbackStrategy && !c.isMoney) return 'kv-badge is-warn';
  return 'kv-badge';
}

/** The two columns W007 draws that have no source anywhere on this platform. Rendered as absent, with the reason. */
export function metricKey(value: number | null): string {
  return value === null ? 'ap11.latency.noSource' : 'ap11.latency.value';
}
