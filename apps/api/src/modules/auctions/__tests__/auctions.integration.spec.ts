// modules/auctions/__tests__/auctions.integration.spec.ts
// REAL end-to-end proof of the auctions money + lifecycle path against a live Postgres:
//   1. a seller opens an auction on their listing; it goes live;
//   2. bidders place bids → each bidder's EMD is HELD (wallet main → hold) once; the seller CANNOT
//      bid on their own auction; a too-low bid is rejected;
//   3. closing resolves the highest valid bid as the winner, RELEASES every LOSER's EMD (hold → main) and APPLIES the
//      WINNER's to the order (hold → escrow) — PC-56 TENANT-11a, founder decision F-2. This test used to assert the old
//      behaviour ("releases every bidder's EMD", the winner included), which let a winner walk away at zero cost;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's auction.
// Schema/seeds come from the REAL db/migrations + db/seeds; wiring via ./auction-harness (typed listing inserts — the
// shared makePublishedListing fixture is red at this HEAD, named in the 10b report).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { SellerCannotBidError, BidTooLowError } from '../domain/auctions.errors';
import { AuctionHarness, balanceOf, buildHarness, fundUser, makeListing } from './auction-harness';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('auctions slice (integration, real Postgres + RLS)', () => {
  let h: AuctionHarness;
  let admin: Pool;
  let inspect: Pool;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const seller = randomUUID();
  const bidder1 = randomUUID();
  const bidder2 = randomUUID();
  const EMD = 5000n;
  let listingId = ''; let auctionId = '';

  const holdBal = (u: string) => balanceOf(admin, u, 'hold');
  const mainBal = (u: string) => balanceOf(admin, u, 'main');

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, seller); await makeUser(admin, bidder1); await makeUser(admin, bidder2);
    listingId = await makeListing(admin, tenantA, seller, 'Auction Lot', 1, 'quintal', 100000n);
    h = buildHarness(APP_URL!);
    // fund both bidders so EMD holds succeed
    await fundUser(h, tenantA, bidder1, 1_000_000n); await fundUser(h, tenantA, bidder2, 1_000_000n);
    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  // The outbox is ONE shared queue: specs that drain it with a bounded relayBatch (dispute-refund: 100) never reach their own
  // event behind this file's few hundred. Nothing in this file relays them, so they are closed here rather than left pending.
  afterAll(async () => { await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined); await h?.close(); await inspect?.end(); await admin?.end(); });

  it('seller opens an auction; it can be made live', async () => {
    const startsAt = new Date(Date.now() - 1000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await h.auctions.create(tenantA, { userId: seller }, `idem-${randomUUID()}`, { listingId, kind: 'english_open', startPriceMinor: '100000', minIncrementMinor: '10000', emdMinor: EMD.toString(), startsAt, endsAt } as any);
    auctionId = res.auctionId;
    await h.auctions.open(tenantA, auctionId);
    const row = await admin.query(`SELECT status FROM auctions WHERE id=$1`, [auctionId]);
    expect(row.rows[0].status).toBe('live');
  });

  it('bids hold EMD once per bidder; seller cannot bid; too-low is rejected', async () => {
    await h.bids.placeBid(tenantA, bidder1, auctionId, `idem-${randomUUID()}`, '100000', null);
    expect(await holdBal(bidder1)).toBe(EMD);                       // EMD held
    expect(await mainBal(bidder1)).toBe(1_000_000n - EMD);

    await h.bids.placeBid(tenantA, bidder2, auctionId, `idem-${randomUUID()}`, '110000', null);
    expect(await holdBal(bidder2)).toBe(EMD);

    // bidder1 raises — EMD hold is reused (not doubled)
    await h.bids.placeBid(tenantA, bidder1, auctionId, `idem-${randomUUID()}`, '120000', null);
    expect(await holdBal(bidder1)).toBe(EMD);

    await expect(h.bids.placeBid(tenantA, seller, auctionId, `idem-${randomUUID()}`, '130000', null)).rejects.toBeInstanceOf(SellerCannotBidError);
    await expect(h.bids.placeBid(tenantA, bidder2, auctionId, `idem-${randomUUID()}`, '125000', null)).rejects.toBeInstanceOf(BidTooLowError); // < 120000 + 10000
  });

  it('closing resolves the winner, releases the LOSER\'s EMD and APPLIES the winner\'s to the order (F-2)', async () => {
    await admin.query(`UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id=$1`, [auctionId]);
    await h.auctions.closeAndResolve(tenantA, auctionId);
    const a = await admin.query(`SELECT status, winning_bid_id, settled_order_id FROM auctions WHERE id=$1`, [auctionId]);
    expect(a.rows[0].status).toBe('settled');
    expect(a.rows[0].settled_order_id).not.toBeNull();
    const winning = await admin.query(`SELECT bidder_user_id, amount_minor FROM bids WHERE id=$1`, [a.rows[0].winning_bid_id]);
    expect(winning.rows[0].bidder_user_id).toBe(bidder1);          // highest (120000)
    expect(String(winning.rows[0].amount_minor)).toBe('120000');
    // the loser is whole; the winner's EMD moved hold → escrow (applied to the order), NOT back to their main
    expect(await holdBal(bidder2)).toBe(0n);
    expect(await mainBal(bidder2)).toBe(1_000_000n);
    expect(await holdBal(bidder1)).toBe(0n);
    expect(await mainBal(bidder1)).toBe(1_000_000n - EMD);
  });

  it('RLS: tenant B cannot see tenant A\'s auction', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM auctions WHERE id=$1`, [auctionId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[auctions] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
