// apps/web-partner/src/features/partner1/refusals.ts · PC-56 PARTNER-1a / 1b · founder D7 (survey E1) — WHAT THE PARTNER CONSOLE DOES NOT CLAIM, BY NAME.
// PURE. The shape of the storefront's features/sweep/refusals.ts. Each refused canon claim is listed ONCE with where the canon makes it and
// the surfaces that PRINT it (a refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its
// page — or the refused copy coming back into a catalogue (test/partner1-claims-guard.spec.ts) — turns a test red. The sentences word the
// refused claims generically: the literal canon phrases (a pager, a phone line, a hardware-key name, a comparison) appear in NO value.
//
// THE SURFACE TYPE `Partner1Surface`: 1a's `dashboard` · `dashboard_chain` (W2926–W2928) · `settings` · `settings_form` (W3002–W3005) ·
// `help` · `help_ticket` (W2937–W2940) · `help_retry` (W2941–W2943); 1b's `keys` (W267) · `keys_form` (W2907–W2910) · `webhooks` (W268) ·
// `hooks_form` (W3017–W3020) · `hooks_act` (W3021–W3023) · `status` (W266) · `onboarding` (W265) · `onboarding_chain` (W2970–W2976).
// A 1b refusal carries `wave: '1b'`: the claims guard holds its English to the 1b word list (no penny, no IFSC, no sandbox, no status page …).
export type Partner1Surface =
  | 'dashboard' | 'dashboard_chain' | 'settings' | 'settings_form' | 'help' | 'help_ticket' | 'help_retry'
  | 'onboarding' | 'onboarding_chain' | 'status' | 'keys' | 'keys_form' | 'webhooks' | 'hooks_form' | 'hooks_act';
export interface Partner1Refusal { id: string; canon: string; surfaces: readonly Partner1Surface[]; key: string; why: string; wave?: '1b' }

export const PARTNER1_REFUSALS: readonly Partner1Refusal[] = Object.freeze([
  // ── W205 (the dashboard) ──
  { id: 'repay_better', canon: 'W205 "platform loans repay better — deductions ride milk bills & harvests"', surfaces: ['dashboard'],
    key: 'partner1.refusal.repayBetter', why: 'founder D1: no comparative measure exists; the on-time share is the partner\'s own book only' },
  { id: 'sla_clock', canon: 'W205 "4 breach SLA in < 24h" · "66h of 72h SLA · 6h left"', surfaces: ['dashboard'],
    key: 'partner1.refusal.slaClock', why: 'founder D1: no per-application clock — only "decided within the promise" counted over 30 days where a promise exists' },
  { id: 'docs_overnight', canon: 'W205 "3 crop loans docs complete overnight → moved docs_pending → under_review automatically"', surfaces: ['dashboard'],
    key: 'partner1.refusal.docsOvernight', why: 'no docs_pending status in the state machine (loan-application.state.ts); no automatic move' },
  { id: 'disbursement_batch', canon: 'W205 "Disbursement batch of 8 approved loans ready — ₹9,20,000"', surfaces: ['dashboard'],
    key: 'partner1.refusal.disbursementBatch', why: 'PARTNER-0 D3: a partner never disburses (PARTNER_CANNOT_DISBURSE); the batch view is PARTNER-4\'s' },
  { id: 'applicant_name', canon: 'W205 "LA-2026-0710-08 KCC ₹3,00,000 · Ramesh P."', surfaces: ['dashboard'],
    key: 'partner1.refusal.applicantName', why: 'PARTNER-0 D2: no applicant name in any partner read; no LA-number exists (uuids)' },
  { id: 'verified_income', canon: 'W205 "Scores built on verified platform income (settlement statements), not guesses"', surfaces: ['dashboard'],
    key: 'partner1.refusal.verifiedIncome', why: 'credit_scores has no reader in apps/api (survey F-5)' },
  { id: 'reputation', canon: 'W205 "a member repays their cooperative\'s reputation, not an anonymous app"', surfaces: ['dashboard'],
    key: 'partner1.refusal.reputation', why: 'unprovable copy' },
  { id: 'plan_settings', canon: 'W205 / W269 / W272 / W267 / W268 flagged-off state "See plan settings"', surfaces: ['dashboard', 'settings', 'help', 'keys', 'webhooks'],
    key: 'partner1.refusal.planSettings', why: 'a partner organisation has no plan; partner_console is the platform\'s switch' },
  // ── W2926–W2928 (dashboard Retry — PARITY-DECOR) and the shared chain-template sentences ──
  { id: 'chain_audit', canon: 'W2926 "confirming writes an audit-trail entry" · W2927 "the audit trail has the entry" · "View audit trail"', surfaces: ['dashboard_chain', 'help_retry', 'hooks_act', 'onboarding_chain'],
    key: 'partner1.refusal.chainAudit', why: 'a re-read writes nothing; the dashboard read itself is logged as a read' },
  { id: 'chain_zero_sum', canon: 'W2927 / W2939 / W2942 / W3004 / W2909 / W3019 / W3022 / W2972 / W2975 "Money-adjacent actions reconcile zero-sum before this page ever shows"',
    surfaces: ['dashboard_chain', 'help_retry', 'help_ticket', 'settings_form', 'keys_form', 'hooks_form', 'hooks_act', 'onboarding_chain'],
    key: 'partner1.refusal.chainZeroSum', why: 'nothing on these pages moves money' },
  { id: 'chain_on_call', canon: 'W2928 / W2940 / W2943 / W3005 / W2910 / W3020 / W3023 / W2973 / W2976 "repeated failures page the on-call"',
    surfaces: ['dashboard_chain', 'help_retry', 'help_ticket', 'settings_form', 'keys_form', 'hooks_form', 'hooks_act', 'onboarding_chain'],
    key: 'partner1.refusal.chainOnCall', why: 'no paging from a partner page exists in code' },
  // ── W269 (organisation settings) + W3002–W3005 (Save changes — DECOR) ──
  { id: 'save_changes', canon: 'W269 "Save changes" → W3002–W3005', surfaces: ['settings', 'settings_form'],
    key: 'partner1.settings.saveRefused', why: 'founder D5: nothing on the page is writable by a partner (identity fixed, SLA by contract, team by its own chain)' },
  { id: 'live_since', canon: 'W269 "live since Nov 2025"', surfaces: ['settings'], key: 'partner1.refusal.liveSince', why: 'no go-live record exists' },
  { id: 'settlement_account', canon: 'W269 "Settlement account XXXXXX8829 · penny-drop ✓ · change = re-verification, maker–checker"', surfaces: ['settings'],
    key: 'partner1.refusal.settlementAccount', why: 'no partner bank account exists (survey F-4; GAP-BE B4/B5) — PARTNER-1b\'s onboarding refusal' },
  { id: 'disbursal_promise', canon: 'W269 SLA row "Disbursal after approval + consent 24h"', surfaces: ['settings'],
    key: 'partner1.refusal.disbursalPromise', why: 'founder D2: disbursal is the FPO\'s act' },
  { id: 'first_response', canon: 'W269 SLA row "First response to farmer query 4h"', surfaces: ['settings'],
    key: 'partner1.refusal.firstResponse', why: 'founder D2: no source records a first response' },
  { id: 'farmer_shown', canon: 'W269 "The SLA you publish here is the promise a farmer is shown next to your products"', surfaces: ['settings'],
    key: 'partner1.refusal.farmerShown', why: 'founder D5: no farmer surface reads financial_partners.sla' },
  { id: 'dormancy', canon: 'W269 "Dormant >90 days auto-suspends"', surfaces: ['settings'], key: 'partner1.refusal.dormancy', why: 'no suspension job for partner people' },
  { id: 'hardware_key', canon: 'W269 "Admin actions require FIDO2" · team "FIDO2 key ✓"', surfaces: ['settings'],
    key: 'partner1.refusal.hardwareKey', why: 'founder D5: TOTP is the partner realm\'s second factor; hardware keys are the admin realm\'s only' },
  { id: 'maker_checker', canon: 'W269 "Maker and checker can never be the same person on a decision — enforced by the platform"', surfaces: ['settings'],
    key: 'partner1.refusal.makerChecker', why: '0225 uq_pm_user_partner_role is UNIQUE (user_id, partner_id, role_id): one person MAY hold maker and checker' },
  { id: 'last_changed', canon: 'W269 view-only state "Every field shows who last changed it"', surfaces: ['settings'], key: 'partner1.refusal.lastChanged', why: 'no field history exists' },
  { id: 'consent_documents', canon: 'W269 "farmer identity documents open only inside an active consent (AA-consent gated), never export"', surfaces: ['settings'],
    key: 'partner1.refusal.consentDocuments', why: 'no document is read by the partner realm at all' },
  { id: 'member_email', canon: 'W269 team "a.joshi@…"', surfaces: ['settings'], key: 'partner1.refusal.memberEmail', why: 'founder D5: no email column; partner people sign in by phone' },
  { id: 'last_active', canon: 'W269 team "Last active"', surfaces: ['settings'], key: 'partner1.refusal.lastActive', why: 'founder D5: no last-active record for a partner person' },
  // ── W272 (help) + W2937–W2940 (Raise a ticket — DECOR) + W2941–W2943 (Retry — PARITY-DECOR) ──
  { id: 'help_search', canon: 'W272 "Search help articles"', surfaces: ['help'], key: 'partner1.refusal.helpSearch', why: 'no help index (store B4 carried)' },
  { id: 'article_index', canon: 'W272 the article list with "updated …", "read 8 min", "answered 187 searches", "31 questions"', surfaces: ['help'],
    key: 'partner1.refusal.articleIndex', why: 'no platform article store; one static article from the rail\'s constants' },
  { id: 'versioned', canon: 'W272 "Articles are versioned (cms_pages)"', surfaces: ['help'], key: 'partner1.refusal.versioned', why: 'no platform cms writer (store B4)' },
  { id: 'tickets', canon: 'W272 "Raise a ticket · Categories technical · payment · kyc · dispute" · "Your tickets" table', surfaces: ['help', 'help_ticket'],
    key: 'partner1.refusal.tickets', why: 'founder D4 / B10 queued: support tickets are tenant-scoped; a partner ticket would land in an FPO\'s desk' },
  { id: 'severity_sla', canon: 'W272 "First-response SLA by severity"', surfaces: ['help', 'help_ticket'], key: 'partner1.refusal.severitySla', why: 'no hours are platform facts' },
  { id: 'pager', canon: 'W272 the round-the-clock pager with a call-back promise', surfaces: ['help'], key: 'partner1.refusal.pager', why: 'no pager exists (SWEEP F-2 precedent)' },
  { id: 'phone_line', canon: 'W272 the partners phone line and its hours', surfaces: ['help'], key: 'partner1.refusal.phone', why: 'no phone fact is published; "business hours IST" was unprovable (F-8)' },
  { id: 'one_thread', canon: 'W272 "One thread per issue regardless of channel"', surfaces: ['help'], key: 'partner1.refusal.oneThread', why: 'one channel exists: the mailbox fact' },
  { id: 'csat', canon: 'W272 "Rate 1–5" · CSAT column', surfaces: ['help'], key: 'partner1.refusal.csat', why: 'no partner CSAT' },
  { id: 'code_samples', canon: 'W272 "code samples in 4 languages · signature-fail handling"', surfaces: ['help'], key: 'partner1.refusal.codeSamples', why: 'the article states the contract from the rail\'s constants; no samples are maintained' },
  { id: 'ticket_desk', canon: 'W2937–W2940 the ticket form chain', surfaces: ['help_ticket'], key: 'partner1.help.ticketRefused', why: 'founder D4: "write to the partners mailbox"' },

  // ════════════════ PC-56 PARTNER-1b ════════════════
  // ── W267 (API credentials) + W2907–W2910 (Create key — DECOR) ──
  { id: 'keys_self_service', canon: 'W267 "Self-service keys — create, scope, rotate and revoke without waiting for anyone" · "Create key"', surfaces: ['keys', 'keys_form'], wave: '1b',
    key: 'partner1.refusal.keysSelfService', why: 'founder D1: mint, re-scope, quota and replacement stay with the platform\'s partner operations (0090: kv_app holds no INSERT); revoke is the one console write' },
  { id: 'keys_overlap', canon: 'W267 "Lost it? Rotate: the new key overlaps the old for 24 hours"', surfaces: ['keys'], wave: '1b',
    key: 'partner1.refusal.keysOverlap', why: 'PC55 A10 §5.2: no rotation window for keys (the 24 h overlap is a WEBHOOK secret\'s); a revoked key fails at once' },
  { id: 'keys_usage', canon: 'W267 "Calls this month 41,208 · Error rate 0.4% · Throttle events 2"', surfaces: ['keys'], wave: '1b',
    key: 'partner1.refusal.keysUsage', why: 'B8: the guard keeps counters only (partner_api.authenticated / denied); no persisted per-key usage' },
  { id: 'keys_write_scopes', canon: 'W267 scopes "loans.read loans.decide disbursements.write"', surfaces: ['keys'], wave: '1b',
    key: 'partner1.refusal.keysWriteScopes', why: 'partner-key.rules.ts PARTNER_SCOPES: three READ scopes, no wildcard, no write capability' },
  { id: 'keys_creator', canon: 'W267 "created 12 Mar 2026 by <a person>"', surfaces: ['keys'], wave: '1b',
    key: 'partner1.refusal.keysCreator', why: 'the mint script records no creator; never a person\'s name (SWEEP W316 precedent)' },
  { id: 'keys_ask_person', canon: 'W267 admin-role state "Ask <a person>, or request the role — the request is logged"', surfaces: ['keys'], wave: '1b',
    key: 'partner1.refusal.keysAskPerson', why: 'no role request exists; never a person\'s name' },
  { id: 'keys_health_page', canon: 'W267 error state "check the status page"', surfaces: ['keys', 'webhooks'], wave: '1b',
    key: 'partner1.refusal.healthPage', why: 'SWEEP Q7 refused a public health page' },
  { id: 'keys_test_world', canon: 'W267 empty state "Sandbox keys are free to make and safe to lose"', surfaces: ['keys', 'status'], wave: '1b',
    key: 'partner1.refusal.testWorld', why: 'a key\'s test / live is a label in its prefix (mint-partner-key.js), not a separate data world' },
  // ── W268 (webhooks) + W3017–W3020 (Add endpoint — DECOR) + W3021–W3023 (Activate / Rotate secret / Send test ping / Replay — DECOR) ──
  { id: 'hooks_not_hash', canon: 'W268 "secret whsec_•••• (hash-only, rotate any time)"', surfaces: ['webhooks'], wave: '1b',
    key: 'partner1.refusal.hooksNotHash', why: '0090 / 0191: the signing secret is AES-256-GCM ciphertext — reversible by necessity (the sender reproduces the HMAC)' },
  { id: 'hooks_app_events', canon: 'W268 subscribed events "loan.application.submitted consent.granted …"', surfaces: ['webhooks'], wave: '1b',
    key: 'partner1.refusal.hooksAppEvents', why: 'founder D2 / Q5: the 0090 allow-list only — an application is not the partner\'s book before consent is modelled' },
  { id: 'hooks_self_serve', canon: 'W268 "Add endpoint" · "Activate" · "Rotate secret" (W3017–W3022)', surfaces: ['webhooks', 'hooks_form', 'hooks_act'], wave: '1b',
    key: 'partner1.refusal.hooksSelfServe', why: '0090:178: kv_app holds no INSERT / UPDATE on partner_webhook_endpoints; B7 writes stay queued' },
  { id: 'hooks_replay', canon: 'W268 "Replay" / "Replay now" ×5 (FM classes them `filter`)', surfaces: ['webhooks', 'hooks_act'], wave: '1b',
    key: 'partner1.refusal.hooksReplay', why: 'founder D2: a replay is run by the platform\'s partner operations on request' },
  { id: 'hooks_ping', canon: 'W268 "Send test ping"', surfaces: ['webhooks', 'hooks_act'], wave: '1b',
    key: 'partner1.refusal.hooksPing', why: 'not built; recorded as the cheapest future REAL act (one signed partner.ping on the rail, no config write)' },
  { id: 'hooks_verified', canon: 'W268 "verified Mon 06 Jul"', surfaces: ['webhooks'], wave: '1b',
    key: 'partner1.refusal.hooksVerified', why: 'partner_webhook_endpoints has no verified_at' },
  { id: 'hooks_totals', canon: 'W268 "Showing 1–5 of 12,408 deliveries · Page 1 of 497"', surfaces: ['webhooks'], wave: '1b',
    key: 'partner1.refusal.hooksTotals', why: 'the list is a keyset by time; no total is counted' },
  { id: 'hooks_admin_only', canon: 'W268 "Admin role needed — Endpoints and secrets are partner-admin only"', surfaces: ['webhooks'], wave: '1b',
    key: 'partner1.refusal.hooksAdminOnly', why: 'founder D2 / 0227: every member reads endpoints and deliveries; nobody reads a secret' },
  // ── W266 (onboarding status) ──
  { id: 'status_application', canon: 'W266 "application PRT-2026-0119 · submitted …" · "You\'re three checks from going live"', surfaces: ['status'], wave: '1b',
    key: 'partner1.refusal.statusApplication', why: 'B4: no partner application or onboarding record exists' },
  { id: 'status_checklist', canon: 'W266 go-live checklist (guide, test loan, webhook ping, UAT sign-off)', surfaces: ['status'], wave: '1b',
    key: 'partner1.refusal.statusChecklist', why: 'founder D3: nothing is stored or ticked; the facts are read from what exists' },
  { id: 'status_agreement', canon: 'W266 "Partnership agreement — platform countersign pending · Your e-sign landed"', surfaces: ['status'], wave: '1b',
    key: 'partner1.refusal.statusAgreement', why: 'no electronic signature or counter-signature exists on the platform' },
  { id: 'status_desk', canon: 'W266 "held by: partnerships desk · SLA 2 working days · escalates without you asking"', surfaces: ['status'], wave: '1b',
    key: 'partner1.refusal.statusDesk', why: 'no partnerships desk, no response clock, no escalation (store 1c partnerships_desk refusal)' },
  { id: 'status_key_by_mail', canon: 'W266 "Test key kv_test_… emailed to your signatory"', surfaces: ['status'], wave: '1b',
    key: 'partner1.refusal.statusKeyByMail', why: 'a secret is never sent by mail (F-5); keys are printed once by a human-run script' },
  { id: 'status_drafts', canon: 'W266 "products stay in draft — nothing half-verified ever reaches a farmer\'s screen"', surfaces: ['status'], wave: '1b',
    key: 'partner1.refusal.statusDrafts', why: 'loan_products are reference data the platform authors, not partner drafts' },
  { id: 'regulator_register', canon: 'W266 "Regulator licence verified" · W265 "Verified against the co-op bank register"', surfaces: ['status', 'onboarding'], wave: '1b',
    key: 'partner1.refusal.regulatorRegister', why: 'no regulator register lookup exists (grep → none)' },
  // ── W265 (settlement account) + W2970–W2976 (DECOR) ──
  { id: 'onb_steps', canon: 'W265 stepper "1 Organisation & licence ✓ · 2 Authorised signatory ✓ · 3 Settlement account …" · "Save & exit"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbSteps', why: 'B4: no onboarding form or step state exists' },
  { id: 'onb_account_fields', canon: 'W265 "Account number · IFSC" · "Add account number & IFSC" (W2970–W2973)', surfaces: ['onboarding', 'onboarding_chain'], wave: '1b',
    key: 'partner1.refusal.onbAccountFields', why: 'founder Q2 / D3: no settlement account is collected in Phase 1' },
  { id: 'onb_branch', canon: 'W265 "Branch resolved: <a branch>"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbBranch', why: 'no branch lookup exists' },
  { id: 'onb_stored', canon: 'W265 "full number captured on entry and stored encrypted"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbStored', why: 'no number is taken, so none is stored' },
  { id: 'onb_test_credit', canon: 'W265 the one-rupee test credit, its narration code and "the ₹1 stays yours" · "Verify & continue" (W2974–W2976)', surfaces: ['onboarding', 'onboarding_chain', 'status'], wave: '1b',
    key: 'partner1.refusal.onbTestCredit', why: 'BankAccount.markVerified() has no caller; no account-check provider is connected (B5)' },
  { id: 'onb_live_check', canon: 'W265 "Not arrived after 2 hours? … we retry once, then verify by video call"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbLiveCheck', why: 'no retry, no live verification call' },
  { id: 'onb_paper', canon: 'W265 flagged-off state "signed cancelled cheque"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbPaper', why: 'no paper path exists' },
  { id: 'onb_signatory', canon: 'W265 "Authorised signatory <a person> DIN-linked KYC ✓ · phone …"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbSignatory', why: 'no signatory model; a person\'s name and phone are never fixtures' },
  { id: 'onb_locked', canon: 'W265 state "Step locked — signatory not confirmed"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbLocked', why: 'no step machine' },
  { id: 'onb_by_kind', canon: 'W265 flagged-off state "digital … disabled for this partner class"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbByKind', why: 'no per-kind rule exists' },
  { id: 'onb_money_path', canon: 'W265 "Account that will receive repayments & send disbursals"', surfaces: ['onboarding'], wave: '1b',
    key: 'partner1.refusal.onbMoneyPath', why: 'fintech/README.md:13-15: the FPO is the lender of record and lends from its own wallet; the bank rail is deferred' },
]);

/** The canon shapes 1a builds differently — recorded DELTAs, not refusals. */
export const PARTNER1_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'dashboard_route', canon: 'W205 at `lender/dashboard`', built: '`/dashboard` (the built route, kept)' },
  { id: 'help_route', canon: 'W272 at `account/help`', built: '`/help` (the built route, kept); the nav lists it under "Account"' },
  { id: 'settings_route', canon: 'W269 at `account/settings`', built: '`/account/settings` (the canon\'s own path)' },
  { id: 'chain_routes', canon: 'the chain pages W2926–W2928, W2937–W2943, W3002–W3008 as separate files', built: 'query states of their parent page: `/dashboard?retry=…`, `/help?ticket=…` / `?retry=…`, `/account/settings?form=…`; the invite chain is a client-side step machine on `/account/settings` (the code never enters a URL)' },
  { id: 'chain_retry_defect', canon: 'W3005 / W2940 "Retry — back to confirm" on a FORM chain (a form chain has no confirm)', built: 'the DECOR failure page links back to its page' },
  { id: 'fm_numbering', canon: 'FLOWMAP chain targets W1320… / W1462… (survey C-11)', built: 'mapped by module + pattern to W2926–W2943 / W3002–W3008' },
  { id: 'fm_filter_class', canon: 'FLOWMAP rows mis-classing the team rows, "Rate 1–5" and the avatar as `filter`', built: 'recorded; the team rows are a table with their own acts (revoke, remove)' },
  { id: 'insurer_persona', canon: 'W272 drawn for an insurer partner (its sidebar)', built: 'one help page for every partner kind' },
  { id: 'lender_sidebar', canon: 'the canon lender sidebar (Disbursements, Repayments, SLA & reports, API & webhooks)', built: 'built routes only: Account = Settings · API keys · Webhooks · Readiness · Help; the rest arrive with their waves' },
  // ── PC-56 PARTNER-1b ──
  { id: 'keys_route', canon: 'W267 at `account/api`', built: '`/account/api` (the canon\'s own path)' },
  { id: 'webhooks_route', canon: 'W268 at `account/webhooks`', built: '`/account/webhooks` (the canon\'s own path); a delivery\'s detail is `?delivery=<id>` on the same page' },
  { id: 'status_route', canon: 'W266 at `onboarding/status`', built: '`/onboarding/status` (the canon\'s own path), in the Account nav group as "Readiness", reached from settings' },
  { id: 'settlement_route', canon: 'W265 at `onboarding/step-3`', built: '`/onboarding/settlement` — there are no steps; linked from the readiness page only' },
  { id: 'revoke_chain', canon: 'W2911–W2913 as separate files', built: 'the REAL revoke chain is a query state of `/account/api`: `?act=revoke&id=` (confirm, the Idempotency-Key minted at render, the reason typed there) → `&state=success` / `&state=failure&code=`; the reason never enters a URL' },
  { id: 'fm_filter_replay', canon: 'FLOWMAP W268 rows classing "Replay" / "Replay now" ×5 as `filter` (F-17)', built: 'they are acts: each leads to the DECOR act chain (W3021–W3023)' },
  { id: 'chain_retry_defect_1b', canon: 'W2910 / W3020 "Retry — back to confirm" on a FORM chain (F-18)', built: 'the DECOR failure page links back to its page' },
  { id: 'onboarding_back_defect', canon: 'W2971–W2973, W2975, W2976 point "Back" at W253-partner-claim-detail (F-18)', built: 'every onboarding chain page links back to `/onboarding/settlement`' },
  { id: 'bilingual_subline', canon: 'W265 the Hindi sub-line under the title (Q8)', built: 'the whole page is in the reader\'s language (en / hi / gu), not a second line' },
]);

/** Every canon file of PARTNER-1 (45) with its verdict — 1a's 20 and 1b's 25 (PARTNER-1b flipped every `pending_1b`; none is left). */
export type Partner1Verdict = 'BUILT' | 'BUILT (honest)' | 'BUILT (REAL)' | 'PARITY-DECOR' | 'DECOR';
export const PARTNER1_CANON_FILES: readonly { file: string; wave: '1a' | '1b'; verdict: Partner1Verdict; note: string }[] = Object.freeze([
  { file: 'W205-partner-dashboard.html', wave: '1a', verdict: 'BUILT', note: '/dashboard rebuilt over GET /v1/partner/dashboard: the six server-computed figures with as-of, the SLA promise beside the actual latency, the FPOs by public name, "needs you today"; empty / error / switched-off / scope states' },
  { file: 'W269-partner-settings.html', wave: '1a', verdict: 'BUILT', note: '/account/settings: identity (masked regulator ref, code, kind fixed), the published decision promise + actuals, the team (name, role, authenticator, joined — no mail address), invites, revoke / remove with reasons; Save changes DECOR' },
  { file: 'W272-partner-help.html', wave: '1a', verdict: 'BUILT', note: '/help rebuilt: the partners mailbox from the platform facts or "not published yet", the webhook-signature article from the rail\'s constants; desk, search, phone and pager refused' },
  { file: 'W2926-partner-dashboard-mutate-confirm.html', wave: '1a', verdict: 'PARITY-DECOR', note: '/dashboard?retry=confirm — Retry is a re-read; nothing to confirm' },
  { file: 'W2927-partner-dashboard-mutate-success.html', wave: '1a', verdict: 'PARITY-DECOR', note: '/dashboard?retry=success — no action to complete; audit / zero-sum refused' },
  { file: 'W2928-partner-dashboard-mutate-failure.html', wave: '1a', verdict: 'PARITY-DECOR', note: '/dashboard?retry=failure — nothing changed; paging refused' },
  { file: 'W2937-partner-help-form-form-error.html', wave: '1a', verdict: 'DECOR', note: '/help?ticket=error — no ticket form: write to the partners mailbox' },
  { file: 'W2938-partner-help-form-review.html', wave: '1a', verdict: 'DECOR', note: '/help?ticket=review — no ticket to review' },
  { file: 'W2939-partner-help-form-success.html', wave: '1a', verdict: 'DECOR', note: '/help?ticket=success — no ticket created' },
  { file: 'W2940-partner-help-form-failure.html', wave: '1a', verdict: 'DECOR', note: '/help?ticket=failure — nothing changed; the "Retry → confirm" defect is a DELTA' },
  { file: 'W2941-partner-help-mutate-confirm.html', wave: '1a', verdict: 'PARITY-DECOR', note: '/help?retry=confirm — a reload' },
  { file: 'W2942-partner-help-mutate-success.html', wave: '1a', verdict: 'PARITY-DECOR', note: '/help?retry=success — read again' },
  { file: 'W2943-partner-help-mutate-failure.html', wave: '1a', verdict: 'PARITY-DECOR', note: '/help?retry=failure — nothing changed' },
  { file: 'W3002-partner-settings-form-form-error.html', wave: '1a', verdict: 'DECOR', note: '/account/settings?form=error — nothing to correct' },
  { file: 'W3003-partner-settings-form-review.html', wave: '1a', verdict: 'DECOR', note: '/account/settings?form=review — nothing to review' },
  { file: 'W3004-partner-settings-form-success.html', wave: '1a', verdict: 'DECOR', note: '/account/settings?form=success — nothing saved' },
  { file: 'W3005-partner-settings-form-failure.html', wave: '1a', verdict: 'DECOR', note: '/account/settings?form=failure — nothing changed; the "Retry → confirm" defect is a DELTA' },
  { file: 'W3006-partner-settings-mutate-confirm.html', wave: '1a', verdict: 'BUILT (REAL)', note: 'invite confirm: the masked phone and the role, the Idempotency-Key minted at render (hidden field)' },
  { file: 'W3007-partner-settings-mutate-success.html', wave: '1a', verdict: 'BUILT (REAL)', note: 'invite success: the code shown ONCE ("send it yourself; we never email a secret"), its expiry; a replay shows no code' },
  { file: 'W3008-partner-settings-mutate-failure.html', wave: '1a', verdict: 'BUILT (REAL)', note: 'invite failure: the named code (already a member, a pending invite, the rate limit, a bad phone, not an administrator); no seat limit for partners' },
  // ── PARTNER-1b ──
  { file: 'W265-partner-onboarding.html', wave: '1b', verdict: 'BUILT (honest)', note: '/onboarding/settlement: no settlement account is collected in Phase 1 — the FPO is the lender of record and lends from its own wallet; the partner kind from /me; every account, branch, test-credit, signatory and step claim refused by name' },
  { file: 'W266-partner-onboarding-status.html', wave: '1b', verdict: 'BUILT', note: '/onboarding/status over GET /v1/partner/readiness: six facts from what exists (organisation active, an administrator with a second factor, keys, an endpoint, a delivery in 90 days, the promise) with computedAt; what is still with partner operations beside the mailbox fact' },
  { file: 'W267-partner-api-credentials.html', wave: '1b', verdict: 'BUILT', note: '/account/api over GET /v1/partner/keys: name, prefix, scopes, hourly quota, last used, status (revoked with the reason) — never a hash; "shown once, only a hash kept" TRUE; create DECOR' },
  { file: 'W268-partner-webhooks.html', wave: '1b', verdict: 'BUILT', note: '/account/webhooks over GET /v1/partner/webhooks(+/deliveries): the partner\'s endpoints (no secret), the rail\'s contract from the constants, the 0090 events, deliveries newest first with attempts (no payload, no tenant); writes DECOR' },
  { file: 'W2907-partner-api-form-form-error.html', wave: '1b', verdict: 'DECOR', note: '/account/api?form=error — no key form: keys are issued by the platform\'s partner operations' },
  { file: 'W2908-partner-api-form-review.html', wave: '1b', verdict: 'DECOR', note: '/account/api?form=review — no new key to review' },
  { file: 'W2909-partner-api-form-success.html', wave: '1b', verdict: 'DECOR', note: '/account/api?form=success — no key was created here' },
  { file: 'W2910-partner-api-form-failure.html', wave: '1b', verdict: 'DECOR', note: '/account/api?form=failure — nothing changed; the "Retry → confirm" defect is a DELTA' },
  { file: 'W2911-partner-api-mutate-confirm.html', wave: '1b', verdict: 'BUILT (REAL)', note: '/account/api?act=revoke&id= — "every call with it fails at once", the reason (20–300) typed here, the Idempotency-Key minted at render (hidden field)' },
  { file: 'W2912-partner-api-mutate-success.html', wave: '1b', verdict: 'BUILT (REAL)', note: '&state=success — revoked at <time>, the prefix; the audit row holds the reason' },
  { file: 'W2913-partner-api-mutate-failure.html', wave: '1b', verdict: 'BUILT (REAL)', note: '&state=failure&code= — the named refusal (not found / already revoked / reason / role); nothing changed' },
  { file: 'W2970-partner-onboarding-form-form-error.html', wave: '1b', verdict: 'DECOR', note: '/onboarding/settlement?form=error — no account form' },
  { file: 'W2971-partner-onboarding-form-review.html', wave: '1b', verdict: 'DECOR', note: '/onboarding/settlement?form=review — nothing to review (the canon\'s Back → W253 defect is a DELTA)' },
  { file: 'W2972-partner-onboarding-form-success.html', wave: '1b', verdict: 'DECOR', note: '/onboarding/settlement?form=success — nothing was verified' },
  { file: 'W2973-partner-onboarding-form-failure.html', wave: '1b', verdict: 'DECOR', note: '/onboarding/settlement?form=failure — nothing changed' },
  { file: 'W2974-partner-onboarding-mutate-confirm.html', wave: '1b', verdict: 'DECOR', note: '/onboarding/settlement?act=confirm — no account check to confirm' },
  { file: 'W2975-partner-onboarding-mutate-success.html', wave: '1b', verdict: 'DECOR', note: '/onboarding/settlement?act=success — nothing was checked' },
  { file: 'W2976-partner-onboarding-mutate-failure.html', wave: '1b', verdict: 'DECOR', note: '/onboarding/settlement?act=failure — nothing changed' },
  { file: 'W3017-partner-webhooks-form-form-error.html', wave: '1b', verdict: 'DECOR', note: '/account/webhooks?form=error — no endpoint form: endpoints are registered by the platform\'s partner operations' },
  { file: 'W3018-partner-webhooks-form-review.html', wave: '1b', verdict: 'DECOR', note: '/account/webhooks?form=review — no endpoint to review' },
  { file: 'W3019-partner-webhooks-form-success.html', wave: '1b', verdict: 'DECOR', note: '/account/webhooks?form=success — no endpoint was added here' },
  { file: 'W3020-partner-webhooks-form-failure.html', wave: '1b', verdict: 'DECOR', note: '/account/webhooks?form=failure — nothing changed; the "Retry → confirm" defect is a DELTA' },
  { file: 'W3021-partner-webhooks-mutate-confirm.html', wave: '1b', verdict: 'DECOR', note: '/account/webhooks?act=confirm — activate / new secret / test ping / replay are run by partner operations on request' },
  { file: 'W3022-partner-webhooks-mutate-success.html', wave: '1b', verdict: 'DECOR', note: '/account/webhooks?act=success — nothing was run from here' },
  { file: 'W3023-partner-webhooks-mutate-failure.html', wave: '1b', verdict: 'DECOR', note: '/account/webhooks?act=failure — nothing changed' },
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner1RefusalKeys(surface: Partner1Surface): string[] {
  return PARTNER1_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type ChainId = 'dashboard_retry' | 'settings_form' | 'help_ticket' | 'help_retry' | 'keys_form' | 'hooks_form' | 'hooks_act' | 'onboarding_form' | 'onboarding_act';
export interface ChainDef { id: ChainId; param: string; page: string; surface: Partner1Surface; states: readonly string[]; key: (state: string) => string; files: readonly string[] }
const HELP_RETRY_KEY: Readonly<Record<string, string>> = Object.freeze({ confirm: 'confirm', success: 'reloaded', failure: 'unchanged' });
export const PARTNER1_CHAINS: readonly ChainDef[] = Object.freeze([
  { id: 'dashboard_retry', param: 'retry', page: '/dashboard', surface: 'dashboard_chain', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner1.chain.dashboard.${s}`, files: ['W2926', 'W2927', 'W2928'] },
  { id: 'settings_form', param: 'form', page: '/account/settings', surface: 'settings_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner1.chain.settings.${s}`, files: ['W3002', 'W3003', 'W3004', 'W3005'] },
  { id: 'help_ticket', param: 'ticket', page: '/help', surface: 'help_ticket', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner1.chain.help.${s}`, files: ['W2937', 'W2938', 'W2939', 'W2940'] },
  { id: 'help_retry', param: 'retry', page: '/help', surface: 'help_retry', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner1.chain.help.${HELP_RETRY_KEY[s] ?? s}`, files: ['W2941', 'W2942', 'W2943'] },
  // ── PC-56 PARTNER-1b: the DECOR chains (the REAL revoke W2911–W2913 is `?act=revoke` on /account/api — features/partner1/keys.ts) ──
  { id: 'keys_form', param: 'form', page: '/account/api', surface: 'keys_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner1.chain.keys.${s}`, files: ['W2907', 'W2908', 'W2909', 'W2910'] },
  { id: 'hooks_form', param: 'form', page: '/account/webhooks', surface: 'hooks_form', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner1.chain.hooksForm.${s}`, files: ['W3017', 'W3018', 'W3019', 'W3020'] },
  { id: 'hooks_act', param: 'act', page: '/account/webhooks', surface: 'hooks_act', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner1.chain.hooksAct.${s}`, files: ['W3021', 'W3022', 'W3023'] },
  { id: 'onboarding_form', param: 'form', page: '/onboarding/settlement', surface: 'onboarding_chain', states: ['error', 'review', 'success', 'failure'],
    key: (s: string) => `partner1.chain.onboardingForm.${s}`, files: ['W2970', 'W2971', 'W2972', 'W2973'] },
  { id: 'onboarding_act', param: 'act', page: '/onboarding/settlement', surface: 'onboarding_chain', states: ['confirm', 'success', 'failure'],
    key: (s: string) => `partner1.chain.onboardingAct.${s}`, files: ['W2974', 'W2975', 'W2976'] },
]);
export function chainById(id: ChainId): ChainDef { return PARTNER1_CHAINS.find((c) => c.id === id) as ChainDef; }
/** The chain state a page was opened in (`?retry=confirm` …), or null for the page itself / an unknown state. */
export function chainState(id: ChainId, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chainById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
