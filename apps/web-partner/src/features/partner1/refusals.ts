// apps/web-partner/src/features/partner1/refusals.ts · PC-56 PARTNER-1a · founder D7 (survey E1) — WHAT THE PARTNER CONSOLE DOES NOT CLAIM, BY NAME.
// PURE. The shape of the storefront's features/sweep/refusals.ts. Each refused canon claim is listed ONCE with where the canon makes it and
// the surfaces that PRINT it (a refusal sentence — never an offer); the render tests read this map, so a refusal that disappears from its
// page — or the refused copy coming back into a catalogue (test/partner1-claims-guard.spec.ts) — turns a test red. The sentences word the
// refused claims generically: the literal canon phrases (a pager, a phone line, a hardware-key name, a comparison) appear in NO value.
//
// THE SURFACE TYPE `Partner1Surface`: 1a's `dashboard` · `dashboard_chain` (W2926–W2928) · `settings` · `settings_form` (W3002–W3005) ·
// `help` · `help_ticket` (W2937–W2940) · `help_retry` (W2941–W2943); 1b's `onboarding` · `status` · `keys` · `webhooks` (refusals added there).
export type Partner1Surface =
  | 'dashboard' | 'dashboard_chain' | 'settings' | 'settings_form' | 'help' | 'help_ticket' | 'help_retry'
  | 'onboarding' | 'status' | 'keys' | 'webhooks';
export interface Partner1Refusal { id: string; canon: string; surfaces: readonly Partner1Surface[]; key: string; why: string }

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
  { id: 'plan_settings', canon: 'W205 / W269 / W272 flagged-off state "See plan settings"', surfaces: ['dashboard', 'settings', 'help'],
    key: 'partner1.refusal.planSettings', why: 'a partner organisation has no plan; partner_console is the platform\'s switch' },
  // ── W2926–W2928 (dashboard Retry — PARITY-DECOR) and the shared chain-template sentences ──
  { id: 'chain_audit', canon: 'W2926 "confirming writes an audit-trail entry" · W2927 "the audit trail has the entry" · "View audit trail"', surfaces: ['dashboard_chain', 'help_retry'],
    key: 'partner1.refusal.chainAudit', why: 'a re-read writes nothing; the dashboard read itself is logged as a read' },
  { id: 'chain_zero_sum', canon: 'W2927 / W2939 / W2942 / W3004 "Money-adjacent actions reconcile zero-sum before this page ever shows"', surfaces: ['dashboard_chain', 'help_retry', 'help_ticket', 'settings_form'],
    key: 'partner1.refusal.chainZeroSum', why: 'nothing on these pages moves money' },
  { id: 'chain_on_call', canon: 'W2928 / W2940 / W2943 / W3005 "repeated failures page the on-call"', surfaces: ['dashboard_chain', 'help_retry', 'help_ticket', 'settings_form'],
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
  { id: 'lender_sidebar', canon: 'the canon lender sidebar (Disbursements, Repayments, SLA & reports, API & webhooks)', built: 'built routes only: Account = Settings + Help; the rest arrive with their waves' },
]);

/** Every canon file of PARTNER-1 (45): 1a's 20 with their verdicts, 1b's 25 `pending_1b` until PARTNER-1b flips them. */
export type Partner1Verdict = 'BUILT' | 'BUILT (REAL)' | 'PARITY-DECOR' | 'DECOR' | 'pending_1b';
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
  // ── PARTNER-1b (pending) ──
  ...['W265-partner-onboarding.html', 'W266-partner-onboarding-status.html', 'W267-partner-api-credentials.html', 'W268-partner-webhooks.html',
    'W2907-partner-api-form-form-error.html', 'W2908-partner-api-form-review.html', 'W2909-partner-api-form-success.html', 'W2910-partner-api-form-failure.html',
    'W2911-partner-api-mutate-confirm.html', 'W2912-partner-api-mutate-success.html', 'W2913-partner-api-mutate-failure.html',
    'W2970-partner-onboarding-form-form-error.html', 'W2971-partner-onboarding-form-review.html', 'W2972-partner-onboarding-form-success.html', 'W2973-partner-onboarding-form-failure.html',
    'W2974-partner-onboarding-mutate-confirm.html', 'W2975-partner-onboarding-mutate-success.html', 'W2976-partner-onboarding-mutate-failure.html',
    'W3017-partner-webhooks-form-form-error.html', 'W3018-partner-webhooks-form-review.html', 'W3019-partner-webhooks-form-success.html', 'W3020-partner-webhooks-form-failure.html',
    'W3021-partner-webhooks-mutate-confirm.html', 'W3022-partner-webhooks-mutate-success.html', 'W3023-partner-webhooks-mutate-failure.html',
  ].map((file) => ({ file, wave: '1b' as const, verdict: 'pending_1b' as const, note: 'PARTNER-1b' })),
]);

/** The refusal i18n keys printed on one surface (render tests read this). */
export function partner1RefusalKeys(surface: Partner1Surface): string[] {
  return PARTNER1_REFUSALS.filter((r) => r.surfaces.includes(surface)).map((r) => r.key);
}

// ── THE DECOR / PARITY-DECOR CHAINS: each is a query state of its parent page ──
export type ChainId = 'dashboard_retry' | 'settings_form' | 'help_ticket' | 'help_retry';
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
]);
export function chainById(id: ChainId): ChainDef { return PARTNER1_CHAINS.find((c) => c.id === id) as ChainDef; }
/** The chain state a page was opened in (`?retry=confirm` …), or null for the page itself / an unknown state. */
export function chainState(id: ChainId, searchParams: Record<string, string | string[] | undefined> | undefined): string | null {
  const c = chainById(id);
  const raw = searchParams?.[c.param];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && c.states.includes(v) ? v : null;
}
