// PC-56 TENANT-2c · W128's screen rules — the template that cannot drift, and the trust path stated on the page.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LISTING_IMPORT_COLUMNS, listingImportTemplateCsv } from '@krishalaya/sdk-js';

describe('TENANT-2c · the template', () => {
  it('its header IS the column list the importer parses — a drifting template is impossible', () => {
    const [header, sample] = listingImportTemplateCsv().trim().split('\n');
    expect(header).toBe([...LISTING_IMPORT_COLUMNS].join(','));
    expect(sample.split(',').length).toBe(LISTING_IMPORT_COLUMNS.length);
  });
  it('the sample row is a PER-QUINTAL price — the mistake the file exists to catch is not taught by the template', () => {
    const sample = listingImportTemplateCsv().trim().split('\n')[1];
    expect(sample).toContain('quintal');
    expect(sample).toContain('2640');     // a plausible per-quintal wheat price, not a per-kilo one
  });
});

describe('TENANT-2c · the page states its own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const page = () => strip(fs.readFileSync(path.join(__dirname, '..', 'app', 'listings', 'import', 'page.tsx'), 'utf8'));

  it('the trust path and the NAMED KYC gap are both on the page', () => {
    const s = page();
    expect(s).toContain('limport.trustPath');
    expect(s).toContain('limport.consentNote');
    expect(s).toContain('limport.kycGap');      // the half-truth is named, not drawn as a tick
  });

  it('the confirm button carries the COUNT the operator was shown', () => {
    expect(page()).toContain("t.t('limport.confirm', { n: j.validation?.willCreate ?? 0 })");
  });

  it('the template downloads for real, with no queue page and no invented receipt (W2355/W2356)', () => {
    const s = page();
    expect(s).toContain('download="krishalaya_listings_template.csv"');
    // (matched loosely at first, and generateMetadata contains "eta" — the pin now names what must be absent)
    expect(s).not.toMatch(/W2355|W2356/);            // no chain page is linked as a route
    expect(s).not.toMatch(/etaSeconds|queuePosition/);
  });

  it('the page only lists LISTING jobs — a member import must not appear on a listings screen', () => {
    expect(page()).toContain("j.importType === 'listings'");
  });
});
