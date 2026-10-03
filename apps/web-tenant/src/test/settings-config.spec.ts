// apps/web-tenant/src/test/settings-config.spec.ts · unit tests for the tenant self-config validators/presenters
// (commission / delivery-zones / branding / languages). These are the first gate before the audited, RBAC-gated
// SDK call — the API re-validates. Money stays a string; bps presentation is float-safe display only.
import {
  buildCommissionRule, formatBps, buildDeliveryZone, buildBranding, buildLanguages, settingString, settingList,
} from '../features/settings/config';

describe('buildCommissionRule', () => {
  it('accepts valid bps + keeps fixedMinor a string', () => {
    const r = buildCommissionRule({ rateBps: '250', platformShareBps: '100', fixedMinor: '5000', source: 'auction' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.rateBps).toBe(250); expect(r.value.fixedMinor).toBe('5000'); expect(r.value.source).toBe('auction'); expect(r.value.chargedTo).toBe('seller'); }
  });
  it('defaults fixedMinor to "0" and priority to 100', () => {
    const r = buildCommissionRule({ rateBps: 0, platformShareBps: 0 });
    expect(r.ok && r.value.fixedMinor).toBe('0');
    expect(r.ok && r.value.priority).toBe(100);
  });
  it('rejects out-of-range / non-integer / bad source / non-digit money', () => {
    expect(buildCommissionRule({ rateBps: 200001, platformShareBps: 0 }).ok).toBe(false);
    expect(buildCommissionRule({ rateBps: 'x', platformShareBps: 0 }).ok).toBe(false);
  });
  it('PC-56 TENANT-SW-a (F-3): carries NO platform share — the plan sets it; a typed one is ignored, never sent', () => {
    const r = buildCommissionRule({ rateBps: 1, platformShareBps: -1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect('platformShareBps' in r.value).toBe(false);
  });
  it('still rejects non-digit money and a bad source', () => {
    expect(buildCommissionRule({ rateBps: 1, fixedMinor: '1.5' }).ok).toBe(false);
    expect(buildCommissionRule({ rateBps: 1, source: 'bogus' }).ok).toBe(false);
  });
});

describe('formatBps', () => {
  it('renders percent without trailing zeros', () => {
    expect(formatBps(250)).toBe('2.5%');
    expect(formatBps(100)).toBe('1%');
    expect(formatBps(125)).toBe('1.25%');
    expect(formatBps(0)).toBe('0%');
  });
});

describe('buildDeliveryZone', () => {
  it('parses + dedups pincodes from free text', () => {
    const r = buildDeliveryZone({ defaultName: 'Pune', pincodes: '411001, 411002\n411001 411004' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pincodes).toEqual(['411001', '411002', '411004']);
  });
  it('allows an empty pincode list (region-only zone)', () => {
    const r = buildDeliveryZone({ defaultName: 'All India', pincodes: '' });
    expect(r.ok && r.value.pincodes).toEqual([]);
  });
  it('rejects a bad name or a malformed PIN', () => {
    expect(buildDeliveryZone({ defaultName: '', pincodes: '411001' }).ok).toBe(false);
    expect(buildDeliveryZone({ defaultName: 'X', pincodes: '011001' }).ok).toBe(false); // leading zero
    expect(buildDeliveryZone({ defaultName: 'X', pincodes: '41100' }).ok).toBe(false);  // too short
  });
});

describe('buildBranding', () => {
  it('accepts valid fields and emits four setting upserts', () => {
    const r = buildBranding({ displayName: 'Acme Agri', logoUrl: 'https://cdn.x/logo.png', primaryColor: '#1B5E20', supportEmail: 'help@acme.in' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.settings).toHaveLength(4); expect(r.settings.find((s) => s.key === 'branding.primary_color')?.value).toBe('#1B5E20'); }
  });
  it('rejects a non-https logo, bad hex, bad email', () => {
    expect(buildBranding({ logoUrl: 'http://x/logo.png' }).ok).toBe(false);
    expect(buildBranding({ primaryColor: 'green' }).ok).toBe(false);
    expect(buildBranding({ supportEmail: 'not-an-email' }).ok).toBe(false);
  });
  it('treats empty fields as clear ("")', () => {
    const r = buildBranding({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.every((s) => s.value === '')).toBe(true);
  });
});

describe('buildLanguages', () => {
  const platform = ['en', 'hi', 'gu'];
  it('accepts a subset with a default inside it', () => {
    const r = buildLanguages({ enabled: ['en', 'hi'], default: 'hi' }, platform);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.settings[0]).toEqual({ key: 'languages.enabled', value: ['en', 'hi'] }); expect(r.settings[1].value).toBe('hi'); }
  });
  it('rejects empty, unknown codes, or a default outside the set', () => {
    expect(buildLanguages({ enabled: [], default: 'en' }, platform).ok).toBe(false);
    expect(buildLanguages({ enabled: ['fr'], default: 'fr' }, platform).ok).toBe(false);
    expect(buildLanguages({ enabled: ['en'], default: 'hi' }, platform).ok).toBe(false);
  });
});

describe('setting readers', () => {
  const rows = [{ key: 'branding.display_name', value: 'Acme' }, { key: 'languages.enabled', value: ['en', 'hi'] }, { key: 'x', value: 7 }];
  it('settingString reads strings + falls back', () => {
    expect(settingString(rows, 'branding.display_name')).toBe('Acme');
    expect(settingString(rows, 'missing', 'def')).toBe('def');
    expect(settingString(rows, 'x', 'def')).toBe('def'); // non-string → fallback
  });
  it('settingList reads arrays + falls back', () => {
    expect(settingList(rows, 'languages.enabled')).toEqual(['en', 'hi']);
    expect(settingList(rows, 'missing', ['en'])).toEqual(['en']);
  });
});
