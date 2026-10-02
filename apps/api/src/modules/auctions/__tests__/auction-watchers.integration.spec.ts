// modules/auctions/__tests__/auction-watchers.integration.spec.ts
// REAL Postgres proof of the API-W3-11 slice, re-cut by PC-56 TENANT-11a:
//   1. a member WATCHES an auction (idempotent) + lists their watch-list; a non-member (other tenant)
//      gets 404 (auction not visible — no cross-tenant enumeration); and UNWATCHES as kv_app (F-21 — it used to 42501);
//   2. the release-losing-emd SWEEPER releases LOSING bidders' EMD (hold → main) for an auction awaiting the seller while
//      the WINNER keeps their hold — idempotent on the shared wallet key;
//   3. TENANT-11a (F-2): a payment that names the AUCTION directly is no longer a settlement path — the winner's EMD is
//      APPLIED to the order at settlement, so nothing moves (the old handler released it here, reading `bids` as kv_relay);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's auction_watchers row.
// Schema/seeds from the REAL db/migrations + db/seeds; wiring via ./auction-harness.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AuctionPaymentSucceededHandler } from '../events/handlers/payment-succeeded.handler';
import { AuctionNotFoundError } from '../domain/auctions.errors';
import { AuctionHarness, balanceOf, buildHarness, fundUser, makeListing } from './auction-harness';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('auction watchers + EMD-release glue (integration, real Postgres + RLS)', () => {
  let h: AuctionHarness; let admin: Pool; let inspect: Pool;
  let isSuperuser = false;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const seller = randomUUID(); const bidder1 = randomUUID(); const bidder2 = randomUUID(); const strangerB = randomUUID();
  let listingId = ''; let auctionId = ''; let winningBidId = '';
  const EMD = 5000n;
  const holdBal = (u: string) => balanceOf(admin, u, 'hold');

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, seller); await makeUser(admin, bidder1); await makeUser(admin, bidder2); await makeUser(admin, strangerB);
    listingId = await makeListing(admin, tenantA, seller, 'Auction Lot', 1, 'quintal', 100000n);
    h = buildHarness(APP_URL!);
    await fundUser(h, tenantA, bidder1, 1_000_000n); await fundUser(h, tenantA, bidder2, 1_000_000n);
    const c = await h.auctions.create(tenantA, { userId: seller }, `idem-${randomUUID()}`, { listingId, kind: 'english_open', startPriceMinor: '100000', minIncrementMinor: '10000', emdMinor: EMD.toString(), startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() } as any);
    auctionId = c.auctionId;
    await h.auctions.open(tenantA, auctionId);
    await h.bids.placeBid(tenantA, bidder2, auctionId, `idem-${randomUUID()}`, '100000', null);          // loser
    const w = await h.bids.placeBid(tenantA, bidder1, auctionId, `idem-${randomUUID()}`, '120000', null); // winner (high)
    winningBidId = w.bidId;
    // stand the auction at 'awaiting_approval' with its winner WITHOUT the close's own release, so the SWEEPER is what is exercised
    await admin.query(`UPDATE auctions SET status='awaiting_approval', winning_bid_id=$2, decision_due_at=now() + interval '1 day', updated_at=now() WHERE id=$1`, [auctionId, winningBidId]);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  // The outbox is ONE shared queue: specs that drain it with a bounded relayBatch (dispute-refund: 100) never reach their own
  // event behind this file's few hundred. Nothing in this file relays them, so they are closed here rather than left pending.
  afterAll(async () => { await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined); await h?.close(); await inspect?.end(); await admin?.end(); });

  it('watch is idempotent + lists in my watch-list; a non-member gets 404; unwatch works as kv_app (F-21)', async () => {
    await h.watchers.watch(tenantA, bidder1, auctionId);
    await h.watchers.watch(tenantA, bidder1, auctionId);   // idempotent
    const cnt = await admin.query(`SELECT count(*)::int c FROM auction_watchers WHERE auction_id=$1 AND user_id=$2`, [auctionId, bidder1]);
    expect(cnt.rows[0].c).toBe(1);
    const mine = await h.watchers.listMine(tenantA, bidder1, { limit: 20 });
    expect(mine.items.find((x) => x.auctionId === auctionId)).toBeTruthy();
    // a user acting in tenant B cannot watch tenant A's auction (not visible → 404)
    await expect(h.watchers.watch(tenantB, strangerB, auctionId)).rejects.toBeInstanceOf(AuctionNotFoundError);
    await expect(h.watchers.unwatch(tenantB, strangerB, auctionId)).rejects.toBeInstanceOf(AuctionNotFoundError);
    await h.watchers.unwatch(tenantA, bidder1, auctionId);
    expect((await admin.query(`SELECT count(*)::int c FROM auction_watchers WHERE auction_id=$1`, [auctionId])).rows[0].c).toBe(0);
    await h.watchers.watch(tenantA, bidder1, auctionId);   // keep one row for the RLS check below
  });

  it('the release-losing-emd sweeper returns LOSERS\' EMD and keeps the WINNER\'s hold', async () => {
    expect(await holdBal(bidder1)).toBe(EMD); expect(await holdBal(bidder2)).toBe(EMD);
    const res = await h.auctions.releaseLosingEmd(tenantA, auctionId);
    expect(res.released).toBe(1);                       // only the loser
    expect(await holdBal(bidder2)).toBe(0n);            // loser refunded
    expect(await holdBal(bidder1)).toBe(EMD);           // winner still held
    // idempotent: re-running releases nothing new
    expect((await h.auctions.releaseLosingEmd(tenantA, auctionId)).released).toBe(0);
  });

  it('TENANT-11a · a payment naming the AUCTION moves nothing — the winner\'s EMD is applied at settlement, not refunded on payment', async () => {
    await new AuctionPaymentSucceededHandler(h.auctions).handle(
      { id: '1', tenantId: tenantA, aggregateType: 'payment', aggregateId: randomUUID(), eventType: 'payments.payment_succeeded', payload: { v: 1, referenceType: 'auction', referenceId: auctionId } } as any);
    expect(await holdBal(bidder1)).toBe(EMD);
  });

  it('RLS: tenant B cannot see tenant A\'s auction_watchers row', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM auction_watchers w JOIN auctions a ON a.id=w.auction_id WHERE w.auction_id=$1`, [auctionId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[auction-watchers] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
