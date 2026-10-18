// modules/partner-console/__tests__/partner-keys.rules.spec.ts · PC-56 PARTNER-1b · founder D1 / D2 / D3 — the pure rules of the partner's own keys,
// endpoints, deliveries and readiness: the revoke reason's bounds, the permanent revoke transition, the projections that can NEVER carry a
// hash, a secret, a payload or a tenant (for any input), and the readiness facts (an administrator's second factor — never another member's).
import { cleanKeyReason, isDeliveryState, keyReasonOk, keyStatus, KEY_REVOKE_REASON_MAX, KEY_REVOKE_REASON_MIN, projectAttempt, projectDelivery,
  projectEndpoint, projectKey, revokeTransition } from '../domain/partner-keys.rules';
import { administratorsFact, readinessFacts } from '../domain/partner-readiness.rules';

const FORBIDDEN = /^(keyHash|key_hash|secret|secretEnc|secret_enc|secretHash|secret_hash|payload|tenantId|tenant_id|signature|signatures|partnerId|partner_id)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
/** Rows as hostile as a future SQL change could make them: every forbidden column present, in both spellings. */
function hostileRows(n = 40): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`, name: `key ${i}`, key_prefix: `kv_pk_test_${'a'.repeat(12)}${i}`, keyPrefix: 'x',
    key_hash: 'f'.repeat(64), keyHash: 'e'.repeat(64), secret: 's3cr3t', secret_enc: 'v2.cipher', secretEnc: 'v2.cipher', payload: { data: { phone: '+91' } },
    tenant_id: 'tttttttt', tenantId: 'tttttttt', partner_id: 'pppp', signature: 'v1=abc', signatures: 2,
    scopes: i % 2 ? ['lending:book:read'] : 'not-an-array', rate_limit_per_hour: 1000 + i, is_active: i % 3 !== 0, revoked_at: i % 4 === 0 ? '2026-10-18T00:00:00.000Z' : null,
    revoked_reason: i % 4 === 0 ? 'the key leaked into a public repository' : null, last_used_at: null, created_at: '2026-10-01T00:00:00.000Z',
    url: 'https://hooks.example.test/kv', event_types: ['fintech.loan_repaid'], endpoint_id: 'eeee', event_type: 'fintech.loan_repaid', state: 'delivered',
    attempt: 2, status_code: 200, attempt_no: 1, outcome: 'delivered', duration_ms: 120, signed_at: '2026-10-18T00:00:00.000Z',
  }));
}

describe('PC-56 PARTNER-1b · the revoke reason (20–300 after whitespace is collapsed)', () => {
  it('bounds', () => {
    expect([KEY_REVOKE_REASON_MIN, KEY_REVOKE_REASON_MAX]).toEqual([20, 300]);
    expect(keyReasonOk('x'.repeat(19))).toBe(false);
    expect(keyReasonOk('x'.repeat(20))).toBe(true);
    expect(keyReasonOk('x'.repeat(300))).toBe(true);
    expect(keyReasonOk('x'.repeat(301))).toBe(false);
    expect(keyReasonOk('short')).toBe(false);
    expect(keyReasonOk(undefined)).toBe(false);
    expect(keyReasonOk(`   ${'a '.repeat(9)}   `)).toBe(false);                    // 17 characters once collapsed
    expect(cleanKeyReason('  the   key\n leaked  ')).toBe('the key leaked');
  });
});

describe('PC-56 PARTNER-1b · the revoke transition (permanent)', () => {
  it('a key that is not revoked may be revoked; a revoked key is already_revoked whatever is_active says', () => {
    expect(revokeTransition({ revokedAt: null, isActive: true })).toBe('ok');
    expect(revokeTransition({ revokedAt: null, isActive: false })).toBe('ok');
    expect(revokeTransition({ revokedAt: '2026-10-18T00:00:00.000Z', isActive: false })).toBe('already_revoked');
    expect(revokeTransition({ revokedAt: new Date(), isActive: true })).toBe('already_revoked');
    expect(keyStatus({ revokedAt: '2026-10-18T00:00:00.000Z', isActive: true })).toBe('revoked');
    expect(keyStatus({ revokedAt: null, isActive: false })).toBe('inactive');
    expect(keyStatus({ revokedAt: null, isActive: true })).toBe('active');
  });
});

describe('PC-56 PARTNER-1b · the projections never carry a hash, a secret, a payload or a tenant — for ANY input', () => {
  it('keys', () => {
    for (const r of hostileRows()) {
      const v = projectKey(r);
      expect(deepKeys(v).filter((k) => FORBIDDEN.test(k))).toEqual([]);
      expect(Object.keys(v).sort()).toEqual(['createdAt', 'id', 'keyPrefix', 'lastUsedAt', 'name', 'rateLimitPerHour', 'revokedAt', 'revokedReason', 'scopes', 'status'].sort());
      expect(JSON.stringify(v)).not.toMatch(/f{64}|e{64}|s3cr3t|v2\.cipher/);
      expect(Array.isArray(v.scopes)).toBe(true);
    }
    expect(projectKey(hostileRows(1)[0]).status).toBe('revoked');
  });
  it('endpoints, deliveries, attempts', () => {
    for (const r of hostileRows()) {
      for (const v of [projectEndpoint(r), projectDelivery(r), projectAttempt(r)]) {
        expect(deepKeys(v).filter((k) => FORBIDDEN.test(k))).toEqual([]);
        expect(JSON.stringify(v)).not.toMatch(/s3cr3t|v2\.cipher|\+91|tttttttt|v1=abc/);
      }
    }
    expect(Object.keys(projectEndpoint(hostileRows(1)[0])).sort()).toEqual(['active', 'createdAt', 'eventTypes', 'id', 'url']);
    expect(isDeliveryState('delivered')).toBe(true); expect(isDeliveryState('parked')).toBe(false);
  });
});

describe('PC-56 PARTNER-1b · readiness facts (D3)', () => {
  const team = [
    { userId: 'a', roleCode: 'partner_admin', active: true, twoFactor: false },
    { userId: 'v', roleCode: 'partner_viewer', active: true, twoFactor: true },        // a viewer's TOTP is NOT the fact
    { userId: 'r', roleCode: 'partner_admin', active: false, twoFactor: true },        // a removed admin's TOTP is NOT the fact
  ];
  it('an administrator with a second factor counts ACTIVE administrators only', () => {
    expect(administratorsFact(team)).toEqual({ count: 1, withTwoFactor: 0 });
    expect(administratorsFact([...team, { userId: 'b', roleCode: 'partner_admin', active: true, twoFactor: true }])).toEqual({ count: 2, withTwoFactor: 1 });
    expect(administratorsFact([])).toEqual({ count: 0, withTwoFactor: 0 });
  });
  it('the six facts from the inputs, nothing invented', () => {
    const f = readinessFacts({ computedAt: '2026-10-18T03:00:00.000Z', organisationActive: true, team, activeKeys: 2, activeEndpoints: 0, lastDeliveredAt: null, decisionHours: 48 });
    expect(f).toEqual({
      computedAt: '2026-10-18T03:00:00.000Z', organisation: { active: true, ready: true }, administrators: { count: 1, withTwoFactor: 0, ready: false },
      keys: { active: 2, ready: true }, endpoints: { active: 0, ready: false },
      deliveries: { windowDays: 90, deliveredWithinWindow: false, lastDeliveredAt: null, ready: false }, sla: { published: true, decisionHours: 48, ready: true },
    });
  });
});
