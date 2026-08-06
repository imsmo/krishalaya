// apps/admin-api/src/modules/billing-ops/services/subscription-write.service.ts · CHANGE a tenant's subscription
// (PC-56 ADMIN-1c, closes ADMIN-1-Q10). Three acts the canon screen W017 asks for and admin-api had NO path for:
// change plan, add an add-on, cancel at period end.
//
// WHAT MAKES THIS DIFFERENT FROM THE OTHER WRITES IN THIS MODULE. Nothing here moves money — and that is the whole
// design. A subscription change alters what the NEXT invoice will say; it must never reach into an invoice that has
// already been issued, and it must never post to the wallet. The billing cycle prices the period; this service only
// records the agreement. Any code here that tried to "adjust" an existing invoice would be re-pricing a document a
// tenant may already have paid.
//
// THE THREE RULES THAT SHAPE IT:
//   1. PRICE IS EXPLICIT, NEVER INHERITED. Changing plan requires the new negotiated price to be stated. Carrying the
//      old price silently onto a different plan is how a tenant ends up on enterprise features at a starter rate (or
//      the reverse, which is worse — they discover it on an invoice).
//   2. NEVER MID-PERIOD BY STEALTH. A plan change takes effect at the next period boundary by default; changing the
//      price of the period a tenant is already inside would make the invoice they receive disagree with the one they
//      agreed to. `immediate` exists for genuine corrections and is audited as such — it does NOT pro-rate, because
//      pro-ration is arithmetic on money and belongs to the billing cycle, not to an admin action.
//   3. CANCEL AT PERIOD END IS A FLAG, NOT A DELETION. The tenant keeps service to the end of the paid period. There
//      is deliberately no "cancel now" here: ending service somebody has paid for is a refund decision.
//
// One ACID tx per write (Law 4) + an audit row in the same tx (§4), row locked FOR UPDATE, and a mandatory reason on
// every act — a subscription's history is exactly what gets disputed years later.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { BillingRepository } from '../repositories/billing.repository';
import { BillingTenantNotFoundError, SubscriptionNotFoundError, InvalidSubscriptionChangeError } from '../domain/billing-ops.errors';
import { assertPlanChange, assertAddon, canCancelAtPeriodEnd } from '../domain/subscription-change';
import { ChangePlanDto, AddAddonDto, CancelSubscriptionDto } from '../dto/billing-ops.dto';

@Injectable()
export class SubscriptionWriteService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: BillingRepository,
  ) {}

  /** Move the tenant to a different plan at the next period boundary (or immediately, for a correction). */
  async changePlan(actor: AdminRequestContext, tenantId: string, dto: ChangePlanDto) {
    if (!(await this.repo.tenantExists(tenantId))) throw new BillingTenantNotFoundError(tenantId);

    return this.pool.withTx(async (client) => {
      const sub = await this.repo.getSubscriptionForUpdate(client, tenantId);
      if (!sub) throw new SubscriptionNotFoundError(tenantId);
      if (!(await this.repo.planExists(client, dto.planId))) {
        throw new InvalidSubscriptionChangeError(`plan ${dto.planId} does not exist`);
      }

      const change = assertPlanChange({
        currentPlanId: String(sub.planId), currentStatus: String(sub.status),
        newPlanId: dto.planId, priceMinor: BigInt(dto.priceMinor), billingCycle: dto.billingCycle,
        currency: String(sub.currency), newCurrency: dto.currency, immediate: dto.immediate === true,
      });

      await this.repo.updateSubscriptionPlan(client, String(sub.id), {
        planId: dto.planId, priceMinor: change.priceMinor, billingCycle: dto.billingCycle,
        discountPct: dto.discountPct ?? null, actorUserId: actor.userId,
      });

      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.subscription_plan_changed', entityType: 'subscription', entityId: String(sub.id),
        oldValue: { planId: sub.planId, priceMinor: sub.priceMinor, billingCycle: sub.billingCycle },
        newValue: {
          planId: dto.planId, priceMinor: change.priceMinor.toString(), billingCycle: dto.billingCycle,
          // recorded explicitly so the audit reader knows whether the CURRENT period was touched
          effective: change.effective, periodEnd: sub.periodEnd,
        },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });

      return { subscriptionId: sub.id, planId: dto.planId, priceMinor: change.priceMinor.toString(), effective: change.effective };
    });
  }

  /** Attach a paid add-on (extra language, +1000 farmers, a CSM). Priced explicitly, dated explicitly. */
  async addAddon(actor: AdminRequestContext, tenantId: string, dto: AddAddonDto) {
    if (!(await this.repo.tenantExists(tenantId))) throw new BillingTenantNotFoundError(tenantId);

    return this.pool.withTx(async (client) => {
      const sub = await this.repo.getSubscriptionForUpdate(client, tenantId);
      if (!sub) throw new SubscriptionNotFoundError(tenantId);

      const addon = assertAddon({
        addonCode: dto.addonCode, quantity: dto.quantity, priceMinor: BigInt(dto.priceMinor),
        startsOn: dto.startsOn, endsOn: dto.endsOn ?? null, subscriptionStatus: String(sub.status),
      });

      const id = randomUUID();
      await this.repo.insertSubscriptionAddon(client, {
        id, subscriptionId: String(sub.id), addonCode: addon.addonCode, quantity: addon.quantity,
        priceMinor: addon.priceMinor, startsOn: addon.startsOn, endsOn: addon.endsOn, actorUserId: actor.userId,
      });

      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.subscription_addon_added', entityType: 'subscription', entityId: String(sub.id),
        newValue: {
          addonId: id, addonCode: addon.addonCode, quantity: addon.quantity,
          priceMinor: addon.priceMinor.toString(), startsOn: addon.startsOn, endsOn: addon.endsOn,
        },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });

      return { subscriptionId: sub.id, addonId: id, addonCode: addon.addonCode };
    });
  }

  /** Set (or clear) cancel-at-period-end. The tenant keeps service to the end of the period they paid for. */
  async setCancelAtPeriodEnd(actor: AdminRequestContext, tenantId: string, dto: CancelSubscriptionDto) {
    if (!(await this.repo.tenantExists(tenantId))) throw new BillingTenantNotFoundError(tenantId);

    return this.pool.withTx(async (client) => {
      const sub = await this.repo.getSubscriptionForUpdate(client, tenantId);
      if (!sub) throw new SubscriptionNotFoundError(tenantId);
      if (!canCancelAtPeriodEnd(String(sub.status))) {
        throw new InvalidSubscriptionChangeError(`a '${sub.status}' subscription cannot be set to cancel at period end`);
      }
      const next = dto.cancel !== false;
      if ((sub.cancelAtPeriodEnd === true) === next) {
        // Idempotent, and SAID so rather than writing a second audit row claiming a change that did not happen.
        return { subscriptionId: sub.id, cancelAtPeriodEnd: next, unchanged: true, periodEnd: sub.periodEnd };
      }

      await this.repo.setSubscriptionCancelAtPeriodEnd(client, String(sub.id), next, actor.userId);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: next ? 'billing.subscription_cancel_scheduled' : 'billing.subscription_cancel_revoked',
        entityType: 'subscription', entityId: String(sub.id),
        oldValue: { cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true },
        newValue: { cancelAtPeriodEnd: next, lastDayOfService: sub.periodEnd },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });

      return { subscriptionId: sub.id, cancelAtPeriodEnd: next, unchanged: false, periodEnd: sub.periodEnd };
    });
  }
}
