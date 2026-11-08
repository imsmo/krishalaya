// apps/web-tenant/src/test/ops3p-dairy-read-copy.spec.ts · PC-56 OPS-3p (founder Q6-A, 2026-11-08) — the sentences that changed.
// (1) The quality desk's restricted state said "this platform defines only one dairy permission, so there is no read-only dairy
//     scope to give you". Migration 0235 made that false: the desk reads with dairy.read, dairy.collect or dairy.manage (the API's
//     DAIRY_READ_ANY). In all three launch languages the new sentence names the three codes and no longer claims one permission.
// (2) The desks page's dairy-template guarantee "Rate cards stay behind a checker" is printed as BUILT (the API's desk-templates.ts
//     — the dairy desk carries no dairy.manage); the key and its words are unchanged.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

describe('PC-56 OPS-3p · the dairy read sentence (en / hi / gu)', () => {
  const K = 'dairy.quality.state.restricted';
  it('names dairy.read, dairy.collect and dairy.manage in every launch language', () => {
    for (const m of [en, hi, gu] as Array<Record<string, string>>) {
      for (const code of ['dairy.read', 'dairy.collect', 'dairy.manage']) expect(m[K]).toContain(code);
    }
    expect(en[K as keyof typeof en]).toBe('You do not have a dairy permission that reads this desk. It can be read with dairy.read, dairy.collect or dairy.manage.');
  });
  it('no longer claims the platform has one dairy permission or no read-only scope', () => {
    expect(en[K as keyof typeof en]).not.toMatch(/only one dairy permission|no read-only/i);
    expect((hi as Record<string, string>)[K]).not.toContain('केवल एक डेयरी अनुमति');
    expect((gu as Record<string, string>)[K]).not.toContain('ફક્ત એક ડેરી પરવાનગી');
  });
  it('the rate-card guarantee key keeps its words', () => {
    expect((en as Record<string, string>)['dk.guarantee.rate_cards_checker']).toBe('Rate cards stay behind a checker');
  });
});
