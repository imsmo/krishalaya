// modules/payments/controllers/v1/payment-webhooks.controller.ts
// PUBLIC, UNAUTHENTICATED gateway webhook sink — there is no JWT here. Trust is established ONLY
// by the HMAC signature over the raw body (verified in the gateway adapter); the tenant is read
// from the signature-verified order notes. The raw bytes come from req.rawBody (main.ts sets
// rawBody:true) so the signature matches exactly. Processing is idempotent on the gateway event id.
import { Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { PaymentService } from '../../services/payment.service';
import { RazorpayPayoutWebhookHandler } from '../../events/handlers/razorpay-webhook.handler';
import { INBOUND_WEBHOOK_SINK, InboundWebhookSink } from '../../../../core/webhooks/inbound-webhook.recorder';

// Razorpay sends 'x-razorpay-signature'; the sandbox uses 'x-webhook-signature'. Accept either.
function signatureOf(req: Request): string {
  const h = req.headers;
  return (h['x-razorpay-signature'] as string) || (h['x-webhook-signature'] as string) || '';
}
// Razorpay's canonical per-delivery event id — the most robust webhook dedup key (empty for the sandbox).
function eventIdOf(req: Request): string {
  return (req.headers['x-razorpay-event-id'] as string) || '';
}
/** The provider's own name for what happened ('payment.captured'), read from the body for the receipt only — never
 *  trusted for a decision, because at this point nothing has been verified. */
function eventTypeOf(req: Request): string | null {
  const b = req.body as { event?: unknown } | undefined;
  return typeof b?.event === 'string' ? b.event : null;
}
function requestIdOf(req: Request): string | null {
  return (req.headers['x-request-id'] as string) || null;
}
function messageOf(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 500);
}
/** **THE ONE INFERENCE THIS FILE MAKES, AND IT IS MADE CONSERVATIVELY.** The gateway adapter raises a forbidden-class
 *  error for a bad signature and other classes for processing faults; matching on the message is fragile, so anything
 *  that is not clearly a signature refusal is recorded as a PROCESSING failure. Guessing the other way round would
 *  quietly inflate W106's signature-failure count with our own bugs, which is the number an operator uses to conclude
 *  that a secret is stale. */
function isSignatureRefusal(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? '');
  const msg = String((err as Error)?.message ?? '').toLowerCase();
  return code === 'FORBIDDEN' || /signature/.test(msg);
}

@Controller({ path: 'payments/webhooks', version: '1' })
export class PaymentWebhooksController {
  constructor(
    private readonly payments: PaymentService,
    private readonly payoutWebhook: RazorpayPayoutWebhookHandler,
    // PC-56 ADMIN-11c. **THIS ENDPOINT VERIFIED A SIGNATURE AND THREW THE BYTES AWAY.** W106 promises
    // "raw payloads stored pre-processing — replayable, audit-grade", and `inbound_webhooks` (migration 0015) had no
    // writer anywhere. For a PAYMENT callback that is a money dispute with no evidence on our side: when the gateway
    // says "we told you at 15:03" there was nothing to compare.
    @Inject(INBOUND_WEBHOOK_SINK) private readonly receipts: InboundWebhookSink,
  ) {}

  @Post(':provider')
  @HttpCode(200) // always 200 on accepted/ignored so the gateway doesn't infinitely retry; errors throw.
  async handle(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    if (!raw) throw new BadRequestError('empty webhook body');
    // **RECORDED FIRST, WITH NO VERDICT YET.** A receipt written after verification could only ever describe
    // successes, and the rejected signature is the row that matters most: it is the only evidence a stale secret or a
    // forgery attempt ever leaves.
    const receipt = await this.receipts.record({
      providerCode: provider, eventType: eventTypeOf(req), raw,
      sourceIp: req.ip ?? null, requestId: requestIdOf(req), providerEventId: eventIdOf(req) || null,
    });
    try {
      const data = await this.payments.handleWebhook(provider, raw, signatureOf(req), eventIdOf(req));
      await this.receipts.settle(receipt, { signatureOk: true, reason: 'ok', status: 'processed' });
      return { data };
    } catch (err) {
      // The gateway adapter throws on a bad signature and on a processing failure alike, and the two are different
      // events: one is a defence working, the other is an incident. `ignored` versus `failed` is that distinction, and
      // W106's headline count reads the first.
      const bad = isSignatureRefusal(err);
      await this.receipts.settle(receipt, {
        signatureOk: !bad, reason: bad ? 'mismatch' : 'ok',
        status: bad ? 'ignored' : 'failed', error: messageOf(err),
      });
      throw err;
    }
  }

  /** Async PAYOUT callback (RazorpayX payout.processed/failed/reversed). Same trust model: HMAC over
   *  the raw body, tenant from signed notes. Idempotent on the gateway event id. */
  @Post(':provider/payouts')
  @HttpCode(200)
  async handlePayout(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    if (!raw) throw new BadRequestError('empty webhook body');
    // The payout leg gets the same receipt: this is the callback that says money LEFT, and it had no record either.
    const receipt = await this.receipts.record({
      providerCode: provider, eventType: eventTypeOf(req), raw,
      sourceIp: req.ip ?? null, requestId: requestIdOf(req), providerEventId: eventIdOf(req) || null,
    });
    try {
      const data = await this.payoutWebhook.ingest(raw, signatureOf(req));
      await this.receipts.settle(receipt, { signatureOk: true, reason: 'ok', status: 'processed' });
      return { data };
    } catch (err) {
      const bad = isSignatureRefusal(err);
      await this.receipts.settle(receipt, {
        signatureOk: !bad, reason: bad ? 'mismatch' : 'ok',
        status: bad ? 'ignored' : 'failed', error: messageOf(err),
      });
      throw err;
    }
  }
}
