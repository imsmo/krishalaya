// modules/tenancy/services/billing-notice.service.ts · PC-56 TENANT-4d-5 — the one place a billing event
// becomes NOTIFIABLE.
//
// **IT ENRICHES A PAYLOAD; IT DOES NOT SEND ANYTHING.** That is the whole design, and it is a refusal of the
// obvious alternative. The obvious alternative is a tenancy-side outbox handler that resolves recipients and
// calls `NotificationService.fanout` itself — and it would be a SECOND MECHANISM OVER ONE CONSUMABLE RESOURCE,
// the exact defect class this programme has already found twice (two mechanisms over one payment in 0146, two
// correct-looking halves over one clock in 0148). The platform has exactly one notification spine:
// `NOTIFICATION_EVENT_MAP` → `DomainEventFanoutHandler` → catalog row → templates → delivery log. Every other
// module on the platform reaches it by putting recipients in its payload and adding a map row. Billing does the
// same, through the same door, and gets the opt-outs, quiet hours, template versioning, cost tracking and
// idempotent delivery log for free — rather than a private path that would have to reimplement all six and
// would drift from the first of them within a wave.
//
// So this service answers only the questions the emitting module is the only one able to answer: WHO in this
// tenant may act on a bill, and WHAT the amount says in words.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { BillingRecipientsRepository } from '../repositories/billing-recipients.repository';
import { TenancyEventType } from '../domain/tenancy.events';
import { isNotifiedBillingEvent, moneyText, paidNoticeApplies, recipientVerdict } from '../domain/billing-notice';

/** Law 10, default OFF, per-tenant. A white-label that does its own billing correspondence switches this off
 *  and the platform goes quiet for that tenant alone — which is why the flag is checked with the tenant in
 *  scope rather than globally. */
export const BILLING_NOTIFICATIONS_FLAG = 'saas_billing_notifications';

/** The payload field each notice's money sentence is built from. `overdue` is deliberately NOT `totalMinor`:
 *  an invoice that was half-paid and then went overdue owes the REMAINDER, and telling a tenant they owe the
 *  full amount of an invoice they part-paid is both wrong and the kind of wrong that costs trust twice. */
const AMOUNT_SOURCE: Readonly<Record<string, string>> = Object.freeze({
  [TenancyEventType.SaasInvoiceIssued]:  'totalMinor',
  [TenancyEventType.SaasInvoicePaid]:    'totalMinor',
  [TenancyEventType.SaasInvoiceOverdue]: 'outstandingMinor',
});

@Injectable()
export class BillingNoticeService {
  private readonly log = new Logger(BillingNoticeService.name);

  constructor(
    private readonly recipients: BillingRecipientsRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /**
   * Return the payload the outbox should carry. Unchanged for anything that is not a billing notice, and
   * unchanged when this tenant has notices switched off.
   *
   * **THE FLAG IS THE KILL SWITCH BECAUSE OF WHERE IT SITS.** The map rows are registered at module init and
   * cannot be conditionally unregistered per tenant; gating inside the fanout would mean a communication-module
   * change per emitting module. Gating HERE means the flag decides whether a recipient exists at all, and
   * `DomainEventFanoutHandler`'s own documented rule — "nothing to notify (fail-closed: never invent a
   * recipient)" — becomes the kill switch. With the flag off, the notification plane is provably inert for this
   * tenant: not "configured not to send", but holding no address to send to. A live probe in 0149 asserts the
   * outbox row's payload has no `recipientUserIds` key at all in that state.
   *
   * **AND A FLAG FLIP IS NOT RETROACTIVE, WHICH IS SAID RATHER THAN DISCOVERED.** An event emitted while the
   * flag was off carries no recipients for ever; turning the flag on notifies future events only. That is the
   * correct behaviour for a kill switch (flipping it on must not suddenly deliver a month of back-dated
   * overdue notices to an FPO), and it is the behaviour a reader of this file would otherwise have to infer.
   */
  async enrich(tx: TxContext, tenantId: string, eventType: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!isNotifiedBillingEvent(eventType)) return payload;
    // A part-payment moves the invoice and rolls nothing; the receipt belongs to the settlement.
    if (eventType === TenancyEventType.SaasInvoicePaid && !paidNoticeApplies(payload)) {
      this.metrics.inc('tenancy.notice.skipped', { event: eventType, reason: 'not_settled' });
      return payload;
    }

    const enabled = await this.flags.isEnabled(BILLING_NOTIFICATIONS_FLAG, { tenantId }).catch(() => false);
    const candidates = enabled ? await this.recipients.holdersOfBillingPermission(tx, tenantId) : [];
    const verdict = recipientVerdict(candidates, enabled);
    if (verdict.kind !== 'notify') {
      // Both non-notify verdicts are recorded, and they are DIFFERENT facts. `nobody_holds_permission` is a
      // finding — this tenant has nobody who could act on a bill — and it must not be legible as a delivery
      // failure or as a switched-off flag, because the remedy is a human granting somebody `tenant.settings`.
      this.metrics.inc('tenancy.notice.no_recipient', { event: eventType, reason: verdict.kind });
      return payload;
    }
    if (verdict.truncated) {
      this.metrics.inc('tenancy.notice.recipients_truncated', { event: eventType });
      this.log.warn(`billing notice ${eventType} for tenant ${tenantId}: more holders of tenant.settings than the send ceiling; notifying the first ${verdict.userIds.length} by user id`);
    }

    const out: Record<string, unknown> = { ...payload, recipientUserIds: verdict.userIds };

    const amountKey = AMOUNT_SOURCE[eventType];
    if (amountKey) {
      const text = await this.amountText(tx, payload, amountKey);
      // **NO AMOUNT MEANS NO NOTICE, NOT A NOTICE WITH A HOLE IN IT.** `NotificationTemplate.render()` turns a
      // missing variable into an empty string, so returning the payload without `amountText` would send an FPO
      // "Invoice KRI-202607-0001 for  is overdue" — rendered, dispatched, and logged as `sent`. Dropping the
      // recipients instead means the fanout returns early and the metric names the reason.
      if (text === null) {
        this.metrics.inc('tenancy.notice.no_recipient', { event: eventType, reason: 'amount_unformattable' });
        return payload;
      }
      out.amountText = text;
    }
    this.metrics.inc('tenancy.notice.enriched', { event: eventType, recipients: String(verdict.userIds.length) });
    return out;
  }

  /** W120's figure, in words a tenant can pay against. Null (→ no notice) rather than a guess when either half
   *  of the arithmetic is missing: a currency the platform holds no `minor_units` for cannot be divided, and
   *  0002 created `saas_invoices.currency_code` with no foreign key to `currencies` at all (0149 adds it). */
  private async amountText(tx: TxContext, payload: Record<string, unknown>, amountKey: string): Promise<string | null> {
    const raw = payload[amountKey];
    const currency = payload.currencyCode;
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
    if (typeof raw !== 'string' || !/^-?\d{1,19}$/.test(raw)) return null;
    const units = await this.recipients.minorUnits(tx, currency);
    if (units === null) return null;
    try {
      return moneyText(BigInt(raw), currency, units);
    } catch {
      return null;
    }
  }
}
