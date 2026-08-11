// core/webhooks/inbound-webhook.recorder.ts · the receipt every public sink was missing (PC-56 ADMIN-11c).
//
// **FOUR UNAUTHENTICATED PUBLIC ENDPOINTS VERIFY A SIGNATURE AND THROW THE BYTES AWAY.** `inbound_webhooks` was created
// in migration 0015 and `grep -rln "inbound_webhooks" apps packages --include=*.ts` returned nothing — not a reader, not
// a writer, not a test. Meanwhile W106 states as a property of the platform: "Raw payloads stored pre-processing
// (inbound_webhooks, partitioned) — replayable, audit-grade. Failed signatures are ignored, never processed."
//
// The consequences, in the order they will bite:
//
//   • **A REJECTED SIGNATURE LEFT NO TRACE AT ALL.** The one event that most needs a record — somebody signing with the
//     wrong secret, or forging — was the one event this platform could not see afterwards. W106's own diagnosis, "all
//     from one stale Gupshup secret", requires exactly the rows nobody wrote.
//   • **AN ACCEPTED PAYMENT CALLBACK LEFT ONLY ITS EFFECT.** When a gateway says "we told you at 15:03" and this
//     platform has no capture, there is nothing to compare — a money dispute with no evidence on our side.
//   • Nothing was replayable, so a processing bug lost events rather than deferring them.
//
// **RECORD FIRST, THEN VERIFY, THEN PROCESS.** The order is the whole point: a receipt written after verification can
// only ever describe successes.

/** What the caller knows before it has decided anything. */
export interface InboundReceipt {
  providerCode: string;
  eventType?: string | null;
  /** null = not yet decided (a receipt written before verification), true/false = the verdict. */
  signatureOk?: boolean | null;
  reason?: SignatureReason | null;
  raw: string;
  sourceIp?: string | null;
  requestId?: string | null;
  providerEventId?: string | null;
}

/**
 * Why a signature verdict came out the way it did. **THREE FAILURE REASONS THAT LOOK THE SAME AND ARE NOT**: a caller
 * sending no signature header is usually misconfigured, a mismatch is a stale secret or a forgery, and an unconfigured
 * secret on OUR side is our own outage wearing a security error's clothes. Collapsing them into `signature_ok = false`
 * is what made W106's "all from one stale secret" undiagnosable.
 */
export type SignatureReason = 'ok' | 'absent' | 'mismatch' | 'secret_unconfigured' | 'unsupported_provider' | 'unparseable';

/**
 * **AN UNAUTHENTICATED SINK IS AN UNBOUNDED WRITE PATH.** Recording rejected payloads is precisely what this module is
 * for, and it is also how a stranger fills a partitioned table with 10 MB bodies. So the stored payload is capped and
 * the row says whether it is complete: a truncated row is honest about being partial, where a silently short one would
 * be the worst of both — useless for replay and misleading as evidence.
 *
 * 64 KB is chosen against the real payloads: a Razorpay `payment.captured` is ~2 KB, a delivery callback a few hundred
 * bytes. Anything past this is not a provider callback that got long.
 */
export const MAX_STORED_BYTES = 64 * 1024;

export interface StoredPayload { payload: unknown; rawBytes: number; truncated: boolean }

/**
 * Prepare the payload for storage. Parses where it can, and **stores the raw text when it cannot** — because a body
 * that does not parse is exactly the body a reviewer will want to look at, and `jsonb` cannot hold it as-is.
 */
export function preparePayload(raw: string): StoredPayload {
  const rawBytes = Buffer.byteLength(raw, 'utf8');
  if (rawBytes > MAX_STORED_BYTES) {
    return {
      payload: { _truncated: true, _rawBytes: rawBytes, _head: raw.slice(0, 2_000) },
      rawBytes,
      truncated: true,
    };
  }
  try {
    return { payload: JSON.parse(raw), rawBytes, truncated: false };
  } catch {
    // Unparseable is a finding, not an error: it is what a probe or a misrouted caller looks like.
    return { payload: { _unparseable: true, _raw: raw.slice(0, 2_000) }, rawBytes, truncated: false };
  }
}

/** Map a verdict to the processing status W106 renders. **A FAILED SIGNATURE IS `ignored`, NEVER `failed`** — "failed"
 *  says the platform tried and could not, and what happened is that the platform declined. The distinction is the
 *  difference between an incident and a defence working. */
export function statusFor(signatureOk: boolean | null | undefined): 'received' | 'ignored' {
  return signatureOk === false ? 'ignored' : 'received';
}

/**
 * A written receipt. **THE TIMESTAMP TRAVELS WITH THE ID BECAUSE THE TABLE IS PARTITIONED BY IT** — Law 8's
 * partition-key-first rule. `WHERE id = $1` alone would make every settle scan every monthly partition, which is the
 * kind of query that is invisible in a demo and pages somebody in year three.
 */
export interface InboundReceiptHandle { id: string; createdAt: string }

/** The port. A controller records through this and never learns which table or pool is behind it. */
export interface InboundWebhookSink {
  /** Returns the handle where a receipt was written, or null where recording failed. Never throws. */
  record(r: InboundReceipt): Promise<InboundReceiptHandle | null>;
  /** Attach the verdict and outcome to a receipt already written. Never throws. */
  settle(h: InboundReceiptHandle | null, verdict: { signatureOk: boolean; reason: SignatureReason; status?: 'processed' | 'ignored' | 'failed'; error?: string | null }): Promise<void>;
}

export const INBOUND_WEBHOOK_SINK = Symbol('INBOUND_WEBHOOK_SINK');
