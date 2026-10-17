// modules/traceability/controllers/v1/public-scan.controller.ts · PUBLIC, UNAUTHENTICATED farm-to-fork QR scan + its VERIFY read, and the
// signed-in EXPORT of the record.
// No guards on the two reads: the unguessable qr_token is the capability. Returns ONLY the curated non-PII projection (via the SECURITY DEFINER
// trace_scan_v3() function). Flag-gated inside the service (the platform kill-switch, then the lot's organisation's own flag). No tenant
// context, no IDOR surface (you can only read what the token you hold points to).
//
// PC-56 STORE-5b:
//   GET  /v1/traceability/scan/:qrToken           W303 — the v3 lot (organisation, product, village/district, the journey with hashes, the
//                                                  seal, the certificates); TRACE_NO_LONGER_PUBLISHED / TRACE_NOT_PUBLISHED / TRACE_SCAN_NOT_FOUND
//   GET  /v1/traceability/scan/:qrToken/verify    W304 — the server's recompute (B11): per event ok | mismatch | unverifiable_v1, the chain, the
//                                                  seal's matchesHead; the same gate
//   POST /v1/traceability/scan/:qrToken/export    W3154 — SIGNED IN (AuthGuard) + Idempotency-Key: queues `traceability.lot_record` on the export
//                                                  plane for the caller (requester-only) → `{ jobId }`; the job is then read on `/v1/exports/:id`
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { clientIpOf } from '../../../../core/http/client-ip';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { PublicScanService } from '../../services/public-scan.service';
import { TraceExportService } from '../../services/trace-export.service';

@Controller({ path: 'traceability/scan', version: '1' })
export class PublicScanController {
  constructor(private readonly svc: PublicScanService, private readonly exportsSvc: TraceExportService) {}

  @Get(':qrToken')
  scan(@Param('qrToken') qrToken: string) { return this.svc.scan(qrToken).then((data) => ({ data })); }

  @Get(':qrToken/verify')
  verify(@Param('qrToken') qrToken: string) { return this.svc.verify(qrToken).then((data) => ({ data })); }

  @Post(':qrToken/export')
  @UseGuards(AuthGuard)
  export(@CurrentContext() ctx: RequestContext, @Param('qrToken') qrToken: string, @Headers('idempotency-key') key: string, @Req() req: Request) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.exportsSvc.request(ctx.tenantId, ctx.userId, qrToken, key, clientIpOf(req)).then((data) => ({ data }));
  }
}
