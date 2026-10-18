// apps/web-partner/src/features/partner1/webhook-contract.ts · PC-56 PARTNER-1a · founder D4 — THE RAIL'S SIGNING CONTRACT, AS DATA.
//
// The help article "Verifying webhook signatures" prints these values; it never types a figure into a sentence. They are the delivery
// rail's own constants — `apps/api/src/modules/tenant-webhooks/domain/webhook-signature.ts` (byte-identical in apps/worker) and
// `…/webhook-rail.state.ts` — mirrored here because the console cannot import the API's source; `src/test/partner1-webhook-contract.spec.ts`
// reads those two files from disk and turns red the day a value here and there differ. The platform-named header is composed from
// PLATFORM_BRAND (the one brand literal) and the parity spec proves it equals the rail's literal header name.
import { PLATFORM_BRAND } from '@krishalaya/tokens';

export const WEBHOOK_CONTRACT = Object.freeze({
  signatureHeader: `${PLATFORM_BRAND.name}-Signature`,
  legacySignatureHeader: 'X-KV-Signature',
  /** `t=<unix seconds>,v1=<hex>` — the header's shape (rail: `signatureHeader`). */
  headerFormat: 't=…,v1=…',
  algorithm: 'HMAC-SHA256',
  /** What is signed: the send time, a dot, the raw request body (rail: `${timestampSec}.${body}`). */
  signedString: '{t}.{raw body}',
  toleranceSec: 300,
  retryLadderLabels: ['1m', '5m', '30m', '2h', '12h'] as readonly string[],
  retryLadderSeconds: [60, 300, 1800, 7200, 43200] as readonly number[],
  maxAttempts: 6,
  rotationOverlapHours: 24,
  sendTimeoutSec: 10,
  /** PC-56 PARTNER-1b · the webhooks page's contract block: how much of a response the sender reads, and how long deliveries are kept. */
  responseBodyCapBytes: 65536,
  retentionDays: 90,
  /** The rail's delivery states (rail: `DELIVERY_STATES`) — the deliveries filter and the state words. */
  deliveryStates: ['pending', 'retrying', 'delivered', 'held', 'exhausted', 'cancelled'] as readonly string[],
});

/** PC-56 PARTNER-1b · the events a partner endpoint may subscribe to — 0090's allow-list (`partner-api/domain/partner-webhook.rules.ts`
 *  `PARTNER_WEBHOOK_EVENTS`, pinned by the parity spec). Never an application or a consent event. */
export const PARTNER_WEBHOOK_EVENT_TYPES: readonly string[] = Object.freeze([
  'fintech.loan_disbursed', 'fintech.loan_repaid', 'fintech.loan_closed',
  'insurance.policy_activated', 'insurance.policy_cancelled', 'insurance.policy_claimed',
  'insurance.claim_filed', 'insurance.claim_surveyed', 'insurance.claim_decided', 'insurance.claim_settled', 'insurance.claim_closed',
]);
