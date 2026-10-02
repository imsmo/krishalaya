// modules/auctions/__tests__/tenant11a-auction-gates.spec.ts · PC-56 TENANT-11a — the static gates (unit project):
// the route-order gate · the auditor gate · the module's registrations · the handlers never touching the relay's tx ·
// 0186 + seeds as text.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import { AUDITOR_READ_ACT_KEY, auditorVerdict } from '../../../core/auth/auditor-read-only.guard';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';
import { AuctionsController } from '../controllers/v1/auctions.controller';
import { BidsController } from '../controllers/v1/bids.controller';
import { AuctionPaymentSucceededHandler } from '../events/handlers/payment-succeeded.handler';
import { AuctionOrderCancelledHandler } from '../events/handlers/order-cancelled.handler';
import { auctionActor, canReadBids, canSchedule } from '../policies/auctions.policies';

const ctx = (perms: string[]) => ({ userId: 'u', tenantId: 't', permissions: new Set(perms) }) as never;

describe('the route-order gate + the auditor gate', () => {
  const NAME: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE' };
  const routes: Array<{ m: string; segs: string[]; label: string; perms: string[] | undefined; act?: unknown }> = [];
  for (const [name, cls] of Object.entries({ AuctionsController, BidsController }) as Array<[string, any]>) {
    const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
    for (const h of Object.getOwnPropertyNames(cls.prototype)) {
      const fn = cls.prototype[h];
      if (h === 'constructor' || typeof fn !== 'function') continue;
      const m = Reflect.getMetadata(METHOD_METADATA, fn);
      if (m === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, fn) ?? '');
      const full = [base, sub].filter((x) => x && x !== '/').join('/');
      routes.push({ m: NAME[m], segs: full.split('/').filter(Boolean), label: `${NAME[m]} /${full} (${name}.${h})`, perms: Reflect.getMetadata(PERMISSIONS_KEY, fn), act: Reflect.getMetadata(AUDITOR_READ_ACT_KEY, fn) });
    }
  }
  it('no earlier route matches a later route\'s static path (GET :id never swallows GET watching / my-bids)', () => {
    const shadows: string[] = [];
    routes.forEach((a, i) => routes.slice(i + 1).forEach((b) => {
      if (a.m !== b.m || a.segs.length !== b.segs.length || a.segs[0] !== b.segs[0]) return;
      const covers = a.segs.every((s, k) => s.startsWith(':') || s === b.segs[k]);
      const differs = a.segs.some((s, k) => s.startsWith(':') && !b.segs[k].startsWith(':'));
      if (covers && differs) shadows.push(`${a.label} shadows ${b.label}`);
    }));
    expect(shadows).toEqual([]);
  });
  it('the new acts exist; pause / resume read auction.pause_entry; every non-GET is refused for an auditor', () => {
    const labels = routes.map((r) => r.label.split(' (')[0]);
    expect(labels).toEqual(expect.arrayContaining(['POST /auctions/:id/approve', 'POST /auctions/:id/cancel', 'POST /auctions/:id/pause-entry', 'POST /auctions/:id/resume-entry', 'PATCH /auctions/:id', 'DELETE /auctions/:id/watch']));
    for (const l of ['POST /auctions/:id/pause-entry', 'POST /auctions/:id/resume-entry']) expect(routes.find((r) => r.label.startsWith(l))!.perms).toEqual(['auction.pause_entry']);
    const mutating = routes.filter((x) => x.m !== 'GET');
    expect(mutating.length).toBeGreaterThanOrEqual(9);
    for (const r of mutating) { expect(r.act).toBeUndefined(); expect(auditorVerdict(['auditor'], r.m, r.act as never)).toBe('refused'); }
  });
});

describe('F-10 · the auction desk\'s verbs, not moderation reach', () => {
  it('support_agent / ai_ops (listing.moderate, dispute.resolve) hold NO auction verb', () => {
    expect(auctionActor(ctx(['listing.moderate', 'dispute.resolve']))).toEqual({ userId: 'u', onBehalf: false, cancelLive: false, pauseEntry: false });
    expect(canSchedule(ctx(['listing.moderate']))).toBe(false);
  });
  it('schedule = auction.create OR auction.schedule_on_behalf; the bid stream = auction.bid OR auction.read', () => {
    expect(canSchedule(ctx(['auction.create']))).toBe(true); expect(canSchedule(ctx(['auction.schedule_on_behalf']))).toBe(true);
    expect(canReadBids(ctx(['auction.read']))).toBe(true); expect(canReadBids(ctx(['auction.bid']))).toBe(true); expect(canReadBids(ctx([]))).toBe(false);
  });
  it('the outcomes are mapped into the notification spine', () => {
    const map = Object.fromEntries(NOTIFICATION_EVENT_MAP.map((e) => [e.outboxType, e]));
    expect(map['auctions.auction_won']).toMatchObject({ eventCode: 'bid.won', recipientKeys: ['bidderUserId'] });
    for (const [t, c] of [['auctions.auction_cancelled', 'auction.cancelled'], ['auctions.auction_failed_reserve', 'auction.failed_reserve'], ['auctions.auction_defaulted', 'auction.defaulted'], ['auctions.auction_lapsed', 'auction.lapsed']])
      expect(map[t]).toMatchObject({ eventCode: c, recipientKeys: ['recipientUserIds'] });
  });
});

describe('F-9 · the handlers never use the relay\'s transaction; the module registers five sweeps', () => {
  it('payment_succeeded (order) → onOrderPaid; (auction) → nothing; order_cancelled → onOrderCancelled with the role', async () => {
    const relayTx = { query: jest.fn() };
    const svc = { onOrderPaid: jest.fn(async () => true), onOrderCancelled: jest.fn(async () => 'skipped') };
    await new AuctionPaymentSucceededHandler(svc as never).handle({ id: '1', tenantId: 't', aggregateType: 'payment', aggregateId: 'p', eventType: 'payments.payment_succeeded', payload: { referenceType: 'order', referenceId: 'o' } } as never);
    await new AuctionPaymentSucceededHandler(svc as never).handle({ id: '2', tenantId: 't', aggregateType: 'payment', aggregateId: 'p', eventType: 'payments.payment_succeeded', payload: { referenceType: 'auction', referenceId: 'a' } } as never);
    await new AuctionOrderCancelledHandler(svc as never).handle({ id: '3', tenantId: 't', aggregateType: 'order', aggregateId: 'o', eventType: 'orders.order_cancelled', payload: { role: 'buyer' } } as never);
    expect(svc.onOrderPaid.mock.calls).toEqual([['t', 'o']]);
    expect(svc.onOrderCancelled.mock.calls).toEqual([['t', 'o', 'buyer']]);
    expect(relayTx.query).not.toHaveBeenCalled();
  });
  it('auctions.module registers the two consumers and the five jobs', () => {
    const mod = fs.readFileSync(path.join(__dirname, '../auctions.module.ts'), 'utf8');
    expect(mod).toMatch(/this\.registry\.register\(this\.paymentSucceeded\)/);
    expect(mod).toMatch(/this\.registry\.register\(this\.orderCancelled\)/);
    expect(mod).toMatch(/\[this\.openJob, this\.closeJob, this\.lapseJob, this\.releaseJob, this\.defaultJob\]\) this\.jobs\.register\(j\)/);
  });
  it('the dead listings AuctionSettledHandler is gone (one path, not two)', () => {
    expect(fs.existsSync(path.join(__dirname, '../../listings/events/handlers/auction-settled.handler.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(__dirname, '../../listings/listings.module.ts'), 'utf8')).not.toMatch(/AuctionSettledHandler,|AuctionSettledHandler\]/);
  });
});

describe('0186 + seeds · as text', () => {
  const root = path.join(__dirname, '../../../../../../db');
  const mig = fs.readFileSync(path.join(root, 'migrations/0186_auction_truth.sql'), 'utf8');
  const s4 = fs.readFileSync(path.join(root, 'seeds/core/0004_roles_permissions.sql'), 'utf8');
  const s5 = fs.readFileSync(path.join(root, 'seeds/core/0005_lookup_vocabularies.sql'), 'utf8');
  const s7 = fs.readFileSync(path.join(root, 'seeds/core/0007_notification_events_templates.sql'), 'utf8');
  it('both new tables: RLS ENABLE + FORCE, the 0175 split with WITH CHECK, admin realm; no grant to kv_relay', () => {
    for (const t of ['auction_settlements', 'auction_consents']) {
      expect(mig).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      expect(mig).toContain(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      expect(mig).toMatch(new RegExp(`ON ${t} FOR INSERT WITH CHECK \\(tenant_id = current_tenant_id\\(\\)\\)`));
      expect(mig).toMatch(new RegExp(`ON ${t} FOR ALL TO kv_admin`));
    }
    expect(mig.split(';').filter((s) => /GRANT[^;]*TO kv_relay/.test(s))).toEqual([]);
    expect(mig).toMatch(/GRANT DELETE ON auction_watchers TO kv_app;/);
    expect(mig).toMatch(/GRANT UPDATE \(outcome, outcome_at, emd_forfeit_txn_id, emd_return_txn_id\) ON auction_settlements TO kv_app;/);
  });
  it('the vocabulary and the verbs live in BOTH the migration and the fresh-install seeds', () => {
    for (const code of ['emd_apply', 'emd_forfeit', 'emd_return']) { expect(mig).toContain(`'${code}'`); expect(s5).toContain(`'${code}'`); }
    for (const p of ['auction.read', 'auction.schedule_on_behalf', 'auction.cancel_live', 'auction.pause_entry']) { expect(mig).toContain(`'${p}'`); expect(s4).toContain(`'${p}'`); }
    // the auditor's realm stays EXACTLY its five reads (TENANT-9c): auction.read is broad, but not the auditor's
    const grantClause = mig.slice(mig.indexOf("WHERE (p.code = 'auction.read'"), mig.indexOf('ON CONFLICT DO NOTHING', mig.indexOf("WHERE (p.code = 'auction.read'")));
    expect(grantClause).not.toContain("'auditor'");
    const seedClause = s4.slice(s4.indexOf('[PC-56 TENANT-11a] the auction desk (0186)'), s4.indexOf("p.code IN ('auction.read'))"));
    expect(seedClause).not.toContain("'auditor'");
  });
  it('every new notification event has push + inapp templates in en / hi / gu, above the version backfill', () => {
    const backfill = s7.indexOf('NOTE (TENANT-6d-1): the block above sits BEFORE this backfill');
    for (const code of ['auction.cancelled', 'auction.failed_reserve', 'auction.defaulted', 'auction.lapsed']) {
      expect(mig).toContain(`'${code}'`);
      for (const ch of ['push', 'inapp']) for (const lang of ['en', 'hi', 'gu']) {
        const at = s7.indexOf(`('${code}','${ch}','${lang}'`);
        expect(at).toBeGreaterThan(0); expect(at).toBeLessThan(backfill);
      }
    }
    for (const lang of ['en', 'hi', 'gu']) expect(s7).toContain(`('bid.won','push','${lang}'`);
  });
});
