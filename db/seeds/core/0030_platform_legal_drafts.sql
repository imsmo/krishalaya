-- db/seeds/core/0030_platform_legal_drafts.sql · PC-56 LEGAL-1 (migration 0242) — GENERATED, DO NOT EDIT BY HAND.
-- Source: docs/legal/{terms,privacy,refunds,shipping}.md (the text between the BEGIN / END PAGE BODY markers; the first "# " line is the title).
-- Regenerate: node db/scripts/gen-legal-drafts-seed.js   ·   Verify: node db/scripts/gen-legal-drafts-seed.js --check (db:test runs it).
-- Loads each page as a platform POLICY page, version 1, status DRAFT (never published here — the founder publishes after legal review, in
-- the admin console, by a second operator), ONLY when the platform has no row for the slug at all: re-running never overwrites console work.

INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code)
SELECT NULL, 'terms', 'policy', $legal_title$Terms of Use$legal_title$,
       $legal_terms$These terms apply when you use this platform: its website, its stores and its apps. They are an agreement between you and {{platform.legal.entity_name}}, whose registered office is at {{platform.legal.registered_office}} ("we", "us", "the platform"). Please read them together with the [Privacy Policy](/privacy), the [Refunds and Cancellations Policy](/refunds) and the [Shipping and Delivery Policy](/shipping).

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

The same details are kept up to date on the [Trust and your data page](/trust-data#grievances). For anything else, write to {{platform.contact.general_email}} or see the [contact page](/contact).$legal_terms$,
       1, 'draft', 'en'
 WHERE NOT EXISTS (SELECT 1 FROM cms_pages WHERE tenant_id IS NULL AND slug = 'terms');

INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code)
SELECT NULL, 'privacy', 'policy', $legal_title$Privacy Policy$legal_title$,
       $legal_privacy$This policy explains what personal data the platform holds about you, why, who else receives it, how long it is kept, and how you can exercise your rights under the Digital Personal Data Protection Act, 2023. The platform is operated by {{platform.legal.entity_name}}, registered office {{platform.legal.registered_office}} ("we", "us").

It applies to the platform's website, the stores organisations run on it, and its apps. It should be read with the [Terms of Use](/terms). The [Trust and your data page](/trust-data) explains, claim by claim, how the platform protects your money and your data.

## 1. Who uses your data

- **The platform** runs the accounts, the stores, payments, records and the data-protection desk. Requests to exercise your rights come to the platform, even when you used several organisations' stores.
- **The organisation you deal with** (for example the cooperative or producer organisation whose store you buy from, or whose member you are) sees the data it needs for that relationship, such as your orders with it and the address you chose for delivery. Each organisation's data is kept apart from every other organisation's in the database itself: row-level security decides which rows a request may read or write.

## 2. What we collect

### Your account
- Your mobile phone number, which is how you sign in. One phone number holds one account.
- Your name, and an email address if you add one.
- Your language, and other profile details you choose to add.
- A record of each consent you give or withdraw, with the version of the notice and when.

### Signing in and security
- One-time sign-in codes. These are held only briefly, in temporary storage that expires them; they are never written to the main database.
- Your sessions: when each was started and last used, the IP address it came from, and the kind of device (for example Android, iPhone or web). On the session list we show only the device kind and how long ago it was used.
- A security record of each sign-in attempt, including the phone number used, the IP address and whether it succeeded.
- In the app: a device identifier, the device model and software versions, and a push-notification token so we can send you notices.

### Addresses
- The addresses you save: the address lines, village or town, postal code, country, an optional label, an optional receiver name and phone, and an optional note for whoever delivers. An address may also carry map coordinates if they were supplied when it was saved.
- When you change an address that an order already used, the old copy is kept with the order, marked as retired.

### Orders, payments and money
- Your orders: what you bought, from which organisation, the amounts, the status and its history, and any cancellation reason you gave.
- Payments: the amount, the status, and the payment provider's references. You enter your UPI, card or netbanking details in the payment provider's own secure sheet.
- If you have a wallet: its balance and its transactions, which are recorded in the platform's double-entry ledger.
- If you receive payouts: your bank account or UPI ID. The bank account is tokenised by our payout provider; we keep the token, the last four digits, the IFSC code, the holder's name and whether a small test deposit confirmed it.
- Invoices for your purchases.

### Identity verification (KYC)
If you act as a seller, farmer member, or in another role that needs verification, you may upload identity or licence documents. We store the uploaded file, a masked document number, its issuer and validity dates, and the result of the review. Your full Aadhaar and PAN numbers are not stored in the platform's database; only a reference to a separate secure store and, for Aadhaar, the last four digits.

### What you write
- Messages you send to an organisation about an order or a lot, and reports you make about messages.
- Disputes you raise or answer, and the messages in them.
- Reviews you write.
- Questions you ask the farm assistant in the app, where an organisation offers it.

### Notices we send you
A record of each notice sent to you: which event, which channel (in the app, SMS or push), whether it was delivered and when.

### Location
- The website and stores do not ask for your device's location and do not guess your location from your IP address.
- Coordinates may be attached to an address, and delivery staff may record where a delivery status update happened. As a buyer you never receive these coordinates.
- In the app, a farm worker who clocks in to a job is asked for permission to read the phone's location once, at that moment.

## 3. Cookies and storage on your device

The website uses only the cookies it needs to work. It does not use analytics or advertising cookies, and it loads no third-party tracking scripts.

- **Session cookies.** A short-lived sign-in cookie, a refresh cookie that keeps you signed in for up to 30 days, and a cookie that remembers which organisation's store your session belongs to. Scripts on the page cannot read them.
- **Step cookies.** While you sign in, check out or sign up an organisation, a cookie carries what you typed between steps: 15 minutes for sign-in and organisation sign-up, 30 minutes for checkout. They are cleared when the step finishes or you sign out.
- **Language cookie.** Remembers the language you chose, for up to one year.
- **Drafts.** Some forms keep an unsent draft in your browser's own storage on your phone, so you do not lose your typing. It is deleted when you sign out or when another person signs in on the same browser.
- **Offline copies.** When you are not signed in, the browser may keep copies of public pages, such as a store's home page or a listing, so they open without a connection. Pages for a signed-in person are never kept.

## 4. Why we use your data

- To create and secure your account and sign you in.
- To show stores and listings, take your order, pass it to the organisation, collect payment where the store takes it online, hold it and release or refund it.
- To arrange and record delivery, where the organisation records deliveries on the platform.
- To send you notices about your orders and account. Promotional notices are sent only if you have opted in.
- To handle cancellations, disputes, refunds and complaints.
- To verify identity where a role needs it, and to prevent fraud and abuse, including moderation of listings and messages.
- To keep the records the law requires, such as invoices and payment records.
- To answer questions you put to the farm assistant, where it is offered.

We rely on your consent, which you give when you create an account and accept these policies, and on the legitimate uses the law allows, such as meeting legal obligations.

## 5. Who receives your data

### The organisation you deal with
As described in section 1.

### Service providers
These do work for us, and receive your data only for that work:

- Amazon Web Services, which hosts the platform in India.
- Razorpay, which processes online payments and refunds, and RazorpayX, which tokenises bank accounts and sends payouts.
- An SMS provider that delivers sign-in codes and text notices (the platform can use MSG91 or Twilio).
- Expo, which delivers push notifications to the app.
- An identity-verification service, where electronic verification is used.
- An AI model provider (Anthropic) and a speech-to-text provider (Google), only when the farm assistant or voice entry is switched on and you use it.
- A monitoring service that keeps the platform's technical logs.

### Authorities
When the law requires us to share data, for example under a lawful order.

A public trace page shows a lot's journey but never a person. Your phone number is shown with part of its digits hidden on screens.

## 6. How long we keep it

We keep personal data while your account is open and for as long as we need it for the purposes above. When you delete your account:

- your profile, devices, sign-in sessions, identity documents, preferences, cart and notifications are erased;
- files you uploaded (your photo, documents, voice notes) are withdrawn so that no one can open them;
- your messages and reviews stay where they are for the other person, but their words are replaced and your name is removed; review star ratings are kept;
- your listings are withdrawn;
- orders and invoices are kept for the period tax law requires, and then removed;
- payment and ledger records, your consent records and the platform's audit log are kept, because the law requires them as proof.

The deletion page tells you how many of your invoices are kept and for how many years.

## 7. Your rights

### See and download your data
From [Download my data](/account/data) you can request one file of everything the platform holds about you, across every organisation you used: your profile, addresses (including retired copies), orders, your own messages, consents, notifications and requests. Phone numbers and emails in it are partly hidden. We notify you in the app when the file is ready. The download link works for a short time, every download is logged, and the file is removed after the date shown on the page; you can request a new one at any time.

### Correct your data
You can edit your profile from your account page and manage your addresses from [your addresses](/account/addresses). To change your phone number, use the change-phone screen in the app. For anything you cannot correct yourself, write to the grievance officer.

### Delete your account
From [Delete my account](/account/delete) you can ask for your data to be erased.

- The page first checks what is still open. A deletion cannot be requested while you have orders that have not finished, money held for your orders, or a wallet balance that you have not yet paid out to your bank.
- Once you confirm, there is a cooling-off period of 90 days. The date is set when you confirm.
- After it, the platform erases your data automatically and records what was done, class by class.
- If something is still open at that point — an order, money in your wallet, a dispute, a loan or a payout — the erasure waits. We tell you, and it completes on its own once that is settled; we check every hour.
- What the law makes us keep is kept, as section 6 explains.

### Withdraw consent
- Promotional notices: switch them off in [Preferences](/account/preferences). This withdraws your marketing consent. A withdrawal is recorded exactly as a grant is.
- Some notices about payments cannot be switched off, because they concern your money.
- To withdraw any other consent, write to the grievance officer. Withdrawing consent does not affect what was done before, and you may no longer be able to use a feature that needs it. Accepting the Terms of Use and this policy is needed to hold an account; to withdraw it, delete your account.

### Nominate someone, and complain
You can nominate a person to exercise your rights if you die or become unable to, by writing to the grievance officer. If you are not satisfied with how we handled your request, you can complain to the grievance officer below, and then to the Data Protection Board of India.

## 8. How we protect your data

- Each organisation's data is separated in the database itself by row-level security.
- The audit log can be added to by the application but never changed or deleted by it.
- Platform administrators must sign in with a hardware security key in production.
- Sign-in codes and delivery codes are never stored in readable form.
- Phone numbers are partly hidden on screens and in your data download.

If a personal data breach affects you, we will inform you and the Data Protection Board as the law requires.

## 9. Children

The platform is meant for adults. If you believe a child has created an account, contact the grievance officer and we will act on it.

## 10. Changes to this policy

When we change this policy we publish the new version here. The version you accepted is recorded against your account.

## 11. Grievance officer

- Name: {{platform.grievance.officer_name}}
- Address: {{platform.grievance.address}}
- Email: {{platform.grievance.email}}
- Acknowledgement time, in hours: {{platform.grievance.ack_hours}}
- Resolution time, in days: {{platform.grievance.resolve_days}}

To report a security problem, write to {{platform.contact.security_email}}. For anything else, see the [contact page](/contact).$legal_privacy$,
       1, 'draft', 'en'
 WHERE NOT EXISTS (SELECT 1 FROM cms_pages WHERE tenant_id IS NULL AND slug = 'privacy');

INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code)
SELECT NULL, 'refunds', 'policy', $legal_title$Refunds and Cancellations Policy$legal_title$,
       $legal_refunds$This policy explains when an order can be cancelled, how a problem with an order is raised and decided, and how money comes back to you. It describes how the platform actually works. Some parts depend on choices each organisation makes for its own store; where that is so, this page says so, and each order's own page tells you what applies to that order.

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

The same details are on the [Trust and your data page](/trust-data#grievances). For general questions, see [Help](/help) or the [contact page](/contact).$legal_refunds$,
       1, 'draft', 'en'
 WHERE NOT EXISTS (SELECT 1 FROM cms_pages WHERE tenant_id IS NULL AND slug = 'refunds');

INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code)
SELECT NULL, 'shipping', 'policy', $legal_title$Shipping and Delivery Policy$legal_title$,
       $legal_shipping$This policy explains who delivers your order, where and for what charge, and what you can see about a delivery on the platform. Each organisation runs its own deliveries, so several details are set by the organisation whose store you buy from. The checkout and your order's page always show what applies to your order.

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

See also [Help](/help), the [contact page](/contact) and the [Trust and your data page](/trust-data#grievances).$legal_shipping$,
       1, 'draft', 'en'
 WHERE NOT EXISTS (SELECT 1 FROM cms_pages WHERE tenant_id IS NULL AND slug = 'shipping');
