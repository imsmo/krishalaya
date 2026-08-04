import { buildBroadcast, buildTemplate, NOTIF_CHANNELS } from '../features/comms/hub';

describe('features/comms/hub (PC-27)', () => {
  it('broadcast: title ≤160, body ≤2000, role optional (blank dropped)', () => {
    expect(buildBroadcast({ title: ' Mandi day ', body: 'Bring your produce by 7am.', audienceRoleCode: '' }))
      .toEqual({ ok: true, value: { title: 'Mandi day', body: 'Bring your produce by 7am.' } });
    expect(buildBroadcast({ title: 'x', body: 'y', audienceRoleCode: ' farmer ' }))
      .toEqual({ ok: true, value: { title: 'x', body: 'y', audienceRoleCode: 'farmer' } });
    expect(buildBroadcast({ title: '', body: 'y', audienceRoleCode: '' })).toEqual({ ok: false, error: 'title' });
    expect(buildBroadcast({ title: 'x'.repeat(161), body: 'y', audienceRoleCode: '' })).toEqual({ ok: false, error: 'title' });
    expect(buildBroadcast({ title: 'x', body: '', audienceRoleCode: '' })).toEqual({ ok: false, error: 'body' });
  });

  it('template: event/channel/lang/body rules; subject optional', () => {
    expect(buildTemplate({ eventCode: 'order.confirmed', channel: 'whatsapp', languageCode: 'hi', subject: '', body: 'आपका ऑर्डर {orderNo} पक्का हुआ।', isActive: true }).ok).toBe(true);
    expect(buildTemplate({ eventCode: '', channel: 'whatsapp', languageCode: 'hi', subject: '', body: 'x', isActive: true })).toEqual({ ok: false, error: 'event' });
    expect(buildTemplate({ eventCode: 'e', channel: 'fax', languageCode: 'hi', subject: '', body: 'x', isActive: true })).toEqual({ ok: false, error: 'channel' });
    expect(buildTemplate({ eventCode: 'e', channel: 'sms', languageCode: 'HINDI', subject: '', body: 'x', isActive: true })).toEqual({ ok: false, error: 'lang' });
    expect(buildTemplate({ eventCode: 'e', channel: 'sms', languageCode: 'gu', subject: '', body: '', isActive: false })).toEqual({ ok: false, error: 'body' });
    expect(NOTIF_CHANNELS).toContain('whatsapp');
  });
});
