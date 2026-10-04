// modules/tenancy/domain/swd.errors.ts · PC-56 TENANT-SW-d · ONBOARDING PROFILE + SETUP CALLS — every refusal by NAME.
//
// The walls are in the database (0200's triggers and the `tenants` RLS wall); the services NAME them instead of duplicating them, so
// removing a trigger turns a test red (the SW-a / SW-b / SW-c rule). `namedSwdTenancyRefusal(e)` turns a `[CODE] …` raised by a 0200
// trigger into a typed 4xx with a kind sentence; anything else passes through unchanged. Each code is also a console sentence
// (`swd.code.<CODE>`, en / hi / gu).
import { DomainError } from '../../../shared/errors/app-error';

export class SwdRefusedError extends DomainError {
  constructor(code: string, message: string, status = 409, details: Record<string, unknown> = {}) { super(code, message, status, details); }
}

export const SWD_TENANCY_CODES: Readonly<Record<string, { status: number; message: string }>> = Object.freeze({
  // the `tenants` wall (A1)
  TENANT_INSERT_TRIAL_ONLY: { status: 403, message: 'The request tier creates a trial organisation only.' },
  // the profile step (A2)
  ONBOARDING_DRAFT_OWNER_ONLY: { status: 403, message: 'This setup draft belongs to the person who started it — sign in with that phone to continue it.' },
  ONBOARDING_ALREADY_DONE: { status: 409, message: 'The organisation profile is already complete — edit it under Settings → GST & registration.' },
  ONBOARDING_NOT_TRACKED: { status: 409, message: 'This organisation was not created through self-serve signup — edit its profile under Settings → GST & registration.' },
  ONBOARDING_REQUIRED_MISSING: { status: 422, message: 'Legal name, display name and home district are required.' },
  ONBOARDING_DISTRICT_INVALID: { status: 422, message: 'Choose your home district from the list for your country.' },
  ONBOARDING_DRAFT_TOO_LARGE: { status: 422, message: 'The draft is too large to keep.' },
  ONBOARDING_RESTRICTED: { status: 403, message: 'Only a tenant administrator fills in the organisation profile.' },
  TENANT_NAME_IS_BRAND: { status: 409, message: 'The name members see is set in Branding and published by two administrators.' },
  // setup calls (C1)
  SETUP_CALL_ALREADY_OPEN: { status: 409, message: 'Your organisation already has a setup call requested — cancel it first to choose another slot.' },
  SETUP_CALL_SLOT_INVALID: { status: 422, message: 'Choose a slot that starts in the future (within 30 days) and lasts at most four hours.' },
  SETUP_CALL_NOT_FOUND: { status: 404, message: 'This setup-call request was not found.' },
  SETUP_CALL_NOT_YOURS: { status: 403, message: 'A setup call is requested (or cancelled) in your own session.' },
  SETUP_CALL_ADMIN_REALM: { status: 403, message: 'Only the Krishalaya team schedules or closes a setup call.' },
  SETUP_CALL_CLOSED: { status: 409, message: 'This setup-call request is already closed.' },
  SETUP_CALL_BAD_MOVE: { status: 409, message: 'That is not a move this setup-call request can make.' },
  SETUP_CALL_FINAL: { status: 409, message: 'What a setup-call request asks for is fixed — cancel it and request again.' },
  SETUP_CALL_BORN_REQUESTED: { status: 409, message: 'A setup-call request starts as requested.' },
  SETUP_CALL_APPEND_ONLY: { status: 409, message: 'A setup-call request is cancelled, never deleted.' },
  SETUP_CALL_NO_PHONE: { status: 422, message: 'Your account has no phone number on record — the team needs one to call you.' },
  SETUP_CALL_RESTRICTED: { status: 403, message: 'Only a tenant administrator books a setup call for the organisation.' },
  REASON_REQUIRED: { status: 422, message: 'A reason of 3–300 characters is required.' },
});

/** A `[CODE] …` raised by a 0200 trigger (or the unique index of one open request) → the named refusal; else unchanged. */
export function namedSwdTenancyRefusal(e: unknown): unknown {
  const msg = String((e as { message?: string })?.message ?? '');
  const m = /\[([A-Z_]+)\]/.exec(msg);
  if (m && SWD_TENANCY_CODES[m[1]]) { const c = SWD_TENANCY_CODES[m[1]]; return new SwdRefusedError(m[1], c.message, c.status); }
  const code = (e as { code?: string; constraint?: string })?.code;
  const constraint = (e as { constraint?: string })?.constraint;
  if (code === '23505' && constraint === 'uq_scr_one_open') { const c = SWD_TENANCY_CODES.SETUP_CALL_ALREADY_OPEN; return new SwdRefusedError('SETUP_CALL_ALREADY_OPEN', c.message, c.status); }
  return e;
}
export function swdTenancyRefusal(code: keyof typeof SWD_TENANCY_CODES & string, details: Record<string, unknown> = {}): SwdRefusedError {
  const c = SWD_TENANCY_CODES[code];
  return new SwdRefusedError(code, c.message, c.status, details);
}
