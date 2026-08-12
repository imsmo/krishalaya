// apps/web-admin/src/test/adminsweepc1-portal-sync.spec.ts · W077 console logic (PC-56 ADMIN-SWEEP-c1).
import { ackLagText, truthClass } from '../features/schemes/portal-sync';
import { en } from '../i18n/en';

describe('ADMIN-SWEEP-c1 · portal sync console logic', () => {
  it('a measured lag prints WITH its sample size; unmeasured stays unmeasured', () => {
    expect(ackLagText({ kind: 'measured', p50Hours: 4.5, over: 3 })).toEqual({ key: 'measured', hours: '4.5', over: '3' });
    expect(ackLagText({ kind: 'unmeasured', reason: 'r' })).toEqual({ key: 'unmeasured' });
  });
  it('there is no green truth chip — nothing has earned one', () => {
    expect(truthClass('mapped_never_pulled')).toContain('warn');
    expect(truthClass('mapped_never_pulled')).not.toContain('ok');
    expect(truthClass('manual')).not.toContain('ok');
  });
  it('the honesty copy carries its load-bearing words', () => {
    const cat = en as Record<string, string>;
    expect(cat['ps.never']).toContain('no pull job exists');
    expect(cat['ps.noPullWorker']).toContain('absent, not disabled');
    expect(cat['ps.noSyncPermission']).toContain('promise nothing keeps');
    expect(cat['ps.lagUnmeasured']).toContain('invented times');
    expect(cat['ps.syncClaimAppeared']).toContain('data corruption');
    expect(cat['ps.farmerHonesty']).toContain('No false “approved” claim');
  });
});
