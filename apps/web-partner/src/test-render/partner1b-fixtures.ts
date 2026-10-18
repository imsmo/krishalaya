// apps/web-partner/src/test-render/partner1b-fixtures.ts · PC-56 PARTNER-1b — the render tests' fixtures, shaped as the API answers them: the
// partner's keys (one active, one revoked with a reason, one inactive), endpoints, a deliveries page, one delivery with its attempts, the
// readiness facts. Neutral names only; no person's name; no hash, no secret, no payload anywhere (the types have no such field).
import type { PartnerDeliveriesPage, PartnerDeliveryDetail, PartnerKey, PartnerReadiness, PartnerWebhookEndpoint } from '@krishalaya/sdk-js';

export const KEYS: PartnerKey[] = [
  { id: '0192d2c4-aaaa-7000-8000-000000000001', name: 'Core lending integration', keyPrefix: 'kv_pk_live_a1b2c3d4e5f60718', scopes: ['partner:identity:read', 'lending:book:read'],
    rateLimitPerHour: 1000, status: 'active', lastUsedAt: '2026-10-17T10:00:00.000Z', revokedAt: null, revokedReason: null, createdAt: '2026-09-01T05:00:00.000Z' },
  { id: '0192d2c4-aaaa-7000-8000-000000000002', name: 'Old reporting job', keyPrefix: 'kv_pk_test_0f1e2d3c4b5a6978', scopes: ['partner:identity:read'],
    rateLimitPerHour: 200, status: 'revoked', lastUsedAt: null, revokedAt: '2026-10-18T06:30:00.000Z', revokedReason: 'the job was retired and its key is no longer needed', createdAt: '2026-08-01T05:00:00.000Z' },
  { id: '0192d2c4-aaaa-7000-8000-000000000003', name: 'Paused integration', keyPrefix: 'kv_pk_live_99887766554433aa', scopes: ['insurance:book:read'],
    rateLimitPerHour: 500, status: 'inactive', lastUsedAt: null, revokedAt: null, revokedReason: null, createdAt: '2026-07-01T05:00:00.000Z' },
];
export const ENDPOINTS: PartnerWebhookEndpoint[] = [
  { id: '0192d2c4-eeee-7000-8000-000000000001', url: 'https://hooks.fixture.test/kv', eventTypes: ['fintech.loan_repaid', 'fintech.loan_disbursed'], active: true, createdAt: '2026-09-02T05:00:00.000Z' },
  { id: '0192d2c4-eeee-7000-8000-000000000002', url: 'https://backup.fixture.test/kv', eventTypes: ['fintech.loan_closed'], active: false, createdAt: '2026-09-03T05:00:00.000Z' },
];
export const DELIVERIES: PartnerDeliveriesPage = {
  items: [
    { id: '0192d2c4-dddd-7000-8000-000000000001', endpointId: ENDPOINTS[0].id, eventType: 'fintech.loan_repaid', state: 'delivered', attempts: 2, lastStatusCode: 200, lastError: null,
      createdAt: '2026-10-18T06:00:00.000Z', lastAttemptAt: '2026-10-18T06:01:00.000Z', deliveredAt: '2026-10-18T06:01:00.000Z', replayCount: 0 },
    { id: '0192d2c4-dddd-7000-8000-000000000002', endpointId: ENDPOINTS[0].id, eventType: 'fintech.loan_disbursed', state: 'exhausted', attempts: 6, lastStatusCode: 503, lastError: 'http 503',
      createdAt: '2026-10-17T06:00:00.000Z', lastAttemptAt: '2026-10-17T20:00:00.000Z', deliveredAt: null, replayCount: 0 },
  ],
  nextCursor: 'MjAyNi0xMC0xN1QwNjowMDowMC4wMDAwMDBafDAxOTI', limit: 25, retentionDays: 90, computedAt: '2026-10-18T06:30:00.000Z',
};
export const DELIVERY: PartnerDeliveryDetail = { ...DELIVERIES.items[0], attemptsList: [
  { attemptNo: 1, outcome: 'failed', statusCode: 503, durationMs: 120, error: 'http 503', signedAt: '2026-10-18T06:00:01.000Z', createdAt: '2026-10-18T06:00:01.000Z' },
  { attemptNo: 2, outcome: 'delivered', statusCode: 200, durationMs: 85, error: null, signedAt: '2026-10-18T06:01:00.000Z', createdAt: '2026-10-18T06:01:00.000Z' },
] };
export const READY: PartnerReadiness = {
  computedAt: '2026-10-18T06:30:00.000Z', organisation: { active: true, ready: true }, administrators: { count: 2, withTwoFactor: 1, ready: true },
  keys: { active: 1, ready: true }, endpoints: { active: 1, ready: true },
  deliveries: { windowDays: 90, deliveredWithinWindow: true, lastDeliveredAt: '2026-10-18T06:01:00.000Z', ready: true }, sla: { published: false, decisionHours: null, ready: false },
};
export const NOT_READY: PartnerReadiness = {
  ...READY, administrators: { count: 1, withTwoFactor: 0, ready: false }, keys: { active: 0, ready: false }, endpoints: { active: 0, ready: false },
  deliveries: { windowDays: 90, deliveredWithinWindow: false, lastDeliveredAt: null, ready: false },
};
export const EVENTS = ['fintech.loan_disbursed', 'fintech.loan_repaid', 'fintech.loan_closed', 'insurance.policy_activated'];
/** Words that must never appear on a 1b page (the canon's false claims and its people). "plan settings" is not here: 1a's refusal names it to
 *  refuse it (W267 / W268's flagged-off "See plan settings"); the claims guard keeps it out of every 1b catalogue scope. */
export const FALSE_1B = /penny|IFSC|₹\s*1\b|cheque|video call|\bRBI\b|\bDIN\b|e-sign|countersign|sandbox|emailed|status page|\bAmit\b|Jayesh|Saurashtra|sgbank|whsec|kv_live_|hash-only|self-service/i;
