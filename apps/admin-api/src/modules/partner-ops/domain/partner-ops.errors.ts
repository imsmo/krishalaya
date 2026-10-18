// apps/admin-api/src/modules/partner-ops/domain/partner-ops.errors.ts · PC-56 PARTNER-1a.
//
// Each refusal names itself with a `{code, message}` body. Three of them mirror a `[CODE]` the 0226 invite trigger raises,
// so the database wall and the service say the same thing — and `namedPartnerOpsError` maps one onto the other.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

export class PartnerNotFoundError extends DomainHttpError {
  constructor() { super('PARTNER_NOT_FOUND', 'no active partner organisation with this id', HttpStatus.NOT_FOUND); }
}
/** The platform appoints only the FIRST administrator; after that the partner invites its own team. */
export class PartnerHasAdminError extends DomainHttpError {
  constructor() {
    super('PARTNER_HAS_ADMIN', 'this partner already has an administrator — they invite their own team', HttpStatus.CONFLICT);
  }
}
export class PartnerAdminInvitePendingError extends DomainHttpError {
  constructor(expiresAt?: string | null) {
    super('PARTNER_ADMIN_INVITE_PENDING',
      'a platform invite for this partner\'s first administrator is still open — wait for it to be accepted or to expire',
      HttpStatus.CONFLICT, expiresAt ? { details: { expiresAt } } : {});
  }
}
export class PartnerPlatformRoleError extends DomainHttpError {
  constructor() {
    super('PARTNER_PLATFORM_ROLE', 'the platform appoints only a partner\'s first administrator', HttpStatus.CONFLICT);
  }
}
/** `uq_pi_one_pending` (0225): one pending invite per (partner, phone) — a partner-realm invite to the same phone. */
export class PartnerInvitePendingExistsError extends DomainHttpError {
  constructor() {
    super('PARTNER_INVITE_PENDING_EXISTS', 'this phone already holds a pending invite to this partner', HttpStatus.CONFLICT);
  }
}

/** Map a Postgres error from the invite write to the named refusal, or null when it is not one of ours (the caller
 *  rethrows). The trigger's `[CODE]` prefix is the contract; the unique index is matched by constraint name. */
export function namedPartnerOpsError(e: unknown): HttpException | null {
  const err = e as { message?: unknown; code?: unknown; constraint?: unknown } | null;
  const msg = typeof err?.message === 'string' ? err.message : '';
  if (msg.includes('[PARTNER_HAS_ADMIN]')) return new PartnerHasAdminError();
  if (msg.includes('[PARTNER_ADMIN_INVITE_PENDING]')) return new PartnerAdminInvitePendingError();
  if (msg.includes('[PARTNER_NOT_FOUND]')) return new PartnerNotFoundError();
  if (msg.includes('[PARTNER_PLATFORM_ROLE]')) return new PartnerPlatformRoleError();
  if (err?.code === '23505' && (err.constraint === 'uq_pi_one_pending' || msg.includes('uq_pi_one_pending'))) {
    return new PartnerInvitePendingExistsError();
  }
  return null;
}
