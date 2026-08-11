// modules/platform-api-ops/domain/api-oversight.ts · W106 / W007 view rules (PC-56 ADMIN-11c).
//
// **THE FINDING THIS FILE IS ORGANISED AROUND: `api_keys` HAS EXISTED SINCE MIGRATION 0002 AND NO CODE HAS EVER TOUCHED
// IT.** `grep -rn "[^_]api_keys\b" apps packages --include=*.ts` returns nothing; so does a search of the seeds. No
// issuance route, no gateway that authenticates one, no `last_used_at` stamp, no revoke, and no tenant console screen.
// W106's first figure is "Active keys 412 across 186 tenants" over that table.
//
// And there IS a live key plane — a different one. PC-55 A10 built `partner_api_keys`: hashed, scoped, rate-limited,
// `last_used_at` stamped once a minute, revocable, and enforced by a real guard. So this plane reports BOTH registries
// and keeps them apart, because one number over both would present a live partner integration and a dormant table as
// the same fact.

export type Registry = 'tenant' | 'partner';

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
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------------ */
/* WHICH REGISTRY IS REAL                                                                            */
/* ------------------------------------------------------------------------------------------------ */

/** **THE SENTENCE THIS PLANE EXISTS TO BE ABLE TO SAY.** A registry with no issuer and no gateway is not a registry with
 *  no keys yet: it is a promise in the schema that no realm has kept, and a console showing "0 keys" without saying so
 *  invites an operator to conclude that tenants simply have not got round to it. */
export const TENANT_REGISTRY_HAS_NO_ISSUER = true;

export function registryStatusKey(registry: Registry): string {
  return registry === 'partner' ? 'ap11.reg.live' : 'ap11.reg.noIssuer';
}

/* ------------------------------------------------------------------------------------------------ */
/* KEY STATE                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

export type KeyState = 'active' | 'revoked' | 'dormant' | 'never_used';

/** W106's Status column, and the two states it renders that a single boolean cannot carry.
 *
 *  **"NEVER USED" AND "UNUSED FOR 100 DAYS" ARE DIFFERENT FACTS AND BOTH ARE REVOCATION CANDIDATES FOR DIFFERENT
 *  REASONS.** A key that was issued and never called is probably a mistake or an abandoned integration; a key that
 *  worked for a year and stopped is a change somebody made without telling us. The canon shows the second
 *  ("04 Apr · 100d unused") and the first is what an empty `last_used_at` means — which, on the tenant registry, is
 *  every row, because nothing stamps it. */
export function keyState(k: Pick<KeyRow, 'revokedAt' | 'lastUsedAt' | 'createdAt'>, now: Date, dormantDays = 90): KeyState {
  if (k.revokedAt) return 'revoked';
  if (!k.lastUsedAt) return 'never_used';
  return daysSince(k.lastUsedAt, now) >= dormantDays ? 'dormant' : 'active';
}

/** Whole days, floored — the same rule ADMIN-9's dormancy used, and for the same reason: "89.6 days" rendered as 90
 *  would make a threshold trip a day early and be impossible to explain to the operator watching it. */
export function daysSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

export function keyStateKey(state: KeyState): string {
  return `ap11.key.${state}`;
}

export function keyStateClass(state: KeyState): string {
  if (state === 'revoked') return 'kv-badge';
  if (state === 'dormant') return 'kv-badge is-warn';
  // A key nobody has ever used is drawn as a warning too: on a live registry it is an integration that never shipped,
  // and an unused credential is a credential nobody would notice being stolen.
  return state === 'never_used' ? 'kv-badge is-warn' : 'kv-badge is-ok';
}

/* ------------------------------------------------------------------------------------------------ */
/* RATE LIMITS — the column that cannot be filled from here                                          */
/* ------------------------------------------------------------------------------------------------ */

/**
 * W106 shows "Used this hour · 4,980 (99.6%)" and a "near limit" status.
 *
 * **THAT COUNTER LIVES IN REDIS IN apps/api AND admin-api HAS NO REDIS CLIENT.** There is no table behind it. So the
 * column is rendered as ABSENT rather than approximated — and the specific temptation this refuses is filling it with
 * a count of requests from some other source, which would produce a number that looks like a rate limit and is not,
 * the shape this programme has now found seven times. ADMIN-11c-Q6.
 */
export const HOURLY_USAGE_HAS_NO_ADMIN_SOURCE = 'ap11.usage.noSource';

/** The LIMIT is a column and is shown; the USAGE is not. Keeping them in one function makes it hard to render the
 *  second by accident. */
export function rateCellKeys(): { limit: string; usage: string } {
  return { limit: 'ap11.rate.limit', usage: HOURLY_USAGE_HAS_NO_ADMIN_SOURCE };
}

/* ------------------------------------------------------------------------------------------------ */
/* OUTBOUND WEBHOOK HEALTH — this half is real                                                       */
/* ------------------------------------------------------------------------------------------------ */

export interface DeliveryStats {
  endpoints: number;
  activeEndpoints: number;
  attempted24h: number;
  succeeded24h: number;
  pendingRetry: number;
  exhausted24h: number;
}

/** W106's "96.8% delivery success 24h". **UNKNOWN IS NOT 100%**: with nothing attempted there is no rate, and rendering
 *  a hopeful number over an empty window is how a broken dispatcher looks healthy. */
export function successRateBp(s: Pick<DeliveryStats, 'attempted24h' | 'succeeded24h'>): number | null {
  if (s.attempted24h <= 0) return null;
  // Integer basis points, never a float (Law 2's spirit applied to a ratio): 9_680 = 96.80%.
  return Math.round((s.succeeded24h / s.attempted24h) * 10_000);
}

export function successRateKey(bp: number | null): string {
  if (bp === null) return 'ap11.deliv.noTraffic';
  if (bp < 9_000) return 'ap11.deliv.poor';
  return bp < 9_900 ? 'ap11.deliv.ok' : 'ap11.deliv.good';
}

/** **A BACKLOG AND AN EXHAUSTED DELIVERY ARE DIFFERENT PROBLEMS.** A pending retry is the system working — the worker
 *  backs off exponentially and tries again. A delivery that hit the 8-attempt ceiling is an event the tenant will never
 *  receive, and nothing else on this platform will mention it again. The second is the number that matters. */
export function backlogClass(s: Pick<DeliveryStats, 'pendingRetry' | 'exhausted24h'>): string {
  if (s.exhausted24h > 0) return 'kv-note is-danger';
  return s.pendingRetry > 500 ? 'kv-note is-warn' : 'kv-note';
}

/* ------------------------------------------------------------------------------------------------ */
/* INBOUND — the receipts that did not exist until this wave                                         */
/* ------------------------------------------------------------------------------------------------ */

export type SignatureReason = 'ok' | 'absent' | 'mismatch' | 'secret_unconfigured' | 'unsupported_provider' | 'unparseable';

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

/**
 * The verdict label. **THREE FAILURE REASONS THAT LOOK IDENTICAL IN A BOOLEAN AND ARE NOT.** W106's diagnosis — "3
 * signature failures, all from one stale Gupshup secret" — is only reachable if a mismatch, a missing header and OUR
 * OWN unconfigured secret are three different rows. The third is the sharpest: it is our outage wearing a security
 * error's clothes, and counting it as a signature failure sends an operator to rotate a provider's secret over a
 * missing environment variable.
 */
export function verdictKey(r: Pick<InboundRow, 'signatureOk' | 'signatureReason'>): string {
  if (r.signatureOk === true) return 'ap11.sig.ok';
  if (r.signatureOk === null) return 'ap11.sig.undecided';
  const known = ['absent', 'mismatch', 'secret_unconfigured', 'unsupported_provider', 'unparseable'];
  return known.includes(r.signatureReason ?? '') ? `ap11.sig.${r.signatureReason}` : 'ap11.sig.failedUnknown';
}

export function verdictClass(r: Pick<InboundRow, 'signatureOk' | 'signatureReason'>): string {
  if (r.signatureOk === true) return 'kv-badge is-ok';
  // An undecided verdict means the request was recorded and never settled — the process died mid-handling, which is a
  // finding rather than a neutral state.
  if (r.signatureOk === null) return 'kv-badge is-warn';
  return 'kv-badge is-danger';
}

/** Whether the payload stored is the whole payload. A truncated row is honest about being partial; the console has to
 *  say so, or a reviewer will read a 2 KB head as the entire callback. */
export function payloadNoteKey(r: Pick<InboundRow, 'truncated'>): string | null {
  return r.truncated ? 'ap11.payload.truncated' : null;
}

/* ------------------------------------------------------------------------------------------------ */
/* W007 — CIRCUIT STATE, WHICH IS PER-POD AND MUST SAY SO                                            */
/* ------------------------------------------------------------------------------------------------ */

export interface CircuitRow {
  dep: string;
  providerCode: string | null;
  displayName: string | null;
  category: string | null;
  fallbackStrategy: string | null;
  isMoney: boolean;
  /** Latest transition per instance, from `provider_circuit_events`. */
  instances: { instanceId: string; state: string; consecutiveFailures: number | null; occurredAt: string }[];
}

/**
 * The state to show for a dependency across the fleet.
 *
 * **A CIRCUIT BREAKER IS PER-PROCESS, SO THERE IS NO SINGLE STATE — AND PRETENDING OTHERWISE IS THE DEFECT THIS WAVE
 * EXISTS TO AVOID.** With eight pods, one open breaker means one eighth of traffic is failing fast and seven eighths
 * is still trying. The worst state across the fleet is the honest headline (an operator needs to know something is
 * open), and the instance count is what makes it actionable.
 */
export function fleetState(instances: CircuitRow['instances']): { state: string; open: number; total: number } {
  const total = instances.length;
  const open = instances.filter((i) => i.state === 'open').length;
  const half = instances.filter((i) => i.state === 'half_open').length;
  const state = open > 0 ? 'open' : half > 0 ? 'half_open' : total > 0 ? 'closed' : 'unknown';
  return { state, open, total };
}

export function circuitStateKey(state: string): string {
  const known = ['closed', 'open', 'half_open'];
  // **'unknown' IS ITS OWN LABEL AND NOT 'closed'.** No transition recorded means either nothing has ever failed or
  // nothing is reporting, and those are opposite conclusions. Reading silence as health is how a monitoring plane
  // lies — the sixth time this programme has had to make that distinction explicit.
  return known.includes(state) ? `ap11.circ.${state}` : 'ap11.circ.unknown';
}

export function circuitStateClass(state: string): string {
  if (state === 'open') return 'kv-badge is-danger';
  if (state === 'half_open') return 'kv-badge is-warn';
  if (state === 'closed') return 'kv-badge is-ok';
  return 'kv-badge is-warn';
}

/** The Fallback column. **A BLANK MEANS TWO OPPOSITE THINGS AND THE CONSOLE MUST TELL THEM APART**: a money call has no
 *  fallback BY RULE (`ResilienceService.run` throws when one is passed with `money: true`, because a failed debit must
 *  fail rather than silently succeed), while an ordinary dependency with no fallback is simply undefended. */
export function fallbackKey(r: Pick<CircuitRow, 'fallbackStrategy' | 'isMoney'>): string {
  if (r.fallbackStrategy) return 'ap11.fb.declared';
  return r.isMoney ? 'ap11.fb.forbidden' : 'ap11.fb.none';
}

/** Whether a declared fallback is CURRENTLY carrying traffic — derivable, because a fallback runs exactly when the
 *  breaker is not closed. W007 prints "voice-OTP (active)" and this is the only honest way to know it. */
export function fallbackActive(r: Pick<CircuitRow, 'fallbackStrategy'>, state: string): boolean {
  return Boolean(r.fallbackStrategy) && (state === 'open' || state === 'half_open');
}

/**
 * **W007's p95 AND ERROR-RATE COLUMNS HAVE NO SOURCE AND ARE RENDERED ABSENT.** Nothing persists a per-call sample;
 * `metrics.observe()` feeds a Prometheus registry scraped out-of-band that admin-api does not read. The consecutive-
 * failure count this wave DOES have is not an error rate, and printing it as one would be exactly the substitution
 * this programme has refused seven times. ADMIN-11c-Q1.
 */
export const LATENCY_HAS_NO_SOURCE = 'ap11.latency.noSource';
export const LATENCY_OWNER = 'ADMIN-11c-Q1';
export const PROBE_OWNER = 'ADMIN-11c-Q2';
