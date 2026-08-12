// PC-56 TENANT-2a · listing QC — the dead path made real (W123/W126/W127).
// pending_approval had been a vocabulary with no verbs since 0005: submitForApproval() with zero callers,
// reject_reason never written, listing.approve granted since 0004 and checked by nothing. These tests pin the
// verbs, the reviewer law, the closed reason vocabulary and the measured-never-invented queue numbers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Listing } from '../domain/listing.entity';
import { canTransition } from '../domain/listing.state';
import { DomainError } from '../../../shared/errors/app-error';
import { ListingPermissions } from '../listings.policies';
import { ListingService } from '../services/listing.service';
import { ListingConsoleReadModel } from '../read-models/listing-console.read-model';
import { parseConsoleCursor, buildConsoleCursor } from '../dto/listing-qc.dto';

const codeOf = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (e) { return e instanceof DomainError ? e.code : `<not domain: ${e}>`; }
};

const pending = (over: Record<string, unknown> = {}) => Listing.rehydrate({
  id: 'L1', tenantId: 't1', sellerUserId: 'seller-1', productId: 'p1', categoryId: 'c1',
  title: 'Lokwan wheat', quantityTotal: 18, quantityAvailable: 18, minOrderQty: 2, unitCode: 'quintal',
  priceMinor: 264000n, currencyCode: 'INR', organicClaim: 'none', status: 'pending_approval', saleType: 'direct',
  visibility: 'tenant', aiExtracted: false, version: 1, qcSubmittedAt: new Date('2026-08-12T06:00:00Z'),
  createdBy: null, ...over,
} as any);

/* ================================================================================================ */
describe('TENANT-2a · the QC verbs on the aggregate', () => {
  it('submitForQc starts the waiting clock and emits its event', () => {
    const l = pending({ status: 'draft', qcSubmittedAt: null });
    l.submitForQc(new Date('2026-08-12T07:00:00Z'));
    const p = l.toProps() as any;
    expect(p.status).toBe('pending_approval');
    expect(p.qcSubmittedAt?.toISOString()).toBe('2026-08-12T07:00:00.000Z');
    expect(l.pullEvents().map((e) => e.type)).toContain('listing.qc_submitted');
  });

  it('a published listing cannot be re-submitted — the state machine is the law', () => {
    const l = pending({ status: 'published' });
    expect(codeOf(() => l.submitForQc())).toBe('LISTING_ILLEGAL_TRANSITION');
  });

  it('approveQc publishes immediately and records who decided, when', () => {
    const l = pending();
    const now = new Date('2026-08-12T08:10:00Z');
    l.approveQc('reviewer-9', now);
    const p = l.toProps() as any;
    expect(p.status).toBe('published');
    expect(p.publishedAt).toBe(now);
    expect(p.qcReviewedBy).toBe('reviewer-9');
    expect(p.qcReviewedAt).toBe(now);
    const types = l.pullEvents().map((e) => e.type);
    expect(types).toContain('listing.published');       // buyers with alerts ride this event
    expect(types).toContain('listing.qc_approved');
  });

  it('NO SELF-REVIEW, both identities, as CONDITIONS: the seller (QC_OWN_LISTING) and the staff creator (QC_OWN_DRAFT)', () => {
    expect(codeOf(() => pending().approveQc('seller-1'))).toBe('QC_OWN_LISTING');
    expect(codeOf(() => pending({ createdBy: 'staff-3' }).approveQc('staff-3'))).toBe('QC_OWN_DRAFT');
    expect(codeOf(() => pending({ createdBy: 'staff-3' }).rejectQc('staff-3', 'photos_unclear'))).toBe('QC_OWN_DRAFT');
  });

  it('rejectQc requires a reason, stores it trimmed, and emits the teaching event with it', () => {
    expect(codeOf(() => pending().rejectQc('reviewer-9', '  '))).toBe('QC_REJECT_REASON');
    const l = pending();
    l.rejectQc('reviewer-9', ' photos_unclear ');
    const p = l.toProps() as any;
    expect(p.status).toBe('rejected');
    expect(p.rejectReason).toBe('photos_unclear');       // 0005's column, written for the first time
    const ev = l.pullEvents().find((e) => e.type === 'listing.qc_rejected') as any;
    expect(ev.reason).toBe('photos_unclear');
    expect(ev.sellerUserId).toBe('seller-1');            // the notification's addressee travels in the event
  });

  it('a rejected listing can go back to draft — the one-tap fix-and-relist path exists in the machine', () => {
    expect(canTransition('rejected', 'draft')).toBe(true);
  });
});

/* ================================================================================================ */
function makeTx(lookupRows: any[] = [{ code: 'photos_unclear' }, { code: 'wrong_product' }]) {
  return {
    query: jest.fn((sql: string) => {
      if (sql.includes('listing_reject_reason')) return Promise.resolve({ rows: lookupRows, rowCount: lookupRows.length });
      return Promise.resolve({ rows: [], rowCount: 1 });   // suspension probe: rows[0] undefined → not suspended
    }),
  };
}

function buildService(tx = makeTx()) {
  const uow: any = { run: jest.fn((_t: string, fn: any) => fn(tx)) };
  const deps: any[] = [
    uow,
    { write: jest.fn().mockResolvedValue(undefined) },                                  // outbox
    { assertWithinLimit: jest.fn(), increment: jest.fn() },                             // quota
    { remember: jest.fn((_k: string, _u: string, _o: string, fn: any) => fn()) },       // idem
    { del: jest.fn(), wrap: jest.fn(), get: jest.fn(), set: jest.fn() },                // cache
    { inc: jest.fn(), observe: jest.fn() },                                             // metrics
    { insert: jest.fn(), update: jest.fn().mockResolvedValue(undefined), getForUpdate: jest.fn(), findById: jest.fn() }, // repo
    { append: jest.fn() },                                                              // priceHistory
    { upsertMany: jest.fn() },                                                          // attrs
    { attach: jest.fn(), photoAttachable: jest.fn(), countForListing: jest.fn(), attachOne: jest.fn() }, // media
    { write: jest.fn().mockResolvedValue(undefined) },                                  // audit
  ];
  const svc = new (ListingService as any)(...deps);
  return { svc, tx, outbox: deps[1], repo: deps[6], audit: deps[10] };
}

describe('TENANT-2a · the service wiring', () => {
  it('qcReject refuses an unknown reason BY NAME with the vocabulary, and decides NOTHING', async () => {
    const { svc, repo } = buildService();
    repo.getForUpdate.mockResolvedValue(pending());
    await expect(svc.qcReject('t1', { userId: 'reviewer-9' }, 'L1', 'blurry')).rejects.toMatchObject({
      code: 'QC_UNKNOWN_REJECT_REASON',
      message: expect.stringContaining('photos_unclear'),
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('qcReject accepts a vocabulary code and lands decision + outbox + audit in ONE tx', async () => {
    const { svc, repo, outbox, audit } = buildService();
    repo.getForUpdate.mockResolvedValue(pending());
    await svc.qcReject('t1', { userId: 'reviewer-9' }, 'L1', 'photos_unclear');
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(outbox.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'listing.qc_rejected' }));
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'listing.qc_rejected' }));
  });

  it('qcApprove checks the SELLER for suspension (a reviewer publishing a suspended member’s lot hits the wall)', async () => {
    const tx = makeTx();
    (tx.query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('AS suspended')) return Promise.resolve({ rows: [{ suspended: true }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const { svc, repo } = buildService(tx);
    repo.getForUpdate.mockResolvedValue(pending());
    await expect(svc.qcApprove('t1', { userId: 'reviewer-9' }, 'L1')).rejects.toMatchObject({ details: { reason: 'seller_suspended' } });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('qcApprove happy path: update + published/qc_approved events + audit row', async () => {
    const { svc, repo, outbox, audit } = buildService();
    repo.getForUpdate.mockResolvedValue(pending());
    await svc.qcApprove('t1', { userId: 'reviewer-9' }, 'L1');
    expect(repo.update).toHaveBeenCalledTimes(1);
    const types = (outbox.write as jest.Mock).mock.calls.map((c) => c[1].eventType);
    expect(types).toEqual(expect.arrayContaining(['listing.published', 'listing.qc_approved']));
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'listing.qc_approved' }));
  });
});

/* ================================================================================================ */
class StubPool {
  calls: Array<{ sql: string; params: unknown[] }> = [];
  async query(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    if (sql.includes('COUNT(*) FILTER')) {
      return { rows: [{ waiting: 0, oldest: null, unclocked: 0, approved_today: 0, rejected_today: 0, median_min: null, decided_7d: 0 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe('TENANT-2a · the console/queue reads carry their conditions IN THE SQL', () => {
  async function run() {
    const pool = new StubPool();
    const rm = new ListingConsoleReadModel({ forTenant: async () => pool } as any);
    await rm.qcQueue('t1', 50);
    await rm.qcKpis('t1', new Date('2026-08-12T00:00:00Z'));
    await rm.list('t1', { status: 'published' as any, cursor: { c: '2026-08-01', id: 'x' }, limit: 50 });
    await rm.counts('t1');
    await rm.rejectReasons('t1');
    return pool;
  }

  it('the queue is OLDEST first, and pre-clock rows surface FIRST rather than being aged or hidden', async () => {
    const pool = await run();
    const q = pool.calls.find((c) => c.sql.includes("l.status = 'pending_approval'"))!;
    expect(q.sql).toContain('ORDER BY l.qc_submitted_at ASC NULLS FIRST');
  });

  it('the median is over the last 7 days of CLOCKED decisions only — invented times are structurally impossible', async () => {
    const pool = await run();
    const k = pool.calls.find((c) => c.sql.includes('percentile_cont(0.5)'))!;
    expect(k.sql).toContain("interval '7 days'");
    // BOTH kpi subqueries (the median AND its sample size) must require the clock — asserting one occurrence
    // let a mutant drop the condition from the median while the count kept the string present (M5's lesson).
    expect(k.sql.match(/qc_submitted_at IS NOT NULL/g)).toHaveLength(2);
    const median = k.sql.slice(k.sql.indexOf('percentile_cont'), k.sql.indexOf('AS median_min'));
    expect(median).toContain('qc_submitted_at IS NOT NULL');
  });

  it('the staff list is keyset, never OFFSET, and filters by ONE closed status', async () => {
    const pool = await run();
    for (const c of pool.calls) expect(c.sql.toUpperCase()).not.toContain('OFFSET');
    const l = pool.calls.find((c) => c.sql.includes('l.created_at <'))!;
    expect(l.sql).toContain('l.status =');
    expect(l.params).toContain('published');
  });

  it('the rejection vocabulary read honours tenant extensions (Law 6: platform rows + this tenant’s own)', async () => {
    const pool = await run();
    const r = pool.calls.find((c) => c.sql.includes('listing_reject_reason'))!;
    expect(r.sql).toContain('tenant_id IS NULL OR tenant_id = $1');
  });

  it('the cursor codec survives malformed tokens as "first page", never a crash', () => {
    expect(parseConsoleCursor(undefined)).toBeNull();
    expect(parseConsoleCursor('garbage')).toBeNull();
    expect(parseConsoleCursor('~x')).toBeNull();
    const c = buildConsoleCursor({ createdAt: '2026-08-12T00:00:00.000Z', id: 'abc' });
    expect(parseConsoleCursor(c)).toEqual({ c: '2026-08-12T00:00:00.000Z', id: 'abc' });
  });
});

/* ================================================================================================ */
describe('TENANT-2a · the constraints and absences that ARE the design (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
  const MIG = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0138_listing_qc.sql');
  const SEED = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'seeds', 'core', '0004_roles_permissions.sql');

  it('0138: the clock columns, BOTH reviewer identities in the CHECK, decided-shape, two partial indexes', () => {
    const sql = strip(fs.readFileSync(MIG, 'utf8'));
    expect(sql).toMatch(/ADD COLUMN qc_submitted_at timestamptz/);
    expect(sql).toMatch(/qc_reviewed_by\s+uuid REFERENCES users\(id\)/);
    expect(sql).toMatch(/qc_reviewed_by <> seller_user_id/);
    expect(sql).toMatch(/created_by IS NULL OR qc_reviewed_by <> created_by/);
    expect(sql).toMatch(/\(qc_reviewed_by IS NULL\) = \(qc_reviewed_at IS NULL\)/);
    expect(sql).toMatch(/idx_listings_qc_queue/);
    expect(sql).toMatch(/idx_listings_qc_decided/);
  });

  it('0138: NO claim column (a collision costs a look, never a double write) and NO backfilled history', () => {
    const sql = strip(fs.readFileSync(MIG, 'utf8'));
    expect(sql).not.toMatch(/claimed_by/);
    expect(sql).not.toMatch(/UPDATE\s+listings/i);
  });

  it('0138 seeds the reasons as DATA (Law 6), idempotently, platform-level', () => {
    const sql = fs.readFileSync(MIG, 'utf8');
    expect(sql).toMatch(/listing_reject_reason/);
    expect(sql).toMatch(/photos_unclear/);
    expect(sql).toMatch(/WHERE NOT EXISTS/);   // NULL tenant_id makes ON CONFLICT useless — the 0134 lesson
  });

  it('two-ends: ListingPermissions.Approve IS the code 0004 seeded and granted — the promise finally has a route', () => {
    expect(ListingPermissions.Approve).toBe('listing.approve');
    const seed = fs.readFileSync(SEED, 'utf8');
    expect(seed).toContain("'listing.approve'");
  });

  it('the QC controller: decisions need Approve, console needs ViewAny, and NOTHING here is @Public', () => {
    const src = strip(fs.readFileSync(path.join(__dirname, '..', 'controllers', 'listing-qc.controller.ts'), 'utf8'));
    expect(src).not.toContain('@Public');
    const approveGuarded = src.match(/@RequirePermissions\(ListingPermissions\.Approve\)/g) ?? [];
    expect(approveGuarded.length).toBe(4);     // queue, review, approve, reject
    const viewAny = src.match(/@RequirePermissions\(ListingPermissions\.ViewAny\)/g) ?? [];
    expect(viewAny.length).toBe(2);            // console list + counts
  });
});
