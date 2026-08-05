// modules/tenancy/controllers/v1/tenant-applications.controller.ts · PC-55 A1.
// THE PUBLIC DOOR: an organisation with no account, no tenant and no token applies to join the platform.
// @Public() (no AuthGuard) + a tight per-IP rate limit (abuse surface) + a REQUIRED Idempotency-Key so a
// double-tap on a flaky rural connection can never file two cases. The reply is deliberately minimal —
// a reference and a status, nothing about the platform's queue (Rule Zero: trust, no leakage).
import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { CreateTenantApplicationSchema, CreateTenantApplicationDto } from '../../dto/create-tenant-application.dto';
import { TenantApplicationService } from '../../services/tenant-application.service';

@Controller({ path: 'tenant-applications', version: '1' })
@UseGuards(AuthGuard)
export class TenantApplicationsController {
  constructor(private readonly svc: TenantApplicationService) {}

  @Public() @RateLimit({ limit: 3, windowSec: 3600, by: 'ip' })
  @Post()
  submit(@Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateTenantApplicationSchema) dto: CreateTenantApplicationDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.submit(dto, key, req.ip || null).then((data) => ({ data }));
  }
}
