// modules/audit/domain/auditor-exports.ts · PC-56 TENANT-9c (F-11) · THE AUDITOR'S THREE FILES on the 6e-2 plane (pure).
//
// W201: *"Every export is a sealed evidence bag: content hash + platform signature + generation record."* Two of three are
// real: the plane computes the sha256 over the bytes as stored and records the generation (audit + receipt). The platform
// signature is NOT — there is no signing key (the standing founder-physical debt, ADMIN-5c's ruling: "a digest is not a
// signature"). Every receipt therefore carries `UNSIGNED_NOTE` and the verification facts that ARE true.
//
// THE PACK IS ONE CSV PER SECTION — DECIDED. The plane writes exactly one CSV per job (`core/exports-plane/domain/csv.ts`;
// no multi-file, no ZIP). A ZIP would be a second file format the plane does not have, and a single CSV mixing four
// sections with different columns is a spreadsheet nobody can sort. So `compliance.pack` takes `section` and each section
// is its own job, its own receipt and its own sha256 — four honest files rather than one file pretending to be a pack.
import { z } from 'zod';
import { MAX_EXPORT_WINDOW_DAYS, MAX_LIVE_WINDOW_DAYS, UNSIGNED_NOTE, isCivilDay, daysInclusive } from './auditor-realm';

export const AUDIT_TRAIL_DATASET = 'audit.trail';
export const LEDGER_ENTRIES_DATASET = 'ledger.entries';
export const COMPLIANCE_PACK_DATASET = 'compliance.pack';
export const AUDITOR_DATASETS = [AUDIT_TRAIL_DATASET, LEDGER_ENTRIES_DATASET, COMPLIANCE_PACK_DATASET] as const;
export type AuditorDataset = (typeof AUDITOR_DATASETS)[number];

export const PACK_SECTIONS = ['gst', 'ledger', 'schemes', 'privacy'] as const;
export type PackSection = (typeof PACK_SECTIONS)[number];

/** A ledger file never holds more legs than this; past it the receipt says `truncated` (a money export that quietly
 *  stopped at a round number would be read as a complete statement — TENANT-4a's rule). */
export const LEDGER_EXPORT_CAP = 200_000;
export const TRAIL_EXPORT_CAP = 200_000;

const day = z.string().refine(isCivilDay, 'a day, YYYY-MM-DD');
const bounded = (max: number) => <T extends { from: string; to: string }>(v: T, ctx: z.RefinementCtx) => {
  if (v.from > v.to) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'WINDOW_ORDER', path: ['from'] });
  else if (daysInclusive(v.from, v.to) > max) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `WINDOW_TOO_WIDE (max ${max} days)`, path: ['to'] });
};

/** W201 *"Bounded periods (max 1 FY per export)"* — a year is at most 366 days. */
export const TrailExportParamsSchema = z.object({ from: day, to: day }).strict().superRefine(bounded(MAX_EXPORT_WINDOW_DAYS));
export const LedgerExportParamsSchema = z.object({ from: day, to: day }).strict().superRefine(bounded(MAX_EXPORT_WINDOW_DAYS));
/** A pack section covers what the pack covers: one quarter (≤ 92 days). */
export const PackExportParamsSchema = z.object({ section: z.enum(PACK_SECTIONS), from: day, to: day }).strict().superRefine(bounded(MAX_LIVE_WINDOW_DAYS));
export type TrailExportParams = z.infer<typeof TrailExportParamsSchema>;
export type LedgerExportParams = z.infer<typeof LedgerExportParamsSchema>;
export type PackExportParams = z.infer<typeof PackExportParamsSchema>;

/** The enqueue body (`POST /v1/auditor/exports`). The params are validated by the PRODUCER's own schema in the plane. */
export const AuditorExportEnqueueSchema = z.object({ datasetCode: z.enum(AUDITOR_DATASETS), params: z.record(z.unknown()) }).strict();
export type AuditorExportEnqueueDto = z.infer<typeof AuditorExportEnqueueSchema>;

export const TRAIL_EXPORT_HEADER = ['entry_id', 'created_at_utc', 'action', 'entity_type', 'entity_id', 'actor_user_id', 'actor_role', 'reason', 'old_value_masked', 'new_value_masked', 'masked_fields'] as const;
export const LEDGER_EXPORT_HEADER = ['txn_id', 'txn_created_at_utc', 'txn_type', 'reference_type', 'reference_id', 'leg', 'account_kind', 'account', 'side', 'amount_minor', 'currency', 'running_minor', 'balance_after_minor', 'prev_hash', 'entry_hash', 'hash_link', 'txn_sum_minor', 'txn_legs_visible', 'txn_legs_total'] as const;
export const PACK_EXPORT_HEADER = ['section', 'item', 'value', 'unit', 'basis'] as const;

/** What `actor_role` prints when a row was written before 0181 — "not recorded", never a guess. */
export const NOT_RECORDED = 'not recorded';

export function trailNotes(p: { from: string; to: string; zone: string; empty: boolean }): string[] {
  return [
    UNSIGNED_NOTE,
    `verify: recompute sha256 over the downloaded bytes (e.g. "sha256sum <file>") and compare it with this receipt`,
    `window ${p.from} … ${p.to} (both inclusive), days in ${p.zone}`,
    'diffs are MASKED exactly as on screen (phone, email, Aadhaar, PAN, GSTIN, account numbers, addresses, names of people) — an export is not a reveal',
    `actor_role reads "${NOT_RECORDED}" on rows written before migration 0181 (no writer recorded it)`,
    ...(p.empty ? ['no audit rows in this window'] : []),
  ];
}

export function ledgerNotes(p: { from: string; to: string; zone: string; truncated: boolean; cap: number }): string[] {
  return [
    UNSIGNED_NOTE,
    `verify: recompute sha256 over the downloaded bytes and compare it with this receipt`,
    'hash links: for a leg on an account this cooperative OWNS, entry_hash = sha256(prev_hash|txn_id|account_id|amount_minor|balance_after_minor) (an empty prev_hash is the account\'s first entry) — recomputable from this file',
    'hash links on PLATFORM accounts (escrow, fees, payouts …) are WITHHELD (hash_link = withheld_shared_stripe): those accounts are shared by every cooperative and striped, so their chain interleaves other cooperatives\' entries and cannot be verified, or exported, from one cooperative (ADMIN-6)',
    'a member wallet leg prints a masked account identifier and no balance (member privacy)',
    `window ${p.from} … ${p.to} (both inclusive), days in ${p.zone}; amounts in minor units`,
    p.truncated ? `TRUNCATED at ${p.cap} legs — narrow the window for a complete file` : 'complete for the window',
  ];
}

export function packNotes(section: PackSection, p: { from: string; to: string; zone: string }): string[] {
  const base = [UNSIGNED_NOTE, 'NOT ATTESTED — no attestation record and no signing key exist; this file is the machine "maker" half only', `window ${p.from} … ${p.to} (both inclusive), days in ${p.zone}`];
  if (section === 'gst') return [...base, 'IRN / acknowledgement: no e-invoicing integration writes them — the count of invoices carrying one is printed, not assumed', 'the figure does NOT tie to the gst_payable platform account: that account is shared by every cooperative; the tie printed is this cooperative\'s own invoice sums'];
  if (section === 'ledger') return [...base, 'zero-sum and hash links for this cooperative\'s OWN accounts only; platform-account chains are unverifiable from one cooperative (ADMIN-6)'];
  if (section === 'schemes') return [...base, '"e-KYC-blocked" is not printed: no link from a scheme application to an eKYC verdict exists'];
  return [...base, 'counts over this cooperative\'s members only; consents and data-subject requests are owned by the platform\'s privacy plane (ADMIN-5) and read here'];
}

/** One trail row → CSV cells (already masked by the caller). */
export function trailRow(r: { id: string; createdAt: string; action: string; entityType: string | null; entityId: string | null; actorUserId: string | null; actorRole: string | null; reason: string | null; oldValue: unknown; newValue: unknown; maskedFields: string[] }): Array<string | null> {
  return [r.id, r.createdAt, r.action, r.entityType, r.entityId, r.actorUserId, r.actorRole ?? NOT_RECORDED, r.reason,
    r.oldValue === null || r.oldValue === undefined ? null : JSON.stringify(r.oldValue),
    r.newValue === null || r.newValue === undefined ? null : JSON.stringify(r.newValue), r.maskedFields.join(';')];
}
