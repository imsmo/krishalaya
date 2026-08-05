// modules/ambassadors/controllers/v1/aeps.controller.ts · PC-54 W54-13 `aeps-service-events` (0071).
// LOG ONLY by design — there is no money route here to guard because none exists. Masked last4s only.
import { Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
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
@UseGuards(AuthGuard, PermissionsGuard)
export class AepsController {
  constructor(private readonly svc: AepsService) {}

  /** Kiosk-side record (offline-first sync → idempotent; the service enforces aeps_enabled + W392 rules). */
  @Post('events')
  record(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(RecordEventSchema) dto: z.infer<typeof RecordEventSchema>) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.record(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }
  @Get('events/mine')
  mine(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.svc.mine(ctx.tenantId, ctx.userId, Number(limit) || 50).then((data) => ({ data }));
  }
  @Get('events') @RequirePermissions(AmbassadorsPermissions.Manage)
  oversight(@CurrentContext() ctx: RequestContext, @Query('status') status?: string, @Query('exceptionCode') exceptionCode?: string, @Query('limit') limit?: string) {
    return this.svc.oversight(ctx.tenantId, { status, exceptionCode, limit: Number(limit) || 100 }).then((data) => ({ data }));
  }
}
