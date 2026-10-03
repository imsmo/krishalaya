// modules/tenancy/domain/setting-governance.ts · PC-56 TENANT-13b · F-4 / F-15 / F-16 — WHICH TENANT SETTINGS ONE PERSON MAY WRITE,
// THE PLATFORM FLOOR, AND WHEN A CONFIRMED CHANGE TAKES EFFECT. Pure: no I/O, no clock of its own.
//
// THE FINDING (survey F-4): the only tenant write path checked scope and type, never `risk_class`, so one tenant_admin could raise
// `disputes.refund_checker_threshold_minor` to 2^53 and approve every refund alone, or set `governance.quorum_bp` to 0 — and the
// audit said which key changed but not to what. Founder decision 2026-10-03:
//   • a TRUST-AFFECTING key (risk_class money_path | security, or `member_notice` — canon W186 "auto-confirm, approval") is written
//     only by a PROPOSAL that a DIFFERENT tenant_admin confirms; it takes effect at the next 00:00 Asia/Kolkata and every member is
//     told (`tenant.setting_effective`);
//   • a proposal outside the PLATFORM FLOOR (`tenant_min` / `tenant_max`, 0192) is refused by name — a tenant may tighten, never
//     loosen past the platform;
//   • an ORDINARY key writes directly, with before/after (and an optional reason) in the audit and in `tenant_setting_history`.
//
// The database repeats every rule here (0192: `trg_tsp_moves`, `tsp_floor_problem`, `trg_tenant_settings_gate`). This file is what
// the service checks FIRST, so a refusal is a named 4xx with the field to blame instead of a constraint violation.
import { SettingDefinition } from './tenant-settings.entity';

/** 0192 `reason` CHECK: 20–500 characters, trimmed. */
export const PROPOSAL_REASON_MIN = 20;
export const PROPOSAL_REASON_MAX = 500;
/** 0192 `expires_at = proposed_at + 7 days`. */
export const PROPOSAL_TTL_MS = 7 * 24 * 3600_000;
/** The canon's clock: Asia/Kolkata is UTC+05:30 all year (no DST). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** A key whose change touches member money or trust. */
export function isTrustAffecting(def: Pick<SettingDefinition, 'riskClass' | 'memberNotice'>): boolean {
  return def.riskClass === 'money_path' || def.riskClass === 'security' || def.memberNotice === true;
}

/**
 * The first 00:00 Asia/Kolkata STRICTLY after `at` — 0192's `next_midnight_ist()` in TypeScript (a test pins the two to agree).
 * Confirmed at 23:59:59 IST → effective one second later; confirmed at exactly 00:00 IST → effective the NEXT midnight (never "now").
 */
export function nextMidnightIst(at: Date): Date {
  const ist = at.getTime() + IST_OFFSET_MS;
  const dayStartIst = Math.floor(ist / 86_400_000) * 86_400_000;
  return new Date(dayStartIst + 86_400_000 - IST_OFFSET_MS);
}

export type ReasonProblem = 'required' | 'too_short' | 'too_long';
export function proposalReasonProblem(reason: string | null | undefined): ReasonProblem | null {
  const s = (reason ?? '').trim();
  if (s.length === 0) return 'required';
  if (s.length < PROPOSAL_REASON_MIN) return 'too_short';
  if (s.length > PROPOSAL_REASON_MAX) return 'too_long';
  return null;
}

export type FloorProblem =
  | { code: 'below_floor'; floor: number }
  | { code: 'above_ceiling'; ceiling: number }
  | { code: 'only_value'; only: string }
  | { code: 'number_required' };

/**
 * The platform floor, judged — 0192's `tsp_floor_problem()` in TypeScript. Number keys: [tenant_min, tenant_max] (either side may be
 * open). A string key whose min = max is LOCKED to that one value (e.g. `settlements.cycle_length` = fortnightly: monthly makes every
 * seller wait twice as long). No floor → null.
 */
export function floorProblem(def: Pick<SettingDefinition, 'tenantMin' | 'tenantMax'>, value: unknown): FloorProblem | null {
  const min = def.tenantMin; const max = def.tenantMax;
  if (typeof min === 'string' || typeof max === 'string') {
    if (min !== null && min !== undefined && min === max && value !== min) return { code: 'only_value', only: String(min) };
    return null;
  }
  if (min == null && max == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return { code: 'number_required' };
  if (typeof min === 'number' && value < min) return { code: 'below_floor', floor: min };
  if (typeof max === 'number' && value > max) return { code: 'above_ceiling', ceiling: max };
  return null;
}

/** True when the floor admits exactly one value (min = max) — the key is effectively platform-locked, and the console says so. */
export function isFloorLocked(def: Pick<SettingDefinition, 'tenantMin' | 'tenantMax'>): boolean {
  return def.tenantMin !== null && def.tenantMin !== undefined && def.tenantMin === def.tenantMax;
}

/** Two JSON values are the same setting value (jsonb equality for the scalars and small objects a setting holds). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * How a value is printed in a member notice. Numbers are formatted per the key's unit; enum strings and booleans are named from
 * ui_messages (`setting.value.<v>`, seed core/0024) by the caller — this returns either a plain text or the ui_messages key to look up.
 */
export function noticeValue(key: string, value: unknown): { text: string } | { messageKey: string } {
  if (typeof value === 'boolean') return { messageKey: `setting.value.${value}` };
  if (typeof value === 'string') return { messageKey: `setting.value.${value}` };
  if (typeof value === 'number') {
    if (key.endsWith('_bp')) return { text: `${trimZeros(value / 100)}%` };
    if (key.endsWith('_pct')) return { text: `${value}%` };
    if (key.endsWith('_minor')) return { text: `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` };
    return { text: String(value) };
  }
  return { text: JSON.stringify(value) };
}
function trimZeros(n: number): string { return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }

/** `2026-10-04 00:00` — the instant in Asia/Kolkata, the format the notice variables declare (seed 0007). */
export function istStamp(at: Date): string {
  const d = new Date(at.getTime() + IST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
