// Unit tests for the PURE notification presenters (screen 28).
import { groupByDay, internalDeepLink, presentNotification } from '../../features/notifications/present';
import type { NotificationItem } from '@krishalaya/sdk-js';

const n = (id: string, createdAt?: string, payload: Record<string, unknown> = {}): NotificationItem => ({
  id, eventCode: 'order.shipped', channel: 'inbox', status: 'delivered', payload, createdAt,
});

describe('notifications (screen 28)', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  it('groupByDay buckets today / yesterday / earlier, preserving order', () => {
    const items = [n('a', '2026-08-18T09:00:00Z'), n('b', '2026-08-17T16:32:00Z'), n('c', '2026-08-10T10:00:00Z'), n('d')];
    const g = groupByDay(items, now);
    expect(g.map((s) => s.key)).toEqual(['today', 'yesterday', 'earlier']);
    expect(g[0].items.map((x) => x.id)).toEqual(['a']);
    expect(g[2].items.map((x) => x.id)).toEqual(['c', 'd']); // undated → earlier
  });
  it('internalDeepLink accepts in-app paths, rejects external', () => {
    expect(internalDeepLink('/(buyer)/orders/1')).toBe('/(buyer)/orders/1');
    expect(internalDeepLink('https://evil.example')).toBeNull();
    expect(internalDeepLink('//evil')).toBeNull();
    expect(internalDeepLink(123)).toBeNull();
  });
  it('presentNotification reads server payload defensively', () => {
    const p = presentNotification(n('x', undefined, { title: 'On the way', body: 'out for delivery', ref: 'Order #KV-0142', deepLink: '/(buyer)/orders/1' }));
    expect(p).toMatchObject({ title: 'On the way', body: 'out for delivery', ref: 'Order #KV-0142', deepLink: '/(buyer)/orders/1', unread: true });
  });
});
