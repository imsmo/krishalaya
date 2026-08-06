// apps/admin-api/src/modules/billing-ops/services/subscription-view.service.ts · READ-ONLY view of one tenant's
// subscription, for the console's subscription screen (PC-56 ADMIN-1, canon W017).
//
// WHY THIS IS A VIEW AND NOT A "TIMELINE": the canon screen is titled a timeline, and the honest answer is that the
// platform stores no subscription-EVENT history — `subscriptions` holds the CURRENT row only (0002), and nothing
// records "trialing → active on this date, by this person". So this service returns three things that are all true:
//   • the current state (status, cycle, negotiated price, discount, anchor terms, period window, cancel-at-end),
//   • the add-ons attached to it, and
//   • the invoices it has actually produced — which IS a real, dated billing history.
// The console labels the machine's next legal moves as POSSIBILITIES, not as history. Inventing a transition log
// from `updated_at` would have looked like a timeline while being a fabrication, and a subscription's history is
// exactly the thing a tenant disputes years later.
//
// Money is bigint minor-unit STRINGS throughout (Law 2) — nothing here is floated, summed or re-priced.
import { Injectable } from '@nestjs/common';
import { BillingRepository } from '../repositories/billing.repository';
import { BillingTenantNotFoundError } from '../domain/billing-ops.errors';

@Injectable()
export class SubscriptionViewService {
  constructor(private readonly repo: BillingRepository) {}

  /** One tenant's subscription view. A tenant that does not exist is a 404 (never an empty 200: "this tenant has no
   *  subscription" and "there is no such tenant" are different facts, and conflating them would let a typo look like
   *  a billing problem). A real tenant with no subscription returns nulls — that is a legitimate state (an approved
   *  tenant awaiting its first plan). */
  async forTenant(tenantId: string) {
    if (!(await this.repo.tenantExists(tenantId))) throw new BillingTenantNotFoundError(tenantId);
    const view = await this.repo.subscriptionForTenant(tenantId);
    return { tenantId, ...view };
  }
}
