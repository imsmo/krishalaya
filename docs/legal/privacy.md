> **DRAFT — must be reviewed by a qualified lawyer before publishing.**

## Reviewer notes (not published)
- Data fiduciary role: apps/api identity/controllers/v1/privacy.controller.ts says "the platform is the data controller" for data-subject rights, and DSRs are person-level (no tenant). Each organisation also processes its buyers' and members' data inside its store, under the platform's row-level security. Whether organisations are separate data fiduciaries, joint fiduciaries or processors under the DPDP Act 2023 is a legal question. The body says both the platform and the organisation you deal with use your data, and that requests go to the platform. Lawyer to settle.
- No Data Protection Officer / consent manager is named in code. The DPDP "significant data fiduciary" status is unknown. The body uses only the grievance officer tokens.
- Service providers named are those the code integrates (apps/api core/config/env.validation.ts, apps/ai-services common/config.py, infra/README.md). Which are ACTIVE in production depends on configuration the code cannot show: SMS_PROVIDER (noop | msg91 | twilio), PUSH_PROVIDER (expo), EKYC_PROVIDER_KIND (sandbox | digilocker), BANK_VAULT_KIND (razorpayx in production), ANTHROPIC_API_KEY and GOOGLE_STT_KEY (optional; the AI assistant is behind the `ai_assistant` flag, OFF by default), MASKING_PROVIDER_URL (number masking, not used by the storefront), NOTIFY_GATEWAY_URL (external notifier, unnamed). Datadog appears in infra/README.md as the observability stack. The founder must confirm the active list and whether any of them processes data outside India (Twilio, Expo, Anthropic, Google, Datadog are likely to). DPDP s.16 cross-border transfer wording needs a lawyer.
- Hosting: AWS ap-south-1 (Mumbai) primary, ap-south-2 (Hyderabad) disaster recovery, per infra/README.md and AWS_REGION default. Written in the body as "in India"; confirm this is the production setup.
- Card / UPI details: payment is taken in the payment provider's sheet; the platform stores payment records (amount, status, provider references). That the platform never receives full card numbers is inferred from the Razorpay checkout-sheet flow, not proven line by line. Confirm.
- Encryption at rest/in transit is refused as a public claim (features/sweep/refusals.ts `encryption`: "an infrastructure fact the code cannot show"). The body does NOT claim encryption. Likewise "we do not sell personal data" is refused (`sell_data`: "a commitment for the company to make in writing"). If the company wants to commit to no-sale, the founder must decide and add it.
- Retention: the body names categories, not periods. The seeded retention policy (db/migrations/0107_dsr_erasure_evidence.sql, configurable in the admin compliance console) says: users, devices, KYC documents deleted; notification delivery records deleted after 6 months; listings, reviews and media anonymised; orders and invoices archived (24 months active, 72 months archive, citing CGST Act s.36); ledger entries and transactions, consents (120 months, keep_forever) and the audit log (84 months, keep_forever) kept. Note: the account-deletion page prints invoice retention from setting `platform.invoice_retention_years` (default 8 years, migration 0214), which DISAGREES with the 72-month figure in the retention policy. Founder/lawyer to reconcile. Note also from 0107: the anonymise and archive pipelines and the automated erasure executor are not built; erasure is done manually by the platform's data-protection desk, class by class (storefront store4a.delete.desk). The body says so.
- Erasure cooling-off: 90 days, from ERASURE_COOLING_DAYS in apps/api identity/domain/data-subject-request.entity.ts. Whether a person can cancel a deletion request during the cooling-off is NOT built as a self-serve action (no cancel endpoint). The body says to write to the grievance officer; confirm this is acceptable.
- Correction: there is a `correction` DSR type in code but no endpoint for it. Correction happens by editing the profile (account page) or changing phone in the app. Body says this plus "write to the grievance officer" for anything else.
- Nomination right (DPDP s.14) is not built in code. The body says to write to the grievance officer. Lawyer to confirm.
- Consent withdrawal: only the marketing consent has a self-serve switch (Account, Preferences: the promotional switch records or withdraws the `marketing` consent, features/store4c/preferences.ts). Other optional purposes in seed 0006 (ai_training, data_sharing, location, on_behalf_listing) can be recorded and withdrawn through the consents API but have no storefront screen. The body says to write to the grievance officer for those. Consent notice text per purpose does not exist yet (0107 note).
- Children: no age check exists in code. The DPDP verifiable parental consent requirement is not implemented. The body states the platform is not intended for children; lawyer to decide.
- Breach notification: the admin compliance-ops module has a breach-response console (DPDP s.8). The body says affected people will be informed as the law requires; this is a legal commitment, not a code mechanism. Confirm.
- What sellers see about a buyer: the order records the delivery address chosen; the exact fields an organisation sees on an order were not traced field by field. Body says "the details it needs to fulfil the order". Confirm.
- Location: the storefront collects no device location and makes no IP-based location guess (refusals `ip_guess`; sessions-notice.ts "no geolocation provider"). Addresses may carry optional coordinates (create-address.dto.ts lat/lng). Delivery status updates may carry coordinates (shipment_events lat/lng) and buyers never receive them (tracking-view.ts). The mobile app reads a one-time GPS fix, with permission, for farm worker attendance (apps/mobile core/location/gps.ts, labour clock_in). Stated as such.
- The AI assistant logs pointers only, never the message text, in ai_inferences (apps/api assistant README), but the text is sent to the model provider to answer. Stated.
- Cookie names and lifetimes come from apps/web-storefront src/lib/auth.ts (refresh cookie 30 days), login-flow.ts (15 minutes), checkout-flow.ts (30 minutes), signup-flow.ts (15 minutes), middleware.ts (language cookie, one year). No analytics or advertising script exists in the storefront (package.json has none).
- Links /account/data, /account/delete, /account/preferences and /account/addresses are used; these routes exist under apps/web-storefront/src/app/(platform)/account but are not in the generator brief's list of known links. Confirm they resolve on the platform host for a signed-in person.

<!-- BEGIN PAGE BODY -->
# Privacy Policy

This policy explains what personal data the platform holds about you, why, who else receives it, how long it is kept, and how you can exercise your rights under the Digital Personal Data Protection Act, 2023. The platform is operated by {{platform.legal.entity_name}}, registered office {{platform.legal.registered_office}} ("we", "us").

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

- your profile, devices and identity documents are erased;
- reviews, listings and images are kept without your name attached;
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
- After it, a person on the platform's data-protection desk erases your data class by class and records what was done. Nothing is erased automatically.
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

To report a security problem, write to {{platform.contact.security_email}}. For anything else, see the [contact page](/contact).
<!-- END PAGE BODY -->
