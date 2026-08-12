// PC-56 TENANT-2b · W124/W125 console logic — the verb gates that mirror the QC-aware machine, harvest
// validation, and W2357's preservation law.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildCreateListingInput, preservedQuery } from '../features/listings/form';
import { canPublish, canSubmitQc, canRedraft, canPause, canArchive } from '../features/listings/manage';

const RAW = {
  product: 'p1|c1|quintal', title: 'Lokwan wheat, stored', quantityTotal: '18', minOrderQty: '2',
  priceMajor: '2640', saleType: 'direct', organicClaim: 'none', visibility: 'tenant', pincode: '362001',
};

describe('TENANT-2b · harvest date is optional but never silently wrong', () => {
  it('a well-formed date passes through; empty stays undefined', () => {
    const ok = buildCreateListingInput({ ...RAW, harvestDate: '2026-03-15' });
    expect(ok.ok && ok.value.harvestDate).toBe('2026-03-15');
    const none = buildCreateListingInput({ ...RAW, harvestDate: '  ' });
    expect(none.ok && none.value.harvestDate).toBeUndefined();
  });
  it('a malformed date is REFUSED with its own key — a wrong season misleads every buyer', () => {
    expect(buildCreateListingInput({ ...RAW, harvestDate: 'March 2026' })).toEqual({ ok: false, error: 'errorHarvest' });
    expect(buildCreateListingInput({ ...RAW, harvestDate: '2026-3-5' })).toEqual({ ok: false, error: 'errorHarvest' });
  });
});

describe('TENANT-2b · W2357: refused submits preserve every typed value', () => {
  it('preservedQuery keeps non-empty fields and repeats mediaIds', () => {
    const q = preservedQuery({ title: 'Wheat', priceMajor: '2640', description: '' }, ['m1', 'm2']);
    const p = new URLSearchParams(q);
    expect(p.get('title')).toBe('Wheat');
    expect(p.get('priceMajor')).toBe('2640');
    expect(p.has('description')).toBe(false);         // empties dropped, not serialized as ''
    expect(p.getAll('mediaIds')).toEqual(['m1', 'm2']);
  });
});

describe('TENANT-2b · the verb gates mirror the QC-aware machine', () => {
  it('the bare publish button is GONE from pending_approval — the server refuses it (LISTING_IN_QC)', () => {
    expect(canPublish('pending_approval')).toBe(false);
    expect(canPublish('draft')).toBe(true);
    expect(canPublish('paused')).toBe(true);           // resume
  });
  it('submit-for-QC only from draft; the way back from rejected AND pending_approval', () => {
    expect(canSubmitQc('draft')).toBe(true);
    expect(canSubmitQc('published')).toBe(false);
    expect(canRedraft('rejected')).toBe(true);
    expect(canRedraft('pending_approval')).toBe(true);
    expect(canRedraft('draft')).toBe(false);
  });
  it('pause only from published; archive from anything non-terminal', () => {
    expect(canPause('published')).toBe(true);
    expect(canPause('draft')).toBe(false);
    expect(canArchive('rejected')).toBe(true);
    expect(canArchive('archived')).toBe(false);
  });
});

describe('TENANT-2b · the page rules that must not drift (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the detail page NAMES the absent "matched requirements" figure instead of inventing one', () => {
    const src = read('app', 'listings', '[id]', 'page.tsx');
    expect(src).toContain('actMatchAbsent');
    expect(src).toContain('archiveListingAction');     // the danger zone is wired, with its reason field
    expect(src).toContain('priceHistory');             // 0005's trail, read at last
  });

  it('the form is a GET preview + explicit create action — refusals keep the values by construction', () => {
    const src = read('app', 'listings', 'new', 'page.tsx');
    expect(src).toContain('method="get"');
    expect(src).toContain('formAction={createListingAction}');
    expect(src).toContain('fairPrice');                // the band is fetched, never typed in
  });
});
