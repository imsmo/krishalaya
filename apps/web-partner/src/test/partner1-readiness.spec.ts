// apps/web-partner/src/test/partner1-readiness.spec.ts · PC-56 PARTNER-1b · founder D3 — the readiness page's six-fact model: one row per fact, in
// order, its words chosen by ready / not ready, the figures it carries; nothing invented, nothing ticked.
import type { PartnerReadiness } from '@krishalaya/sdk-js';
import { READINESS_FACTS, readinessRows, readyCount } from '../features/partner1/readiness';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const R: PartnerReadiness = {
  computedAt: '2026-10-18T06:30:00.000Z', organisation: { active: true, ready: true }, administrators: { count: 2, withTwoFactor: 1, ready: true },
  keys: { active: 0, ready: false }, endpoints: { active: 1, ready: true },
  deliveries: { windowDays: 90, deliveredWithinWindow: false, lastDeliveredAt: null, ready: false }, sla: { published: true, decisionHours: 48, ready: true },
};

describe('PC-56 PARTNER-1b · readiness (pure)', () => {
  it('six rows in the page\'s order, each from its own fact', () => {
    const rows = readinessRows(R);
    expect(rows.map((r) => r.id)).toEqual([...READINESS_FACTS]);
    expect(rows.map((r) => [r.id, r.ready, r.key])).toEqual([
      ['organisation', true, 'partner1.readiness.organisation.yes'], ['administrators', true, 'partner1.readiness.administrators.yes'],
      ['keys', false, 'partner1.readiness.keys.no'], ['endpoints', true, 'partner1.readiness.endpoints.yes'],
      ['deliveries', false, 'partner1.readiness.deliveries.no'], ['sla', true, 'partner1.readiness.sla.yes'],
    ]);
    expect(rows[1].vars).toEqual({ count: 2, withTwoFactor: 1 });
    expect(rows[5].vars).toEqual({ hours: 48 });
    expect(readyCount(rows)).toBe(4);
  });
  it('an administrator without a second factor is NOT ready; every row\'s words exist ×3', () => {
    const rows = readinessRows({ ...R, administrators: { count: 1, withTwoFactor: 0, ready: false } });
    expect(rows[1]).toMatchObject({ ready: false, key: 'partner1.readiness.administrators.no' });
    for (const id of READINESS_FACTS) for (const yn of ['yes', 'no']) {
      const k = `partner1.readiness.${id}.${yn}`;
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
    }
  });
});
