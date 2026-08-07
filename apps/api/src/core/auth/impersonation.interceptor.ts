// apps/api/src/core/auth/impersonation.interceptor.ts · PC-56 ADMIN-9b.
//
// **THE PER-REQUEST RECORD W008 PROMISES, WRITTEN BY THE PLATFORM RATHER THAN BY THE OPERATOR.** Until this wave the
// only writer of `impersonation_actions` was `POST /v1/impersonation/grants/:id/actions` — called by the impersonating
// operator, with their own admin bearer, on a route that deliberately carries no elevation guard. **A log the subject
// chooses to write is not evidence.** This interceptor writes one row per impersonated request, from the server that
// served it, whether or not anybody wanted it written.
//
// IT ALSO CARRIES THE OTHER HALF OF "REVOKE MEANS NOW": the grant gate runs here, on every impersonated request, so a
// grant revoked two seconds ago refuses the next read rather than the next half-hour of them.
//
// FAILING TO LOG FAILS THE REQUEST. That inverts the usual rule and it is the ADMIN-8b lesson applied one plane over: a
// control whose work leaves no trace is a control nobody can prove held. The asymmetry is what makes it safe — the
// operator loses a read they can retry; the farmer would otherwise lose the record that somebody looked.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { ForbiddenError } from '../../shared/errors/app-error';
import { tryGetRequestContext } from '../tenancy-context/request-context';
import { ImpersonationGate } from './impersonation.gate';

@Injectable()
export class ImpersonationInterceptor implements NestInterceptor {
  constructor(private readonly gate: ImpersonationGate) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rc = tryGetRequestContext();
    if (ctx.getType() !== 'http' || !rc?.impersonation) return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const imp = rc.impersonation;
    const method = String(req.method ?? '');
    const path = String(req.originalUrl ?? req.url ?? '');
    const route = String(req.route?.path ?? '');

    // Rebuilt from the CONTEXT rather than carried from the token: `userId`/`tenantId` are what every other layer will
    // use for this request, so checking the grant against anything else would verify a session nobody is serving.
    const identity = {
      grantId: imp.grantId,
      targetUserId: rc.userId,
      targetTenantId: rc.tenantId,
      actorAdminId: imp.actorAdminId,
    };

    return from(this.gate.check(identity)).pipe(
      mergeMap(async (verdict) => {
        if (!verdict.live) {
          // **THE MOST IMPORTANT ROW THIS TABLE CAN HOLD**: somebody used an act-as token after the grant stopped being
          // live. 0119's trigger exempts `refused_grant` from the live-grant rule precisely so this can be recorded —
          // a log that is complete only while nothing interesting happens is not a log.
          await this.gate.recordAction({
            grantId: imp.grantId, targetTenantId: rc.tenantId, actorAdminId: imp.actorAdminId,
            method, path, action: route || null,
            outcome: 'refused_grant', statusCode: 403, detail: verdict.detail,
            requestId: rc.requestId || null,
          });
          throw new ForbiddenError(`${verdict.detail}. Ask for a new grant.`);
        }
        return verdict;
      }),
      mergeMap(() => next.handle().pipe(
        mergeMap(async (body) => {
          await this.gate.recordAction({
            grantId: imp.grantId, targetTenantId: rc.tenantId, actorAdminId: imp.actorAdminId,
            method, path,
            // The ROUTE PATTERN, not the resolved path: `/v1/orders/:id` groups a hundred reads into one legible line,
            // and the full path is on the row beside it for anybody who needs the actual object.
            action: route || null,
            outcome: 'served',
            statusCode: Number(ctx.switchToHttp().getResponse()?.statusCode ?? 200),
            detail: null,
            requestId: rc.requestId || null,
          });
          return body;
        }),
        catchError((err) => from(this.gate.recordAction({
          grantId: imp.grantId, targetTenantId: rc.tenantId, actorAdminId: imp.actorAdminId,
          method, path, action: route || null,
          outcome: 'served',
          // A failed read is still a read that was attempted, and the status says how it went. Recording it as `served`
          // with a 4xx/5xx is more honest than inventing a fourth outcome for "the handler threw": the operator did
          // reach the data path, which is the fact the target tenant cares about.
          statusCode: Number((err as { status?: number })?.status ?? 500),
          detail: String((err as Error)?.message ?? '').slice(0, 300),
          requestId: rc.requestId || null,
        })).pipe(mergeMap(() => throwError(() => err)))),
      )),
    );
  }
}
