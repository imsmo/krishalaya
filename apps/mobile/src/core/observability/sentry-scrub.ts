// apps/mobile/src/core/observability/sentry-scrub.ts · PC-56 MOB-STORE-1 — what the Sentry SDK is allowed to send, as PURE
// functions (no @sentry import, so the core suite tests them in node). Two halves:
//   • sentryOptions(): the Sentry.init options — disabled without a DSN, no default PII, no screenshots / view hierarchy /
//     replays / profiling, conservative sampling, environment + release from the app version.
//   • scrubSentryEvent() / scrubSentryBreadcrumb(): the beforeSend / beforeBreadcrumb hooks. Every free-text field goes
//     through redact.ts's scrubString PLUS the extra patterns below (OTPs, UPI ids, IFSC); every structured field through
//     redactPII (key denylist); request bodies, cookies, headers and URL query strings are dropped outright; the user is
//     reduced to its id. Belt-and-braces with crash.ts, which already redacts what OUR code reports — this layer also covers
//     what the SDK collects on its own (unhandled exceptions, console / fetch / navigation breadcrumbs).
import { redactPII, scrubString, REDACTED } from './redact';

// Patterns redact.ts does not cover (bounded, no catastrophic backtracking).
const RE_OTP = /\b(otp|code|pin|passcode|verification)(\D{0,16}?)\d{4,8}\b/gi; // "OTP is 123456", "code: 4321"
const RE_VPA = /\b[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,32}\b/g;                    // UPI id (name@okaxis) — no TLD, so not an email
const RE_IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;                                    // bank branch code

/** scrubString + the payment/OTP patterns. Safe on any input (non-strings come back unchanged). */
export function scrubText<T>(input: T): T {
  if (typeof input !== 'string') return input;
  return scrubString(input)
    .replace(RE_OTP, (_m, word: string, gap: string) => `${word}${gap}${REDACTED}`)
    .replace(RE_VPA, REDACTED)
    .replace(RE_IFSC, REDACTED) as unknown as T;
}

/** Drop the query string + fragment from a URL (phone numbers, tokens and OTPs travel there). */
export function stripQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return scrubText(cut === -1 ? url : url.slice(0, cut));
}

function deepScrub(value: unknown): unknown {
  const redacted = redactPII(value);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubText(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = /url$/i.test(k) ? stripQuery(x) : walk(x);
      return out;
    }
    return v;
  };
  return walk(redacted);
}

/** The structural subset of a Sentry event / breadcrumb this module touches (kept local: no @sentry types in core). */
interface Frame { vars?: unknown; [k: string]: unknown }
export interface SentryLikeBreadcrumb { message?: string; data?: Record<string, unknown>; [k: string]: unknown }
export interface SentryLikeEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  exception?: { values?: { value?: string; stacktrace?: { frames?: Frame[] }; [k: string]: unknown }[] };
  breadcrumbs?: SentryLikeBreadcrumb[];
  request?: { url?: string; [k: string]: unknown };
  user?: { id?: string | number; [k: string]: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  [k: string]: unknown;
}

function withoutVars(frame: Frame): Frame {
  const f = { ...frame };
  delete f.vars;
  return f;
}

export function scrubSentryBreadcrumb<B extends SentryLikeBreadcrumb>(crumb: B): B {
  const out: SentryLikeBreadcrumb = { ...crumb };
  if (out.message != null) out.message = scrubText(String(out.message));
  if (out.data) out.data = deepScrub(out.data) as Record<string, unknown>;
  return out as B;
}

/** beforeSend. Never throws (a scrub failure drops the event rather than sending it unscrubbed). */
export function scrubSentryEvent<E extends SentryLikeEvent>(event: E): E | null {
  try {
    const e: SentryLikeEvent = { ...event };
    if (e.message != null) e.message = scrubText(String(e.message));
    if (e.logentry) e.logentry = { message: scrubText(e.logentry.message), params: e.logentry.params ? (deepScrub(e.logentry.params) as unknown[]) : undefined };
    if (e.exception?.values) {
      e.exception = {
        ...e.exception,
        values: e.exception.values.map((v) => ({
          ...v,
          value: scrubText(v.value),
          // Local variables are never needed to read a JS stack and may hold anything the user typed.
          stacktrace: v.stacktrace?.frames ? { ...v.stacktrace, frames: v.stacktrace.frames.map(withoutVars) } : v.stacktrace,
        })),
      };
    }
    if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map(scrubSentryBreadcrumb);
    // Request: keep only the path. Body, cookies, headers (Authorization!) and query strings never leave the device.
    if (e.request) e.request = e.request.url ? { url: stripQuery(e.request.url) as string } : {};
    // User: the account id only — no phone, name, email, username or IP (sendDefaultPii is also false).
    if (e.user) e.user = e.user.id != null ? { id: e.user.id } : undefined;
    if (e.extra) e.extra = deepScrub(e.extra) as Record<string, unknown>;
    if (e.contexts) e.contexts = deepScrub(e.contexts) as Record<string, unknown>;
    if (e.tags) e.tags = deepScrub(e.tags) as Record<string, unknown>;
    return e as E;
  } catch {
    return null;
  }
}

export interface SentryRuntime { dsn?: string; appEnv: string; appVersion: string }

/** Sentry.init options (minus the hooks, which sentry.provider.ts attaches). `enabled` is false without a DSN — but the
 * provider is not even installed then (observability/index.ts), so an unset DSN means no SDK init and no network. */
export function sentryOptions(rt: SentryRuntime) {
  const production = rt.appEnv === 'production';
  return {
    dsn: rt.dsn,
    enabled: !!rt.dsn,
    environment: rt.appEnv,
    release: `com.krishalaya.app@${rt.appVersion}`,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    sampleRate: 1.0,                          // every error event (they are rare and are what we need)
    tracesSampleRate: production ? 0.05 : 0,  // performance: a 5% sample in production only
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableAutoSessionTracking: true,          // crash-free-session rate gates the staged rollout (eas.json)
    maxBreadcrumbs: 50,
    debug: false,
  };
}
