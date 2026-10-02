// modules/requirements/services/requirement-order.service.ts · PC-56 TENANT-11d · A2 / F-27d — THE REQUIREMENTS SIDE OF "ONE
// ORDER PER ACCEPTED RESPONSE".
//
// Orders' `QuoteAcceptedHandler` (requirements.quote_accepted) makes the order; it asks THIS public service (Law 11 — orders never
// reads requirement tables) for the accepted response, locked, with what the order needs — the accepted quantity (the DB's own
// numeric text, not a float), the quoted unit price, the REQUIREMENT's unit and currency — and records the order on the response
// (`requirement_responses.order_id`, written once by trigger, unique) in the SAME kv_app transaction as the order insert. A
// redelivery finds `orderId` set and makes nothing. No kv_relay grant: the handler runs this through kv_app's unit of work.
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';

export interface AcceptedForOrder {
  responseId: string; requirementId: string; buyerUserId: string; sellerUserId: string; listingId: string;
  unitPriceMinor: bigint; quantity: string; unitCode: string; currencyCode: string; groupId: string | null;
}

@Injectable()
export class RequirementOrderService {
  constructor(private readonly repo: RequirementResponseRepository) {}

  /** The accepted response that still has no order, locked in the caller's transaction — or null (not accepted / already has one). */
  async claimForOrderInTx(tx: TxContext, tenantId: string, responseId: string): Promise<AcceptedForOrder | null> {
    const r = await this.repo.acceptedForOrder(tx, tenantId, responseId);
    if (!r || r.status !== 'accepted' || r.orderId || !r.listingId || !r.acceptedQuantity) return null;
    return { responseId: r.id, requirementId: r.requirementId, buyerUserId: r.buyerUserId, sellerUserId: r.sellerUserId, listingId: r.listingId,
      unitPriceMinor: r.quotedPriceMinor, quantity: r.acceptedQuantity, unitCode: r.unitCode, currencyCode: r.currencyCode, groupId: r.groupId };
  }
  /** Record the order made for THIS response (once). */
  async attachOrderInTx(tx: TxContext, tenantId: string, responseId: string, orderId: string): Promise<void> {
    await this.repo.attachOrder(tx, tenantId, responseId, orderId);
  }
}
