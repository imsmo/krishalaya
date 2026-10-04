// modules/tenancy/domain/onboarding.ts · PC-56 TENANT-SW-d · W114 "Onboarding: Organisation Profile" (signup step 2) — PURE rules.
//
// No I/O. The founder decided (2026-10-04): the organisation profile is SIGNUP STEP 2 with SAVE-AND-EXIT. What lives here:
//   • the profile step's own field set (legal name *, display name *, home district *, society registration no., PAN, GSTIN,
//     FSSAI) and the DRAFT payload shape (0200's CHECK admits exactly these keys — nothing else rides in a draft);
//   • the GSTIN STATE-CODE ADVISORY (F-26): a GSTIN whose first two digits are not the home district's state code gets a GENTLE
//     CONFIRM ("24 is Gujarat's code; your district is in Maharashtra — continue?"), never a block, and a matching one is silent.
//     The state code is DATA (`admin_regions.gst_state_code`, 0140), never a table in this file;
//   • the reason rule for the profile step: the EXISTING rule (`reasonProblem`, W2426) applied to the identifiers that are already
//     recorded — a GSTIN / PAN / registration no. / FSSAI being REPLACED or CLEARED needs a reason; the names a founder typed one
//     step earlier do not (they were never "verified" values — decided in the SW-d report, D3).
//   • "Entries are kept in this browser and retry automatically" (W114's failure state) is REFUSED BY NAME: the console uses server
//     actions only and nothing is stored in a browser; the failure screen says "saved on the server up to step N".
import type { DiffRow } from './tax-identity';

/** The step's fields, in W114's order. The draft payload and the save body use exactly these keys. */
export const PROFILE_STEP_FIELDS = ['legalName', 'displayName', 'regionId', 'cinOrRegNo', 'pan', 'gstin', 'fssaiLicense'] as const;
export type ProfileStepField = (typeof PROFILE_STEP_FIELDS)[number];
export type ProfileStepInput = Partial<Record<ProfileStepField, string | null>>;

/** W114: "Only three fields are required today — everything else can wait until you are ready." */
export const PROFILE_REQUIRED: readonly ProfileStepField[] = ['legalName', 'displayName', 'regionId'];

/** Draft payloads are bounded by the same CHECK the database holds (4 KiB of text, the seven keys). */
export const DRAFT_MAX_BYTES = 4096;
export const DRAFT_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A draft payload as it may be stored: only the step's keys, only strings (a half-typed PAN is still text), trimmed, each ≤ 250
 * characters. Unknown keys are DROPPED rather than refused — a draft is a convenience, and a stale form posting an old field must
 * not lose the rest of what somebody typed on a village connection.
 */
export function cleanDraftPayload(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of PROFILE_STEP_FIELDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== 'string') continue;
    const s = v.trim().slice(0, 250);
    if (k === 'regionId' && s && !UUID.test(s)) continue;
    if (s) out[k] = s;
  }
  return out;
}
export function draftBytes(payload: Record<string, string>): number { return Buffer.byteLength(JSON.stringify(payload), 'utf8'); }

/** Which required fields are missing from a save — each named, never "form invalid". */
export function missingRequired(input: ProfileStepInput): ProfileStepField[] {
  return PROFILE_REQUIRED.filter((k) => {
    const v = input[k];
    return v === undefined || v === null || String(v).trim() === '';
  });
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE GSTIN STATE ADVISORY (F-26)                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------- */

export interface DistrictState {
  districtName: string;
  stateName: string;
  /** `admin_regions.gst_state_code` of the district's state — NULL where nobody has recorded it. */
  stateGstCode: string | null;
}

export type GstStateAdvisory =
  /** No GSTIN given, or its first two digits ARE the district's state code — nothing to say. */
  | { kind: 'silent' }
  /** The gentle confirm: never a block. `gstStateName` is the state whose code the GSTIN carries, when it is recorded. */
  | { kind: 'confirm'; gstCode: string; gstStateName: string | null; districtName: string; districtStateName: string; districtStateCode: string }
  /** We cannot compare — said, never guessed: no district chosen, the state's code not recorded, or not an Indian GSTIN. */
  | { kind: 'not_checkable'; reason: 'no_district' | 'state_code_unknown' | 'not_india' };

/**
 * Compare a GSTIN's state code with the home district's state.
 *
 * **A CONFIRM, NEVER A REFUSAL.** A co-operative registered for GST in the state of its head office can run a collection centre — and
 * choose a home district — across a border. W114 says it in so many words: "a GSTIN starting differently … gets a gentle confirm,
 * never a block". The confirm names both states so the person can see whether they mistyped two digits or chose the right thing.
 */
export function gstStateAdvisory(gstin: string | null | undefined, district: DistrictState | null, countryCode: string,
                                 stateNameForCode: (code: string) => string | null): GstStateAdvisory {
  const g = (gstin ?? '').trim().toUpperCase();
  if (!g) return { kind: 'silent' };
  if (countryCode.toUpperCase() !== 'IN') return { kind: 'not_checkable', reason: 'not_india' };
  if (!district) return { kind: 'not_checkable', reason: 'no_district' };
  if (!district.stateGstCode) return { kind: 'not_checkable', reason: 'state_code_unknown' };
  const code = g.slice(0, 2);
  if (!/^[0-9]{2}$/.test(code)) return { kind: 'silent' };   // a malformed GSTIN is the format check's job, with its own sentence
  if (code === district.stateGstCode) return { kind: 'silent' };
  return {
    kind: 'confirm', gstCode: code, gstStateName: stateNameForCode(code), districtName: district.districtName,
    districtStateName: district.stateName, districtStateCode: district.stateGstCode,
  };
}

/** Does this advisory stop a save that was not confirmed? Only `confirm` — and a confirmed save always proceeds. */
export function advisoryNeedsConfirm(a: GstStateAdvisory, confirmed: boolean): boolean {
  return a.kind === 'confirm' && !confirmed;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE REASON RULE ON THE PROFILE STEP                                                                              */
/* ---------------------------------------------------------------------------------------------------------------- */

/** The identifiers whose replacement needs a reason (W2426's existing rule), as `DiffRow.field` names. */
export const REASONED_IDENTIFIERS = ['gstin', 'pan', 'cinOrRegNo', 'fssaiLicense'] as const;

/** The diff rows the reason rule applies to on the profile step: a recorded identifier being REPLACED or CLEARED. */
export function reasonedRows(diff: readonly DiffRow[]): DiffRow[] {
  return diff.filter((r) => (REASONED_IDENTIFIERS as readonly string[]).includes(r.field) && r.from !== null);
}

/** "Saved on the server up to step N" — the failure screen's honest line (the browser keeps nothing). */
export function savedUpToStep(step: 'profile' | 'done' | null, hasDraft: boolean): number {
  if (step === 'done') return 4;
  return hasDraft ? 3 : 2;
}
