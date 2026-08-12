// apps/web-admin/src/test/adminsweepb4-farmer360.spec.ts · W109 console logic (PC-56 ADMIN-SWEEP-b4).
import { tileText, bandClass, formatMinor, buildExport, buildSearch, EXPORT_REASON_MIN } from '../features/analytics/farmer360';
import { en } from '../i18n/en';

describe('ADMIN-SWEEP-b4 · Farmer 360 console logic', () => {
  it('a null tile prints UNKNOWN, never ₹0.00 — unknown is not zero', () => {
    expect(tileText({ valueMinor: null, basis: 'b', n: 0 })).toEqual({ key: 'unknown', text: '' });
    expect(tileText({ valueMinor: '0', basis: 'b', n: 1 })).toEqual({ key: 'value', text: '₹0.00' });
    expect(tileText({ valueMinor: '86420000', basis: 'b', n: 42 }).text).toBe('₹8,64,200.00');
  });
  it('band chips: trusted ok, caution warn, restricted/blocked err, unscored neutral', () => {
    expect(bandClass('trusted')).toContain('ok');
    expect(bandClass('caution')).toContain('warn');
    expect(bandClass('blocked')).toContain('err');
    expect(bandClass(null)).not.toContain('ok');
  });
  it('lakh formatting holds across magnitudes', () => {
    expect(formatMinor('112000')).toBe('₹1,120.00');
    expect(formatMinor('1600000')).toBe('₹16,000.00');
    expect(formatMinor('-500')).toBe('−₹5.00');
  });
  it('the export gate shares the server floor; search refuses a population sweep', () => {
    expect(EXPORT_REASON_MIN).toBe(10);
    expect(buildExport({ reason: 'because' })).toEqual({ ok: false, error: 'reason' });
    expect(buildExport({ reason: ' DSR follow-up, case #812 ' })).toEqual({ ok: true, value: { reason: 'DSR follow-up, case #812' } });
    expect(buildSearch({ q: ' r ' })).toEqual({ ok: false, error: 'q' });
    expect(buildSearch({ q: 'Ramesh' })).toEqual({ ok: true, value: { q: 'Ramesh' } });
  });
  it('the honesty copy carries its load-bearing words', () => {
    const cat = en as Record<string, string>;
    expect(cat['f360.searchPlaceholder']).toContain('never a phone number');
    expect(cat['f360.viewRecorded']).toContain('before the profile is assembled');
    expect(cat['f360.unknown']).toContain('not zero');
    expect(cat['f360.engagementHonesty']).toContain('refused, not invented');
    expect(cat['f360.deliveryTruth']).toContain('synchronous');
    expect(cat['f360.assemblyFailed']).toContain('never shown as complete');
    expect(cat['f360.error.exportGrant']).toContain('in addition to');
  });
});
