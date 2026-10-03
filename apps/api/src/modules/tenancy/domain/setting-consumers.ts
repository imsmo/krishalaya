// modules/tenancy/domain/setting-consumers.ts · PC-56 TENANT-13b · F-15 — A SETTING THE CONSOLE OFFERS MUST CHANGE SOMETHING.
//
// The survey found six tenant keys nothing reads (`grep -rln "'<key>'" apps/api/src`), and the canon's "Effect" column printing
// effects that did not exist ("All member listings pass your QC desk", "Faster escrow release"). Law 9: the settings page either
// wires a consumer or does not offer the key. So every tenant-scope key is in EXACTLY ONE of the two lists below:
//
//   WIRED   — the key, the file that reads it, and a marker string that file must contain. `tenant13b-settings-desks.spec.ts` opens
//             each file and fails if the marker is gone (a consumer deleted is a key that silently stopped doing anything).
//             Only a wired key shows an Effect and is editable.
//   UNWIRED — defined in the registry, read by nothing. Rendered in a collapsed "defined, not yet wired" list with the honest
//             sentence, never editable. Wiring them is their own module's wave (brief A4) — except `group_lot.max_extension_hours`,
//             which this wave registered AND wired (11c's extend act).
//
// The integration spec reads `setting_definitions` and fails if a tenant-scope key is in neither list or both.

export interface SettingConsumer { file: string; marker: string }

/** Paths are relative to apps/api/src. */
export const WIRED_SETTINGS: Readonly<Record<string, SettingConsumer>> = Object.freeze({
  'billing.grace_days':                     { file: 'modules/tenancy/tenancy.module.ts', marker: "'billing.grace_days'" },
  'dairy.bmc_condemn_temp_decic':           { file: 'modules/dairy/repositories/bmc-unit.repository.ts', marker: 'dairy.bmc_condemn_temp_decic' },
  'dairy.bmc_divert_temp_decic':            { file: 'modules/dairy/repositories/bmc-unit.repository.ts', marker: 'dairy.bmc_divert_temp_decic' },
  'dairy.bmc_silence_minutes':              { file: 'modules/dairy/repositories/bmc-unit.repository.ts', marker: 'dairy.bmc_silence_minutes' },
  'dairy.cycle_payday_offset_days':         { file: 'modules/dairy/repositories/dairy-bill-cycle.repository.ts', marker: 'dairy.cycle_payday_offset_days' },
  'dairy.deduction_assembly_max_pct':       { file: 'modules/dairy/repositories/dairy-deduction-instruction.repository.ts', marker: 'dairy.deduction_assembly_max_pct' },
  'dairy.deduction_consent_pct':            { file: 'modules/dairy/services/milk-bill.service.ts', marker: 'dairy.deduction_consent_pct' },
  'dairy.dispute_window_hours':             { file: 'modules/dairy/repositories/dairy-bill-cycle.repository.ts', marker: 'dairy.dispute_window_hours' },
  'disputes.refund_checker_threshold_minor': { file: 'modules/disputes/domain/refund-gate.ts', marker: "'disputes.refund_checker_threshold_minor'" },
  'education.live_reminder_offsets_mins':   { file: 'modules/education/repositories/live-session.repository.ts', marker: 'education.live_reminder_offsets_mins' },
  'finance.fiscal_year_start_month':        { file: 'modules/memberships/services/coop-payout.service.ts', marker: 'finance.fiscal_year_start_month' },
  'governance.min_membership_months':       { file: 'modules/memberships/domain/voting-eligibility.ts', marker: "'governance.min_membership_months'" },
  'governance.min_shares_to_vote':          { file: 'modules/memberships/domain/voting-eligibility.ts', marker: "'governance.min_shares_to_vote'" },
  'governance.quorum_bp':                   { file: 'modules/memberships/domain/voting-eligibility.ts', marker: "'governance.quorum_bp'" },
  'governance.special_majority_den':        { file: 'modules/memberships/domain/resolution-rules.ts', marker: "'governance.special_majority_den'" },
  'governance.special_majority_num':        { file: 'modules/memberships/domain/resolution-rules.ts', marker: "'governance.special_majority_num'" },
  'group_lot.max_extension_hours':          { file: 'modules/group-lots/services/group-lot.service.ts', marker: "'group_lot.max_extension_hours'" },
  'notification.quiet_hours_default':       { file: 'modules/communication/repositories/quiet-hours.repository.ts', marker: 'notification.quiet_hours_default' },
  'payouts.batch_checker_threshold_minor':  { file: 'modules/payments/services/payout-approval.service.ts', marker: "'payouts.batch_checker_threshold_minor'" },
  'payouts.batch_cut_off_minutes':          { file: 'modules/payments/services/payout-approval.service.ts', marker: "'payouts.batch_cut_off_minutes'" },
  'plans.usage_alert_threshold_pct':        { file: 'modules/tenancy/repositories/plan-usage.repository.ts', marker: 'plans.usage_alert_threshold_pct' },
  'settlements.cycle_length':               { file: 'modules/payments/services/settlement-cycle.service.ts', marker: "'settlements.cycle_length'" },
});

/** Why a defined key is not offered. Each code is an i18n sentence on the console (`os.unwired.<code>`). */
export type UnwiredReason = 'no_consumer' | 'branding_13d' | 'deprecated_languages';
export const UNWIRED_SETTINGS: Readonly<Record<string, UnwiredReason>> = Object.freeze({
  // F-15 — refused by name in this wave; each is its module's own wave.
  'listing.approval_required': 'no_consumer',     // 4 publish paths + the canon default (true) would reroute every listing; see the 13b report
  'order.auto_confirm_hours': 'no_consumer',      // no auto-confirm exists anywhere (grep autoConfirm|auto_confirm)
  'order.quality_window_hours': 'no_consumer',
  'review.enabled': 'no_consumer',
  'payout.min_threshold_minor': 'no_consumer',
  'delivery.free_above_minor': 'no_consumer',
  'payout.cycle': 'no_consumer',                  // the settlement cadence is settlements.cycle_length (0144); payout.cycle is read by nothing
  // Branding is TENANT-13d's (W191): the console edits these under Branding; no storefront consumer reads them yet (survey F-13).
  'branding.display_name': 'branding_13d',
  'branding.logo_url': 'branding_13d',
  'branding.primary_color': 'branding_13d',
  'branding.support_email': 'branding_13d',
  // F-14 — deprecated by 0192: the store every consumer reads is tenant_languages (PUT /tenant-settings/languages).
  'languages.enabled': 'deprecated_languages',
  'languages.default': 'deprecated_languages',
});

export function isWired(key: string): boolean { return Object.prototype.hasOwnProperty.call(WIRED_SETTINGS, key); }
export function unwiredReason(key: string): UnwiredReason | null {
  return Object.prototype.hasOwnProperty.call(UNWIRED_SETTINGS, key) ? UNWIRED_SETTINGS[key] : null;
}
