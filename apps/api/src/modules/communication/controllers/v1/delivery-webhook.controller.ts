// modules/communication/controllers/v1/delivery-webhook.controller.ts · PUBLIC, UNAUTHENTICATED delivery-status
// sink: the external notifier POSTs here when a message is delivered/failed. Trust is established ONLY by the
// HMAC-SHA256 signature over the RAW body (constant-time compare against NOTIFY_WEBHOOK_SECRET) — fail-closed
// if unconfigured or mismatched. Idempotent (provider_msg_ref → delivered). `communication` flag.
import { Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../../../core/config/app-config';
import { BadRequestError, ForbiddenError } from '../../../../shared/errors/app-error';
import { NotificationService } from '../../services/notification.service';
import { INBOUND_WEBHOOK_SINK, InboundWebhookSink } from '../../../../core/webhooks/inbound-webhook.recorder';

@Controller({ path: 'notifications/delivery-callback', version: '1' })
export class DeliveryWebhookController {
  constructor(
    private readonly svc: NotificationService,
    private readonly config: AppConfig,
    // PC-56 ADMIN-11c: this sink verified correctly and recorded nothing. W106's "all from one stale Gupshup secret"
    // is a diagnosis that needs exactly these rows — and a delivery callback is also how the platform learns that a
    // notification never arrived, so losing the rejected ones loses the evidence for both questions at once.
    @Inject(INBOUND_WEBHOOK_SINK) private readonly receipts: InboundWebhookSink,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-notify-signature') signature: string) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    if (!raw) throw new BadRequestError('empty delivery body');
    // Recorded BEFORE the secret is even looked up, so the two different failures below both leave a row.
    const receipt = await this.receipts.record({
      providerCode: 'notify', eventType: 'message.status', raw,
      sourceIp: req.ip ?? null, requestId: (req.headers['x-request-id'] as string) || null,
    });

    const secret = this.config.notifications.webhookSecret;
    if (!secret) {
      // **OUR OWN OUTAGE WEARING A SECURITY ERROR'S CLOTHES.** Recorded with its own reason rather than as a mismatch:
      // an operator counting "signature failures" must not be led to rotate a provider's secret when the fault is a
      // missing environment variable on this side.
      await this.receipts.settle(receipt, { signatureOk: false, reason: 'secret_unconfigured', status: 'ignored' });
      throw new ForbiddenError('delivery webhook not configured');   // fail-closed
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(signature || '');
    if (!signature) {
      // No header at all is a misconfigured caller; a wrong header is a stale secret or a forgery. Different rows.
      await this.receipts.settle(receipt, { signatureOk: false, reason: 'absent', status: 'ignored' });
      throw new ForbiddenError('bad signature');
    }
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await this.receipts.settle(receipt, { signatureOk: false, reason: 'mismatch', status: 'ignored' });
      throw new ForbiddenError('bad signature');
    }
    const body = (req.body ?? {}) as { tenantId?: string | null; providerMsgRef?: string; status?: string };
    if (!body.providerMsgRef || (body.status !== 'delivered' && body.status !== 'failed')) {
      // A GOOD signature over a body this endpoint cannot use: the signature verdict stays true, because it was, and
      // the processing status carries the fault. Recording it as a signature failure would blame the caller's secret
      // for the caller's schema.
      await this.receipts.settle(receipt, { signatureOk: true, reason: 'ok', status: 'failed', error: 'providerMsgRef + status(delivered|failed) required' });
      throw new BadRequestError('providerMsgRef + status(delivered|failed) required');
    }
    const applied = await this.svc.applyDeliveryStatus(body.tenantId ?? null, body.providerMsgRef, body.status);
    await this.receipts.settle(receipt, { signatureOk: true, reason: 'ok', status: 'processed' });
    return { data: { applied } };
  }
}
