import * as hub from '../features/comms/hub';
import { buildBroadcast } from '../features/comms/hub';

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

  // [PC-56 TENANT-8a] The inert template builder is gone: a tenant override is a reviewed draft now (/content/templates).
  it('no longer builds a template (the upsert never sent — F-1)', () => {
    expect((hub as Record<string, unknown>).buildTemplate).toBeUndefined();
    expect((hub as Record<string, unknown>).NOTIF_CHANNELS).toBeUndefined();
  });
});
