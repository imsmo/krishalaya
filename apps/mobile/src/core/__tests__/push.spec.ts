// Unit tests for the pure push logic: quiet-hours math + notification deep-link routing (incl. the security
// guard that a crafted payload can't redirect off-app).
import { hhmmToMinutes, isWithinQuietMinutes, isWithinQuietHours } from '../push/quiet-hours';
import { routeForNotification } from '../push/notification-router';
import { presentNotification, unreadCount } from '../../features/notifications/present';
import type { NotificationItem } from '@krishalaya/sdk-js';

describe('quiet hours', () => {
  it('parses HH:MM', () => { expect(hhmmToMinutes('22:30')).toBe(1350); expect(hhmmToMinutes('bad')).toBeNull(); });
  it('same-day window', () => {
    expect(isWithinQuietMinutes(13 * 60, 12 * 60, 14 * 60)).toBe(true);
    expect(isWithinQuietMinutes(15 * 60, 12 * 60, 14 * 60)).toBe(false);
  });
  it('window wrapping past midnight (22:00–06:00)', () => {
    expect(isWithinQuietMinutes(23 * 60, 22 * 60, 6 * 60)).toBe(true);  // late night
    expect(isWithinQuietMinutes(2 * 60, 22 * 60, 6 * 60)).toBe(true);   // early morning
    expect(isWithinQuietMinutes(12 * 60, 22 * 60, 6 * 60)).toBe(false); // midday
  });
  it('zero-length window is never quiet', () => expect(isWithinQuietMinutes(100, 600, 600)).toBe(false));
  it('isWithinQuietHours fails open on bad input', () => expect(isWithinQuietHours(new Date(), 'x', 'y')).toBe(false));
});

describe('routeForNotification (deep-link security)', () => {
  it('routes by event code prefix', () => {
    expect(routeForNotification({}, 'order.status_changed')).toBe('/(farmer)/orders');
    expect(routeForNotification({}, 'payment.captured')).toBe('/(farmer)/wallet');
    expect(routeForNotification({}, 'listing.published')).toBe('/(farmer)/listings');
    expect(routeForNotification({}, 'kyc.verified')).toBe('/(farmer)/kyc');
    expect(routeForNotification({}, 'something.else')).toBe('/(farmer)/notifications');
  });
  it('honors a safe internal deepLink', () => {
    expect(routeForNotification({ deepLink: '/(farmer)/orders' }, 'x')).toBe('/(farmer)/orders');
  });
  it('REJECTS external/scheme deep links (no off-app redirect)', () => {
    expect(routeForNotification({ deepLink: 'https://evil.example.com' }, 'order.x')).toBe('/(farmer)/orders');
    expect(routeForNotification({ deepLink: '//evil.example.com' }, 'order.x')).toBe('/(farmer)/orders');
    expect(routeForNotification({ deepLink: 'javascript:alert(1)' }, '')).toBe('/(farmer)/notifications');
  });
});

describe('present helpers', () => {
  const n = (over: Partial<NotificationItem>): NotificationItem => ({ id: 'n1', eventCode: 'order.x', channel: 'push', status: 'sent', payload: {}, ...over });
  it('derives title/body/unread from payload', () => {
    const p = presentNotification(n({ payload: { title: 'Order shipped', body: 'On its way' } }));
    expect(p).toMatchObject({ title: 'Order shipped', body: 'On its way', unread: true });
  });
  it('read status → not unread; falls back to eventCode for title', () => {
    const p = presentNotification(n({ status: 'read', payload: {} }));
    expect(p.unread).toBe(false); expect(p.title).toBe('order.x');
  });
  it('counts unread', () => {
    expect(unreadCount([n({ status: 'sent' }), n({ id: 'n2', status: 'read' }), n({ id: 'n3', status: 'delivered' })])).toBe(2);
  });
});
