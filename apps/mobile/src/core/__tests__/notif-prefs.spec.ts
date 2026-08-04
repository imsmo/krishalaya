// Unit tests for the PURE notification-prefs helpers (features/notifications/notif-prefs, screen 171). No RN deps.
import { groupByEvent, eventCategory, eventIcon, channelIcon, enabledChannels, humanizeCode } from '../../features/notifications/notif-prefs';
import type { NotificationPreference } from '@krishalaya/sdk-js';

const p = (eventCode: string, channel: string, isEnabled: boolean): NotificationPreference => ({ eventCode, channel, isEnabled });

describe('groupByEvent', () => {
  it('groups channels under each event, preserving order', () => {
    const prefs = [p('payment_received', 'push', true), p('payment_received', 'sms', true), p('price_alert', 'sms', false)];
    const g = groupByEvent(prefs);
    expect(g.map((x) => x.eventCode)).toEqual(['payment_received', 'price_alert']);
    expect(g[0].channels).toHaveLength(2);
    expect(g[1].channels).toHaveLength(1);
  });
  it('ignores malformed rows / empty / null', () => {
    expect(groupByEvent([{ channel: 'push', isEnabled: true } as unknown as NotificationPreference])).toEqual([]);
    expect(groupByEvent([])).toEqual([]);
    expect(groupByEvent(null)).toEqual([]);
  });
});

describe('eventCategory', () => {
  it('buckets by keyword, default other', () => {
    expect(eventCategory('payment_received')).toBe('money');
    expect(eventCategory('order_new')).toBe('money');
    expect(eventCategory('delivery_update')).toBe('money');
    expect(eventCategory('price_alert')).toBe('mandi');
    expect(eventCategory('weather_warning')).toBe('mandi');
    expect(eventCategory('crop_tip')).toBe('mandi');
    expect(eventCategory('account_login')).toBe('other');
    expect(eventCategory('')).toBe('other');
  });
});

describe('eventIcon / channelIcon', () => {
  it('maps event codes to glyphs', () => {
    expect(eventIcon('payment_received')).toBe('💰');
    expect(eventIcon('order_new')).toBe('🛒');
    expect(eventIcon('delivery_update')).toBe('📦');
    expect(eventIcon('price_alert')).toBe('📊');
    expect(eventIcon('weather_warning')).toBe('🌧️');
    expect(eventIcon('crop_tip')).toBe('💡');
    expect(eventIcon('unknown')).toBe('🔔');
  });
  it('maps channels to glyphs', () => {
    expect(channelIcon('push')).toBe('📱');
    expect(channelIcon('sms')).toBe('💬');
    expect(channelIcon('email')).toBe('📧');
    expect(channelIcon('whatsapp')).toBe('🔔');
  });
});

describe('enabledChannels', () => {
  it('returns only enabled channel codes', () => {
    expect(enabledChannels([p('e', 'push', true), p('e', 'sms', false), p('e', 'email', true)])).toEqual(['push', 'email']);
    expect(enabledChannels([p('e', 'push', false)])).toEqual([]);
  });
});

describe('humanizeCode', () => {
  it('separates and capitalizes', () => {
    expect(humanizeCode('payment_received')).toBe('Payment received');
    expect(humanizeCode('price.alert')).toBe('Price alert');
    expect(humanizeCode('')).toBe('');
    expect(humanizeCode(null)).toBe('');
  });
});
