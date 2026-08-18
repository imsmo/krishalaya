// apps/web-admin/src/test/adminsweepb3-emergency.spec.ts · W058 console logic (PC-56 ADMIN-SWEEP-b3).
import { categoryTone, stepTone, stepNeedsDetail, buildStep, STEP_DETAIL_MIN } from '../features/support/emergency';
import { en } from '../i18n/en';

describe('ADMIN-SWEEP-b3 · emergency desk console logic', () => {
  it('women_safety carries the heaviest chip; a provider_pending step never prints as done', () => {
    // women_safety maps to 'danger' — a real fix of a dead-CSS bug: the prior 'kv-status--err' literal had no rule
    // anywhere in globals.css, so this row rendered with NO colour at all until this conversion.
    expect(categoryTone('women_safety')).toBe('danger');
    expect(categoryTone('emergency_vet')).toBe('warning');
    expect(stepTone('recorded')).toBe('success');
    expect(stepTone('provider_pending')).toBe('warning');
    expect(stepTone('provider_pending')).not.toBe('success');
  });
  it('would_page steps take NO detail field — the truth is composed server-side, not typed', () => {
    expect(stepNeedsDetail('would_page')).toBe(false);
    expect(stepNeedsDetail('human')).toBe(true);
    const b = buildStep({ stepCode: 'page_vet', kind: 'would_page', detail: '' });
    expect(b).toEqual({ ok: true, value: { stepCode: 'page_vet' } });
  });
  it('a human step refuses a thin detail at the shared floor', () => {
    expect(STEP_DETAIL_MIN).toBe(20);
    expect(buildStep({ stepCode: 'vet_contacted', kind: 'human', detail: 'called' })).toEqual({ ok: false, error: 'detail' });
    const ok = buildStep({ stepCode: 'vet_contacted', kind: 'human', detail: ' Dr Mehta reached at 09:12, en route ', vetProfileId: ' v1 ' });
    expect(ok).toEqual({ ok: true, value: { stepCode: 'vet_contacted', detail: 'Dr Mehta reached at 09:12, en route', vetProfileId: 'v1' } });
  });
  it('the honesty copy carries its load-bearing words', () => {
    const cat = en as Record<string, string>;
    expect(cat['em.pagingHonesty']).toContain('provider_pending');
    expect(cat['em.pageVetTruth']).toContain('NOTHING is sent');
    expect(cat['em.vetsHonesty']).toContain('NOT by distance');
    expect(cat['em.threadHonesty']).toContain('including the platform owner');
    expect(cat['em.staffingHonesty']).toContain('not claimed');
    expect(cat['em.ok.stepPending']).toContain('Nothing was sent');
  });
});
