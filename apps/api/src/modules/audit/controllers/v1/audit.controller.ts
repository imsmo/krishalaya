// modules/audit/controllers/v1/audit.controller.ts · the audit-trail browse for the tenant auditor (and tenant_admin).
// validate→authorize→delegate only. `audit.read` on every route; the `audit_trail` flag is read in the SERVICE so a
// switched-off console answers `AUDITOR_REALM_OFF` (a sentence on the page) rather than a 404 indistinguishable from a typo.
//
// [PC-56 TENANT-9c] Every read here is masked and itself recorded (audit_read_log). The one POST is the recorded REVEAL of
// one entry (`member.pii.reveal`, reason ≥ 20) — a read that writes its own record; an auditor session is refused it by the
// AuditorReadOnlyGuard like any other non-GET (the auditor holds no reveal, and the realm writes nothing).
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { AuditActor, AuditService } from '../../services/audit.service';
import { AuditPermissions, canReadAudit } from '../../policies/audit.policies';
import { QueryAuditSchema, QueryAuditDto, RevealAuditSchema, RevealAuditDto } from '../../dto/audit.dto';

export const actorOf = (ctx: RequestContext): AuditActor => ({
  userId: ctx.userId, canRead: canReadAudit(ctx), roles: ctx.roles, permissions: ctx.permissions, requestId: ctx.requestId || null,
});

@Controller({ path: 'audit/entries', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  @Get() @RequirePermissions(AuditPermissions.Read)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryAuditSchema) q: QueryAuditDto) {
    return this.svc.list(ctx.tenantId, actorOf(ctx), q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, window: res.window } }));
  }

  @Get(':id') @RequirePermissions(AuditPermissions.Read)
  async get(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Query('revealGrant') revealGrant?: string) {
    const entry = await this.svc.getById(ctx.tenantId, actorOf(ctx), id, typeof revealGrant === 'string' ? revealGrant : null);
    if (!entry) throw new NotFoundError('Audit entry not found');
    return { data: entry };
  }

  /** The recorded reveal of ONE entry's masked fields. Recorded (read log + trail row) BEFORE the value is returned. */
  @Post(':id/reveal') @RequirePermissions(AuditPermissions.Read)
  reveal(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(RevealAuditSchema) dto: RevealAuditDto, @Req() r: Request) {
    return this.svc.reveal(ctx.tenantId, actorOf(ctx), id, dto.reason, r.ip || null).then((data) => ({ data }));
  }
}
