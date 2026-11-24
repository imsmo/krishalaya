> **DRAFT — must be reviewed by a qualified lawyer before publishing.**

## Reviewer notes (not published)
- No delivery TIMELINE, slot or ETA exists in code: "NOT an ETA. Nothing on this platform computes one" (logistics shipment.service.ts `etaVerdict`, refusal `eta_slot`). The body promises none. The E-Commerce Rules expect delivery information to be shown; the founder may require organisations to state their own times in their stores (not built).
- Who delivers: the organisation, with its own fleet, an individual rider or a delivery partner (logistics partner_kind 3pl | tenant_fleet | rider; platform-level 3PLs exist in the admin realm). The platform itself does not carry goods. Confirm the platform never contracts carriage itself.
- Delivery areas: the checkout refuses an address the organisation does not deliver to (store2c.method.unserviceable; logistics delivery-zone.entity.ts). Delivery charge: the organisation's own charge by order value, never by distance (store2c.method.valueSlabs), shown at review. Buyer-side charges are behind the per-store `buyer_charges` flag. Member benefits can make delivery free (placement-charges.ts). Amounts are configuration, not code.
- Self-pickup from a centre is NOT offered at checkout (refusal store2c.refusal.selfPickup). Orders created from an accepted offer carry no delivery line: "collection or delivery arranged with the organisation" (placement-charges.ts NO_QUOTE).
- Tracking only where the organisation's `logistics` flag is ON (default OFF). What a buyer sees is from tracking-view.ts / sweep.tracking.* keys: status, milestones with times, "a delivery partner is assigned", count of unsuccessful attempts, partner reference. Never a map, coordinates, rider identity, phone, vehicle, ETA.
- Delivery OTP: the logistics module requires a delivery code at handover when deliveries are recorded, but nothing currently sends that code to the buyer (refusal `otp_handover`: `logistics.delivery_otp_issued` has no consumer). The body does NOT mention a delivery code. Must be revisited before logistics launches.
- Failed / returned deliveries: no re-attempt pricing and no refund-on-return logic exist (refusals `reattempt_price`, `returned_refund`). The body says the organisation's own policy applies and the order page shows the payment as it stands.
- Transit SMS is not sent (refusal `transit_sms`); the body does not promise delivery SMS. "When your order is confirmed we send you a message" is a storefront string (store2c.pay.messageOnConfirm) and is used.
- Risk of loss / passing of title: not in code. Generic sentence that the organisation is responsible until delivery; lawyer to confirm under the Sale of Goods Act.
- Countries: addresses must name their country (0214; CreateAddressSchema requires countryCode). Whether any organisation ships outside India is unknown; the body does not mention international shipping.
- The address delivery note is stored (addresses.delivery_note, 0214) but a "travels to every driver" claim is refused (`driver_view`). The body says only that the organisation can see it with the address.
- The /account/addresses link is used (route exists under apps/web-storefront/src/app/(platform)/account/addresses); it is not in the brief's list of known links. The API treats postal code as optional (create-address.dto.ts) while the storefront form asks for it; the body says an address "holds" a postal code. Confirm.

<!-- BEGIN PAGE BODY -->
# Shipping and Delivery Policy

This policy explains who delivers your order, where and for what charge, and what you can see about a delivery on the platform. Each organisation runs its own deliveries, so several details are set by the organisation whose store you buy from. The checkout and your order's page always show what applies to your order.

See also the [Terms of Use](/terms) and the [Refunds and Cancellations Policy](/refunds).

## 1. Who delivers

The organisation you buy from is responsible for getting your order to you. It may use its own staff and vehicles, an individual rider, or a delivery partner it chooses. The platform itself does not carry goods.

The organisation remains responsible for the goods until they are delivered to you.

## 2. Where organisations deliver

- Each organisation sets the areas it delivers to.
- At checkout you choose a saved address or add a new one. If the organisation does not deliver to that address, the checkout says so and asks you to choose another. Nothing is charged.
- Self-pickup from a collection centre is not offered at checkout.
- An order that comes from an offer you agreed with an organisation has no delivery charge on it: collection or delivery is arranged with the organisation.

## 3. Delivery charges

- The delivery charge is the organisation's own charge, set by the value of the order, never by distance.
- It is shown on the review step of checkout, with the rest of the bill, before you place the order. Nothing is added afterwards.
- Some organisations offer members free delivery; where that applies, the review step shows it.

## 4. Your address

- An address holds the address line, the postal code and the country. You can also add a village or town, a label such as home or farm, the name and phone of whoever will receive the order, and a note for whoever delivers.
- The organisation uses the address you chose for the order. If you later change or remove a saved address, the order keeps the copy it was placed with.
- Manage your addresses from [your addresses](/account/addresses).

## 5. From order to delivery

1. You place the order. If the store takes online payment and you chose it, you pay at this point.
2. The organisation confirms the order. If it does not confirm within 24 hours, the order is cancelled automatically and any online payment is refunded in full. When your order is confirmed we send you a message.
3. The organisation packs the order and gets it ready for handover.
4. The order is handed over and delivered.
5. When it arrives, check it, and say "I received it" on the order's page.

The platform does not calculate delivery dates or time slots. If an organisation gives you a delivery time, that is the organisation's own estimate.

## 6. Following a delivery

Each organisation decides whether it records its deliveries on the platform.

Where it does, the delivery section of your order's page shows:

- the delivery status, such as pick-up arranged, picked up, on the way, at a hub, out for delivery or delivered;
- each step so far, with its time;
- whether a delivery partner has been assigned, and the delivery partner's reference when the organisation has recorded one;
- how many delivery attempts did not succeed, if any.

For your privacy and the privacy of delivery staff, the page never shows a map, a location, the name or phone number of the person delivering, or a vehicle number.

Where the organisation does not record deliveries here, the order's page says so, and the rest of the order is shown as usual. Contact the organisation about your delivery from its store's contact page.

## 7. If a delivery does not succeed

If a delivery attempt fails or the goods are sent back to the organisation, the organisation's own policy decides whether it tries again and whether any charge applies. The money section of your order's page shows your payment as it stands. If the order cannot be delivered, see the [Refunds and Cancellations Policy](/refunds) for how cancellations and refunds work.

## 8. Receiving your order

- **Paid online.** Your payment is released to the organisation when you say "I received it", or automatically 24 hours after delivery if you have not raised a problem. Check your order within that time.
- **Paid on delivery.** You pay the organisation when the order arrives.

If something is wrong with what arrived, and the organisation's store takes disputes, raise a problem from the order's page. See the [quality promise](/quality-promise).

## 9. Questions and complaints

For a question about a delivery, contact the organisation you bought from. If you are not satisfied, contact the platform's grievance officer:

- Name: {{platform.grievance.officer_name}}
- Address: {{platform.grievance.address}}
- Email: {{platform.grievance.email}}
- Acknowledgement time, in hours: {{platform.grievance.ack_hours}}
- Resolution time, in days: {{platform.grievance.resolve_days}}

See also [Help](/help), the [contact page](/contact) and the [Trust and your data page](/trust-data#grievances).
<!-- END PAGE BODY -->
