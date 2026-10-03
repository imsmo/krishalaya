// modules/identity/domain/desk-templates.ts · PC-56 TENANT-13b · B2 / B3 — THE CANON'S SEVEN DESKS, AND WHAT EACH OF ITS PERMISSION
// LABELS REALLY IS ON THIS PLATFORM.
//
// Canon W185 draws 16 distinct permission labels; 13 of them do not exist in `permissions` (survey F-18). Founder decision 2026-10-03:
// tenant desk bundles, NO NEW GLOBAL ROLES — so a label is never minted as a new code just to make a card look complete. Each label is
// either MAPPED to the existing code a real route already checks (verified route-first: the code must be in `permissions` AND be read
// by an `@RequirePermissions` / policy in apps/api — `tenant13b-settings-desks.spec.ts` opens the files), or REFUSED BY NAME with the
// reason the console prints ("no route carries this yet" / "rides another verb").
//
// Departures from the brief's suggested map, each verified (the 13b report lists them):
//   • templates.edit → `notification.templates.manage`, not `cms.manage`: 0004 itself records cms.manage as "Retired in TENANT-8d — no
//     route checks it"; the canon's content desk edits template OVERRIDES (W180), which is notification.templates.manage.
//   • report.review → `content.moderate`: the member report queue (ai-governance moderation: "a member REPORTS; a moderator HANDLES")
//     is a real route under content.moderate.
//   • bmc.monitor → `dairy.manage`: GET /v1/dairy/bmc/monitor is a real route, gated by dairy.manage.
//   • order.read → REFUSED: the order console's read rides `dispute.resolve` (canModerateOrder) — a refund-resolving verb, not a read.
//   • statement.read → REFUSED: settlement statements ride `settlement.close`, a money act.
//   • listing.reject → REFUSED as its own code: rejection rides `listing.approve` (already on the moderation desk).
//   • member.view → `report.view`: the member roster's read gate (IdentityPermissions.Report), which also opens reports — said on the card.
//
// The DB lookup `desk_templates` (0192) carries the seven codes and the canon labels; this file carries the mapping. A test pins both.

export type CanonVerdict =
  | { kind: 'mapped'; code: string; noteKey?: string }
  | { kind: 'refused'; reasonKey: 'no_route' | 'rides_other'; ridesOn?: string };

export interface CanonLabel { label: string; verdict: CanonVerdict }
export interface DeskTemplate {
  code: 'verification' | 'support' | 'moderation' | 'dairy' | 'finance' | 'content' | 'labour';
  labels: readonly CanonLabel[];
  /** What the canon's honest sentence promises beyond the codes, and whether it exists. */
  guarantees: readonly { key: string; built: boolean; evidence: string }[];
}

const mapped = (code: string, noteKey?: string): CanonVerdict => ({ kind: 'mapped', code, ...(noteKey ? { noteKey } : {}) });
const noRoute: CanonVerdict = { kind: 'refused', reasonKey: 'no_route' };
const rides = (ridesOn: string): CanonVerdict => ({ kind: 'refused', reasonKey: 'rides_other', ridesOn });

export const DESK_TEMPLATES: readonly DeskTemplate[] = Object.freeze([
  { code: 'verification', labels: [
      { label: 'kyc.verify', verdict: mapped('kyc.review') },
      { label: 'member.view', verdict: mapped('report.view', 'report_view_also_reports') },
      { label: 'docs.read', verdict: mapped('kyc.read') },
    ], guarantees: [
      { key: 'no_money', built: true, evidence: 'none of the three codes touches a wallet, payout or refund route' },
      { key: 'kyc_recusal', built: false, evidence: 'no conflict declaration or recusal exists in identity (grep recus modules/identity → nothing)' },
    ] },
  { code: 'support', labels: [
      { label: 'ticket.respond', verdict: mapped('support.handle') },
      { label: 'member.view', verdict: mapped('report.view', 'report_view_also_reports') },
      { label: 'order.read', verdict: rides('dispute.resolve') },
    ], guarantees: [
      { key: 'refunds_escalate', built: true, evidence: 'support.handle carries no refund verb; refunds need order.refund + the 3b refund checker' },
    ] },
  { code: 'moderation', labels: [
      { label: 'listing.approve', verdict: mapped('listing.approve') },
      { label: 'listing.reject', verdict: rides('listing.approve') },
      { label: 'report.review', verdict: mapped('content.moderate') },
    ], guarantees: [
      { key: 'no_self_review', built: true, evidence: 'QC_OWN_LISTING / QC_OWN_DRAFT in the listing domain, 0138 CHECK as backstop' },
    ] },
  { code: 'dairy', labels: [
      { label: 'dairy.collections', verdict: mapped('dairy.manage') },
      { label: 'dairy.quality', verdict: mapped('dairy.manage') },
      { label: 'bmc.monitor', verdict: mapped('dairy.manage') },
    ], guarantees: [
      // canon: "Rate cards stay owner + checker" — NOT TRUE TODAY: POST /v1/dairy/rate-cards is gated by dairy.manage alone
      // (rate-cards.controller.ts) with no checker, so a dairy desk member could publish a rate card. Refused by name on the card.
      { key: 'rate_cards_checker', built: false, evidence: 'POST /v1/dairy/rate-cards needs dairy.manage only, no checker (rate-cards.controller.ts)' },
    ] },
  { code: 'finance', labels: [
      { label: 'payout.prepare', verdict: mapped('payout.prepare') },
      { label: 'ledger.read', verdict: mapped('ledger.read') },
      { label: 'statement.read', verdict: rides('settlement.close') },
    ], guarantees: [
      { key: 'maker_not_checker', built: true, evidence: 'payout.approve is on the one ungrantable list (core/rbac/ungrantable.ts); 0143 payout batch checker' },
    ] },
  { code: 'content', labels: [
      { label: 'content.publish', verdict: mapped('cms.pages.publish') },
      { label: 'templates.edit', verdict: mapped('notification.templates.manage') },
    ], guarantees: [
      { key: 'policy_pages_checker', built: true, evidence: 'a policy page is published by someone other than its author (cms-page.service needsChecker, 8d)' },
    ] },
  { code: 'labour', labels: [
      { label: 'labour.desk', verdict: mapped('labour.desk') },
    ], guarantees: [
      { key: 'wages_checker', built: true, evidence: 'labour.wages.approve is on the one ungrantable list' },
    ] },
] as DeskTemplate[]);

export const DESK_TEMPLATE_CODES = DESK_TEMPLATES.map((t) => t.code);

export function templateOf(code: string): DeskTemplate | undefined { return DESK_TEMPLATES.find((t) => t.code === code); }

/** The distinct real codes a template maps to (in canon order). */
export function mappedCodes(t: DeskTemplate): string[] {
  const out: string[] = [];
  for (const l of t.labels) if (l.verdict.kind === 'mapped' && !out.includes(l.verdict.code)) out.push(l.verdict.code);
  return out;
}

/** Every real code any template maps to — the set the route-check test opens apps/api for. */
export function allMappedCodes(): string[] {
  return [...new Set(DESK_TEMPLATES.flatMap(mappedCodes))].sort();
}
/** Every canon label that is refused (never minted as a permission). */
export function allRefusedLabels(): string[] {
  return [...new Set(DESK_TEMPLATES.flatMap((t) => t.labels.filter((l) => l.verdict.kind === 'refused').map((l) => l.label)))].sort();
}
