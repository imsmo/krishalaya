// core/webhooks/inbound-webhook.sink.pg.ts · the Postgres sink (PC-56 ADMIN-11c).
//
// **IT NEVER THROWS, AND THAT IS A DIFFERENT DECISION FROM THE ONE ADMIN-9b MADE.** There, an impersonation action that
// could not be logged FAILED the request, because the log IS the control. Here the control is the signature check, and
// the receipt is evidence about it — so a database blip must not turn a valid payment callback into a 500 that makes the
// gateway retry for an hour. The failure is logged loudly, which is the honest version of best-effort: the row is
// missing and something says so.
//
// **AND IT WRITES OUTSIDE ANY TRANSACTION THE PROCESSING MIGHT OPEN.** The ADMIN-8b rule, learned once: evidence written
// inside a transaction that aborts is evidence that never existed. A rejected callback rolls nothing back — but a
// processing failure after a good signature does, and the receipt has to survive it.
import { Injectable, Logger } from '@nestjs/common';
import { PgPoolProvider } from '../database/pg-pool.provider';
import {
  InboundReceipt, InboundReceiptHandle, InboundWebhookSink, SignatureReason, preparePayload, statusFor,
} from './inbound-webhook.recorder';

@Injectable()
export class PgInboundWebhookSink implements InboundWebhookSink {
  private readonly log = new Logger(PgInboundWebhookSink.name);

  constructor(private readonly pools: PgPoolProvider) {}

  async record(r: InboundReceipt): Promise<InboundReceiptHandle | null> {
    const { payload, rawBytes, truncated } = preparePayload(r.raw);
    try {
      const res = await this.pools.writer(0).query<{ id: string; created_at: string }>(
        `INSERT INTO inbound_webhooks
           (provider_code, event_type, signature_ok, signature_reason, payload, processing_status,
            raw_bytes, truncated, source_ip, request_id, provider_event_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::inet,$10,$11)
         RETURNING id, created_at`,
        [
          // Bounded at the column width rather than left to error: an unknown provider in the URL is a real request
          // shape (a probe, a misroute) and the receipt for it is the interesting one.
          r.providerCode.slice(0, 60),
          r.eventType?.slice(0, 120) ?? null,
          r.signatureOk ?? null,
          r.reason ?? null,
          JSON.stringify(payload),
          statusFor(r.signatureOk),
          rawBytes,
          truncated,
          r.sourceIp ?? null,
          r.requestId?.slice(0, 64) ?? null,
          r.providerEventId?.slice(0, 150) ?? null,
        ]);
      return { id: String(res.rows[0].id), createdAt: new Date(res.rows[0].created_at).toISOString() };
    } catch (err) {
      this.log.error(`inbound webhook receipt NOT recorded (${r.providerCode}): ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  async settle(
    h: InboundReceiptHandle | null,
    verdict: { signatureOk: boolean; reason: SignatureReason; status?: 'processed' | 'ignored' | 'failed'; error?: string | null },
  ): Promise<void> {
    // A null handle means the receipt itself was never written; there is nothing to settle and nothing to report twice.
    if (!h) return;
    try {
      await this.pools.writer(0).query(
        `UPDATE inbound_webhooks
            SET signature_ok = $2, signature_reason = $3,
                processing_status = $4,
                processed_at = CASE WHEN $4 IN ('processed','ignored','failed') THEN now() ELSE processed_at END,
                error = $5
          WHERE id = $1 AND created_at = $6`,
        [h.id, verdict.signatureOk, verdict.reason, verdict.status ?? statusFor(verdict.signatureOk),
          verdict.error ?? null, h.createdAt]);
    } catch (err) {
      this.log.error(`inbound webhook receipt NOT settled (${h.id}): ${(err as Error)?.message ?? err}`);
    }
  }
}
