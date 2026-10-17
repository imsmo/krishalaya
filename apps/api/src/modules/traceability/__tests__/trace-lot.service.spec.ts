// modules/traceability/__tests__/trace-lot.service.spec.ts · service unit tests with fakes.
// Pins: create requires trace.manage + seeds a genesis event; append chains off the previous hash; a non-owner
// non-manager read 404s (no IDOR); appendForListing is idempotent (skips a code already present).
import { TraceLotService } from '../services/trace-lot.service';
import { TraceLot } from '../domain/trace-lot.entity';
import { TraceForbiddenError, TraceLotNotFoundError } from '../domain/traceability.errors';

const lot = (over: Partial<any> = {}) => TraceLot.rehydrate({ id: 'l1', tenantId: 't1', listingId: 'lst1', qrToken: 'QR1', farmerUserId: 'farmer', parcelId: null, cropSeasonId: null, declaredInputs: [], certificateIds: [], blockchainAnchor: null, ...over });

function harness(opts: { lot?: TraceLot | null; lastHash?: string | null; hasCode?: boolean } = {}) {
  const inserts: any[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const lots = { insert: jest.fn(), getForUpdate: jest.fn(async () => opts.lot ?? null), getById: jest.fn(async () => opts.lot ?? null), findByListing: jest.fn(async () => opts.lot ?? null), update: jest.fn(), listFor: jest.fn(), linkCertificates: jest.fn(async () => 0) };   // STORE-5b · B19: the link table
  const eventsRepo = { insert: jest.fn(async (_tx: any, e: any) => { inserts.push(e); }), lastHash: jest.fn(async () => opts.lastHash ?? null), lastHead: jest.fn(async () => (opts.lastHash ? { hash: opts.lastHash, atMs: 0 } : null)) /* STORE-5b: the head + its instant */, hasCode: jest.fn(async () => opts.hasCode ?? false), listForLot: jest.fn() };
  const svc = new TraceLotService(uow as any, outbox as any, idem as any, metrics as any, lots as any, eventsRepo as any);
  return { svc, lots, eventsRepo, inserts };
}
const manager = { userId: 'farmer', canManage: true };
const stranger = { userId: 'x', canManage: false };

describe('create', () => {
  it('requires trace.manage', async () => {
    const h = harness();
    await expect(h.svc.create('t1', stranger, 'idem-1', { declaredInputs: [], certificateIds: [] } as any)).rejects.toBeInstanceOf(TraceForbiddenError);
  });
  it('creates the lot + seeds a genesis chained event', async () => {
    const h = harness();
    await h.svc.create('t1', manager, 'idem-2', { listingId: 'lst1', declaredInputs: [], certificateIds: [] } as any);
    expect(h.lots.insert).toHaveBeenCalledTimes(1);
    expect(h.inserts).toHaveLength(1); expect(h.inserts[0].eventCode).toBe('listed');   // listingId present → 'listed'
  });
  it('STORE-5b · B19: the certificates go to the ONE link table (this organisation\'s only — the repository\'s JOIN)', async () => {
    const h = harness();
    await h.svc.create('t1', manager, 'idem-3', { declaredInputs: [], certificateIds: ['0219c000-0000-7000-8000-000000000001'] } as any);
    expect(h.lots.linkCertificates).toHaveBeenCalledWith(expect.anything(), 't1', expect.any(String), ['0219c000-0000-7000-8000-000000000001']);
  });
});

describe('appendEvent', () => {
  it('chains off the previous hash', async () => {
    const h = harness({ lot: lot(), lastHash: 'PREVHASH' });
    const out = await h.svc.appendEvent('t1', manager, 'l1', 'sold', { buyer: 'x' });
    expect(out.eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out).toMatchObject({ hashVersion: 2 });   // STORE-5b · B11
  });
  it('STORE-5b: an event is never stamped before the chain head (a pod clock behind the head → head + 1 ms)', async () => {
    const h = harness({ lot: lot(), lastHash: 'PREVHASH' });
    (h.eventsRepo.lastHead as jest.Mock).mockResolvedValueOnce({ hash: 'PREVHASH', atMs: Date.now() + 60_000 });
    await h.svc.appendEvent('t1', manager, 'l1', 'sold', {});
    const stamped = h.inserts[0].toProps().createdAt as Date;
    expect(stamped.getTime()).toBeGreaterThan(Date.now() + 59_000);
  });
  it('404 when the lot is missing', async () => {
    const h = harness({ lot: null });
    await expect(h.svc.appendEvent('t1', manager, 'nope', 'sold', {})).rejects.toBeInstanceOf(TraceLotNotFoundError);
  });
});

describe('reads + fanout idempotency', () => {
  it('getById 404s a stranger (no IDOR)', async () => {
    const h = harness({ lot: lot() });
    await expect(h.svc.getById('t1', stranger, 'l1')).rejects.toBeInstanceOf(TraceLotNotFoundError);
  });
  it('appendForListing skips when the code already exists (idempotent)', async () => {
    const h = harness({ lot: lot(), hasCode: true });
    await h.svc.appendForListing({ query: jest.fn() } as any, 't1', 'lst1', 'delivered', {});
    expect(h.inserts).toHaveLength(0);
  });
});
