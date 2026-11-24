> **DRAFT — must be reviewed by a qualified lawyer before publishing.**

## Reviewer notes (not published)
- No refund TIMELINE exists anywhere in code. A gateway refund stays "refund initiated" until Razorpay reports it processed (apps/api payments/services/payment.service.ts refundCancelledOrder); a wallet refund is immediate. The body says the time depends on the payment provider and the bank. The Consumer Protection (E-Commerce) Rules 2020 expect a refund within a reasonable time; lawyer/founder to decide whether to publish a figure (it would then need to be built, or at least monitored).
- No dispute resolution time exists in code (refusal `resolved_in_days`). Not stated.
- Disputes, returns and refund approvals are all behind the per-store `disputes` flag (default OFF; db/seeds/core/0009_feature_flags.sql). In a store where it is OFF, a buyer has NO in-platform way to raise a problem; the body says the organisation's own policy and the grievance officer then apply. The lawyer must check whether this meets the E-Commerce Rules' complaint-handling duty.
- Pay-on-delivery orders: no money passes through the platform (`online_payments` OFF is the seeded default), so any refund of cash paid on delivery is between the buyer and the organisation. Nothing in code handles it. Stated neutrally.
- Quality window: 24 hours after delivery, every category, from QUALITY_WINDOW_MS in apps/api orders/domain/order.entity.ts; auto-complete only for orders paid online (order-clocks.ts QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT = true). The order state machine also allows a dispute on a COMPLETED order (order.state.ts `completed: ['disputed']`), and the storefront says a problem can be raised once the organisation has confirmed the order (store3a.dispute.notYet). So the window is when the money is released, not a hard cut-off for raising a dispute. The body is worded that way; lawyer to decide whether to set a dispute deadline (it would need building).
- Cancellation: buyer may cancel through status `ready` (order.state.ts isCancellable); a reason is required (0210 cancel_reason vocabulary); no fee ladder exists (refusal `fee_ladder`). The seller can decline/cancel too; the system cancels after 24 hours without confirmation (ACCEPTANCE_WINDOW_MS, seller-confirm-timeout.job.ts); moderators can cancel (storefront store3a.cancelledBy.moderator).
- Auction orders: unpaid winner who cancels forfeits the deposit; paid auction order cancelled returns deposit and payment (storefront store3a.cancel.auction.*). The 24-hour auto-cancel does not apply to auction orders.
- Returns: the returns machine exists (disputes/domain/return.state.ts) but the storefront's returns form was removed (orders/[id]/page.tsx comment "the returns form is gone"). The body therefore does not offer buyers a separate return request; a return can happen only where the organisation or moderator arranges it, and then the refund follows receipt. Confirm.
- Partial refund amount is decided by the moderator; there is no tolerance rule (refusal `partial_refund`). Future-order credits do not exist (refusal `future_credits`).
- "Escrow" is the platform's own ledger account, not a regulated escrow (see the Terms reviewer notes).
- The body links /quality-promise, which prints the same rules from features/sweep/quality-rules.ts.

<!-- BEGIN PAGE BODY -->
# Refunds and Cancellations Policy

This policy explains when an order can be cancelled, how a problem with an order is raised and decided, and how money comes back to you. It describes how the platform actually works. Some parts depend on choices each organisation makes for its own store; where that is so, this page says so, and each order's own page tells you what applies to that order.

The seller of every order is the organisation whose store you bought from. The platform provides the ordering, payment and dispute tools. See the [Terms of Use](/terms) and the [quality promise](/quality-promise).

## 1. How you paid decides what can be refunded

- **Paid online.** In a store that takes online payment, your payment is held in an escrow account in the platform's ledger until the order completes. A refund comes out of that held money.
- **Paid from your wallet.** The same, except that a refund goes back into your wallet.
- **Pay on delivery.** In a store that does not take online payment, you pay the organisation directly when you receive the order. The platform holds nothing for such an order, so it has nothing to refund. Any return of money you paid on delivery is between you and the organisation, under its own policy.

## 2. Cancelling an order

### When you can cancel
- Whether an order can still be cancelled is shown on that order's page.
- You can cancel without any deduction until the order is ready for handover.
- Once the order has been picked up for delivery, it can no longer be cancelled. If something is wrong after that, raise a problem instead (section 4).
- You choose a reason from a list when you cancel. If you choose "Other", you say why in your own words. Your reason is recorded on the order.

### What happens to your money
- If you paid online, the whole payment goes back to where it came from automatically. You do not need to ask.
- If you paid from your wallet, the money is back in your wallet straight away.
- If nothing was paid, there is nothing to refund.

### Cancellations you did not make
An order can also be cancelled:

- by the organisation, if it declines or cannot fulfil the order;
- by the system, if the organisation does not confirm the order within 24 hours of it being placed, or if an online payment was not completed in that time;
- by the platform's moderators.

In each case, a payment you made online or from your wallet is refunded in full to where it came from, in the same way. The order's page says who cancelled it.

### Auction orders
If you won a lot at auction and cancel without paying, your deposit is forfeited to the organisation. If you had already paid, your deposit and your payment are returned. The automatic 24-hour cancellation does not apply to auction orders.

## 3. After delivery: the quality window

- **Paid online.** After delivery you have 24 hours, for every kind of produce, before the payment is released to the organisation. If you are satisfied, say "I received it" on the order's page and the payment is released then. If nothing is raised, the order completes by itself when the 24 hours end, and the payment is released.
- **Paid on delivery.** There is no window and nothing is held. Saying "I received it" closes the order.

If something is wrong, raise it before the window ends, so the payment stays held while it is decided.

## 4. Raising a problem (disputes)

Each organisation decides whether its store takes disputes. If it has not switched them on, the order's page says that a problem cannot be raised as a dispute in that store; you can then contact the organisation, and if you are not satisfied, the platform's grievance officer (section 7).

Where an organisation's store takes disputes:

- You raise a problem from the order's page, once the organisation has confirmed the order. You choose a reason and describe the problem in writing. Disputes and their messages are text only.
- The organisation can respond, and both of you can add messages to the dispute.
- While a dispute is open, the whole order payment stays in escrow, not only the part in question. An order paid on delivery has nothing in escrow.
- The organisation's moderator, or the platform's dispute desk, decides the dispute.
- A dispute ends in one of four decisions: a full refund; a partial refund of an amount the moderator decides; a replacement; or the dispute is rejected. When a dispute is rejected or settled by a replacement, the payment is released to the organisation.
- You can withdraw a dispute you raised while it is still open.

There is no separate return request on the storefront. Where a decision requires goods to be sent back, the organisation or the moderator arranges it, and the refund is made once the goods are received back.

## 5. How refunds are paid

- A refund always goes back to where the money came from: to the UPI account, card or bank account you paid with, through our payment provider, or to your wallet if you paid from it.
- It is for the full amount, or for the amount decided in a dispute.
- A refund to your wallet is immediate. A refund through the payment provider is requested from the provider at once and shows as "refund initiated" on your order until the provider confirms it is processed. How long the money then takes to reach your account depends on the payment provider and your bank.
- We do not give refunds as credit for future orders.

## 6. When a payment fails

If an online payment does not go through, the order is not paid and nothing is charged. If money did leave your account for a payment that failed, your bank returns it. The payment page shows the reason the payment provider gave, and you can try again.

## 7. Complaints

If you are not satisfied with how a cancellation, dispute or refund was handled, contact the platform's grievance officer:

- Name: {{platform.grievance.officer_name}}
- Address: {{platform.grievance.address}}
- Email: {{platform.grievance.email}}
- Acknowledgement time, in hours: {{platform.grievance.ack_hours}}
- Resolution time, in days: {{platform.grievance.resolve_days}}

The same details are on the [Trust and your data page](/trust-data#grievances). For general questions, see [Help](/help) or the [contact page](/contact).
<!-- END PAGE BODY -->
