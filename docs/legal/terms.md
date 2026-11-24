> **DRAFT — must be reviewed by a qualified lawyer before publishing.**

## Reviewer notes (not published)
- Legal entity, registered office, grievance officer, mailboxes and grievance time limits are NOT in code: they are platform facts (migration 0223) set in the admin realm. The body uses tokens only; the storefront prints "not published yet" until they are set.
- Governing law is written as "the laws of India"; the seat of courts / jurisdiction (city) is deliberately NOT chosen. Lawyer to decide, and to decide whether to add an arbitration clause.
- Eligibility / age: the code does NOT verify age at sign-up (users.dob exists but nothing enforces a minimum age for buyers). The eligibility clause is generic legal text, not a described mechanism. Lawyer to confirm wording (Indian Contract Act capacity) and whether minors must be excluded expressly.
- Intermediary framing (IT Act s.79, IT Rules 2021, Consumer Protection (E-Commerce) Rules 2020 marketplace model): the code shows a marketplace where each organisation sells from its own store and the platform provides technology, payment collection into a platform escrow ledger, moderation and dispute desks. Whether the platform qualifies as an intermediary / marketplace e-commerce entity, given it holds buyer money in its own escrow ledger (refusal `regulated_partner`: there is no nodal/escrow agreement with a regulated partner yet), is a legal question. Flagged.
- Escrow wording: the code calls it an escrow account of the platform's own double-entry ledger (trust-claims.ts `escrow_ledger`). It is NOT a regulated escrow or nodal account. The lawyer must check whether the word "escrow" may be used with the public at all.
- The separate agreement between the platform and each organisation (docs/legal/tenant-msa-template.md is a stub) does not exist yet. This draft refers to it generically.
- Limitation of liability, disclaimer, indemnity and IP clauses are generic boilerplate with no code basis. No cap amount is stated. Lawyer to draft.
- Changes to terms: the code records a consent per purpose with a version (consent_purposes `terms` and `privacy` at v1, both mandatory; consents table is append-only). Whether users are asked to accept again when the version changes is NOT verified in code. The body only says the version you accepted is recorded.
- Appeals: an appeal path exists only for decisions under the `ai_governance` flag (apps/api ai-governance appeals.controller.ts) and is decided in the admin appeals queue. Whether every moderation action can be appealed is not established, so the body says "where an appeal is offered".
- Platform/buyer fees: a platform fee and buyer commission can be added to an order (placement-charges.ts, behind the `buyer_charges` flag). Their amounts come from configuration, not code. The body only says that any charges are shown before you place the order.
- Auctions: an unpaid winning auction order forfeits the deposit to the organisation (storefront store3a.cancel.auction.forfeit, orders/order-clocks.ts). Kept short; the lawyer should check that a forfeiture term is enforceable and disclosed at bidding time.
- Regulated farm inputs (for example pesticides) are refused and blocked at the cart (storefront refusals `licence_upload`, STORE-2b). This is stated as a fact.
- Language: live languages are English, Hindi and Gujarati (features/sweep/languages.ts). The lawyer must decide which language version prevails.
- The brand name is deliberately not typed; "the platform" plus the entity token is used throughout.
- Links to /language and /trace are used (both routes exist per features/sweep/refusals.ts: /language W323, /trace 5b) although they are not in the generator brief's list of known links. Confirm.

<!-- BEGIN PAGE BODY -->
# Terms of Use

These terms apply when you use this platform: its website, its stores and its apps. They are an agreement between you and {{platform.legal.entity_name}}, whose registered office is at {{platform.legal.registered_office}} ("we", "us", "the platform"). Please read them together with the [Privacy Policy](/privacy), the [Refunds and Cancellations Policy](/refunds) and the [Shipping and Delivery Policy](/shipping).

When you create an account you are asked to accept these terms and the Privacy Policy. We record which version you accepted and when.

## 1. What the platform is

The platform is a marketplace for farm produce and related goods. Farmer producer organisations, cooperatives, dairies and other organisations open their own stores on it. Each store belongs to one organisation, and that organisation is the seller of everything listed in its store.

The platform provides the technology the stores run on: listings, carts and checkout, payment collection, order records, messaging, delivery records and dispute handling. Unless a listing clearly says otherwise, we are not the seller of the goods, we do not own or inspect them, and we do not set their prices.

The platform home page is a directory of organisations and a read-only feed of listings. Each card leads into that organisation's own store. Carts, checkout and orders always belong to one store. There is no cart that spans several organisations.

## 2. Organisations and their stores

- An organisation appears to the public only once the platform has verified it. Verification means the platform's administrators have approved the organisation; it is not a badge the organisation gives itself. Organisations still on trial are not shown to the public.
- Each organisation sets its own prices, product descriptions, grades, delivery areas and delivery charges.
- Each organisation decides which features its store uses. For example, an organisation decides whether its store takes online payment, whether it records deliveries on the platform, whether it takes disputes, and whether buyers can message it. Each page tells you what applies in that store.
- The grade shown on a lot is the grade the organisation confirmed when it listed it. Lots are graded once, at listing.
- Organisations use the platform under a separate agreement with us. Their obligations to you as a seller come from the law and from what they publish in their store.

## 3. Your account

- You sign in with your mobile phone number. We send a one-time code to that number; entering it signs you in. One phone number holds one account.
- You are responsible for what happens on your account. Keep your phone and the codes sent to it to yourself. If you think someone else has used your account, sign out of your sessions and contact us.
- You can view and edit your profile from your account page. To change your phone number, use the change-phone screen in the platform's app; a code is sent to the new number.
- The platform is available in English, Hindi and Gujarati. You can change the language at any time from the [language page](/language).
- You must be legally able to enter into a binding contract under Indian law to place orders or operate a store.

## 4. Buying

- **Listings.** A listing is the organisation's offer to sell. The organisation is responsible for its description, grade, quantity and price.
- **Charges.** The review step of checkout shows the full bill before you place the order: the goods, any delivery charge the organisation sets, and any other charge that applies. Nothing is added after you place the order.
- **Confirmation.** After you place an order, the organisation must confirm it. If the organisation does not confirm within 24 hours, the order is cancelled automatically. If you were paying online and had not completed payment within that time, the order is also cancelled automatically.
- **The contract of sale** is between you and the organisation. The platform records the order and, where online payment is used, holds the payment as described in section 5.
- **Restricted goods.** Regulated farm inputs, such as pesticides, cannot be bought through the storefront; they are blocked at the cart.
- **Auctions.** Where an organisation sells a lot by auction, the auction's own page states the deposit and the time to pay. If a winning bidder does not pay and cancels, the deposit is forfeited to the organisation.

## 5. Paying

- **Pay on delivery.** In a store that does not take online payment, you pay the organisation when you receive the order, and the organisation confirms your order. The platform does not hold any money for such an order.
- **Pay online.** In a store that takes online payment, you pay through a secure payment sheet run by our payment provider, using UPI, card or netbanking. The money is recorded in an escrow account in the platform's own ledger. It is released to the organisation by a rule, not by a person: when you say "I received it", or when the 24-hour quality window after delivery closes with nothing raised. If a dispute is opened, the whole payment stays held until the dispute is decided.
- **Wallet.** If you have a wallet balance, you can pay from it when it covers the whole bill. Money in your wallet is paid out to your bank only when you ask; nothing is paid out automatically.
- All amounts are shown in the currency of the store.

The details of how refunds work are in the [Refunds and Cancellations Policy](/refunds).

## 6. Cancellations, problems and refunds

Whether an order can still be cancelled is shown on that order's page. You can cancel without any deduction until the order is ready for handover; after it has been picked up, it can no longer be cancelled. A cancelled order that was paid online is refunded in full to where the money came from.

Where an organisation has switched on disputes in its store, you can raise a problem with an order in writing from the order's page. The organisation's moderator or the platform's desk decides it. The full rules are in the [Refunds and Cancellations Policy](/refunds) and the [quality promise](/quality-promise).

## 7. Delivery

Delivery is arranged by the organisation you buy from, using its own staff or a delivery partner it chooses. The organisation decides where it delivers and what it charges. See the [Shipping and Delivery Policy](/shipping).

## 8. Messages and reviews

- Where an organisation has switched on messaging, you can message it about an order or a lot. Every message is about a specific order or lot.
- You can report a message. A reported message is hidden from everyone in the conversation while it is reviewed, and the reporter is never shown.
- Where an organisation's store takes reviews, only a buyer of a completed purchase can review it.
- What you write must be honest and lawful. Do not post anyone else's personal details.

## 9. Acceptable use

You must not:

- give false information, impersonate anyone, or create accounts for someone else without their permission;
- list or try to buy anything the law does not allow to be sold, or anything blocked on the platform;
- post a listing that misdescribes goods, their grade, origin or quantity;
- harass, threaten or defraud any person, or use messages to send spam or unrelated offers;
- interfere with the platform's security, try to read data you are not allowed to see, or overload the service;
- use the platform to avoid the law, including tax and payment rules.

## 10. Moderation and enforcement

- The platform's moderators can hold, remove or archive a listing, hide a reported message, and restrict or block an account that breaks these terms or the law. Every such action is recorded in the platform's audit log, which the application cannot change or delete.
- An organisation can suspend members of its own organisation from acting in its store.
- Where an appeal is offered against a decision that affected you, you can submit it from the place where the decision is shown, and a person on the platform's appeals desk decides it.
- We may also act on a lawful order from a court or a government authority.

## 11. Traceability

Some lots carry a trace code. Anyone can check a published trace by entering the code on the [trace page](/trace). A public trace shows the lot's journey; it never shows a person or an amount of money.

## 12. Our content and yours

The platform's software, design and text belong to us or our licensors. You may use them only to use the platform as intended.

You keep the rights in what you post (for example messages, reviews and listing content). You allow us to store it, show it to the people it is meant for, and use it to run the platform, for as long as it is on the platform and as the [Privacy Policy](/privacy) describes.

## 13. Availability

We work to keep the platform running, but it may sometimes be unavailable or limited, for example during maintenance or when a feature has been paused. When buying is paused, the page says so, and nothing is charged.

## 14. Responsibility and liability

- The organisation that sells to you is responsible for the goods, their description and quality, and for delivery.
- To the extent the law allows, the platform is not liable for the acts of organisations, delivery partners or buyers, or for indirect or consequential loss.
- Nothing in these terms limits any right you have as a consumer that the law does not allow to be limited.

## 15. Ending your use

You can stop using the platform at any time, and you can ask to delete your account from your account page as the [Privacy Policy](/privacy) explains. We may suspend or close an account that breaks these terms or the law. Orders already placed, and records the law requires us to keep, survive the end of your account.

## 16. Changes to these terms

We may change these terms. When we do, we will publish the new version on this page. The version you accepted is recorded against your account.

## 17. Law and disputes

These terms are governed by the laws of India. A disagreement with the platform that is not settled through the grievance process below may be taken to the courts that have jurisdiction under Indian law.

## 18. Grievances and contact

If you have a complaint about the platform, contact our grievance officer:

- Name: {{platform.grievance.officer_name}}
- Address: {{platform.grievance.address}}
- Email: {{platform.grievance.email}}
- Acknowledgement time, in hours: {{platform.grievance.ack_hours}}
- Resolution time, in days: {{platform.grievance.resolve_days}}

The same details are kept up to date on the [Trust and your data page](/trust-data#grievances). For anything else, write to {{platform.contact.general_email}} or see the [contact page](/contact).
<!-- END PAGE BODY -->
