// apps/web-admin/src/test/adminsweepb2-hub.spec.ts · W050 console logic (PC-56 ADMIN-SWEEP-b2).
import { slaText, slaClass, channelChip, presenceAction, takeNextBlockedKey, buildPresence } from '../features/support/hub';
import { en } from '../i18n/en';

describe('ADMIN-SWEEP-b2 · hub console logic', () => {
  it('a support clock reads in minutes under an hour, hours after, and breach is OVER never LEFT', () => {
    expect(slaText({ kind: 'due', inMinutes: 45 })).toEqual({ key: 'due', amount: '45m' });
    expect(slaText({ kind: 'due', inMinutes: 130 })).toEqual({ key: 'due', amount: '2h' });
    expect(slaText({ kind: 'breached', overMinutes: 12 })).toEqual({ key: 'over', amount: '12m' });
    expect(slaText({ kind: 'unset' })).toEqual({ key: 'unset', amount: '' });
    expect(slaClass({ kind: 'breached', overMinutes: 1 })).toContain('err');
    expect(slaClass({ kind: 'due', inMinutes: 30 })).toContain('warn');
    expect(slaClass({ kind: 'unset' })).not.toContain('ok');   // no clock ≠ on time
  });
  it('a non-carried channel chip is always marked declared — the platform did not carry that message', () => {
    expect(channelChip({ channel: 'app', standing: 'carried' })).toEqual({ label: 'app', declared: false });
    expect(channelChip({ channel: 'whatsapp', standing: 'declared' })).toEqual({ label: 'whatsapp', declared: true });
  });
  it('the presence button offers only the real transition', () => {
    expect(presenceAction('available')).toEqual({ to: 'break', key: 'takeBreak' });
    expect(presenceAction('break')).toEqual({ to: 'available', key: 'imBack' });
  });
  it('each nothing has its own sentence: on-break beats inbox-zero (it is about YOU, not the queue)', () => {
    expect(takeNextBlockedKey({ presence: 'break', unclaimed: 5 })).toBe('onBreak');
    expect(takeNextBlockedKey({ presence: 'break', unclaimed: 0 })).toBe('onBreak');
    expect(takeNextBlockedKey({ presence: 'available', unclaimed: 0 })).toBe('inboxZero');
    expect(takeNextBlockedKey({ presence: 'available', unclaimed: 3 })).toBeNull();
  });
  it('buildPresence admits only the two real states', () => {
    expect(buildPresence({ status: 'break' })).toEqual({ ok: true, value: { status: 'break' } });
    expect(buildPresence({ status: 'busy' })).toEqual({ ok: false, error: 'status' });
  });
  it('the honesty copy carries its load-bearing words', () => {
    const cat = en as Record<string, string>;
    for (const k of ['hub.identityDoctrine', 'hub.channelsHonesty', 'hub.routingHonesty']) expect(cat[k]).toBeTruthy();
    expect(cat['hub.channelsHonesty']).toContain('DECLARED');           // channels beyond in-app are not verified
    expect(cat['hub.routingHonesty']).toContain('pull-based');          // no routing engine is claimed
    expect(cat['hub.identityDoctrine']).toContain('no phone input');    // the cross-tenant sweep stays refused
    for (const k of ['onBreak', 'inboxZero']) expect(cat[`hub.blocked.${k}`]).toBeTruthy();
  });
});
