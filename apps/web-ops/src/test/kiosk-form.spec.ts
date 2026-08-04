import { buildFarmer, KIOSK_LANGS } from '../features/kiosk/form';

describe('features/kiosk/form (OW-1)', () => {
  it('normalises phone (strips spaces/hyphens), E.164-ish 8–15 digits', () => {
    expect(buildFarmer({ phone: '+91 90990 12340', fullName: '', languageCode: '' }))
      .toEqual({ ok: true, value: { phone: '+919099012340' } });
    expect(buildFarmer({ phone: '12', fullName: '', languageCode: '' })).toEqual({ ok: false, error: 'phone' });
    expect(buildFarmer({ phone: 'abc', fullName: '', languageCode: '' })).toEqual({ ok: false, error: 'phone' });
  });
  it('optional name ≤120 + platform language only', () => {
    expect(buildFarmer({ phone: '9099012340', fullName: ' Ramesh Patel ', languageCode: 'gu' }))
      .toEqual({ ok: true, value: { phone: '9099012340', fullName: 'Ramesh Patel', languageCode: 'gu' } });
    expect(buildFarmer({ phone: '9099012340', fullName: 'x'.repeat(121), languageCode: '' })).toEqual({ ok: false, error: 'name' });
    expect(buildFarmer({ phone: '9099012340', fullName: '', languageCode: 'fr' })).toEqual({ ok: false, error: 'lang' });
    expect(KIOSK_LANGS).toContain('hi');
  });
});
