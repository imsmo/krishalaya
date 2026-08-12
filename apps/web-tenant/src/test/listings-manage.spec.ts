// apps/web-tenant/src/test/listings-manage.spec.ts · unit tests for the owner listing-detail action gating +
// price-conflict mapping, and the minorToMajor pre-fill. Action gating mirrors the API state machine, so it's
// worth pinning that the publish button never surfaces for already-published/archived listings.
import { canPublish, canChangePrice, priceErrorKey } from '../features/listings/manage';
import { minorToMajor } from '../features/listings/form';

describe('canPublish', () => {
  it('surfaces for publishable statuses', () => {
    // TENANT-2b: pending_approval left this list — once in the QC queue a REVIEWER decides; the server
    // refuses the bare verb there (LISTING_IN_QC), so the button would be a door drawn on a wall.
    for (const s of ['draft', 'paused', 'sold_out', 'expired', 'hidden']) expect(canPublish(s)).toBe(true);
    expect(canPublish('pending_approval')).toBe(false);
  });
  it('hidden for already-published / archived / rejected / unknown / empty', () => {
    for (const s of ['published', 'archived', 'rejected', 'weird', '', undefined, null]) expect(canPublish(s as string)).toBe(false);
  });
});

describe('canChangePrice', () => {
  it('allowed unless archived', () => {
    expect(canChangePrice('published')).toBe(true);
    expect(canChangePrice('draft')).toBe(true);
    expect(canChangePrice('archived')).toBe(false);
  });
});

describe('priceErrorKey', () => {
  it('maps version/conflict/409 to conflict, else failed', () => {
    expect(priceErrorKey('VERSION_CONFLICT')).toBe('conflict');
    expect(priceErrorKey('listing_version_mismatch')).toBe('conflict');
    expect(priceErrorKey('409')).toBe('conflict');
    expect(priceErrorKey('SERVER_ERROR')).toBe('failed');
    expect(priceErrorKey(undefined)).toBe('failed');
  });
});

describe('minorToMajor (price pre-fill)', () => {
  it('formats minor-unit strings to major', () => {
    expect(minorToMajor('12340')).toBe('123.40');
    expect(minorToMajor('99')).toBe('0.99');
    expect(minorToMajor('12000')).toBe('120');
    expect(minorToMajor('0')).toBe('0');
  });
  it('returns empty for junk', () => {
    expect(minorToMajor('abc')).toBe('');
    expect(minorToMajor(undefined)).toBe('');
  });
});
