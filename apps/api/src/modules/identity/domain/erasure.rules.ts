// modules/identity/domain/erasure.rules.ts · PC-56 DPDP-1 — the rules of a DPDP erasure, pure (no I/O). The work itself is ONE
// SECURITY DEFINER wall (migration 0245 `kv_dsr_erasure_execute`); this file is what the handler decides with and what the
// integration spec holds the database to:
//   • BLOCKERS — the counts `kv_dsr_erasure_figures` returns, mapped to the reason codes the person is told. Every figure is a
//     blocker when non-zero; an UNKNOWN figure that is non-zero still blocks (`unknown:<key>`) — fail closed, never erase past a
//     check this code does not understand. Money is never touched: a non-zero balance BLOCKS, it is never zeroed.
//   • THE MATRIX — every data class the executor acts on, with what it does (deleted / anonymised / kept by law / kept as a dated
//     record) and why. The README's table is this list in prose; the integration spec asserts the executor wrote exactly these.
//   • REFERENCE-ONLY TABLES — every other table that points at `users(id)`: they hold the opaque id (an actor column, a party to a
//     record) and nothing personal, and an id is not personal data once its `users` row is a tombstone. The coverage gate fails
//     when a table referencing users is in neither list — a new table must be decided, not forgotten.

/** The fixed tombstone a person's own words / free text become (a chat line, a review, a dispute statement, an address line). */
export const ERASED_TOMBSTONE = '[erased]';
/** The phone an erased person's tombstone row carries: deterministic, unique, not reversible, not a number anyone can sign in with. */
export const erasedPhoneOf = (userId: string): string => `erased:${userId}`;

/** The blocker figures `kv_dsr_erasure_figures` returns (counts). The order here is the order the reasons are listed in. */
export const ERASURE_BLOCKERS = [
  'open_orders', 'wallet_balance', 'open_disputes', 'active_loans', 'pending_payouts',
  'listings_under_auction', 'sole_partner_admin', 'authority_membership',
] as const;
export type ErasureBlocker = (typeof ERASURE_BLOCKERS)[number];
export type ErasureReason = ErasureBlocker | `unknown:${string}`;

const isCount = (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?\d+$/.test(v));
const nonZero = (v: unknown): boolean => {
  if (!isCount(v)) return true;                     // an unreadable figure is a blocker — fail closed
  return BigInt(String(v)) !== 0n;
};

/** The reasons an erasure cannot run, from the database's figures. Empty = clear to erase. Unknown keys that are non-zero still
 *  block; a figures object that is missing or not an object blocks as `unknown:figures`. */
export function erasureBlockers(figures: unknown): ErasureReason[] {
  if (!figures || typeof figures !== 'object' || Array.isArray(figures)) return ['unknown:figures'];
  const f = figures as Record<string, unknown>;
  const out: ErasureReason[] = [];
  for (const k of ERASURE_BLOCKERS) if (k in f && nonZero(f[k])) out.push(k);
  for (const k of ERASURE_BLOCKERS) if (!(k in f)) out.push(`unknown:${k}`);           // a check the database did not answer
  for (const k of Object.keys(f).sort()) {
    if ((ERASURE_BLOCKERS as readonly string[]).includes(k)) continue;
    if (nonZero(f[k])) out.push(`unknown:${k}`);
  }
  return out;
}

/** What the handler does with a claimed request. Pure, so the decision table is unit-tested. */
export type ErasureDecision = 'skip' | 'not_due' | 'block' | 'erase';
export function decideErasure(input: { status: string | null; coolingEndsAt: Date | null; figures: unknown; now: Date }): { decision: ErasureDecision; reasons: ErasureReason[] } {
  if (input.status !== 'in_progress' && input.status !== 'blocked') return { decision: 'skip', reasons: [] };   // completed / rejected / open / gone
  if (!input.coolingEndsAt || input.coolingEndsAt.getTime() > input.now.getTime()) return { decision: 'not_due', reasons: [] };
  const reasons = erasureBlockers(input.figures);
  return reasons.length > 0 ? { decision: 'block', reasons } : { decision: 'erase', reasons: [] };
}

/** `dsr_erasure_actions.action` (0107) for each class. `blocked_by_law` = kept because a statute requires it; `archived` = kept as a
 *  dated business record until its retention rule removes it (it holds only ids and amounts once the person is a tombstone). */
export type ErasureAction = 'deleted' | 'anonymised' | 'archived' | 'blocked_by_law';
export interface ErasureClass { action: ErasureAction; what: string }

/** THE MATRIX — the classes `kv_dsr_erasure_execute` writes evidence for, keyed by table. Keep in step with migration 0245. */
export const ERASURE_MATRIX: Readonly<Record<string, ErasureClass>> = Object.freeze({
  // ── sessions & sign-in: every live token stops working ──
  tenant_session_revocations: { action: 'anonymised', what: 'a per-tenant cut-off is WRITTEN for every organisation the person used; access tokens issued before it are refused' },
  sessions:                  { action: 'deleted',    what: 'refresh tokens (no refresh can mint a new access token)' },
  devices:                   { action: 'deleted',    what: 'device fingerprints, models, push tokens' },
  push_devices:              { action: 'deleted',    what: 'push tokens' },
  login_events:              { action: 'deleted',    what: 'sign-in log (phone, IP, device fingerprint)' },
  fido2_credentials:         { action: 'deleted',    what: 'security keys' },
  user_totp:                 { action: 'anonymised', what: '2FA disabled (rows are never deleted — SW-c guard)' },
  user_recovery_codes:       { action: 'anonymised', what: 'unused recovery codes retired' },
  idempotency_keys:          { action: 'deleted',    what: 'cached API responses that can echo personal data' },
  // ── roles ──
  user_tenant_roles:         { action: 'anonymised', what: 'every role deactivated + revoked, role_data cleared' },
  partner_memberships:       { action: 'anonymised', what: 'removed (reason dsr_erasure)' },
  desk_members:              { action: 'anonymised', what: 'removed from every desk' },
  user_memberships:          { action: 'anonymised', what: 'membership tiers cancelled' },
  // ── the person ──
  users:                     { action: 'anonymised', what: 'TOMBSTONE: phone → erased:<id>, name/email/DOB/gender/photo/Aadhaar+PAN refs cleared, status soft_deleted' },
  addresses:                 { action: 'anonymised', what: 'line1 → tombstone; line2, village, pincode, lat/lng, contact name/phone, note cleared; retired (orders point at them)' },
  user_phone_changes:        { action: 'anonymised', what: 'old/new phone → sentinel' },
  kyc_documents:             { action: 'anonymised', what: 'document number, issuer, provider payload, reject reason cleared; retired; the scan is in the media purge' },
  ekyc_sessions:             { action: 'deleted',    what: 'eKYC attempts (masked id, last4, provider ref)' },
  business_kyc_profiles:     { action: 'anonymised', what: 'legal name → tombstone; GSTIN/PAN masks and document media cleared; retired' },
  bank_accounts:             { action: 'anonymised', what: 'vault token destroyed on our side, UPI/last4/IFSC/holder cleared, retired (payouts point at them)' },
  // ── only about the person ──
  notification_preferences:  { action: 'deleted',    what: 'channel preferences' },
  user_quiet_hours:          { action: 'deleted',    what: 'quiet hours' },
  weather_prefs:             { action: 'deleted',    what: 'weather preferences' },
  saved_searches:            { action: 'deleted',    what: 'saved searches' },
  saved_items:               { action: 'deleted',    what: 'saved items' },
  price_alert_triggers:      { action: 'deleted',    what: 'price alert history' },
  price_alerts:              { action: 'deleted',    what: 'price alerts' },
  auction_watchers:          { action: 'deleted',    what: 'auctions watched' },
  user_blocks:               { action: 'deleted',    what: 'people the person blocked' },
  cart_items:                { action: 'deleted',    what: 'cart lines' },
  carts:                     { action: 'deleted',    what: 'carts' },
  notifications:             { action: 'deleted',    what: 'every notification sent to the person (content included)' },
  risk_scores:               { action: 'deleted',    what: 'risk profile' },
  credit_scores:             { action: 'deleted',    what: 'credit scores not relied on by a loan application' },
  risk_events:               { action: 'anonymised', what: 'event metadata cleared (code + weight kept for fraud aggregates)' },
  // ── words the person wrote ──
  messages:                  { action: 'anonymised', what: 'chat bodies → tombstone, voice/attachments detached (files in the media purge)' },
  dispute_messages:          { action: 'anonymised', what: 'dispute statements → tombstone' },
  disputes:                  { action: 'anonymised', what: 'description of disputes they raised → tombstone (closed disputes only — an open one blocks)' },
  reviews:                   { action: 'anonymised', what: 'text → tombstone, tags cleared, stars + sub-ratings KEPT; their seller replies → tombstone' },
  support_csat_responses:    { action: 'anonymised', what: 'free-text comment cleared (score kept)' },
  support_tickets:           { action: 'anonymised', what: 'subject cleared' },
  moderation_reports:        { action: 'anonymised', what: 'free-text details of reports they filed cleared' },
  // ── listings & media ──
  listings:                  { action: 'anonymised', what: 'archived; description, location, AI metadata cleared; title → tombstone + photos purged unless the listing is part of an order' },
  media_links:               { action: 'deleted',    what: 'links from listings to purged photos' },
  media_assets:              { action: 'anonymised', what: 'photo, KYC scans, voice notes, chat attachments, listing photos: soft-deleted; STORAGE DELETION PENDING (no purge path yet)' },
  vet_bookings:              { action: 'anonymised', what: 'symptom text and voice note cleared' },
  tenant_export_jobs:        { action: 'anonymised', what: 'their own DPDP export jobs retired' },
  data_export_jobs:          { action: 'anonymised', what: 'their own DPDP export jobs retired' },
  // ── role profiles ──
  worker_profiles:           { action: 'anonymised', what: 'emergency contact, e-Shram number cleared; undiscoverable; retired' },
  sardar_profiles:           { action: 'anonymised', what: 'compliance note cleared; retired' },
  vet_profiles:              { action: 'anonymised', what: 'registration number → tombstone; retired' },
  drone_pilots:              { action: 'anonymised', what: 'RPL number → tombstone; retired' },
  ambassador_profiles:       { action: 'anonymised', what: 'deactivated; retired' },
  instructors:               { action: 'anonymised', what: 'bio, display name, verification note cleared; retired' },
  ambassador_visits:         { action: 'anonymised', what: 'visit notes and location about the person cleared' },
  land_parcels:              { action: 'anonymised', what: 'survey number, land-record ref, boundary cleared; retired' },
  animals:                   { action: 'anonymised', what: 'Pashu Aadhaar tag and animal name cleared' },
  mgnrega_job_cards:         { action: 'anonymised', what: 'job card number → tombstone; retired' },
  scheme_applications:       { action: 'anonymised', what: 'never-submitted drafts: form data cleared (a submitted application is the authority\'s record, kept)' },
  // ── records the law keeps, personal data removed ──
  payments:                  { action: 'anonymised', what: 'gateway webhook body (can carry phone/email/VPA) cleared; amounts, status, references kept' },
  staff_invites:             { action: 'anonymised', what: 'phone on used invites → sentinel' },
  partner_invites:           { action: 'anonymised', what: 'phone on used invites → sentinel' },
  setup_call_requests:       { action: 'anonymised', what: 'masked phone tail + free-text notes cleared' },
  cold_chain_breaches:       { action: 'archived',   what: 'buyer\'s free-text decision reason cleared; the breach record is kept' },
  // ── kept unchanged ──
  consents:                  { action: 'blocked_by_law', what: 'consent LOG kept (proof of lawful processing); holds only the id, purpose and version' },
  ledger_entries:            { action: 'blocked_by_law', what: 'never edited (Law 2); ids and amounts only — zero-sum unchanged' },
  ledger_transactions:       { action: 'blocked_by_law', what: 'never edited (Law 2)' },
  wallet_accounts:           { action: 'blocked_by_law', what: 'kept at zero balance (a non-zero balance blocks the erasure)' },
  audit_log:                 { action: 'blocked_by_law', what: 'append-only trail kept; actor is now an opaque id' },
  orders:                    { action: 'archived',   what: 'tax records kept unchanged (ids, amounts; delivery address row anonymised)' },
  trade_invoices:            { action: 'archived',   what: 'GST documents kept unchanged (GSTINs are business identifiers)' },
  payouts:                   { action: 'archived',   what: 'kept unchanged (point at the retired bank account)' },
  settlement_statements:     { action: 'archived',   what: 'kept unchanged' },
  cold_chain_logs:           { action: 'archived',   what: 'readings name a shipment/device, never a person' },
  webhook_deliveries:        { action: 'archived',   what: 'organisation webhook log, ids only; removed by its 90-day retention sweep' },
});

/** Every other table that references `users(id)` (by FK or a named user column). Each holds the opaque id only — an actor column
 *  (`*_by`), a party to a business record, a membership row — and is KEPT unchanged: once the users row is a tombstone the id says
 *  nothing about a person. The integration coverage gate fails when a users-referencing table is in neither list. */
export const ERASURE_REFERENCE_ONLY: readonly string[] = Object.freeze([
  'account_freeze_orders', 'aeps_service_events', 'agm_packs', 'ai_inferences', 'ai_review_queue', 'ambassador_earnings', 'ambassador_payout_run_lines',
  'ambassador_payout_runs', 'animal_health_events', 'animal_ownership_transfers', 'announcement_changes', 'api_key_proposals', 'api_keys', 'appeals',
  'attendance_records', 'auction_consents', 'auction_settlements', 'auctions', 'audit_read_log', 'authority_memberships', 'banners', 'bids',
  'billing_adjustments', 'bmc_units', 'bnpl_limits', 'breach_notification_steps', 'bulk_import_jobs', 'carbon_enrolments', 'catalogue_changes',
  'cell_map_changes', 'certificates', 'charge_change_proposals', 'checkout_groups', 'cms_pages', 'cod_cash_day_carries', 'cod_cash_days',
  'cod_collections', 'cod_remittances', 'cod_shortfalls', 'cold_chain_device_silences', 'cold_chain_thresholds', 'commission_rule_proposals',
  'consent_purpose_versions', 'contract_growers', 'conversation_participants', 'coop_payout_runs', 'coop_resolutions', 'coop_share_registers',
  'coop_votes', 'correction_draft_legs', 'coupon_redemption_attempts', 'coupon_redemptions', 'course_lesson_subtitles', 'course_lessons',
  'course_royalty_rules', 'courses', 'credit_notes', 'credit_score_consents', 'd2c_subscriptions', 'dairy_bill_cycles', 'dairy_deduction_instructions',
  'dairy_member_credits', 'dairy_membership_routes', 'dairy_memberships', 'dairy_shift_diversions', 'data_breaches', 'data_subject_requests',
  'dbt_bounces', 'dbt_transfers', 'delivery_routes', 'delivery_zone_proposals', 'desk_change_proposals', 'desks', 'device_keys', 'dispute_eligibility',
  'enrollments', 'equipment_assets', 'equipment_bookings', 'esg_disclosures', 'export_shipments', 'exporter_registrations', 'farming_contracts',
  'feature_flag_changes', 'field_verifications', 'finance_group_members', 'freight_invoice_lines', 'group_ledger_entries', 'group_lot_consents',
  'group_lot_pledges', 'group_lot_settlement_lines', 'group_lot_settlements', 'group_lots', 'impersonation_actions', 'impersonation_grants',
  'instructor_agreements', 'instructor_credentials', 'instructor_royalty_lines', 'insurance_claims', 'insurance_policies', 'integration_proposals',
  'kyc_claims', 'kyc_document_decisions', 'ledger_chain_verifications', 'labour_bookings', 'labour_consents', 'labour_escrows', 'labour_grievances', 'labour_wage_payouts',
  'labour_wage_runs', 'learning_channels', 'learning_resources', 'listing_boosts', 'listing_moderation_orders', 'listing_offers',
  'listing_price_history', 'listing_trust_documents', 'live_session_registrations', 'live_sessions', 'loan_applications', 'loan_disbursement_run_items',
  'loan_disbursement_runs', 'loan_restructures', 'loans', 'logistics_partners', 'mandi_prices', 'masked_calls', 'mcc_centres',
  'mcc_operator_assignments', 'mgnrega_musters', 'mgnrega_work_demands', 'milk_bill_deduction_consents', 'milk_bill_deductions', 'milk_bill_disputes',
  'milk_bills', 'milk_collections', 'milk_quality_reviews', 'milk_rate_cards', 'moderation_action_notices', 'notification_template_versions',
  'nwr_receipts', 'ops_alert_rule_changes', 'ops_fired_alerts', 'order_events', 'parcel_handover_fees', 'parcel_handovers', 'partner_api_keys',
  'payout_batches', 'pickup_slot_proposals', 'pickup_slots', 'plan_changes', 'platform_blocklists', 'platform_config_changes',
  'platform_operator_bootstrap_uses', 'platform_operator_credentials', 'platform_operator_identities', 'platform_operator_login_tickets', 'platform_operator_restrictions', 'platform_operator_sessions', 'platform_operators', 'platform_ops_notices',
  'platform_operator_webauthn_challenges', 'platform_step_up_events', 'pod_reviews', 'product_batches', 'promotions', 'provider_changes', 'quiz_answers', 'recon_investigations',
  'referrals', 'refund_approvals', 'report_runs', 'report_schedules', 'requirement_consents', 'requirement_group_lines',
  'requirement_response_groups', 'requirement_responses', 'requirements', 'residency_violations', 'returns', 'review_eligibility', 'rider_payout_terms',
  'risk_rules', 'route_drop_points', 'route_runs', 'saas_invoice_dunning_attempts', 'saas_invoice_payments', 'safety_case_steps', 'safety_checklists',
  'saved_report_definitions', 'scheme_application_documents', 'scheme_application_events', 'scheme_eligibility_sweep_rows',
  'scheme_eligibility_sweeps', 'scheme_registry_changes', 'scheme_versions', 'schemes', 'service_bookings', 'service_offerings', 'settlement_cycles',
  'settlement_holds', 'settlement_lines', 'share_register_import_rows', 'share_register_imports', 'shipments', 'staff_conflict_declarations',
  'staff_override_proposals', 'staff_permission_overrides', 'storage_bookings', 'subscription_plan_changes', 'subscription_plans_d2c',
  'support_coaching_records', 'support_macro_uses', 'support_platform_replies', 'tenant_applications', 'tenant_branding', 'tenant_branding_history',
  'tenant_branding_proposals', 'tenant_broadcast_recipients', 'tenant_broadcasts', 'tenant_domain_proposals', 'tenant_domains',
  'tenant_export_downloads', 'tenant_integrations', 'tenant_member_suspensions', 'tenant_onboarding_drafts', 'tenant_setting_history',
  'tenant_setting_proposals', 'tenant_status_events', 'tenants', 'trace_lots', 'translation_reviewers', 'translation_runs', 'translations',
  'twin_access_requests', 'twin_assumption_history', 'twin_assumptions', 'twin_devices', 'twin_runs', 'twin_scenarios', 'upi_mandate_executions',
  'upi_mandates', 'warehouses', 'wastage_events', 'watch_events', 'webhook_endpoints', 'worker_advances',
]);

/** The completion summary the executor returns (and stores on the request). Parsed defensively — it is evidence, never trusted blindly. */
export interface ErasureSummary { classes: Record<string, { action: string; rows: number }>; mediaPendingStoragePurge: number; unmappedRetentionClasses: string[] }
export function parseErasureSummary(v: unknown): ErasureSummary | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!o.classes || typeof o.classes !== 'object') return null;
  const classes: ErasureSummary['classes'] = {};
  for (const [k, x] of Object.entries(o.classes as Record<string, unknown>)) {
    const e = x as { action?: unknown; rows?: unknown };
    if (typeof e?.action !== 'string' || !isCount(e.rows)) return null;
    classes[k] = { action: e.action, rows: Number(e.rows) };
  }
  return {
    classes,
    mediaPendingStoragePurge: isCount(o.mediaPendingStoragePurge) ? Number(o.mediaPendingStoragePurge) : 0,
    unmappedRetentionClasses: Array.isArray(o.unmappedRetentionClasses) ? o.unmappedRetentionClasses.filter((s): s is string => typeof s === 'string') : [],
  };
}
