// apps/api/src/core/auth/impersonation-read-only.guard.ts · PC-56 ADMIN-9b.
//
// **`read_only` STOPS BEING A STRING NOBODY READS.** W008's subtitle — "Scope is read_only by design — write
// impersonation does not exist on this platform" — was asserted at mint, CHECKed in the schema, and enforced at request
// time by nothing, because nothing honoured the token at all. This guard is the enforcement, and it is a GLOBAL guard
// rather than a decorator: a rule that has to be remembered on each new route is a rule that will be forgotten on one.
//
// METHOD-BASED, and deliberately blunt. GET/HEAD/OPTIONS pass; everything else is refused, including POST endpoints
// that happen to be reads. Guessing which POSTs are safe is how a read-only scope becomes read-mostly, and the guess
// would have to be re-made by every future author of a POST-shaped search endpoint.
//
// THE REFUSAL IS RECORDED BEFORE IT IS THROWN. W008 renders exactly this row — "System write attempt blocked —
// listings.update denied (scope read_only)" — and a blocked write that left no trace would be the most interesting
// event in the log going unrecorded.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../shared/errors/app-error';
import { tryGetRequestContext } from '../tenancy-context/request-context';
import { isSafeForImpersonation } from './impersonation-token';
import { ImpersonationGate } from './impersonation.gate';

@Injectable()
export class ImpersonationReadOnlyGuard implements CanActivate {
  constructor(private readonly gate: ImpersonationGate) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const rc = tryGetRequestContext();
    // Not impersonating: this guard has no opinion. Every ordinary request passes without a branch worth measuring.
    if (!rc?.impersonation) return true;

    const req = ctx.switchToHttp().getRequest();
    const method = String(req.method ?? '');
    if (isSafeForImpersonation(method)) return true;

    const path = String(req.originalUrl ?? req.url ?? '');
    // Recorded synchronously and awaited: if the log write fails, the request fails too, and it fails CLOSED — the
    // write was already going to be refused, so the caller loses nothing they were entitled to.
    await this.gate.recordAction({
      grantId: rc.impersonation.grantId,
      targetTenantId: rc.tenantId,
      actorAdminId: rc.impersonation.actorAdminId,
      method,
      path,
      action: null,
      outcome: 'refused_write',
      statusCode: 403,
      detail: `${method} refused: an act-as session is read-only`,
      requestId: rc.requestId || null,
    });

    throw new ForbiddenError(
      'This is a read-only support session. Write actions are refused, and this attempt has been recorded.',
    );
  }
}
