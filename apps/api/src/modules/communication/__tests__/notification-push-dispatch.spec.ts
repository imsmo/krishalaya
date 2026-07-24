// modules/communication/__tests__/notification-push-dispatch.spec.ts · the PUSH delivery branch (P0-10).
// Exercises NotificationService.deliverPush in isolation (only the deps it touches are faked): resolve the
// recipient's active device tokens → send via PUSH_SENDER → mark the notification sent/failed → deactivate
// any DeviceNotRegistered tokens. No DB, no network.
import { NotificationService } from '../services/notification.service';
import { Notification } from '../domain/notification.entity';

const makeNotif = () => Notification.queue({
  id: '00000000-0000-8000-8000-000000000001', tenantId: 't1', userId: 'u1', eventCode: 'order.shipped',
  channel: 'push', templateId: null, languageCode: 'en', payload: { orderId: 'o1' },
});

function build(opts: { tokens?: { token: string; platform: string }[]; sendResult?: any }) {
  const deactivated: string[] = [];
  const devices = {
    activeTokensForUser: jest.fn(async () => opts.tokens ?? []),
    deactivate: jest.fn(async (_tx: any, _userId: string, token: string) => { deactivated.push(token); return 1; }),
  };
  const pushSender = { providerCode: 'fake', send: jest.fn(async () => opts.sendResult ?? { sent: 1, invalidTokens: [] }) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  // only deliverPush is exercised → the other ctor deps are never touched
  const svc = new NotificationService(
    undefined as any, undefined as any, metrics as any, undefined as any, pushSender as any, devices as any,
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
  );
  return { svc, devices, pushSender, deactivated };
}

const TX = {} as any;
const ARG = { tenantId: 't1', userId: 'u1', event: 'order.shipped', payload: { orderId: 'o1' } };

describe('NotificationService.deliverPush', () => {
  it('sends to the recipient\'s active tokens and marks sent', async () => {
    const { svc, pushSender } = build({ tokens: [{ token: 'tokA', platform: 'android' }, { token: 'tokB', platform: 'ios' }] });
    const n = makeNotif();
    await (svc as any).deliverPush(TX, ARG, n, { subject: 'Shipped', body: 'Your order is on the way' });
    expect(n.status).toBe('sent');
    expect(pushSender.send).toHaveBeenCalledTimes(1);
    const msg = (pushSender.send.mock.calls[0] as any[])[0];
    expect(msg.tokens).toEqual(['tokA', 'tokB']);
    expect(msg.data).toMatchObject({ orderId: 'o1', eventCode: 'order.shipped' });   // deep-link payload rides along
  });

  it('marks no_device (failed) when the user has no registered device', async () => {
    const { svc, pushSender } = build({ tokens: [] });
    const n = makeNotif();
    await (svc as any).deliverPush(TX, ARG, n, { subject: null, body: 'b' });
    expect(n.status).toBe('failed');
    expect(pushSender.send).not.toHaveBeenCalled();
  });

  it('deactivates DeviceNotRegistered tokens (hygiene) and still marks sent if any delivered', async () => {
    const { svc, deactivated } = build({
      tokens: [{ token: 'good', platform: 'android' }, { token: 'dead', platform: 'ios' }],
      sendResult: { sent: 1, invalidTokens: ['dead'] },
    });
    const n = makeNotif();
    await (svc as any).deliverPush(TX, ARG, n, { subject: 's', body: 'b' });
    expect(deactivated).toEqual(['dead']);
    expect(n.status).toBe('sent');
  });

  it('marks failed when the provider delivered nothing (degraded)', async () => {
    const { svc } = build({ tokens: [{ token: 'tokA', platform: 'android' }], sendResult: { sent: 0, invalidTokens: [], failureReason: 'push_unavailable' } });
    const n = makeNotif();
    await (svc as any).deliverPush(TX, ARG, n, { subject: 's', body: 'b' });
    expect(n.status).toBe('failed');
  });
});
