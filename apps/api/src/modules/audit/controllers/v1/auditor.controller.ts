// modules/audit/controllers/v1/auditor.controller.ts · THE AUDITOR REALM's routes (PC-56 TENANT-9c):
//   GET  /v1/auditor/overview          W200 — ledger.read
//   GET  /v1/auditor/ledger            W436 — ledger.read (the tenant funnel)
//   GET  /v1/auditor/compliance-pack   W437 — ledger.read
//   GET  /v1/auditor/exports           W201 — audit.read (the caller's own jobs for the three auditor datasets)
//   POST /v1/auditor/exports           W2498 — THE REALM'S ONE ACT, the AuditorReadOnlyGuard's named exception; Idempotency-Key
// validate → delegate. Permission and flag are judged by the SERVICE so each refusal is a coded state the page words
// (`AUDITOR_REALM_OFF`, `AUDITOR_SCOPE_ONLY`, `AUDIT_WINDOW_REFUSED`) — not a bare 404/403 it cannot tell apart.
import { Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { AuditorReadAct } from '../../../../core/auth/auditor-read-only.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AuditorActor, AuditorService } from '../../services/auditor.service';
import { AuditorExportEnqueueSchema, AuditorExportEnqueueDto } from '../../domain/auditor-exports';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const AuditorWindowQuerySchema = z.object({ from: DAY.optional(), to: DAY.optional() }).strict();
export const AuditorLedgerQuerySchema = z.object({
  from: DAY.optional(), to: DAY.optional(), cursor: z.string().max(200).optional(),
  txnType: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/).optional(), limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();
export const AuditorExportsQuerySchema = z.object({ cursor: z.string().max(200).optional() }).strict();

const actorOf = (ctx: RequestContext): AuditorActor => ({ userId: ctx.userId, roles: ctx.roles ?? [], permissions: ctx.permissions, requestId: ctx.requestId || null });
const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };

@Controller({ path: 'auditor', version: '1' })
@UseGuards(AuthGuard)
export class AuditorController {
  constructor(private readonly svc: AuditorService) {}

  @Get('overview')
  overview(@CurrentContext() ctx: RequestContext, @ZodQuery(AuditorWindowQuerySchema) q: z.infer<typeof AuditorWindowQuerySchema>) {
    return this.svc.overview(ctx.tenantId, actorOf(ctx), q).then((data) => ({ data }));
  }

  @Get('ledger')
  ledger(@CurrentContext() ctx: RequestContext, @ZodQuery(AuditorLedgerQuerySchema) q: z.infer<typeof AuditorLedgerQuerySchema>) {
    return this.svc.ledgerPage(ctx.tenantId, actorOf(ctx), q).then((data) => ({ data }));
  }

  @Get('compliance-pack')
  compliancePack(@CurrentContext() ctx: RequestContext, @ZodQuery(AuditorWindowQuerySchema) q: z.infer<typeof AuditorWindowQuerySchema>) {
    return this.svc.compliancePack(ctx.tenantId, actorOf(ctx), q).then((data) => ({ data }));
  }

  @Get('exports')
  exportsList(@CurrentContext() ctx: RequestContext, @ZodQuery(AuditorExportsQuerySchema) q: z.infer<typeof AuditorExportsQuerySchema>) {
    return this.svc.exportsList(ctx.tenantId, actorOf(ctx), q).then((data) => ({ data }));
  }

  /** THE NAMED EXCEPTION. It writes a queue row, an audit row and a read-log row, and produces a file — no business data. */
  @AuditorReadAct('export.enqueue')
  @Post('exports')
  enqueue(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(AuditorExportEnqueueSchema) dto: AuditorExportEnqueueDto) {
    return this.svc.enqueueExport(ctx.tenantId, actorOf(ctx), needKey(key), dto, r.ip || null).then((data) => ({ data }));
  }
}
