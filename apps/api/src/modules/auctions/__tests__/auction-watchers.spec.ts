// modules/auctions/__tests__/auction-watchers.spec.ts · pure-domain unit tests for the API-W3-11 slice:
// the AuctionWatcher value object + Auction.editSchedule (scheduled-only edit invariants). Service-level
// watch/RLS, outbid emission, and EMD release are covered by auctions.integration.spec.ts.
import { Auction } from '../domain/auction.entity';
import { AuctionWatcher } from '../domain/auction-watcher.entity';
import { AuctionEventType } from '../domain/auctions.events';
import { InvalidAuctionError } from '../domain/auctions.errors';
import { AuctionsPublisher } from '../events/auctions.publisher';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';

const base = { id: 'a1', tenantId: 't1', listingId: 'l1', quantity: '1', unitCode: 'lot', startsAt: new Date('2026-04-01T00:00:00Z'), endsAt: new Date('2026-04-02T00:00:00Z') };
const english = (over: any = {}) => Auction.create({ ...base, kind: 'english_open', startPriceMinor: 100000n, minIncrementMinor: 10000n, ...over });

describe('AuctionWatcher', () => {
  it('builds with composite identity + requires both ids', () => {
    const w = AuctionWatcher.of({ auctionId: 'a1', userId: 'u1' });
    expect(w.props).toMatchObject({ auctionId: 'a1', userId: 'u1' });
    expect(w.props.createdAt).toBeInstanceOf(Date);
    expect(() => AuctionWatcher.of({ auctionId: '', userId: 'u1' })).toThrow();
    expect(() => AuctionWatcher.of({ auctionId: 'a1', userId: '' })).toThrow();
  });
});

describe('watcher fanout on auction close (P1-7)', () => {
  it('emits auctions.watchers_auction_ended carrying recipientUserIds + hadWinner, in the caller tx (Law 4)', async () => {
    const written: any[] = [];
    const outbox = { write: async (_tx: any, ev: any) => { written.push(ev); } } as any;
    const pub = new AuctionsPublisher(outbox);
    const tx = {} as any;
    await pub.watchersAuctionEnded(tx, 't1', 'a1', ['u2', 'u3'], true);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      tenantId: 't1', aggregateType: 'auction', aggregateId: 'a1',
      eventType: AuctionEventType.WatchersEnded,
    });
    expect(written[0].payload).toMatchObject({ v: 1, auctionId: 'a1', recipientUserIds: ['u2', 'u3'], hadWinner: true });
  });

  it('is wired into the notification spine → auction.ended for the watcher recipients', () => {
    const row = NOTIFICATION_EVENT_MAP.find((r) => r.outboxType === AuctionEventType.WatchersEnded);
    expect(row).toBeDefined();
    expect(row!.eventCode).toBe('auction.ended');
    expect(row!.recipientKeys).toContain('recipientUserIds');
  });
});

describe('Auction.editSchedule (scheduled-only)', () => {
  it('updates reserve / increment / window and emits auction_updated', () => {
    const a = english(); a.pullEvents();
    a.editSchedule({ reservePriceMinor: 200000n, minIncrementMinor: 5000n, endsAt: new Date('2026-04-03T00:00:00Z') });
    const p = a.toProps();
    expect(p.reservePriceMinor).toBe(200000n);
    expect(p.minIncrementMinor).toBe(5000n);
    expect(p.endsAt).toEqual(new Date('2026-04-03T00:00:00Z'));
    expect(a.pullEvents().map((e) => e.type)).toContain(AuctionEventType.Updated);
  });
  it('clears the reserve when passed null', () => {
    const a = english({ reservePriceMinor: 200000n });
    a.editSchedule({ reservePriceMinor: null });
    expect(a.toProps().reservePriceMinor).toBeNull();
  });
  it('rejects reserve < start, ends ≤ starts, non-positive increment', () => {
    expect(() => english().editSchedule({ reservePriceMinor: 50000n })).toThrow(InvalidAuctionError);
    expect(() => english().editSchedule({ endsAt: base.startsAt })).toThrow(InvalidAuctionError);
    expect(() => english().editSchedule({ minIncrementMinor: 0n })).toThrow(InvalidAuctionError);
  });
  it('refuses to edit once the auction has left scheduled', () => {
    const a = english(); a.open();   // → live
    expect(() => a.editSchedule({ minIncrementMinor: 5000n })).toThrow(InvalidAuctionError);
  });
});
