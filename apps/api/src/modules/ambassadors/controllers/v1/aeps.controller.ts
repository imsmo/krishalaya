// modules/ambassadors/controllers/v1/aeps.controller.ts · PC-54 W54-13 `aeps-service-events` (0071).
// LOG ONLY by design — there is no money route here to guard because none exists. Masked last4s only.
// PC-56 HOTFIX-10 · H10-2 (survey OPS-1 F-2 / C-2 / C-9, founder Q7 + Law 10): this was the ONE ambassador controller without the module's
// kill-switch — turning `ambassadors` OFF for a tenant left its AePS desk recording and its supervisor reading 90 days of masked Aadhaar and
// account digits. It now carries `@FeatureFlag('ambassadors')` like every sibling (flag OFF → the same 404 they answer), and the service
// writes one audit row per record and one per supervisor read (no customer digit in either). The record's SHAPE (Aadhaar digits, the
// person link, retention) is OPS-1b's (Q7-A) and is unchanged here.
import { Controller, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { clientIpOf } from '../../../../core/http/client-ip';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AmbassadorsPermissions } from '../../policies/ambassadors.policies';
import { AepsService } from '../../services/aeps.service';
import { z } from 'zod';

const last4 = z.string().regex(/^\d{4}$/);
const RecordEventSchema = z.object({
  customerUserId: z.string().uuid().optional(),
  serviceKind: z.enum(['cash_withdrawal', 'balance_enquiry', 'mini_statement']),
  bankName: z.string().max(120).optional(),
  accountLast4: last4.optional(),
  aadhaarLast4: last4.optional(),                     // NEVER more than 4 digits arrives here (Law 10)
  amountMinor: z.string().regex(/^\d{1,15}$/).optional(),
  balanceAfterMinor: z.string().regex(/^\d{1,15}$/).optional(),
  status: z.enum(['success', 'failed', 'declined', 'blocked']),
  exceptionCode: z.enum(['device_not_rd_certified', 'finger_fail', 'bank_server_down', 'cap_exceeded', 'bank_declined']).optional(),
  attemptNo: z.number().int().min(1).max(3),          // ≤3 finger retries, NO OTP fallback (W391)
  deviceCertified: z.boolean(),
  npciRrn: z.string().max(40).optional(),
  escalationNote: z.string().max(200).optional(),
}).strict();

@Controller({ path: 'ambassadors/aeps', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ambassadors')
export class AepsController {
  constructor(private readonly svc: AepsService) {}

  /** Kiosk-side record (offline-first sync → idempotent; the service enforces aeps_enabled + W392 rules). */
  @Post('events')
  record(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(RecordEventSchema) dto: z.infer<typeof RecordEventSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.record(ctx.tenantId, ctx.userId, key, dto, clientIpOf(req)).then((data) => ({ data }));
  }
  @Get('events/mine')
  mine(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.svc.mine(ctx.tenantId, ctx.userId, Number(limit) || 50).then((data) => ({ data }));
  }
  @Get('events') @RequirePermissions(AmbassadorsPermissions.Manage)
  oversight(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Query('status') status?: string, @Query('exceptionCode') exceptionCode?: string, @Query('limit') limit?: string) {
    return this.svc.oversight(ctx.tenantId, ctx.userId, { status, exceptionCode, limit: Number(limit) || 100 }, clientIpOf(req)).then((data) => ({ data }));
  }
}
