// apps/web-tenant/src/features/settings/config.ts · PURE validators + presenters for the tenant self-config page
// (commission-rules / delivery-zones / branding / languages). No framework, no I/O → unit-tested. The SERVER stays
// authoritative: these only shape + pre-validate the form payload the SDK forwards to the audited, RBAC-gated API
// (which re-validates with zod .strict and computes all money itself, Law 2/11). All regexes are anchored, fixed
// char-classes (no backtracking → ReDoS-safe). Money is bigint minor-unit STRINGS — never a float (Law 2).

// The platform-active storefront languages (Phase 1 = en/hi/gu, mirroring db/seeds/core/0001_languages.sql).
// A tenant can enable any subset; the plan's `max_languages` limit is enforced SERVER-SIDE.
export const PLATFORM_LANGUAGES = ['en', 'hi', 'gu'] as const;

export const COMMISSION_SOURCES = ['direct', 'auction', 'requirement', 'subscription'] as const;
export type CommissionSource = (typeof COMMISSION_SOURCES)[number];

const DIGITS = /^[0-9]+$/;                  // minor-unit string (non-negative integer)
const PINCODE = /^[1-9][0-9]{5}$/;          // Indian PIN (no leading 0)
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}\.[a-zA-Z]{2,24}$/;
const LANG_CODE = /^[a-z]{2}(-[A-Z]{2})?$/;

function intInRange(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// ---- commission rule ----
export interface CommissionRuleInput {
  rateBps: number; fixedMinor: string;
  chargedTo: 'seller' | 'buyer'; priority: number; source?: CommissionSource;
}
export type CommissionResult =
  | { ok: true; value: CommissionRuleInput }
  | { ok: false; error: 'rate' | 'fixed' | 'priority' | 'source' };

/** Validate a commission rule's terms. Basis-points are 0–100000 (0–1000%). PC-56 TENANT-SW-a (F-3): there is no platform-share field —
 *  the plan sets the platform's share and a tenant cannot type it; a stray `platformShareBps` is ignored. */
export function buildCommissionRule(raw: {
  rateBps?: unknown; platformShareBps?: unknown; fixedMinor?: unknown; chargedTo?: unknown; priority?: unknown; source?: unknown;
}): CommissionResult {
  const rateBps = intInRange(raw.rateBps, 0, 100000);
  if (rateBps === null) return { ok: false, error: 'rate' };
  const fixedRaw = String(raw.fixedMinor ?? '0').trim() || '0';
  if (!DIGITS.test(fixedRaw)) return { ok: false, error: 'fixed' };
  const priority = intInRange(raw.priority ?? 100, 0, 1000);
  if (priority === null) return { ok: false, error: 'priority' };
  const chargedTo = raw.chargedTo === 'buyer' ? 'buyer' : 'seller';
  let source: CommissionSource | undefined;
  const s = String(raw.source ?? '').trim();
  if (s) {
    if (!(COMMISSION_SOURCES as readonly string[]).includes(s)) return { ok: false, error: 'source' };
    source = s as CommissionSource;
  }
  return { ok: true, value: { rateBps, fixedMinor: fixedRaw, chargedTo, priority, source } };
}

/** Present basis-points as a percentage string, e.g. 250 → "2.5%". Pure, locale-agnostic. */
export function formatBps(bps: number): string {
  if (!Number.isFinite(bps)) return '—';
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct.toString() : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

// ---- delivery zone ----
export interface DeliveryZoneInput { defaultName: string; pincodes: string[] }
export type DeliveryZoneResult = { ok: true; value: DeliveryZoneInput } | { ok: false; error: 'name' | 'pincode' };
const MAX_PINCODES = 5000;

/** Parse the zone form. `pincodesRaw` is a free-text list (comma / space / newline separated). */
export function buildDeliveryZone(raw: { defaultName?: unknown; pincodes?: unknown }): DeliveryZoneResult {
  const defaultName = String(raw.defaultName ?? '').trim();
  if (defaultName.length < 1 || defaultName.length > 120) return { ok: false, error: 'name' };
  const tokens = String(raw.pincodes ?? '').split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const tk of tokens) {
    if (!PINCODE.test(tk)) return { ok: false, error: 'pincode' };
    seen.add(tk);
    if (seen.size > MAX_PINCODES) return { ok: false, error: 'pincode' };
  }
  return { ok: true, value: { defaultName, pincodes: [...seen] } };
}

// ---- branding (stored as typed tenant settings) ----
export interface SettingPut { key: string; value: string | string[] }
export type BrandingResult = { ok: true; settings: SettingPut[] } | { ok: false; error: 'color' | 'logo' | 'email' | 'name' };

/** Validate branding fields and produce the setting upserts. Empty fields are sent as "" (clear). */
export function buildBranding(raw: { displayName?: unknown; logoUrl?: unknown; primaryColor?: unknown; supportEmail?: unknown }): BrandingResult {
  const displayName = String(raw.displayName ?? '').trim();
  if (displayName.length > 120) return { ok: false, error: 'name' };
  const logoUrl = String(raw.logoUrl ?? '').trim();
  if (logoUrl && !isHttpsUrl(logoUrl)) return { ok: false, error: 'logo' };
  const primaryColor = String(raw.primaryColor ?? '').trim();
  if (primaryColor && !HEX_COLOR.test(primaryColor)) return { ok: false, error: 'color' };
  const supportEmail = String(raw.supportEmail ?? '').trim();
  if (supportEmail && !EMAIL.test(supportEmail)) return { ok: false, error: 'email' };
  return {
    ok: true,
    settings: [
      { key: 'branding.display_name', value: displayName },
      { key: 'branding.logo_url', value: logoUrl },
      { key: 'branding.primary_color', value: primaryColor },
      { key: 'branding.support_email', value: supportEmail },
    ],
  };
}

function isHttpsUrl(s: string): boolean {
  if (s.length > 2000) return false;
  try { return new URL(s).protocol === 'https:'; } catch { return false; }
}

// ---- languages ----
export type LanguagesResult = { ok: true; settings: SettingPut[] } | { ok: false; error: 'empty' | 'unknown' | 'default' };

/** Validate the language selection against the platform-active set. `enabled` must be non-empty and the chosen
 *  default must be one of the enabled codes. */
export function buildLanguages(raw: { enabled?: unknown; default?: unknown }, platformCodes: readonly string[]): LanguagesResult {
  const allowed = new Set(platformCodes);
  const enabledArr = Array.isArray(raw.enabled) ? raw.enabled.map(String) : String(raw.enabled ?? '').split(',');
  const enabled: string[] = [];
  for (const c of enabledArr.map((x) => x.trim()).filter(Boolean)) {
    if (!LANG_CODE.test(c) || !allowed.has(c)) return { ok: false, error: 'unknown' };
    if (!enabled.includes(c)) enabled.push(c);
  }
  if (enabled.length === 0) return { ok: false, error: 'empty' };
  const def = String(raw.default ?? enabled[0]).trim();
  if (!enabled.includes(def)) return { ok: false, error: 'default' };
  return { ok: true, settings: [{ key: 'languages.enabled', value: enabled }, { key: 'languages.default', value: def }] };
}

// ---- read helper ----
/** Read a setting value from the tenant's settings list, with a typed fallback. */
export function settingString(settings: { key: string; value: unknown }[], key: string, fallback = ''): string {
  const row = settings.find((s) => s.key === key);
  if (!row || row.value == null) return fallback;
  return typeof row.value === 'string' ? row.value : fallback;
}
/** Read a string[] setting (e.g. languages.enabled) with a fallback. */
export function settingList(settings: { key: string; value: unknown }[], key: string, fallback: string[] = []): string[] {
  const row = settings.find((s) => s.key === key);
  if (!row || !Array.isArray(row.value)) return fallback;
  return row.value.filter((v): v is string => typeof v === 'string');
}
