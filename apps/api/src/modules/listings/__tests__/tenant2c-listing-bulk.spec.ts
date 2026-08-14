// PC-56 TENANT-2c · W128 bulk listing upload — the row reader, the four triage verdicts, and the trust path
// bulk must not skip.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readListingRow, readQuantityCell, readPriceCell, perKiloSuspicion, listingImportIdemKey, LISTING_IMPORT_COLUMNS } from '../domain/listing-import-row';
import { ListingBulkApplier } from '../bulk/listing-bulk-applier';
import { ON_BEHALF_LISTING_PURPOSE } from '../services/on-behalf-console.service';

const ROW = { phone: '9876543210', product: 'Wheat', quantity: '18', unit: 'quintal', price: '2640', min_order_qty: '2', harvest_date: '2026-03-15', title: '' };

describe('TENANT-2c · reading one row of a real spreadsheet', () => {
  it('reads the happy row, normalising the phone the way the login path does', () => {
    const r = readListingRow(ROW);
    expect(r.ok && r).toMatchObject({ phone: '+919876543210', product: 'Wheat', quantity: 18, unit: 'quintal', priceMajor: '2640', minOrderQty: 2, harvestDate: '2026-03-15' });
  });

  it('a quantity cell carrying its unit keeps BOTH — 18 kg silently becoming 18 quintals is a 100× error', () => {
    expect(readQuantityCell('18 qtl')).toEqual({ n: 18, unit: 'qtl' });
    expect(readQuantityCell('7.5')).toEqual({ n: 7.5, unit: null });
    expect(readQuantityCell('0')).toBeNull();
    expect(readQuantityCell('lots')).toBeNull();
    // the unit column wins when both are present; the cell's own word is the fallback
    expect((readListingRow({ ...ROW, quantity: '18 kg', unit: '' }) as any).unit).toBe('kg');
  });

  it('money survives ₹ and commas as a STRING, and never through a float (Law 2)', () => {
    expect(readPriceCell('₹2,640')).toBe('2640');
    expect(readPriceCell(' 12800.50 ')).toBe('12800.50');
    expect(readPriceCell('abc')).toBeNull();
    expect(readPriceCell('')).toBeNull();
  });

  it('the two columns a row cannot do without are INVALID; everything else a human fixes in the file', () => {
    expect(readListingRow({ ...ROW, phone: '' })).toMatchObject({ code: 'PHONE_MISSING' });
    expect(readListingRow({ ...ROW, product: '' })).toMatchObject({ code: 'PRODUCT_MISSING' });
    expect(readListingRow({ phone: '', product: '', quantity: '', price: '' })).toMatchObject({ code: 'ROW_EMPTY' });
    expect(readListingRow({ ...ROW, phone: '12' })).toMatchObject({ code: 'PHONE_INVALID', fixable: true });
    expect(readListingRow({ ...ROW, quantity: '-4' })).toMatchObject({ code: 'QTY_INVALID', fixable: true });
    expect(readListingRow({ ...ROW, price: '' })).toMatchObject({ code: 'PRICE_INVALID', fixable: true });
    expect(readListingRow({ ...ROW, harvest_date: 'March 2026' })).toMatchObject({ code: 'HARVEST_INVALID', fixable: true });
    expect(readListingRow({ ...ROW, min_order_qty: '99' })).toMatchObject({ code: 'MOQ_INVALID', fixable: true });
  });

  it('the idempotency key is the LOT’s identity, so the same lot twice in one file is one draft', () => {
    const a = listingImportIdemKey('t1', { phone: '+919876543210', product: 'Wheat', quantity: 18, priceMajor: '2640' });
    const b = listingImportIdemKey('t1', { phone: '+919876543210', product: 'wheat', quantity: 18, priceMajor: '2640' });
    const c = listingImportIdemKey('t1', { phone: '+919876543210', product: 'Wheat', quantity: 18, priceMajor: '2650' });
    expect(a).toBe(b);          // case is not identity
    expect(a).not.toBe(c);      // a corrected price IS a different lot
  });
});

describe('TENANT-2c · the per-kilo catch fires only against a REAL band', () => {
  it("W128's own row: ₹128/qtl against a band floor of ₹12,480 suggests ₹12,800", () => {
    expect(perKiloSuspicion('12800', { lowMinor: '1248000' })).toEqual({ suggestMinor: '1280000' });
  });
  it('no band, no warning — a suspicion invented from nothing teaches operators to click past warnings', () => {
    expect(perKiloSuspicion('12800', null)).toBeNull();
  });
  it('a merely cheap lot inside one order of magnitude is LEFT ALONE', () => {
    expect(perKiloSuspicion('600000', { lowMinor: '1248000' })).toBeNull();   // half the floor — a cheap lot, not a typo
    expect(perKiloSuspicion('124800', { lowMinor: '1248000' })).toBeNull();   // exactly 10× under: still within the guard
  });
  it('a price ×100 CANNOT explain gets no suggestion — a suggestion that does not fit is worse than none', () => {
    expect(perKiloSuspicion('1248', { lowMinor: '1248000' })).toBeNull();     // 1000× under; ×100 still below the floor
  });
});

/* ================================================================================================ */
function buildApplier(over: Partial<{ member: any; product: any; consent: boolean; dup: string | null; band: any }> = {}) {
  const o = { member: { id: 'u-member', pending: false }, product: { id: 'p1', category_id: 'c1', default_unit: 'quintal', default_name: 'Wheat' }, consent: true, dup: null, band: null, ...over };
  const pool = {
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM users u')) return Promise.resolve({ rows: o.member ? [o.member] : [] });
      if (sql.includes('FROM products')) return Promise.resolve({ rows: o.product ? [o.product] : [] });
      if (sql.includes('FROM listings')) return Promise.resolve({ rows: o.dup ? [{ id: o.dup }] : [] });
      if (sql.includes('FROM addresses')) return Promise.resolve({ rows: o.band ? [{ region_id: 'r1' }] : [] });
      return Promise.resolve({ rows: [] });
    }),
  };
  const listings: any = { create: jest.fn().mockResolvedValue({ id: 'L-new' }) };
  const consents: any = { isGranted: jest.fn().mockResolvedValue(o.consent) };
  const band: any = { band: jest.fn().mockResolvedValue(o.band) };
  const applier = new ListingBulkApplier({ forTenant: () => pool } as any, listings, consents, band);   // forTenant is sync here (the member-applier convention)
  return { applier, listings, consents, pool };
}
const CTX = { tenantId: 't1', actorUserId: 'staff-9' };

describe('TENANT-2c · the triage verdicts (reads only)', () => {
  it('a good row would CREATE', async () => {
    const { applier } = buildApplier();
    expect(await applier.validateRow(CTX, 1, ROW)).toEqual({ kind: 'create' });
  });
  it('W128 row 23: the phone matches no member of THIS organisation — fixable, named', async () => {
    const { applier } = buildApplier({ member: null });
    expect(await applier.validateRow(CTX, 1, ROW)).toMatchObject({ kind: 'fixable', code: 'MEMBER_NOT_FOUND' });
  });
  it('an unknown product is fixable, never guessed into the nearest catalogue row', async () => {
    const { applier } = buildApplier({ product: null });
    expect(await applier.validateRow(CTX, 1, ROW)).toMatchObject({ kind: 'fixable', code: 'PRODUCT_UNKNOWN' });
  });
  it('THE CONSENT DOOR (TENANT-2b’s law, third door): no recorded yes → fixable, not a silent skip', async () => {
    const { applier, consents } = buildApplier({ consent: false });
    expect(await applier.validateRow(CTX, 1, ROW)).toMatchObject({ kind: 'fixable', code: 'ONBEHALF_CONSENT' });
    expect(consents.isGranted).toHaveBeenCalledWith('t1', 'u-member', ON_BEHALF_LISTING_PURPOSE, 'staff-9');
  });
  it('W128 row 42: the same member + product + quantity already live is a DUPLICATE, skipped not failed', async () => {
    const { applier } = buildApplier({ dup: 'LST-088417' });
    expect(await applier.validateRow(CTX, 1, ROW)).toEqual({ kind: 'duplicate', existingId: 'LST-088417' });
  });
  it('W128 row 31: a per-kilo price is fixable WITH a suggestion in major units, applied by nobody', async () => {
    const { applier } = buildApplier({ band: { lowMinor: '1248000' } });
    const v = await applier.validateRow(CTX, 1, { ...ROW, price: '128' }) as any;
    expect(v).toMatchObject({ kind: 'fixable', code: 'PRICE_LOOKS_PER_KG' });
    expect(v.suggestion).toBe('12800');
  });
});

describe('TENANT-2c · applying a row walks the NORMAL path', () => {
  it('creates a DRAFT through the same service the console uses, with the staff hand recorded', async () => {
    const { applier, listings } = buildApplier();
    const res = await applier.applyRow(CTX, 'row-7', ROW);
    expect(res.id).toBe('L-new');
    const [tenantId, sellerUserId, idemKey, dto, createdBy] = (listings.create as jest.Mock).mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(sellerUserId).toBe('u-member');                 // the MEMBER owns the lot, not the uploader
    expect(idemKey).toContain('listing_import:t1:+919876543210:wheat:18:2640');
    expect(createdBy).toBe('staff-9');                     // QC's no-self-review gets its identity
    expect(dto).toMatchObject({ productId: 'p1', categoryId: 'c1', priceMinor: '264000', quantityTotal: 18, unitCode: 'quintal', harvestDate: '2026-03-15' });
    expect(dto.status).toBeUndefined();                    // nothing here can ask for 'published'
  });

  it('EVERY check re-runs at apply time — consent withdrawn between triage and confirm is refused', async () => {
    const { applier, listings } = buildApplier({ consent: false });
    await expect(applier.applyRow(CTX, 'row-7', ROW)).rejects.toMatchObject({ code: 'ONBEHALF_CONSENT' });
    expect(listings.create).not.toHaveBeenCalled();
  });

  it('a duplicate found at apply time returns the EXISTING id and creates nothing', async () => {
    const { applier, listings } = buildApplier({ dup: 'LST-088417' });
    expect(await applier.applyRow(CTX, 'row-7', ROW)).toEqual({ id: 'LST-088417' });
    expect(listings.create).not.toHaveBeenCalled();
  });

  it('the duplicate read counts drafts and QC-waiting lots as live — otherwise a re-upload doubles them', async () => {
    const { applier, pool } = buildApplier();
    await applier.validateRow(CTX, 1, ROW);
    const sql = (pool.query as jest.Mock).mock.calls.map((c) => c[0]).find((s: string) => s.includes('FROM listings'))!;
    expect(sql).toContain("status IN ('draft', 'pending_approval', 'published')");
  });
});

describe('TENANT-2c · the absences and the wiring (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const applierSrc = () => strip(fs.readFileSync(path.join(__dirname, '..', 'bulk', 'listing-bulk-applier.ts'), 'utf8'));

  it('the applier requires only the two columns a row cannot do without', () => {
    const { applier } = buildApplier();
    expect(applier.importType).toBe('listings');
    expect(applier.requiredColumns).toEqual(['phone', 'product']);
  });

  it('NO KYC PUBLISH GATE IS INVENTED HERE — the half-truth is named, not faked', () => {
    const s = applierSrc();
    expect(s).not.toMatch(/kyc_status\s*=\s*'verified'\s*\)?\s*(\?|\|\||&&)/);   // no gate expression
    expect(s).not.toMatch(/throw.*KYC/i);
  });

  it('the importer is registered by the module that OWNS listings — core/bulk stays generic', () => {
    const mod = strip(fs.readFileSync(path.join(__dirname, '..', 'listings.module.ts'), 'utf8'));
    expect(mod).toContain('this.bulkRegistry.register(this.listingApplier)');
    const core = strip(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'core', 'bulk', 'bulk-applier.registry.ts'), 'utf8'));
    expect(core).not.toMatch(/listing/i);   // the plumbing never learns what a lot is
  });

  it('the SDK template is generated from the SAME column list the parser reads — it cannot drift', () => {
    const sdk = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'packages', 'sdk-js', 'src', 'resources', 'bulk-imports.ts'), 'utf8');
    const cols = /LISTING_IMPORT_COLUMNS = \[([^\]]+)\]/.exec(sdk)![1].replace(/['\s]/g, '').split(',');
    expect(cols).toEqual([...LISTING_IMPORT_COLUMNS]);
  });

  it('no migration was needed — bulk plumbing and every column already existed', () => {
    // THIS ASSERTION USED TO READ `filter((f) => f.startsWith('0139')).toEqual([])`, which was a claim about
    // the NEXT wave's migration number rather than about this wave. It went red the moment TENANT-3b shipped
    // 0139_dispute_refund_gate.sql, and stayed red through 3c-1 and 3c-2 — a suite is worth nothing if a
    // passing test depends on nobody else doing any work. Repaired in TENANT-4a to assert what is actually
    // true and stays true: every migration header names the wave that authored it, and none names this one.
    const dir = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations');
    const authoredForThisWave = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('TENANT-2c'));
    expect(authoredForThisWave).toEqual([]);
  });
});
