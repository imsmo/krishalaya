// apps/api/src/core/auth/auditor-read-only.guard.ts · PC-56 TENANT-9c · THE AUDITOR IS READ-ONLY BY CONSTRUCTION (Law 12).
//
// W200: *"Read-only realm. This console has no business-data write actions — not hidden, absent. The single exception:
// generating signed exports, which only appends to the audit log. The auditor role is enforced read-only at the
// permission layer."* Until this guard that sentence was false: the auditor was an ordinary tenant role, 201 of 542
// mutating routes carried no permission at all, and `POST /v1/invoices/:id/credit-notes` was gated by `report.view` alone
// — which the auditor holds — so the role the canon defines by having no write could issue a GST credit note (F-8).
//
// ONE GUARD, GLOBAL, METHOD-BASED (ADMIN-9b's impersonation guard is the precedent and the argument): a read-only rule
// that has to be remembered on each new route is a rule that will be forgotten on one, and guessing which POSTs are
// "really reads" is how read-only becomes read-mostly. So: a session that holds the `auditor` role in this tenant may
// GET / HEAD / OPTIONS, and every other method is refused — whatever permission the route asks for, and whether or not it
// asks for one. Holding a second role does not lift it: an auditor who is also a hand that writes is not independent,
// and the canon's separation ("tenant staff use their own desks — separation is the point") is the rule.
//
// THE EXCEPTIONS ARE NAMED ON THE ROUTE, NOT IN A LIST HERE, AND A SPEC ENUMERATES THEM. `@AuditorReadAct(code)` marks a
// handler, and `auditor-read-only.guard.spec.ts` walks every controller method in the real AppModule and asserts that
// exactly these three carry it:
//   • `export.enqueue` — THE canon's single exception: the auditor's export enqueue (`POST /v1/auditor/exports`). It
//     changes no business data; it writes a queue row, an audit row and a read-log row, and produces a file.
//   • `export.link`   — minting the 15-minute link to that file (`POST /v1/exports/:id/link`). Part of the same export:
//     without it the file the exception produced cannot be fetched. Audited with its jti.
//   • `session.logout` — ending one's own session (`POST /v1/auth/logout`). Not business data; refusing it would keep a
//     revoked auditor's refresh token alive, the opposite of the canon's "revocable".
//   • `two_factor.self` — PC-56 TENANT-SW-c: the auditor's OWN second factor (`POST /v1/me/2fa/enrol|confirm|disable`). Not business
//     data; the auditor holds a staff seat, so when the organisation requires 2FA for staff (`security.require_staff_2fa`) refusing
//     these would lock the auditor out of the realm entirely instead of letting them comply.
//
// THE REFUSAL IS RECORDED BEFORE IT IS THROWN (ADMIN-9b's rule): an auditor's attempted write is the most interesting row
// the trail could hold. If the record fails, the request is still refused — fail closed.
import { CanActivate, ExecutionContext, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../shared/errors/app-error';
import { tryGetRequestContext } from '../tenancy-context/request-context';
import { AuditWriter } from '../audit/audit.writer';

export const AUDITOR_ROLE = 'auditor';
export const AUDITOR_READ_ACT_KEY = 'auditor_read_act';
export const AUDITOR_READ_ACTS = ['export.enqueue', 'export.link', 'session.logout', 'two_factor.self'] as const;
export type AuditorReadActCode = (typeof AUDITOR_READ_ACTS)[number];

/** Marks the ONE route-level carve-out a handler is. Never a class decorator: an exception is one route, read by a person. */
export const AuditorReadAct = (code: AuditorReadActCode) => SetMetadata(AUDITOR_READ_ACT_KEY, code);

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export type AuditorVerdict = 'not_auditor' | 'read' | 'named_exception' | 'refused';

/** PURE: what the guard decides for a session's roles, the HTTP method and the route's carve-out (if any). */
export function auditorVerdict(roles: readonly string[] | undefined, method: string, act: unknown): AuditorVerdict {
  if (!roles || !roles.includes(AUDITOR_ROLE)) return 'not_auditor';
  if (SAFE.has(String(method).toUpperCase())) return 'read';
  if (typeof act === 'string' && (AUDITOR_READ_ACTS as readonly string[]).includes(act)) return 'named_exception';
  return 'refused';
}

export class AuditorReadOnlyError extends AppError {
  constructor(method: string) {
    super('AUDITOR_READ_ONLY', 'The auditor realm is read-only: this session holds the auditor role, and a write is refused whatever the route. This attempt has been recorded.', 403, { method, rule: 'auditor_read_only' });
  }
}

@Injectable()
export class AuditorReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Optional() private readonly audit?: AuditWriter) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const rc = tryGetRequestContext();
    const req = ctx.switchToHttp().getRequest();
    const method = String(req?.method ?? '');
    const act = this.reflector.get<string | undefined>(AUDITOR_READ_ACT_KEY, ctx.getHandler());
    const verdict = auditorVerdict(rc?.roles, method, act);
    if (verdict !== 'refused') return true;

    const path = String(req?.originalUrl ?? req?.url ?? '').split('?')[0].slice(0, 200);
    if (this.audit && rc?.tenantId) {
      await this.audit.log({
        tenantId: rc.tenantId, actorUserId: rc.userId || null, actorRole: (rc.roles ?? []).slice().sort().join('+'),
        action: 'auditor.write_refused', entityType: 'route', newValue: { method, path }, requestId: rc.requestId || null,
      }).catch(() => undefined);
    }
    throw new AuditorReadOnlyError(method);
  }
}
