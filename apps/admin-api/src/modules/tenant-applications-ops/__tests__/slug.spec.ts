// PC-55 A1 · slug derivation. Rule Zero: a non-Latin org name must NEVER be mangled into nonsense and must
// NEVER block the application — it falls back to a stable, honest `tenant-<8hex>` slug instead.
import { slugFor } from '../tenant-applications-ops.service';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('slugFor', () => {
  it('derives a clean ASCII slug from a Latin org name', () => {
    expect(slugFor('Anand Farmer Producer Company Ltd.', ID)).toBe('anand-farmer-producer-company-ltd');
    expect(slugFor('  Krishi   Verse  ', ID)).toBe('krishi-verse');
  });
  it('never mangles a non-Latin name — stable fallback instead', () => {
    expect(slugFor('આનંદ ખેડૂત ઉત્પાદક કંપની', ID)).toBe('tenant-01890a5d');
    expect(slugFor('कृषि सहकारी', ID)).toBe('tenant-01890a5d');
    expect(slugFor('جمعية المزارعين', ID)).toBe('tenant-01890a5d');
  });
  it('caps length and never leaves a trailing dash', () => {
    const s = slugFor('A'.repeat(80), ID);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
  it('is deterministic (the same application always yields the same slug)', () => {
    expect(slugFor('कृषि', ID)).toBe(slugFor('कृषि', ID));
  });
});
