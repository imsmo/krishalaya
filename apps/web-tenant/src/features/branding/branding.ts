// apps/web-tenant/src/features/branding/branding.ts · PURE helpers for W191 white-label theming and W192 domains — PC-56 TENANT-13d.
//
// Founder decision 2026-10-03: BRAND FOR ALL (Rule Zero — branding is on every plan; only a custom domain and removing the Powered-by
// mark are plan-gated, and both are READ from the API, never assumed); PUBLISH NEEDS A CHECKER; THE CONTRAST LAW; CNAME + TXT PROOF;
// ACME LATER. What this console prints, as built:
//   • the contrast panel is computed LIVE from the same law the API's publish gate applies (@krishalaya/tokens — the one implementation packages/ui re-exports) —
//     every pair with its ratio, AA ✓/✗, AAA reported honestly ("needs 7:1"), never claimed;
//   • "Senior Farmer Mode multiplies, never fixes, contrast" — a fact the law returns (`seniorMode.changesContrast: false`);
//   • TLS for a custom domain is "pending — certificate issuance not yet built" (the API's own words); the included subdomain's TLS is
//     "issued" only when the platform wildcard certificate is configured;
//   • the coverage list is real or named: statements / invoices print the name (the PDF writer draws no image), certificates "not yet".
import { brandContrast, normaliseHex, PLATFORM_BRAND_COLOURS, type BrandColours, type ContrastReport } from '@krishalaya/tokens';
import type { BrandValues, BrandConsole, DomainList, TenantDomainView } from '@krishalaya/sdk-js';

export const BRANDING_HREF = '/settings/branding';
export const BRAND_PUBLISH_HREF = `${BRANDING_HREF}/publish`;
export const BRAND_HISTORY_HREF = `${BRANDING_HREF}/history`;
export const DOMAINS_HREF = `${BRANDING_HREF}/domains`;
export const DOMAIN_NEW_HREF = `${DOMAINS_HREF}/new`;
export const DOMAIN_ACT_HREF = `${DOMAINS_HREF}/act`;
export const PLANS_HREF = '/billing/upgrade';
export function brandProposalHref(id: string, step?: string): string {
  return `${BRANDING_HREF}/proposals/${encodeURIComponent(id)}${step ? `?step=${encodeURIComponent(step)}` : ''}`;
}
export function domainProposalHref(id: string, step?: string): string {
  return `${DOMAINS_HREF}/proposals/${encodeURIComponent(id)}${step ? `?step=${encodeURIComponent(step)}` : ''}`;
}
export function rollbackHref(version: number): string { return `${BRAND_PUBLISH_HREF}?kind=rollback&version=${version}`; }
export function domainActHref(kind: 'make_primary' | 'remove' | 'recheck', domainId: string): string {
  return `${DOMAIN_ACT_HREF}?kind=${kind}&domain=${encodeURIComponent(domainId)}&step=confirm`;
}
export function logoPreviewHref(mediaId: string): string { return `${BRANDING_HREF}/logo/${encodeURIComponent(mediaId)}`; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
export function isIdemKey(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v); }

export type PageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
export function pageState(code: string | undefined, status?: number, forId = false): PageState {
  if (code === 'TENANT_FORBIDDEN' || code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return forId ? 'notFound' : 'flaggedOff';
  return 'error';
}

/* ---- the contrast panel (LIVE, the API's own law) ---------------------------------------------------------------------- */

/** The four colours a draft would render with; an invalid field falls back to what it was (the panel never throws while typing). */
export function coloursFrom(raw: Partial<Record<keyof BrandColours, string>>, fallback: BrandColours = PLATFORM_BRAND_COLOURS): BrandColours {
  return {
    primary: normaliseHex(raw.primary ?? '') ?? fallback.primary,
    accent: normaliseHex(raw.accent ?? '') ?? fallback.accent,
    ink: normaliseHex(raw.ink ?? '') ?? fallback.ink,
    surface: normaliseHex(raw.surface ?? '') ?? fallback.surface,
  };
}
export function liveContrast(c: BrandColours): ContrastReport { return brandContrast(c); }

/** One pair as the panel prints it: AA ✓/✗ (the gate), AAA large ✓/✗ and AAA normal "needs 7:1" — honestly, never claimed. */
export function pairLine(p: { code: string; display: string; aa: boolean; aaa: boolean; aaaLarge: boolean }): { pairKey: string; display: string; aaKey: string; aaaLargeKey: string; aaaKey: string } {
  return {
    pairKey: `br.pair.${p.code}`, display: p.display,
    aaKey: p.aa ? 'br.contrast.aaPass' : 'br.contrast.aaFail',
    aaaLargeKey: p.aaaLarge ? 'br.contrast.aaaLargePass' : 'br.contrast.aaaLargeFail',
    aaaKey: p.aaa ? 'br.contrast.aaaPass' : 'br.contrast.aaaNeeds',
  };
}

/** The preview's CSS custom properties — the same four tokens the storefront sets on :root for this tenant. */
export function previewVars(c: BrandColours): Record<string, string> {
  return { '--br-primary': c.primary, '--br-accent': c.accent, '--br-ink': c.ink, '--br-surface': c.surface };
}

/* ---- the draft form ---------------------------------------------------------------------------------------------------- */

export const DRAFT_FIELDS = ['displayName', 'appShortName', 'primaryColor', 'accentColor', 'inkColor', 'surfaceColor', 'poweredByHidden'] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];
export interface DraftForm { displayName: string; appShortName: string; primaryColor: string; accentColor: string; inkColor: string; surfaceColor: string; poweredByHidden: boolean }
export function formFrom(v: BrandValues): DraftForm {
  return { displayName: v.displayName, appShortName: v.appShortName, primaryColor: v.colours.primary, accentColor: v.colours.accent,
           inkColor: v.colours.ink, surfaceColor: v.colours.surface, poweredByHidden: v.poweredByHidden };
}
/** Only what changed travels (the API's review diffs against the stored draft anyway). */
export function changedFields(before: DraftForm, after: DraftForm): Partial<DraftForm> {
  const out: Partial<DraftForm> = {};
  for (const k of DRAFT_FIELDS) if (before[k] !== after[k]) (out as Record<string, unknown>)[k] = after[k];
  return out;
}

/* ---- states, banners, coverage ----------------------------------------------------------------------------------------- */

/** W191's top-of-page state: Default brand (nothing published) · published · restricted / flagged off come from pageState. */
export function brandStateKey(c: Pick<BrandConsole, 'membersSee' | 'exists'>): 'br.state.default' | 'br.state.published' {
  return c.membersSee === 'published_brand' ? 'br.state.published' : 'br.state.default';
}
/** The plan banner: branding is everybody's; the domain and the mark removal name the plan(s) that include them — read, never typed. */
export function planBanner(plan: BrandConsole['plan']): { key: string; vars: Record<string, string> } {
  const need = [...new Set([...(plan.customDomain.enabled ? [] : plan.customDomain.plansWith), ...(plan.removePoweredBy.enabled ? [] : plan.removePoweredBy.plansWith)])];
  if (plan.customDomain.enabled && plan.removePoweredBy.enabled) return { key: 'br.plan.allIncluded', vars: { plan: plan.planCode ?? '' } };
  return { key: 'br.plan.banner', vars: { plan: need.length ? need.join(' / ') : '—', current: plan.planCode ?? '—' } };
}
export const COVERAGE_CODES = ['member_app', 'statements_invoices', 'certificates', 'custom_domain', 'powered_by', 'trust_surfaces', 'sms_sender'] as const;
export function coverageKey(code: string, state: string): string { return `br.cov.${code}.${state}`; }
export function coverageMark(state: string): '✓' | '＝' | '·' {
  if (state === 'live' || state === 'name_only' || state === 'removable' || state === 'see_domains') return '✓';
  if (state === 'stays' || state === 'platform_marks' || state === 'dlt_registered') return '＝';
  return '·';
}
export function logoStateKey(state: string): string { return `br.logo.state.${state}`; }

/* ---- refusals ---------------------------------------------------------------------------------------------------------- */

export const BRAND_REFUSAL_CODES = [
  'BRAND_NAME_TOO_SHORT', 'BRAND_NAME_TOO_LONG', 'BRAND_NAME_CHARACTERS', 'BRAND_SHORT_NAME_REQUIRED', 'BRAND_SHORT_NAME_TOO_LONG', 'BRAND_LOGO_INVALID',
  'BRAND_COLOUR_INVALID', 'BRAND_POWERED_BY_INVALID', 'POWERED_BY_PLAN_REQUIRED', 'BRAND_UNCHANGED', 'BRAND_DRAFT_INVALID', 'BRAND_CONTRAST_FAILED',
  'BRAND_CONTRAST_FLOOR_DB', 'BRAND_LOGO_REQUIRED', 'BRAND_LOGO_NOT_READY', 'BRAND_REASON_INVALID', 'BRAND_NO_DRAFT', 'BRAND_NOTHING_TO_PUBLISH',
  'BRAND_PUBLISH_REFUSED', 'BRAND_PROPOSAL_LIVE', 'BRAND_PROPOSAL_CLOSED', 'BRAND_PROPOSAL_STALE', 'BRAND_PROPOSAL_NOT_FOUND', 'BRAND_VERSION_NOT_FOUND',
  'BRAND_ROLLBACK_CURRENT', 'NEEDS_SECOND_ADMIN', 'CHECKER_IS_MAKER', 'TENANT_FORBIDDEN', 'LOGO_TOO_LARGE', 'LOGO_EMPTY', 'LOGO_TYPE_UNSUPPORTED',
  'LOGO_MALFORMED', 'LOGO_SVG_UNSAFE', 'LOGO_NOT_SQUARE_OR_WIDE', 'LOGO_TOO_SMALL', 'LOGO_NO_DIMENSIONS', 'IDEMPOTENCY_KEY_REQUIRED', 'NOT_FOUND', 'unknown',
] as const;
export const DOMAIN_REFUSAL_CODES = [
  'PLAN_FEATURE_REQUIRED', 'DOMAIN_INVALID', 'DOMAIN_RESERVED', 'DOMAIN_ALREADY_YOURS', 'DOMAIN_CLAIMED_ELSEWHERE', 'DOMAIN_REASON_INVALID',
  'DOMAIN_NOT_VERIFIED', 'DOMAIN_ALREADY_PRIMARY', 'DOMAIN_INCLUDED_PERMANENT', 'DOMAIN_SUCCESSOR_REQUIRED', 'DOMAIN_SUCCESSOR_NOT_VERIFIED',
  'DOMAIN_SUCCESSOR_NOT_NEEDED', 'DOMAIN_PROPOSAL_LIVE', 'DOMAIN_PROPOSAL_CLOSED', 'DOMAIN_PROPOSAL_EXPIRED', 'DOMAIN_PROPOSAL_NOT_FOUND', 'DOMAIN_NOTHING_TO_CHECK',
  'DOMAIN_RECHECK_TOO_SOON', 'DOMAIN_NOT_FOUND', 'NEEDS_SECOND_ADMIN', 'CHECKER_IS_MAKER', 'TENANT_FORBIDDEN', 'NOT_FOUND', 'unknown',
] as const;
export function brandRefusalKey(code: string): string { return (BRAND_REFUSAL_CODES as readonly string[]).includes(code) ? `br.refusal.${code}` : 'br.refusal.unknown'; }
export function domainRefusalKey(code: string): string { return (DOMAIN_REFUSAL_CODES as readonly string[]).includes(code) ? `dom.refusal.${code}` : 'dom.refusal.unknown'; }
/** Every refusal the API answered (its `refusals` list, else its code), sanitised for a URL. */
export function failureCodesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown }> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) return refusals.map((r) => (typeof r.code === 'string' && /^[A-Za-z_]{2,40}$/.test(r.code) ? r.code : 'unknown')).slice(0, 8);
  if (code && /^[A-Za-z_]{2,40}$/.test(code)) return [code];
  if (status === 403) return ['TENANT_FORBIDDEN'];
  if (status === 404) return ['NOT_FOUND'];
  return ['unknown'];
}
export function parseCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)).slice(0, 8); }
/** The contrast failure's own facts ("primary_on_surface 4.4:1"), carried in a URL as pair:display pairs. */
export function contrastFailuresFrom(details: unknown): Array<{ pair: string; display: string }> {
  const f = (details as { failing?: Array<{ pair?: unknown; display?: unknown }> } | null)?.failing;
  if (!Array.isArray(f)) return [];
  return f.filter((x) => typeof x.pair === 'string' && /^[a-z_]{3,40}$/.test(x.pair) && typeof x.display === 'string' && /^\d{1,2}\.\d:1$/.test(x.display))
    .map((x) => ({ pair: String(x.pair), display: String(x.display) })).slice(0, 4);
}

/* ---- domains ----------------------------------------------------------------------------------------------------------- */

export function domainTypeKey(d: Pick<TenantDomainView, 'kind'>): string { return d.kind === 'included' ? 'dom.type.included' : 'dom.type.custom'; }
export function tlsKey(d: Pick<TenantDomainView, 'tls' | 'kind'>): string {
  if (d.tls.status === 'issued') return 'dom.tls.issued';
  if (d.tls.status === 'failed') return 'dom.tls.failed';
  return d.kind === 'included' ? 'dom.tls.pendingWildcard' : 'dom.tls.pendingNotBuilt';
}
export function statusKey(d: Pick<TenantDomainView, 'verification'>): string { return `dom.status.${d.verification.status}`; }
/** Which acts a row offers (the API and the database judge again). */
export function domainActs(d: TenantDomainView, list: Pick<DomainList, 'proposals'>): Array<'make_primary' | 'remove' | 'recheck'> {
  if (list.proposals.some((p) => p.domainId === d.id && p.status === 'proposed')) return [];
  const acts: Array<'make_primary' | 'remove' | 'recheck'> = [];
  if (d.verification.status === 'verified' && !d.isPrimary) acts.push('make_primary');
  if (d.kind === 'custom' && d.verification.status !== 'verified') acts.push('recheck');
  if (d.kind === 'custom') acts.push('remove');
  return acts;
}
/** W192's top state: subdomain only (no custom_domain on the plan) · no custom domains yet · the list. */
export function domainsStateKey(list: Pick<DomainList, 'plan' | 'counts'>): 'dom.state.subdomainOnly' | 'dom.state.noCustom' | null {
  if (!list.plan.customDomain) return 'dom.state.subdomainOnly';
  if (list.counts.custom === 0) return 'dom.state.noCustom';
  return null;
}
/** Successor candidates for removing a primary: the tenant's other verified, live domains. */
export function successorCandidates(items: TenantDomainView[], removing: string): TenantDomainView[] {
  return items.filter((d) => d.id !== removing && d.verification.status === 'verified');
}

/** Fill {placeholders} in a translated string (client components receive the catalogue as a plain map). */
export function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : s;
}
