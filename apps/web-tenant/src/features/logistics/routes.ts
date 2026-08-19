// apps/web-tenant/src/features/logistics/routes.ts · W231 (Delivery routes) as PURE rules (PC-56 TENANT-5b).
// No React, no I/O — unit- and mutation-tested; the API re-enforces every gate server-side.
//
// W231's instruction is the whole point of the screen: "Approve when the math holds, not when it feels right."
// So this file's job is to make the math legible AND to refuse to print the half of it nobody recorded.

import type { RouteApproval, RouteBoardRow, RouteEconomics, RouteParcels, RouteStatusDto } from '@krishalaya/sdk-js';

/* ------------------------------------------------------------------------------------------------------- */
/* THE STATE, AND THE WORD "PROPOSED"                                                                      */
/* ------------------------------------------------------------------------------------------------------- */

export const ROUTE_TABS = ['all', 'active', 'proposed', 'inactive'] as const;
export type RouteTab = (typeof ROUTE_TABS)[number];

export function isRouteTab(v: string | undefined): v is RouteTab {
  return !!v && (ROUTE_TABS as readonly string[]).includes(v);
}
export function tabOf(raw: string | undefined): RouteTab {
  return isRouteTab(raw) ? raw : 'all';
}
/** The API filters on the state machine; `all` sends nothing rather than a fourth status the server would
 *  reject. */
export function statusParam(tab: RouteTab): RouteStatusDto | undefined {
  return tab === 'all' ? undefined : tab;
}

export function statusKey(s: RouteStatusDto): string {
  return `route.status.${s}`;
}

/** A proposal is drawn differently, not just labelled: W231 puts "(proposed)" beside the name and leaves the
 *  vehicle cell reading `unassigned`, because the row is a question rather than a commitment. */
export function isProposal(s: RouteStatusDto): boolean { return s === 'proposed'; }

/* ------------------------------------------------------------------------------------------------------- */
/* THE DAY                                                                                                 */
/* ------------------------------------------------------------------------------------------------------- */

const DAY_KEY_RE = /^route\.day\.(sun|mon|tue|wed|thu|fri|sat)$/;

/**
 * The API returns an i18n KEY for the weekday, and this validates it before the console translates it.
 *
 * Not paranoia: `t()` on an unvalidated server string is how a response value ends up rendered as a dictionary
 * lookup, and a route with no weekday runs ON DEMAND — which is its own sentence, not a dash that reads like
 * missing data.
 */
export function dayLabelKey(dayKey: string | null, onDemand: boolean): string {
  if (onDemand) return 'route.day.onDemand';
  return dayKey && DAY_KEY_RE.test(dayKey) ? dayKey : 'route.day.unknown';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE VILLAGES AND THE CONSOLIDATION POINT                                                                */
/* ------------------------------------------------------------------------------------------------------- */

/** W231 prints "Vanthali, Bhesan, Keshod +11". The names come resolved from the API; this is only the overflow
 *  sentence, and `more === 0` must not render "+0". */
export function villagesOverflowKey(more: number): string | null {
  return more > 0 ? 'route.villages.more' : null;
}

/** "Dinesh Bhai M. (cluster lead)" — the tier is a lookup CODE so it translates; an ambassador with no tier
 *  recorded is still a named person and the row says only their name. */
export function tierKey(tierCode: string | null): string | null {
  return tierCode ? `route.tier.${tierCode}` : null;
}

/** A route whose consolidation point is unset says so as a MISSING COMMITMENT, because that is what stops the
 *  approval — not as an empty cell. */
export function consolidationKey(c: RouteBoardRow['consolidation']): string | null {
  return c ? null : 'route.consolidation.unset';
}

/* ------------------------------------------------------------------------------------------------------- */
/* PARCELS PER RUN — MEASURED OR ESTIMATED, NEVER BOTH                                                     */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W231's column reads "34", "18" and "— est. 12". The word "est." is the whole difference and the console keeps
 * it: an approved route's number is its own delivered history; a proposal's is what ad-hoc traffic through those
 * villages already looks like, and an FPO deciding whether to commit a truck must know which they are reading.
 *
 * `no_history` is neither. It is not zero — nobody has delivered to those villages on that day inside the
 * window, so the honest answer is "we cannot say yet".
 */
export function parcelsKey(p: RouteParcels): string {
  switch (p.kind) {
    case 'measured':  return 'route.parcels.measured';
    case 'estimated': return 'route.parcels.estimated';
    default:          return 'route.parcels.none';
  }
}

export function parcelsValue(p: RouteParcels): number | null {
  return p.kind === 'no_history' ? null : p.perRun;
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE ECONOMICS — ONE SIDE                                                                                */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W231: "the Mendarda proposal pencils at ₹28/parcel vs ₹96 ad-hoc — but only above 9 parcels/run."
 *
 * The ad-hoc side is real (`shipments.charge_minor` — what those parcels actually cost, one at a time). The route
 * side is recorded NOWHERE: there is no per-route cost, no vehicle day-rate, no fuel model, and `rider_payout_terms`
 * prices a DROP for a rider rather than a truck for a morning. So the console prints the measured baseline and
 * says the route side is not recorded — it does not divide an imagined lorry hire by an estimated parcel count and
 * print the result next to a real number, because two numbers side by side read as two measurements.
 *
 * The "only above 9 parcels/run" threshold is the same missing input from the other side (route cost ÷ ad-hoc unit
 * cost), so it is named too rather than hardcoded from a mockup.
 */
export function economicsKey(e: RouteEconomics): string {
  return e.kind === 'ad_hoc_only' ? 'route.econ.adHoc' : 'route.econ.noBaseline';
}

/** Always shown beside the baseline: the sentence that stops the screen implying a comparison it cannot make. */
export function routeCostKey(): string { return 'route.econ.routeCostMissing'; }

/** The break-even parcel count W231 quotes. Not computable without a route cost, and not hardcoded: a business
 *  number typed into a screen is exactly what Law 6 forbids. */
export function breakEvenKey(): string { return 'route.econ.breakEvenUnknown'; }

/* ------------------------------------------------------------------------------------------------------- */
/* THE APPROVAL (W2406 · W2407 · W2408)                                                                    */
/* ------------------------------------------------------------------------------------------------------- */

/** Whether [Approve route] may be OFFERED. A button that refuses on click is worse than an absent one with a
 *  reason — the rule W120's pay button and W226's dispatch button both follow. */
export function canApprove(a: RouteApproval): boolean { return a.kind === 'ready'; }

/** Why it is not offered, by name: an operator told "needs a vehicle" opens the vehicle picker, and one told
 *  "incomplete" opens five fields. */
export function approvalKey(a: RouteApproval): string | null {
  switch (a.kind) {
    case 'ready':               return null;
    case 'needs_vehicle':       return 'route.approval.needsVehicle';
    case 'needs_consolidation': return 'route.approval.needsConsolidation';
    case 'needs_villages':      return 'route.approval.needsVillages';
    case 'already_active':      return 'route.approval.alreadyActive';
    default:                    return 'route.approval.notProposed';
  }
}

/** W2406's confirm step, and what it must say out loud: approving commits a named person's day every week. */
export function approveConfirmKey(): string { return 'route.approve.confirmBody'; }

export function boardHref(tab: RouteTab, cursor?: string | null): string {
  const qs = new URLSearchParams();
  if (tab !== 'all') qs.set('tab', tab);
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `/logistics/routes?${s}` : '/logistics/routes';
}

export const ROUTE_ACTIONS = ['approve', 'suspend', 'restart'] as const;
export type RouteAction = (typeof ROUTE_ACTIONS)[number];
export function isRouteAction(v: string | undefined): v is RouteAction {
  return !!v && (ROUTE_ACTIONS as readonly string[]).includes(v);
}
export function actionHref(action: RouteAction, id: string): string {
  return `/logistics/routes?act=${action}&id=${encodeURIComponent(id)}`;
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE NEW-ROUTE FORM (W2402 · W2403 · W2404 · W2405)                                                      */
/* ------------------------------------------------------------------------------------------------------- */

export interface RouteDraft { defaultName: string; runWeekday: string; villageRegionIds: string[] }
export type FieldError = { field: 'defaultName' | 'runWeekday' | 'villageRegionIds'; key: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MIN_ROUTE_NAME = 3;
export const MAX_ROUTE_NAME = 150;

/**
 * W2402: "every invalid field is listed with its reason, values you entered are preserved, nothing was saved."
 *
 * So: EVERY error at once (not the first), each naming its own field, and validated to the same rules the server's
 * entity enforces — a form that passes what the API will refuse has taught the operator nothing.
 */
export function validateDraft(d: RouteDraft): FieldError[] {
  const out: FieldError[] = [];
  const name = d.defaultName.trim();
  if (name.length < MIN_ROUTE_NAME) out.push({ field: 'defaultName', key: 'route.form.err.nameShort' });
  else if (name.length > MAX_ROUTE_NAME) out.push({ field: 'defaultName', key: 'route.form.err.nameLong' });
  else if (/[<>]/.test(name)) out.push({ field: 'defaultName', key: 'route.form.err.namePlain' });
  if (d.runWeekday !== '') {
    const n = Number(d.runWeekday);
    if (!Number.isInteger(n) || n < 0 || n > 6) out.push({ field: 'runWeekday', key: 'route.form.err.weekday' });
  }
  if (d.villageRegionIds.length === 0) out.push({ field: 'villageRegionIds', key: 'route.form.err.villagesEmpty' });
  else if (d.villageRegionIds.some((v) => !UUID_RE.test(v))) out.push({ field: 'villageRegionIds', key: 'route.form.err.villagesInvalid' });
  return out;
}

export function errorFor(errors: readonly FieldError[], field: FieldError['field']): string | null {
  return errors.find((e) => e.field === field)?.key ?? null;
}

/** W2403's review step: "everything you entered, shown read-only". The route being created is a PROPOSAL, and the
 *  review says so — an operator who thinks they just scheduled a truck will not come back to approve it. */
export function reviewNoticeKey(): string { return 'route.form.reviewProposal'; }

export function newRouteHref(step?: 'review'): string {
  return step === 'review' ? '/logistics/routes/new?step=review' : '/logistics/routes/new';
}

/* ------------------------------------------------------------------------------------------------------- */
/* "SUGGEST ROUTES" — AND WHAT IT ACTUALLY IS                                                              */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W231's empty state: "the suggest tool maps 30 days of ad-hoc shipments into route candidates. [Suggest routes]"
 *
 * There is no such tool. What the API returns is the corridors an FPO's parcels ALREADY travel — village, day,
 * parcels, spend — which a person reads and turns into a proposal. The console offers exactly that and names it,
 * because a button that silently created proposals would be committing vehicles on the strength of a GROUP BY.
 */
export function suggestKey(): string { return 'route.suggest.corridorsOnly'; }

export const ROUTE_REFUSALS: Record<string, string> = {
  ROUTE_NOT_APPROVABLE: 'notApprovable',
  DELIVERY_ROUTE_INVALID: 'invalid',
  ZONE_ROUTE_REF_UNKNOWN: 'refUnknown',
  FLEET_ALREADY_IN_STATE: 'alreadyInState',
  SHIPMENT_FORBIDDEN: 'forbidden',
  validation: 'validation',
};

/**
 * `ROUTE_NOT_APPROVABLE` carries a `reason` in its details, and the action layer puts THAT in the URL because it
 * is the specific sentence — "this route has no vehicle" sends an operator to the vehicle picker, while "cannot be
 * approved" sends them to ask us why. So the reasons are first-class keys here, not a fallback to the generic one.
 */
export const APPROVAL_REASONS = ['needs_vehicle', 'needs_consolidation', 'needs_villages', 'needs_approval', 'already_active', 'not_proposed'] as const;

export function routeErrorKey(code: string): string {
  if ((APPROVAL_REASONS as readonly string[]).includes(code)) return `route.err.${code}`;
  return `route.err.${ROUTE_REFUSALS[code] ?? 'generic'}`;
}

export const ROUTE_OK = ['created', 'approved', 'suspended', 'restarted'] as const;
export function routeOkKey(code: string): string | null {
  return (ROUTE_OK as readonly string[]).includes(code) ? `route.ok.${code}` : null;
}
