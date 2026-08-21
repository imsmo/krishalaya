// modules/tenancy/domain/billing-notice.ts · WHO hears about a tenant's own billing, and IN WHAT WORDS
// (PC-56 TENANT-4d-5). Pure rules — no I/O, no clock, no database.
//
// **THE THING THIS WAVE EXISTS TO FIX.** `NOTIFICATION_EVENT_MAP` (communication) had no tenancy row of any
// kind, so SEVEN tenancy outbox events had no subscriber: `saas_invoice_issued`, `saas_invoice_paid`,
// `saas_invoice_overdue`, `trial_ending`, `usage_limit_alert`, and TENANT-4d-4's two new ones,
// `subscription_grace_started` and `subscription_renewed`. A tenant has therefore never been told anything at
// all about its own bill — not that it was raised, not that it was paid, not that it was overdue, and not that
// its service was inside a grace window that was about to close. W120's footnote says "while we retry and
// notify you"; TENANT-4d-1's W118 says "at 90% of any limit you get a console + email notice". Both halves of
// "notify" were fiction.
//
// **AND THE MAP ROWS ALONE WOULD HAVE CHANGED NOTHING**, which is the trap ADMIN-6b already walked into once
// and wrote down in the map file itself: `DomainEventFanoutHandler` reads its recipients OUT OF THE PAYLOAD and
// returns early — silently — when it finds none. Every one of these seven payloads carries `tenantId` and not
// one user id. "A map row pointing at a payload with no recipient is the shape of fix that looks done and
// changes nothing." So the recipient question is the wave, and the map rows are the easy part.
import { moneyText as coreMoneyText } from '../../../core/money/money-text';
import { TenancyEventType } from './tenancy.events';

/* --------------------------------------------------------------------------------------------------------- */
/* WHO                                                                                                       */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * The permission that decides who is a billing recipient — and it is deliberately THE SAME ONE the billing
 * console requires (`TenancyPermissions.ManageTenant`, i.e. `tenant.settings`, enforced by
 * `saas-invoices.controller.ts` and by `SaasInvoiceService.getById`).
 *
 * **WHY A PERMISSION AND NOT A ROLE, AND NOT A `billing_email` COLUMN.**
 *   • A ROLE would be wrong because `roles` is a PLATFORM table with a `scope` column and no tenant id (0142
 *     learned that the hard way against a real database): hardcoding `tenant_admin` would both miss an FPO
 *     that grants billing to a finance clerk through `staff_permission_overrides` and break any white-label
 *     that names its roles differently — capping a tenant's white-label, which Rule Zero forbids outright.
 *   • A `billing_email` COLUMN on `tenants` would be a second, staler copy of a fact the RBAC tables already
 *     hold, and on a phone-first platform it would usually be empty. There is no such column and this wave
 *     does not add one.
 *   • THE PERMISSION IS THE HONEST ANSWER because it is the same key that opens the screen where the tenant can
 *     DO something about the notice. Telling somebody a bill is overdue when they cannot see the invoice or
 *     press pay is noise; telling exactly the people who can act on it is the notice.
 *
 * The consequence is stated rather than hidden: a tenant that has granted `tenant.settings` to nobody gets no
 * billing notice, because there is nobody on the platform who could act on one. `recipientVerdict` names that
 * case so a metric and an operator can see it, instead of it looking like a delivery failure.
 */
export const BILLING_RECIPIENT_PERMISSION = 'tenant.settings';

/** A hard ceiling on one notice's fan-out. Not a paging bound — a COST bound: every recipient beyond this is a
 *  costed SMS per event per tenant, and a tenant that has granted billing management to two hundred people has
 *  a configuration problem that a two-hundred-message send would bill the platform for rather than surface. */
export const MAX_BILLING_RECIPIENTS = 20;

export type RecipientVerdict =
  /** Somebody holds the permission and will be told. */
  | { kind: 'notify'; userIds: string[]; truncated: boolean }
  /** Nobody in this tenant holds `tenant.settings` — there is no one to tell, and that is a real finding. */
  | { kind: 'nobody_holds_permission' }
  /** The tenant has switched billing notices off (Law 10, per-tenant). Not a failure. */
  | { kind: 'notifications_off' };

/**
 * Turn a resolved candidate list into the verdict. Dedupes (a person may hold two roles in one tenant — the
 * seat rule TENANT-4d-1 established) and truncates at the ceiling, reporting that it did.
 *
 * ORDER IS STABLE AND IS THE CALLER'S: the reader returns candidates ordered by user id, so the same event
 * replayed by the relay produces the same recipient list, and `NotificationService`'s per-(dedupeKey, user,
 * channel) derived id therefore dedupes a re-delivery instead of sending a second message.
 */
export function recipientVerdict(candidates: readonly string[], notificationsEnabled: boolean): RecipientVerdict {
  if (!notificationsEnabled) return { kind: 'notifications_off' };
  const seen: string[] = [];
  for (const c of candidates) if (c && !seen.includes(c)) seen.push(c);
  if (seen.length === 0) return { kind: 'nobody_holds_permission' };
  return { kind: 'notify', userIds: seen.slice(0, MAX_BILLING_RECIPIENTS), truncated: seen.length > MAX_BILLING_RECIPIENTS };
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHICH EVENTS                                                                                              */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * The tenancy events that become a tenant-facing billing notice. An allow-list rather than "enrich everything
 * that passes through flush()": `tenancy.tenant_setting_changed` and `tenancy.plan_created` also flow through
 * the same choke point, and attaching a recipient list to them would silently start notifying people the
 * moment somebody adds a catalog row for one — the opposite of an explicit decision.
 */
export const NOTIFIED_BILLING_EVENTS: readonly string[] = [
  TenancyEventType.SaasInvoiceIssued,
  TenancyEventType.SaasInvoicePaid,
  TenancyEventType.SaasInvoiceOverdue,
  TenancyEventType.SubscriptionGraceStarted,
  TenancyEventType.SubscriptionRenewed,
  TenancyEventType.TrialEnding,
  TenancyEventType.UsageLimitAlert,
];

export function isNotifiedBillingEvent(eventType: string): boolean {
  return NOTIFIED_BILLING_EVENTS.includes(eventType);
}

/**
 * `tenancy.saas_invoice_paid` fires on EVERY movement in the paid arithmetic, including
 * `issued → partially_paid` (0146 made two half payments settle an invoice, so the intermediate state is now
 * reachable and common). A tenant should get a receipt when the bill is SETTLED, not a message each time a
 * part-payment lands — so the notice is suppressed unless the invoice actually reached `paid`.
 *
 * The event still fires and 4d-4's period-roll handler still consumes it; only the NOTICE is conditional.
 * Expressed here rather than in the handler because it is a content decision, not a transport one.
 */
export function paidNoticeApplies(payload: Record<string, unknown>): boolean {
  return payload.status === 'paid';
}

/* --------------------------------------------------------------------------------------------------------- */
/* IN WHAT WORDS — the money, exactly                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * **A NOTICE MAY NOT PRINT MINOR UNITS AT A TENANT, AND MAY NOT INVENT A LOCALE.**
 *
 * `NotificationTemplate.render()` interpolates whatever the payload holds and every billing payload on this
 * platform carries `totalMinor` as a string of minor units. A template body reading "You owe {{totalMinor}}"
 * would send an FPO "You owe 795400". The one seeded precedent hedges — 'dispute.refunded' sends "A refund of
 * {{amountMinor}} (minor units) was issued" — which is honest and unreadable, and is not good enough for the
 * document a tenant pays against.
 *
 * So the emitter formats, and it formats EXACTLY:
 *   • integer arithmetic on the minor amount against that currency's own `minor_units` (INR 2, JPY 0, KWD 3),
 *     never a float and never a hardcoded ÷100 — a hardcoded 100 is the shape that blocks a country;
 *   • the ISO 4217 CODE rather than a symbol, because the same message body is rendered for recipients in
 *     three languages off one payload and "₹" is not the right glyph in every script the platform ships,
 *     while "INR" is unambiguous in all of them and needs no locale data the platform does not have;
 *   • grouping every three digits from the right, which is wrong for the Indian lakh/crore convention and is
 *     therefore NOT claimed to be localised — it is a plain, stable, machine-checkable rendering. Per-locale
 *     grouping needs a locale per RECIPIENT, and the payload is shared across recipients; that is named as a
 *     follow-up rather than approximated here.
 */
export function moneyText(minor: bigint, currencyCode: string, minorUnits: number): string {
  // [PC-56 TENANT-6d-7] ONE IMPLEMENTATION, TWO CALLERS. Six dairy member notices needed the same rendering, and the
  // choice was "import another module's domain file" or "write the rule again". The rule now lives in
  // `core/money/money-text.ts` and this stays as the tenancy module's name for it — so 4d-5's spec keeps testing the
  // behaviour a tenant's invoice notice depends on, and there is still only one place that decides how money reads.
  return coreMoneyText(minor, currencyCode, minorUnits);
}

/**
 * THE VARIABLES EACH NOTICE'S TEMPLATES MAY REFERENCE, per event code.
 *
 * **THIS EXISTS BECAUSE A MISSING VARIABLE IS SILENT.** `NotificationTemplate.render()` documents its choice
 * explicitly — "Missing keys render as '' (never leak '{{x}}' to a user)" — which is the right call for a
 * user-facing string and means a template that references a key the payload does not carry sends a sentence
 * with a HOLE in it: "Invoice  for  is due on ." It renders, it dispatches, it is recorded as `sent`, and
 * nothing anywhere fails. 0122 made the variables declarable so a typo is refusable at AUTHORING time; this
 * table is the emitter's half of the same promise, and `tenant4d5-billing-notices.spec.ts` reads every seeded
 * 4d-5 template body, extracts its `{{tokens}}`, and asserts each one appears here — so a template seeded in
 * a later wave with a variable this code does not send fails a test instead of sending a gap.
 */
export const NOTICE_VARIABLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'saas.invoice_issued':   ['invoiceNo', 'amountText', 'dueDate'],
  'saas.invoice_paid':     ['invoiceNo', 'amountText'],
  'saas.invoice_overdue':  ['invoiceNo', 'amountText', 'dueDate'],
  'saas.grace_started':    ['graceUntil'],
  'saas.subscription_renewed': ['periodEnd'],
  'saas.trial_ending':     ['trialEndsOn'],
  'saas.usage_limit_alert': ['metricCode', 'pct', 'used', 'limit'],
});

/** The catalog code each outbox event maps to. Kept here, next to the variables, so the two cannot drift; the
 *  communication map row and 0149's catalog rows are both asserted against it. */
export const NOTICE_EVENT_CODES: Readonly<Record<string, string>> = Object.freeze({
  [TenancyEventType.SaasInvoiceIssued]:  'saas.invoice_issued',
  [TenancyEventType.SaasInvoicePaid]:    'saas.invoice_paid',
  [TenancyEventType.SaasInvoiceOverdue]: 'saas.invoice_overdue',
  [TenancyEventType.SubscriptionGraceStarted]: 'saas.grace_started',
  [TenancyEventType.SubscriptionRenewed]:     'saas.subscription_renewed',
  [TenancyEventType.TrialEnding]:             'saas.trial_ending',
  [TenancyEventType.UsageLimitAlert]:         'saas.usage_limit_alert',
});

/* --------------------------------------------------------------------------------------------------------- */
/* W120's FOURTH SENTENCE, NOW THAT HALF OF IT IS TRUE                                                       */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W120 states one sentence covering two mechanisms: "while we retry and notify you". TENANT-4d-2 gave it the
 * single verdict `no_notification` because NEITHER half existed. This wave builds the notify half and does
 * NOT build the retry half — there is still no autopay mandate for a subscription anywhere in the payments
 * module, so "we retry" still has no instrument.
 *
 * **SO THE ONE VERDICT SPLITS RATHER THAN FLIPPING.** Returning `exists` would claim a retry loop that does
 * not exist; leaving `no_notification` would now tell a tenant we will not contact them immediately after we
 * did. `notify_only` is the third statement, and it is the true one: we will tell you, and you must pay it
 * yourself because we have nothing to charge.
 */
export type NotifyHalf = 'notify_only' | 'no_notification';

export function retryAndNotifyVerdict(p: { notificationsEnabled: boolean }): NotifyHalf {
  return p.notificationsEnabled ? 'notify_only' : 'no_notification';
}
