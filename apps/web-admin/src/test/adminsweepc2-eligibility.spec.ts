// apps/web-admin/src/test/adminsweepc2-eligibility.spec.ts · W071 console copy (PC-56 ADMIN-SWEEP-c2).
// The dry-run UI is thin by design (counts arrive computed; the 422 sentence is shown verbatim) — what the console
// OWNS is the honesty copy, so that is what gets pinned.
import { en } from '../i18n/en';

describe('ADMIN-SWEEP-c2 · the dry run copy carries its load-bearing words', () => {
  const cat = en as Record<string, string>;
  it('the banner rule: zero losers or no expansion-only claim', () => {
    expect(cat['dr.expansionOnly']).toContain('No farmer LOSES eligibility');
    expect(cat['dr.losers']).toContain('re-notification wave');
    expect(cat['dr.losers']).toContain('takes away');
  });
  it('a dry run saves nothing, twice over', () => {
    expect(cat['dr.run']).toContain('saves nothing');
    expect(cat['dr.savedNothing']).toContain('nothing was saved');
  });
  it('unknown ≠ converted: foreign-unit parcels are named, not normalised', () => {
    expect(cat['dr.unconvertible']).toContain('UNKNOWN landholding');
    expect(cat['dr.unconvertible']).toContain('neither silently converted nor silently excluded');
  });
  it('the vocabulary line names the refused canon fields as GAP-BACKEND', () => {
    expect(cat['dr.vocabulary']).toContain('did you mean landholding_max_acres?');
    expect(cat['dr.vocabulary']).toContain('crop_in');
    expect(cat['dr.vocabulary']).toContain('GAP-BACKEND');
  });
  it('a first version has no gained/lost fiction', () => {
    expect(cat['dr.firstVersion']).toContain('no meaning yet');
  });
});
