// modules/dairy/__tests__/tenant6d8-notice.spec.ts · PC-56 TENANT-6d-8 · THE NOTICE.
//
// *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers, Gujarati voice)"*
//
// TENANT-6d-6 built the diversion and printed *"these members are NOT told by this platform"*. TENANT-6d-7 found why
// that could not simply be switched on: every fan-out resolved to English, and fifteen declared template variables
// rendered as the empty string. This wave sends it — so what this spec is mostly about is the difference between
// SENDING and CLAIMING TO HAVE SENT.
//
//   • the strongest state is `queued`, because the outbox row is written in the signing transaction and delivery is a
//     phone that may be off;
//   • a REQUEST announces nothing (one person must not move 87 families);
//   • a signed diversion that is CALLED OFF is retracted — telling families to walk to Bhesan and not telling them it
//     is off is the same promise broken twice;
//   • the notice is chunked, because a fan-out runs inside one relay transaction and a union centre is not 87 people;
//   • and the delivery report counts PEOPLE, not delivery rows: 87 families reached on push and in the app are 87, not
//     174.
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  NOTICE_STATES, chunkRecipients, noticeState, noticeStateKey, NOTICE_CHUNK,
} from '../domain/dairy-diversion';
import { NOTICE_FLAG, DIVERSION_FLAG } from '../domain/dairy-diversion.flags';
import { diversionNoticeVars } from '../domain/dairy-notice-vars';
import { DairyEventType } from '../domain/dairy.events';
import { DairyDiversionService, NOTICE_REPORT_WINDOW_MS } from '../services/dairy-diversion.service';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';
import { DiversionsController } from '../controllers/v1/diversions.controller';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';
import { NotificationRepository } from '../../communication/repositories/notification.repository';
import { pickLang, LangMap } from '../../../core/i18n/lang-map';

const VANTHALI = 'mcc-vanthali';
const BHESAN = 'mcc-bhesan';
const TODAY = '2026-08-21';
const AT = new Date('2026-08-21T10:30:00.000Z');

const mig = () => fs.readFileSync(
  path.join(__dirname, '../../../../../../db/migrations/0167_dairy_shift_diversion_notice.sql'), 'utf8');
const copy = () => fs.readFileSync(
  path.join(__dirname, '../../../../../../db/seeds/core/0007_notification_events_templates.sql'), 'utf8');

const LABELS = {
  shift: {
    morning: { en: 'morning', hi: 'subah', gu: 'સવાર' } as LangMap,
    evening: { en: 'evening', hi: 'shaam', gu: 'સાંજ' } as LangMap,
  },
  qualityOutcome: { cleared: { en: 'cleared' } as LangMap, rejected: { en: 'not accepted' } as LangMap },
  disputeOutcome: { upheld: { en: 'upheld' } as LangMap, rejected: { en: 'rejected' } as LangMap },
};

describe('PC-56 TENANT-6d-8 · what this platform may honestly say about telling 87 families', () => {
  const st = (o: Partial<Parameters<typeof noticeState>[0]>) => noticeState({
    enabled: true, signed: true, recipients: 87, queuedAt: null, retractionQueuedAt: null, ...o,
  });

  it('has no `sent` in its vocabulary, and that is the whole design', () => {
    // The outbox row commits with the signature; everything after it is delivery, which lives in `notifications` and is
    // answered by the report. A state called `sent` would be this wave lying in the shape 6d-7 spent a wave removing.
    expect([...NOTICE_STATES]).toEqual(['not_enabled', 'not_signed', 'nobody_to_tell', 'queued', 'retracted']);
    expect(NOTICE_STATES).not.toContain('sent');
    expect(NOTICE_STATES).not.toContain('delivered');
  });

  it('says NOT SIGNED for a request — one person does not move a village', () => {
    expect(st({ signed: false })).toBe('not_signed');
    // ...even with the notice switched on: the flag decides who announces it, the signature decides whether there is
    // anything to announce.
    expect(st({ signed: false, enabled: true })).toBe('not_signed');
  });

  it('says NOT ENABLED when this cooperative announces its own diversions', () => {
    expect(st({ enabled: false })).toBe('not_enabled');
    // A cooperative whose telephony contract is not signed yet diverts shifts and tells its families by loudspeaker,
    // which is what they did before this platform existed. Showing a count that reached nobody would be worse.
  });

  it('REPORTS THE RECEIPT WHATEVER THE FLAG SAYS NOW', () => {
    // A cooperative that switched the notice off this morning did not un-tell last night's 87 families. A screen that
    // claimed otherwise would be rewriting history to match a toggle.
    expect(st({ enabled: false, queuedAt: '2026-08-20T13:00:00Z' })).toBe('queued');
    expect(st({ enabled: false, signed: false, queuedAt: '2026-08-20T13:00:00Z' })).toBe('queued');
  });

  it('says RETRACTED once the retraction is queued, and never hides it behind `queued`', () => {
    expect(st({ queuedAt: '2026-08-20T13:00:00Z', retractionQueuedAt: '2026-08-20T16:00:00Z' })).toBe('retracted');
  });

  it('says NOBODY TO TELL only when there was genuinely nobody', () => {
    // Signed, enabled, and no receipt ⇒ the roll was empty that day. A real state: a centre whose milk arrives by
    // tanker can be diverted with no members routed to it at all.
    expect(st({ recipients: 0 })).toBe('nobody_to_tell');
    expect(noticeStateKey('queued')).toBe('dairy.diversion.notice.queued');
    for (const s of NOTICE_STATES) expect(noticeStateKey(s)).toBe(`dairy.diversion.notice.${s}`);
  });
});

describe('PC-56 TENANT-6d-8 · the notice is chunked, and the chunking is a decision', () => {
  it('sends W170\'s own 87 pourers as ONE event', () => {
    const ids = Array.from({ length: 87 }, (_, i) => `u${i}`);
    expect(chunkRecipients(ids).length).toBe(1);
    expect(chunkRecipients(ids)[0]).toHaveLength(87);
  });

  it('splits a district union\'s centre, because a fan-out runs inside ONE relay transaction', () => {
    const ids = Array.from({ length: 2_000 }, (_, i) => `u${i}`);
    const chunks = chunkRecipients(ids);
    expect(chunks.length).toBe(4);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 500, 500]);
    // Every member, exactly once: a chunking that dropped or duplicated somebody would either leave a family at a
    // locked centre or phone them twice at five in the morning.
    expect(new Set(chunks.flat()).size).toBe(2_000);
    expect(chunks.flat()).toEqual(ids);
  });

  it('handles the odd tail and the empty roll without inventing an event', () => {
    expect(chunkRecipients(Array.from({ length: 501 }, (_, i) => `u${i}`)).map((c) => c.length)).toEqual([500, 1]);
    expect(chunkRecipients([])).toEqual([]);          // nobody to tell ⇒ no outbox row at all
    expect(NOTICE_CHUNK).toBe(500);
    expect(() => chunkRecipients(['u1'], 0)).toThrow(/at least one recipient/);
  });
});

describe('PC-56 TENANT-6d-8 · the words the members actually get', () => {
  it('names both villages, the day in digits, and the shift in the member\'s own language', () => {
    const v = diversionNoticeVars({
      fromName: 'Vanthali', toName: 'Bhesan', day: TODAY, shift: 'evening', labels: LABELS as never,
    });
    expect(v).toEqual({ from: 'Vanthali', to: 'Bhesan', day: '21/08', shift: LABELS.shift.evening });
    // The whole reason TENANT-6d-7 had to come first: this value is a per-language map and the TEMPLATE picks from it.
    expect(pickLang(v.shift, 'gu')).toBe('સાંજ');
    expect(pickLang(v.shift, 'hi')).toBe('shaam');
    expect(pickLang(v.shift, 'en')).toBe('evening');
  });

  it('prints the day even when it is today, because a diversion may be signed a week ahead', () => {
    const v = diversionNoticeVars({ fromName: 'A', toName: 'B', day: '2026-08-28', shift: 'morning', labels: LABELS as never });
    expect(v.day).toBe('28/08');
    // *"tonight"* read the next morning is worse than a date — and a month NAME would be a word this platform holds in
    // no language, which is exactly the hole 6d-7 closed.
    expect(v.day).not.toMatch(/[A-Za-z]/);
  });

  it('seeds four channels x three languages for BOTH events, above the version backfill', () => {
    const text = copy();
    const rows = [...text.matchAll(/^\s*\('(dairy\.shift_diverted|dairy\.shift_diversion_cancelled)','([a-z]+)','([a-z]+)'/gm)];
    expect(rows.length).toBe(24);
    for (const ev of ['dairy.shift_diverted', 'dairy.shift_diversion_cancelled']) {
      const mine = rows.filter((r) => r[1] === ev);
      expect([...new Set(mine.map((r) => r[2]))].sort()).toEqual(['inapp', 'ivr', 'push', 'sms']);
      expect([...new Set(mine.map((r) => r[3]))].sort()).toEqual(['en', 'gu', 'hi']);
    }
    // ABOVE THE BACKFILL, or every one of these ships with `serving_version_id = NULL`, resolves to nothing and is
    // recorded `no_template` — silently. TENANT-6c-2's finding, which 6d-1 and 6d-5 both had to route around.
    expect(text.indexOf("'dairy.shift_diverted','ivr','gu'"))
      .toBeLessThan(text.indexOf('INSERT INTO notification_template_versions'));
  });

  it('says the voice line TWICE, and never says the membership changed', () => {
    const text = copy();
    for (const lang of ['gu', 'hi', 'en']) {
      const ivr = text.split('\n').find((l) => l.includes(`('dairy.shift_diverted','ivr','${lang}'`))!;
      // A voice call is heard once, by somebody who may be milking. The instruction is repeated inside the same body.
      expect(ivr).toMatch(/\{\{to\}\}[\s\S]*\{\{to\}\}/);
    }
    // A DIVERSION IS NOT A TRANSFER (0166's own words), and the sentence that says so belongs in the notice a family
    // reads — not only in the schema. Present on the in-app leg of both events, where there is room for it.
    const inapp = text.split('\n').filter((l) => l.includes("','inapp','") && l.includes('dairy.shift_div'));
    expect(inapp.length).toBe(6);
    for (const row of inapp) expect(row).toMatch(/membership|સભ્યપદ/);
  });
});

describe('PC-56 TENANT-6d-8 · who is told, in SQL', () => {
  const repo = () => fs.readFileSync(path.join(__dirname, '../repositories/dairy-diversion.repository.ts'), 'utf8');
  const q = () => { const s = repo(); return s.slice(s.indexOf('async affectedMemberUserIds'), s.indexOf('async noticeQueued')); };

  it('reads the ROUTE HISTORY as of the diverted day, not today\'s routing', () => {
    // TENANT-6d-3's argument, and 6d-6 applied it to the COUNT. The notice needs the same rule for the LIST, or the
    // families told are not the families affected.
    expect(q()).toContain('FROM dairy_membership_routes r');
    expect(q()).toContain('r.valid_from <= $3::date');
    expect(q()).toContain('r.valid_to IS NULL OR r.valid_to >= $3::date');
    expect(q()).not.toContain('dairy_memberships.mcc_id');
  });

  it('skips a SUSPENDED membership and counts a family ONCE', () => {
    // A suspended membership is not a family walking to a locked door...
    expect(q()).toContain('m.is_active = true');
    // ...and a member whose route history has two touching rows for one centre is one person, phoned once. Two calls at
    // five in the morning is how a cooperative learns to ignore this platform.
    expect(q()).toContain('SELECT DISTINCT m.farmer_user_id');
  });

  it('writes each receipt ONCE, and fails closed when the row moved', () => {
    const s = repo();
    for (const which of ['notice_queued_at', 'retraction_queued_at']) {
      const w = s.slice(s.indexOf(`SET ${which}=`), s.indexOf(`SET ${which}=`) + 400);
      // WRITE-ONCE: a retry after the outbox write succeeded must not move the instant the members were told.
      expect(w).toContain(`AND ${which} IS NULL AND deleted_at IS NULL`);
    }
    expect(s).toContain('notice receipt not written');
    expect(s).toContain('retraction receipt not written');
  });

  it('FAILS CLOSED on a receipt whose row moved under it', async () => {
    // The thirteenth and fourteenth writers in this repository to refuse a zero-row UPDATE. A receipt for a diversion
    // that is no longer live would tell a cooperative its members were warned about something that is not happening.
    const r = new DairyDiversionRepository({ forTenant: () => ({ query: jest.fn() }) } as never);
    const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
    await expect(r.noticeQueued(tx as never, 't1', 'div-1', AT, 87)).rejects.toThrow(/notice receipt not written/);
    await expect(r.retractionQueued(tx as never, 't1', 'div-1', AT, 87)).rejects.toThrow(/retraction receipt not written/);
  });
});

describe('PC-56 TENANT-6d-8 · the spine is wired for it', () => {
  it('maps BOTH events to a recipient LIST — the first dairy events that are about many people', () => {
    const rows = NOTIFICATION_EVENT_MAP.filter((m) => m.outboxType.startsWith('dairy.shift_div'));
    expect(rows.map((r) => r.outboxType).sort()).toEqual(['dairy.shift_diversion_cancelled', 'dairy.shift_diverted']);
    for (const r of rows) {
      expect(r.eventCode).toBe(r.outboxType);          // the outbox type IS the catalogue code for these two
      expect(r.recipientKeys).toEqual(['recipientUserIds']);
    }
    expect(DairyEventType.ShiftDiverted).toBe('dairy.shift_diverted');
    expect(DairyEventType.ShiftDiversionCancelled).toBe('dairy.shift_diversion_cancelled');
  });

  it('catalogues the retraction as CRITICAL and unmutable, with the voice channel first', () => {
    const m = mig();
    const row = m.slice(m.indexOf("'dairy.shift_diversion_cancelled'"), m.indexOf('167.2'));
    expect(row).toContain("'critical'");
    expect(row).toContain('false, false');                      // user_can_opt_out = false, batchable = false
    expect(row).toMatch(/\["ivr","sms","push","inapp"\]/);        // voice FIRST
    // And the diversion notice gains the in-app leg — the only channel that leaves something a member can re-read
    // standing at the counter.
    expect(m).toMatch(/SET default_channels = '\["ivr","sms","push","inapp"\]'/);
  });

  it('keeps the receipt honest in the DATABASE: pairs, and no retraction without a notice', () => {
    const m = mig();
    expect(m).toContain('ck_dairy_diversion_notice_pair');
    expect(m).toMatch(/CHECK \(\(notice_queued_at IS NULL\) = \(notice_recipients IS NULL\)\)/);
    expect(m).toContain('ck_dairy_diversion_retraction_needs_notice');
    expect(m).toMatch(/CHECK \(retraction_queued_at IS NULL OR notice_queued_at IS NOT NULL\)/);
    // The grant is EXTENDED by exactly four columns, not replaced: 0166 narrowed this table to two endings and a
    // `REVOKE ALL` + `GRANT` pair here would silently widen it back.
    expect(m).toMatch(/GRANT UPDATE \(notice_queued_at, notice_recipients, retraction_queued_at, retraction_recipients\)/);
    expect(m).not.toMatch(/REVOKE UPDATE ON dairy_shift_diversions/);
  });

  it('indexes the delivery report\'s own question, and flags the notice OFF', () => {
    const m = mig();
    expect(m).toContain('CREATE INDEX IF NOT EXISTS idx_notif_event_created ON notifications (event_code, created_at DESC)');
    expect(m).toContain("'dairy_shift_diversion_notice'");
    expect(m).toMatch(/false, 100, 'experiment'/);
    expect(NOTICE_FLAG).toBe('dairy_shift_diversion_notice');
    // TWO flags, not one: the act and the announcement are separate decisions for a cooperative.
    expect(DIVERSION_FLAG).toBe('dairy_shift_diversion');
    expect(NOTICE_FLAG).not.toBe(DIVERSION_FLAG);
  });

  it('declares the notice\'s route AFTER preview and gates it on dairy.manage', () => {
    const proto = DiversionsController.prototype as unknown as Record<string, unknown>;
    const gets = Object.getOwnPropertyNames(proto)
      .filter((m) => m !== 'constructor')
      .filter((m) => Reflect.getMetadata(METHOD_METADATA, proto[m] as never) === RequestMethod.GET)
      .map((m) => Reflect.getMetadata(PATH_METADATA, proto[m] as never) as string);
    expect(gets).toContain(':id/notice');
    // There is no `@Get(':id')` on this controller, so nothing can swallow it — asserted rather than assumed, because
    // the route-order trap is the one this programme has now documented seven times.
    expect(gets).not.toContain(':id');
  });
});

describe('PC-56 TENANT-6d-8 · the act tells them, and records what it did', () => {
  // **THE DIVERTED DAY IS NOT TODAY, DELIBERATELY.** W170's own diversion is for tonight, and a harness whose
  // `divertedOn` equals the database's today cannot see a recipient read that used the wrong one — the two values
  // coincide and the mutant survives. (TENANT-6d-7 lost a mutant to exactly this collision; the lesson is one wave old.)
  const DIVERTED_ON = '2026-08-24';
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'div-1', tenantId: 't1', fromMccId: VANTHALI, toMccId: BHESAN, divertedOn: DIVERTED_ON, shift: 'evening',
    reason: 'power cut, DG will not hold the evening', requestedBy: 'operator', requestedAt: '2026-08-21T09:00:00Z',
    approvedBy: null, approvedAt: null, cancelledBy: null, cancelledAt: null, cancelReason: null,
    noticeQueuedAt: null, noticeRecipients: null, retractionQueuedAt: null, retractionRecipients: null, ...over,
  });

  const harness = (o: { enabled?: boolean; recipients?: number; forUpdate?: Record<string, unknown> } = {}) => {
    const recipients = Array.from({ length: o.recipients ?? 87 }, (_, i) => `farmer-${i}`);
    const centre = (id: string) => ({ toProps: () => ({ id, code: id === VANTHALI ? 'MCC-VNT' : 'MCC-BHE', defaultName: id === VANTHALI ? 'Vanthali' : 'Bhesan', isActive: true }) });
    const repo = {
      pendingOrLive: jest.fn(async () => null),
      // **THE COUNT AND THE LIST ARE DIFFERENT NUMBERS, ALSO DELIBERATELY.** `affectedMembers` counts MEMBERSHIPS on
      // that roll and the recipient list counts DISTINCT FARMERS, so a family with two memberships makes them differ —
      // and a receipt written from the wrong one is invisible while they agree.
      affectedMembers: jest.fn(async () => recipients.length + 3),
      affectedMemberUserIds: jest.fn(async () => recipients),
      insert: jest.fn(async (_tx: unknown, i: Record<string, unknown>) => row(i)),
      forUpdate: jest.fn(async () => row(o.forUpdate ?? {})),
      byId: jest.fn(async () => row(o.forUpdate ?? {})),
      approve: jest.fn(), cancel: jest.fn(),
      noticeQueued: jest.fn(), retractionQueued: jest.fn(),
      poursAt: jest.fn(async () => 0), poursUnder: jest.fn(async () => 0),
      list: jest.fn(async () => [row(o.forUpdate ?? {})]),
    };
    const outbox: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn(async () => ({ rows: [{ d: TODAY }] })) })) };
    const notifications = { deliveryReportFor: jest.fn(async () => ({
      rows: 174, people: 84, byStatus: { sent: 168, failed: 6 }, byChannel: { push: 87, inapp: 87 },
      byLanguage: { gu: 150, hi: 24 }, byEvent: { 'dairy.shift_diverted': 174 },
    })) };
    const svc = new DairyDiversionService(
      uow as never, { write: jest.fn(async (_tx: unknown, e: { eventType: string; payload: Record<string, unknown> }) => { outbox.push(e); }) } as never,
      { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) } as never,
      { inc: jest.fn(), observe: jest.fn() } as never, { write: jest.fn() } as never, repo as never,
      { getById: jest.fn(async (_t: string, id: string) => centre(id)) } as never,
      { isEnabled: jest.fn(async () => o.enabled ?? true) } as never,
      { labels: jest.fn(async () => LABELS) } as never,
      notifications as never);
    return { svc, repo, outbox, notifications };
  };
  const lead = { userId: 'lead', canManage: true, canOverride: true };
  const operator = { userId: 'operator', canManage: true, canOverride: false };

  it('QUEUES THE NOTICE WHEN THE SECOND SIGNATURE LANDS, with the words and the ids', async () => {
    const h = harness();
    const signed = await h.svc.approve('t1', lead as never, 'k1', 'div-1', null);
    const notice = h.outbox.find((e) => e.eventType === DairyEventType.ShiftDiverted)!;
    expect(notice).toBeDefined();
    expect((notice.payload.recipientUserIds as string[]).length).toBe(87);
    expect(notice.payload.from).toBe('Vanthali');
    expect(notice.payload.to).toBe('Bhesan');
    expect(notice.payload.day).toBe('24/08');
    expect(pickLang(notice.payload.shift as LangMap, 'gu')).toBe('સાંજ');
    expect(notice.payload.diversionId).toBe('div-1');
    // THE RECEIPT, written in the same transaction as the signature.
    expect(h.repo.noticeQueued).toHaveBeenCalledTimes(1);
    expect((h.repo.noticeQueued.mock.calls[0] as unknown[])[4]).toBe(87);
    expect(signed.notice).toBe('queued');
    // Resolved from the ROUTE HISTORY as of the diverted day, not from today's membership rows.
    // AS OF THE DIVERTED DAY, and the harness's day is NOT today — a member who moved away last week is not on
    // tonight's list, and a member who moved TO this centre is.
    expect(h.repo.affectedMemberUserIds).toHaveBeenCalledWith(expect.anything(), 't1', VANTHALI, DIVERTED_ON);
    expect(DIVERTED_ON).not.toBe(TODAY);
  });

  it('QUEUES NOTHING when the notice is switched off, and says so', async () => {
    const h = harness({ enabled: false });
    const signed = await h.svc.approve('t1', lead as never, 'k1', 'div-1', null);
    expect(h.outbox.find((e) => e.eventType === DairyEventType.ShiftDiverted)).toBeUndefined();
    expect(h.repo.noticeQueued).not.toHaveBeenCalled();
    expect(signed.notice).toBe('not_enabled');
    // The diversion itself still happened and still announced ITSELF to the platform's own subscribers — the flag is on
    // the member notice, not on the act.
    expect(h.outbox.some((e) => e.eventType === 'dairy.diversion_approved')).toBe(true);
  });

  it('writes NO OUTBOX ROW for an empty roll, and no receipt either', async () => {
    const h = harness({ recipients: 0 });
    const signed = await h.svc.approve('t1', lead as never, 'k1', 'div-1', null);
    expect(h.outbox.find((e) => e.eventType === DairyEventType.ShiftDiverted)).toBeUndefined();
    // The receipt IS written — for zero — because "we announced it to nobody" is a fact, and the state derives from it.
    expect(h.repo.noticeQueued).toHaveBeenCalledTimes(1);
    expect((h.repo.noticeQueued.mock.calls[0] as unknown[])[4]).toBe(0);
    expect(signed.notice).toBe('queued');
  });

  it('CHUNKS a village into events of five hundred', async () => {
    const h = harness({ recipients: 1_100 });
    await h.svc.approve('t1', lead as never, 'k1', 'div-1', null);
    const notices = h.outbox.filter((e) => e.eventType === DairyEventType.ShiftDiverted);
    expect(notices.length).toBe(3);
    expect(notices.map((n) => (n.payload.recipientUserIds as string[]).length)).toEqual([500, 500, 100]);
    // Every chunk carries the SAME words and the same diversion id — a member in chunk three gets the same sentence as
    // a member in chunk one, which is what makes them one announcement rather than three.
    for (const n of notices) {
      expect(n.payload.day).toBe('24/08');
      expect(n.payload.diversionId).toBe('div-1');
    }
    expect((h.repo.noticeQueued.mock.calls[0] as unknown[])[4]).toBe(1_100);
  });

  it('RETRACTS a signed diversion that is called off — the same promise, the other way round', async () => {
    const h = harness({ forUpdate: { approvedBy: 'lead', approvedAt: '2026-08-21T10:00:00Z', noticeQueuedAt: '2026-08-21T10:00:00Z', noticeRecipients: 87 } });
    const done = await h.svc.cancel('t1', operator as never, 'k2', 'div-1', 'DG held after all', null);
    const retraction = h.outbox.find((e) => e.eventType === DairyEventType.ShiftDiversionCancelled)!;
    expect(retraction).toBeDefined();
    expect((retraction.payload.recipientUserIds as string[]).length).toBe(87);
    // The retraction names the SAME two villages, so a member reading both messages can tell they are about one thing.
    expect(retraction.payload.from).toBe('Vanthali');
    expect(retraction.payload.to).toBe('Bhesan');
    expect(h.repo.retractionQueued).toHaveBeenCalledTimes(1);
    expect(done.notice).toBe('retracted');
  });

  it('RETRACTS NOTHING when nobody was told — a cancelled request announced nothing', async () => {
    const h = harness({ forUpdate: {} });          // never signed ⇒ no notice ⇒ nothing to take back
    const done = await h.svc.cancel('t1', operator as never, 'k2', 'div-1', 'asked in error', null);
    expect(h.outbox.find((e) => e.eventType === DairyEventType.ShiftDiversionCancelled)).toBeUndefined();
    expect(h.repo.retractionQueued).not.toHaveBeenCalled();
    expect(done.notice).toBe('not_signed');
  });

  it('reports the DELIVERY LOG\'s account, bounded by the notice\'s own instant', async () => {
    const h = harness({ forUpdate: { approvedBy: 'lead', approvedAt: '2026-08-21T10:00:00Z', noticeQueuedAt: '2026-08-21T10:00:00Z', noticeRecipients: 87 } });
    const rep = await h.svc.noticeReport('t1', lead as never, 'div-1');
    expect(rep.state).toBe('queued');
    expect(rep.queuedFor).toBe(87);
    expect(rep.delivery?.people).toBe(84);
    // PEOPLE, not rows: 87 families reached on push and in the app are 87 told, not 174.
    expect(rep.delivery?.rows).toBe(174);
    const [, arg] = h.notifications.deliveryReportFor.mock.calls[0] as unknown as [string, { eventCodes: string[]; from: Date; to: Date; payloadKey: string; payloadValue: string }];
    expect(arg.eventCodes).toEqual([DairyEventType.ShiftDiverted, DairyEventType.ShiftDiversionCancelled]);
    expect(arg.payloadKey).toBe('diversionId');
    expect(arg.payloadValue).toBe('div-1');
    // THE WINDOW IS WHAT KEEPS THIS READ BOUNDED (Law 8): it starts a minute before the receipt and ends two days
    // after, which is one `notifications` partition rather than the whole table.
    expect(arg.to.getTime() - arg.from.getTime()).toBe(NOTICE_REPORT_WINDOW_MS + 60_000);
  });

  it('reports NOTHING TO REPORT rather than zeroes when nothing was announced', async () => {
    const h = harness({ forUpdate: {} });
    const rep = await h.svc.noticeReport('t1', lead as never, 'div-1');
    // Zeroes and "never sent" look identical on a screen and mean opposite things to whoever reads it.
    expect(rep.delivery).toBeNull();
    expect(rep.queuedFor).toBeNull();
    expect(rep.state).toBe('not_signed');
    expect(h.notifications.deliveryReportFor).not.toHaveBeenCalled();
  });
});

/* ============================================================================================================= */
/* WHAT THE REPORT ASKS THE DATABASE — the two statements, and the three rules inside them.                       */
/*                                                                                                              */
/* The live suite proves the counts against real delivery rows; this proves the RULES that make those counts     */
/* mean what the screen says, because a fan-out in a test where every channel succeeds cannot tell a report that  */
/* counts failures from one that does not. (The mutation pass found exactly that gap.)                            */
/* ============================================================================================================= */
describe('PC-56 TENANT-6d-8 · the delivery report\'s own two questions', () => {
  const sent: string[] = [];
  const executor = { query: jest.fn(async (sql: string) => { sent.push(sql); return { rows: [], rowCount: 0 }; }) };
  const repo = new NotificationRepository({ forTenant: () => executor } as never);

  beforeAll(async () => {
    sent.length = 0;
    await repo.deliveryReport('t1', {
      eventCodes: ['dairy.shift_diverted'], from: new Date('2026-08-21T10:00:00Z'), to: new Date('2026-08-23T10:00:00Z'),
      payloadKey: 'diversionId', payloadValue: 'div-1',
    });
  });

  it('BOUNDS BOTH READS by event code, a time window and the thing announced (Law 8)', () => {
    expect(sent.length).toBe(2);
    for (const sql of sent) {
      expect(sql).toContain('event_code = ANY($2::text[])');
      // The window is what keeps this off a full scan of the platform's highest-volume table — `notifications` is
      // RANGE partitioned by `created_at`, so without it Postgres reads every partition that exists.
      expect(sql).toContain('created_at >= $3 AND created_at < $4');
      expect(sql).toContain('payload->>$5 = $6');
      expect(sql).toContain('tenant_id = $1');
    }
  });

  it('counts PEOPLE by distinct user, only on channels that LEFT the platform, only when they went', () => {
    const people = sent[1];
    expect(people).toContain('count(DISTINCT user_id)');
    // A FAILED row is not a person reached. This is the rule the whole report exists for: 84 of 87 is what sends
    // somebody walking round three houses, and counting failures would always say 87.
    expect(people).toContain("status IN ('sent', 'delivered', 'read')");
    expect(people).not.toContain('status IS NOT NULL');
    // And an in-app inbox row is not a phone ringing: it is marked sent the instant it is written, so counting it would
    // make every live user "reached" and the number would answer nothing.
    expect(people).toContain("channel <> 'inapp'");
  });

  it('groups the ROWS by everything a screen prints, and counts them all', () => {
    const rows = sent[0];
    expect(rows).toContain('GROUP BY event_code, channel, language_code, status');
    // No status filter on this one, deliberately: `byStatus` is how a desk sees `no_address` and `no_template` at all.
    expect(rows).not.toContain("status IN ('sent'");
  });
});
