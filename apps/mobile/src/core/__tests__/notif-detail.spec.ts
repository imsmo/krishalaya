// Unit tests for the PURE notification-detail helpers (features/notifications/notif-detail, screen 172). No RN deps.
import { moneyMinorOf, presentNotificationDetail, notifActions } from '../../features/notifications/notif-detail';
import type { NotificationItem } from '@krishalaya/sdk-js';

const n = (eventCode: string, payload: Record<string, unknown>, status = 'sent'): NotificationItem =>
  ({ id: 'x', eventCode, channel: 'push', status, payload, createdAt: '2026-08-22T06:12:00.000Z' });

describe('moneyMinorOf', () => {
  it('accepts integer strings/numbers, rejects floats & junk', () => {
    expect(moneyMinorOf('1440000')).toBe('1440000');
    expect(moneyMinorOf('-36000')).toBe('-36000');
    expect(moneyMinorOf(1440000)).toBe('1440000');
    expect(moneyMinorOf('1440.00')).toBeNull();   // float → rejected (Law 2)
    expect(moneyMinorOf(14.4)).toBeNull();
    expect(moneyMinorOf('abc')).toBeNull();
    expect(moneyMinorOf(undefined)).toBeNull();
  });
});

describe('presentNotificationDetail', () => {
  it('extracts title/body/hero/money-rows/info-rows from a rich payment payload', () => {
    const v = presentNotificationDetail(n('payment_received', {
      title: 'Payment received!', body: 'Wheat sale settled',
      amountMinor: '1440000', saleAmountMinor: '1440000', feeMinor: '36000', creditedMinor: '1404000',
      from: 'Mehta Trading Co.', orderNo: '#KV-2026-0247', item: '5 quintal Wheat (Lokwan)', buyer: 'Mehta Trading',
      deepLink: '/orders/247',
    }));
    expect(v.icon).toBe('💰');
    expect(v.category).toBe('money');
    expect(v.title).toBe('Payment received!');
    expect(v.heroMinor).toBe('1440000');
    expect(v.moneyRows.map((r) => [r.labelKey, r.minor, r.negative])).toEqual([
      ['notifDetail.row.saleAmount', '1440000', false],
      ['notifDetail.row.fee', '36000', true],
      ['notifDetail.row.credited', '1404000', false],
    ]);
    expect(v.infoRows.map((r) => r.labelKey)).toEqual([
      'notifDetail.row.from', 'notifDetail.row.order', 'notifDetail.row.item', 'notifDetail.row.buyer',
    ]);
    expect(v.deepLink).toBe('/orders/247');
  });

  it('degrades to just title/body when the template carries no structured fields (§13, never fake)', () => {
    const v = presentNotificationDetail(n('price_alert', { title: 'Wheat price up', body: '+3% today' }));
    expect(v.title).toBe('Wheat price up');
    expect(v.heroMinor).toBeNull();
    expect(v.moneyRows).toEqual([]);
    expect(v.infoRows).toEqual([]);
    expect(v.category).toBe('mandi');
  });

  it('rejects an external deep link (§4 guard) and falls back to eventCode title', () => {
    const v = presentNotificationDetail(n('order_update', { link: 'https://evil.example/x' }));
    expect(v.deepLink).toBeNull();
    expect(v.title).toBe('order_update');
  });
});

describe('notifActions', () => {
  it('money event with deep link → view + wallet(outline) + withdraw', () => {
    const v = presentNotificationDetail(n('payment_received', { deepLink: '/orders/1', amountMinor: '100' }));
    const a = notifActions(v);
    expect(a.map((x) => [x.key, x.variant, x.href])).toEqual([
      ['deep', 'primary', '/orders/1'],
      ['wallet', 'outline', '/(farmer)/wallet'],
      ['withdraw', 'ghost', '/(farmer)/wallet/withdraw'],
    ]);
  });
  it('money event without deep link → wallet becomes primary', () => {
    const v = presentNotificationDetail(n('wallet_credit', { amountMinor: '100' }));
    const a = notifActions(v);
    expect(a.map((x) => x.key)).toEqual(['wallet', 'withdraw']);
    expect(a[0].variant).toBe('primary');
  });
  it('non-money event → only the deep-link action (or none)', () => {
    expect(notifActions(presentNotificationDetail(n('price_alert', { deepLink: '/mandi/1' }))).map((x) => x.key)).toEqual(['deep']);
    expect(notifActions(presentNotificationDetail(n('price_alert', {})))).toEqual([]);
  });
});
