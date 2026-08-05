// modules/schemes/domain/dbt-bounce.rules.ts · PC-55 A3 — PURE bounce rules (DB-free, so they are testable
// and no surface re-implements them). A bounce is a farmer's missing money: every gate here exists to keep
// the record truthful rather than tidy.
export const BOUNCE_REASON_CODES = [
  'account_closed', 'account_frozen', 'invalid_account', 'name_mismatch', 'ifsc_invalid',
  'aadhaar_not_seeded', 'npci_mandate_absent', 'bank_rejected', 'beneficiary_deceased', 'other',
] as const;
export type BounceReasonCode = (typeof BOUNCE_REASON_CODES)[number];
export const BOUNCE_RESOLUTIONS = ['open', 'recredited', 'abandoned'] as const;
export type BounceResolution = (typeof BOUNCE_RESOLUTIONS)[number];

/** Only an OPEN bounce can be closed, and it closes exactly once. */
export function canResolve(current: BounceResolution, to: 'recredited' | 'abandoned'): boolean {
  return current === 'open' && (to === 'recredited' || to === 'abandoned');
}

/** 'other' MUST carry the bank's own words — an unexplained bounce is not a record, it is a shrug. */
export function reasonNoteRequired(reasonCode: string): boolean { return reasonCode === 'other'; }

/** Abandoning a farmer's returned money demands a written justification, always. */
export function resolutionNoteRequired(to: 'recredited' | 'abandoned'): boolean { return to === 'abandoned'; }

/** A recredit closure must name the replacement transfer — otherwise "recredited" is an unbacked claim. */
export function recreditRefRequired(to: 'recredited' | 'abandoned'): boolean { return to === 'recredited'; }

/** A bounce cannot predate its credit, and cannot be dated in the future (bank statements are historical). */
export function bounceDateSane(bouncedOn: string, creditedOnOrTransferDate: string, todayIso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(bouncedOn) && bouncedOn >= creditedOnOrTransferDate.slice(0, 10) && bouncedOn <= todayIso;
}

/** Desk triage: which reasons a re-credit can even be attempted for (the rest need beneficiary data fixed
 *  first — surfacing that honestly is the difference between a queue and a graveyard). */
export function isRecreditableWithoutDataFix(reasonCode: string): boolean {
  return ['bank_rejected', 'npci_mandate_absent', 'account_frozen', 'other'].includes(reasonCode);
}
