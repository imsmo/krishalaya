// core/exports-plane/controllers/v1/exports.controller.ts · the plane's shared routes (PC-56 TENANT-6e-2):
//   GET  /v1/exports/:id            W2553's queued state (position, ETA) and W2554's receipt — one read, `status` decides
//   POST /v1/exports/:id/link       mint the 15-minute signed link (audited with its jti)
//   GET  /v1/exports/:id/download   present the link beside the session; every attempt logged; bytes streamed
//
// The ENQUEUE lives with each dataset (dairy: `POST /v1/dairy/insights/export`), because the permission and the flag
// that gate an export are the ones that gate the screen it is an export OF. Authorisation for the reads is the
// registered producer's permission, checked in the service against the job's dataset — so this controller carries no
// `@RequirePermissions` of its own and cannot be wrong about which one.
//
// FLAGS: `tenant_exports` is read in the SERVICE, not on the route, for the reason 6e-1 gave — the guard answers a
// disabled flag with a 404 the page cannot distinguish from a mistyped id, and W2553/W2554's flagged-off state has words.
import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { AuthGuard } from '../../../auth/auth.guard';
import { ZodQuery } from '../../../http/zod.pipe';
import { CurrentContext } from '../../../tenancy-context/current-context.decorator';
import { RequestContext } from '../../../tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ExportActor, ExportPlaneService } from '../../export-plane.service';
import { DownloadQueryDto, DownloadQuerySchema, ExportIdParamSchema } from '../../dto/exports.dto';

const ipOf = (r: Request) => r.ip || null;
const uaOf = (r: Request) => (typeof r.headers['user-agent'] === 'string' ? r.headers['user-agent'] : null);
const actorOf = (ctx: RequestContext): ExportActor => ({ userId: ctx.userId, permissions: ctx.permissions });
const idOf = (raw: string): string => {
  const r = ExportIdParamSchema.safeParse({ id: raw });
  if (!r.success) throw new BadRequestError('export id must be a uuid');
  return r.data.id;
};

@Controller({ path: 'exports', version: '1' })
@UseGuards(AuthGuard)
export class ExportsController {
  constructor(private readonly svc: ExportPlaneService) {}

  @Get(':id')
  view(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.view(ctx.tenantId, actorOf(ctx), idOf(id)).then((data) => ({ data }));
  }

  /** No Idempotency-Key: minting is not a mutation of anything but the audit trail, and two links for one click is not a
   *  double-fire — each is fifteen minutes of the same file, each traceable. */
  @Post(':id/link')
  link(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Req() req: Request) {
    return this.svc.mintLink(ctx.tenantId, actorOf(ctx), idOf(id), ipOf(req)).then((data) => ({ data }));
  }

  /**
   * THE BYTES. The only route in this realm that writes a raw response, and it does so only AFTER the service has
   * verified the link and the job and returned a stream — every refusal is thrown before a byte is sent and reaches the
   * ordinary exception filter as JSON. The digest is re-computed over exactly what is written to the socket, and the
   * log row is written when the response ends with what actually happened (`served` / `aborted`).
   */
  @Get(':id/download')
  async download(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(DownloadQuerySchema) q: DownloadQueryDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    const open = await this.svc.openDownload(ctx.tenantId, actorOf(ctx), idOf(id), q.token ?? null, { ip: ipOf(req), userAgent: uaOf(req) });
    const receipt = open.job.receipt!;
    res.status(200);
    res.setHeader('content-type', receipt.contentType);
    res.setHeader('content-length', String(receipt.byteSize));
    res.setHeader('content-disposition', `attachment; filename="${receipt.fileName}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-robots-tag', 'noindex');
    res.setHeader('x-export-sha256', receipt.sha256);

    const hash = createHash('sha256');
    let bytes = 0;
    let settled = false;
    const finish = async (outcome: 'served' | 'aborted' | 'storage_failed') => {
      if (settled) return;
      settled = true;
      await open.record({ outcome, bytesServed: bytes, servedSha256: outcome === 'storage_failed' ? null : hash.digest('hex') }).catch(() => undefined);
    };
    open.body.on('data', (chunk: Buffer) => { hash.update(chunk); bytes += chunk.length; });
    open.body.on('error', () => { res.destroy(); void finish('storage_failed'); });
    res.on('close', () => { void finish(bytes === receipt.byteSize ? 'served' : 'aborted'); });
    open.body.pipe(res);
  }
}
