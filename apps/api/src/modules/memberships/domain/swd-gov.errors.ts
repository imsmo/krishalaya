// modules/memberships/domain/swd-gov.errors.ts · PC-56 TENANT-SW-d · AGM PACK + REGISTER IMPORT — every refusal by NAME.
// A `[CODE] …` raised by a 0200 trigger becomes a typed 4xx with a kind sentence (`namedSwdGovRefusal`); each code is also a console
// sentence (`swd.code.<CODE>`, en / hi / gu). The services name the walls; they do not duplicate them.
import { DomainError } from '../../../shared/errors/app-error';

export class SwdGovRefusedError extends DomainError {
  constructor(code: string, message: string, status = 409, details: Record<string, unknown> = {}) { super(code, message, status, details); }
}

export const SWD_GOV_CODES: Readonly<Record<string, { status: number; message: string }>> = Object.freeze({
  // the AGM pack (D)
  AGM_RESTRICTED: { status: 403, message: 'AGM packs are drafted, issued and confirmed by tenant administrators (board + checker). Every member still gets their own statement.' },
  AGM_NOT_FOUND: { status: 404, message: 'This AGM pack was not found.' },
  AGM_FY_BASIS_UNDECLARED: { status: 409, message: 'The financial year is not declared — set finance.fiscal_year_start_month (or the country default) first.' },
  AGM_FY_NOT_ENDED: { status: 409, message: 'This financial year has not ended yet — a pack is assembled once the year closes.' },
  AGM_ANNEXURE_NOT_FOUND: { status: 422, message: 'The auditor annexure must be a file this cooperative uploaded.' },
  AGM_PACK_BORN_DRAFT: { status: 409, message: 'An AGM pack starts as a draft.' },
  AGM_PACK_NOT_YOURS: { status: 403, message: 'An AGM pack act is recorded in the acting administrator\'s own session.' },
  AGM_PACK_APPEND_ONLY: { status: 409, message: 'An AGM pack is withdrawn (a draft) or corrected by an addendum (issued), never deleted.' },
  AGM_PACK_IMMUTABLE: { status: 409, message: 'An issued AGM pack never changes — a correction is an addendum.' },
  AGM_PACK_WITHDRAWN: { status: 409, message: 'This draft was withdrawn.' },
  AGM_PACK_FINAL: { status: 409, message: 'This pack is waiting for its checker — send it back to draft to change it.' },
  AGM_PACK_BAD_MOVE: { status: 409, message: 'That is not a move this AGM pack can make now.' },
  AGM_ISSUER_NOT_ADMIN: { status: 403, message: 'Only a tenant administrator asks for an AGM pack to be issued.' },
  AGM_CHECKER_IS_MAKER: { status: 409, message: 'The person who asked for the pack to be issued cannot confirm it — a second tenant administrator must.' },
  AGM_CHECKER_NOT_ADMIN: { status: 403, message: 'Only a tenant administrator confirms an AGM pack.' },
  AGM_DOCUMENT_ID: { status: 409, message: 'The document id is generated, never typed.' },
  AGM_PARENT_NOT_FOUND: { status: 404, message: 'The pack to correct was not found.' },
  AGM_PARENT_NOT_ISSUED: { status: 409, message: 'An addendum corrects an ISSUED pack — a draft is simply re-assembled.' },
  AGM_PARENT_SUPERSEDED: { status: 409, message: 'This pack already has an issued addendum — correct the latest one.' },
  AGM_PARENT_NOT_SUPERSEDED: { status: 409, message: 'An addendum issues in the same act that marks its parent superseded.' },
  AGM_ADDENDUM_SEQUENCE: { status: 409, message: 'An addendum is the next number of the same financial year.' },
  AGM_SECTION_REASSEMBLE: { status: 409, message: 'A section is re-assembled from facts, never edited.' },
  AGM_VERIFY_NOT_FOUND: { status: 404, message: 'No issued AGM pack has this document id.' },
  AGM_PACK_EXISTS: { status: 409, message: 'This financial year already has a pack — correct it with an addendum, or withdraw the draft.' },
  // the register import (E)
  IMPORT_RESTRICTED: { status: 403, message: 'Only a tenant administrator imports the share register.' },
  IMPORT_NOT_FOUND: { status: 404, message: 'This import was not found.' },
  IMPORT_CONSENT_REQUIRED: { status: 422, message: 'A register import needs the consent document (board resolution or attestation) your cooperative uploaded.' },
  IMPORT_FILE_EMPTY: { status: 422, message: 'The file has no rows under its header.' },
  IMPORT_FILE_TOO_LARGE: { status: 422, message: 'A register import holds at most 5,000 rows (and 1 MB).' },
  IMPORT_COLUMNS_MISSING: { status: 422, message: 'The file needs the columns phone, folio, shares and paid_up.' },
  IMPORT_FILE_UNREADABLE: { status: 422, message: 'The file could not be read as CSV.' },
  IMPORT_BORN_STAGED: { status: 409, message: 'An import starts as staged.' },
  IMPORT_NOT_YOURS: { status: 403, message: 'An import act is recorded in the acting administrator\'s own session.' },
  IMPORT_APPEND_ONLY: { status: 409, message: 'An import is rejected, never deleted.' },
  IMPORT_FINAL: { status: 409, message: 'What was uploaded is fixed.' },
  IMPORT_CLOSED: { status: 409, message: 'This import is closed.' },
  IMPORT_BAD_MOVE: { status: 409, message: 'That is not a move this import can make now.' },
  IMPORT_NOTHING_VALID: { status: 422, message: 'No valid row to propose — fix the file and upload it again.' },
  IMPORT_NOT_ADMIN: { status: 403, message: 'Only a tenant administrator proposes or confirms a register import.' },
  IMPORT_CHECKER_IS_MAKER: { status: 409, message: 'The person who proposed this import cannot confirm it — a second tenant administrator must.' },
  IMPORT_NOT_CONFIRMED: { status: 409, message: 'A register row from an import is written only by a confirmed import.' },
  IMPORT_PROVENANCE_FINAL: { status: 409, message: 'A register row written by an import keeps its batch.' },
  NEEDS_SECOND_ADMIN: { status: 409, message: 'This needs a second tenant administrator to confirm it — your organisation has only one.' },
  REASON_REQUIRED: { status: 422, message: 'A reason of 10–500 characters is required.' },
});

export function namedSwdGovRefusal(e: unknown): unknown {
  const msg = String((e as { message?: string })?.message ?? '');
  const m = /\[([A-Z_]+)\]/.exec(msg);
  if (m && SWD_GOV_CODES[m[1]]) { const c = SWD_GOV_CODES[m[1]]; return new SwdGovRefusedError(m[1], c.message, c.status); }
  const code = (e as { code?: string })?.code; const constraint = (e as { constraint?: string })?.constraint;
  if (code === '23505' && (constraint === 'uq_agm_root_fy' || constraint === 'uq_agm_one_addendum')) { const c = SWD_GOV_CODES.AGM_PACK_EXISTS; return new SwdGovRefusedError('AGM_PACK_EXISTS', c.message, c.status); }
  return e;
}
export function swdGovRefusal(code: keyof typeof SWD_GOV_CODES & string, details: Record<string, unknown> = {}): SwdGovRefusedError {
  const c = SWD_GOV_CODES[code];
  return new SwdGovRefusedError(code, c.message, c.status, details);
}
