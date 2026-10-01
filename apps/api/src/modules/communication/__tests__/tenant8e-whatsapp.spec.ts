// modules/communication/__tests__/tenant8e-whatsapp.spec.ts · PC-56 TENANT-8e · the broadcast plane's pure rules, pinned.
// (Replaces API-W10's broadcast-state.spec: the machine it pinned — born queued, `markSent(total, total)` — is gone.)
//   • the state machine (Law 5) and the entity's moves;
//   • the form review (W2841–W2844): the words, the role, the channel, the schedule in the cooperative's zone, the edit;
//   • the act verdicts (W2845–W2847): send / cancel;
//   • the audience and the quiet-hours estimate — `resolveChannels` itself over each member;
//   • the counts — the delivery log's groups, never a copy;
//   • the opt-in policy review (W430) and the refused-by-name register; the export's rows and notes (W2839/W2840).
import {
  BROADCAST_ACTS, BROADCAST_FAILURE_REASONS, BROADCAST_STATUSES, BroadcastStatus, IllegalBroadcastTransitionError, actAllowedFrom, assertTransition, canTransition,
  hasFannedOut, isBroadcastStatus, isEditable, isTerminal,
} from '../domain/broadcast.state';
import { Broadcast } from '../domain/broadcast.entity';
import {
  BROADCAST_BODY_MAX, BROADCAST_FORM_REFUSALS, BROADCAST_TITLE_MAX, BroadcastDraftFacts, MAX_LEAD_DAYS, MIN_LEAD_MINUTES, cleanWords, hasMarkup, parseSchedule,
  reviewBroadcastDraft, toLocalWall,
} from '../domain/broadcast-review';
import { ActFacts, BROADCAST_ACT_REFUSALS, MAX_ACT_REASON, actVerdict, reasonRefusal } from '../domain/broadcast-acts';
import { IMPACT_SAMPLE_MAX, audienceRefusals, looksLikeRoleCode, normaliseRoleCode, quietImpact } from '../domain/broadcast-audience';
import { addCounts, countBroadcast, isHeld } from '../domain/broadcast-counts';
import { OPTIN_FORM_REFUSALS, OPTIN_STATEMENT_MAX, WHATSAPP_REFUSED, normaliseSources, reviewOptinPolicy } from '../domain/whatsapp-policy';
import { BROADCAST_EXPORT_HEADER, broadcastExportNotes, broadcastExportRow } from '../domain/broadcast-export';
import type { NotifChannel } from '../domain/communication.events';

const ZONE = 'Asia/Kolkata';
const NOW = new Date('2026-10-01T06:30:00Z');            // 12:00 IST

describe('the state machine (Law 5)', () => {
  it('draft → scheduled | queued | cancelled; scheduled → queued | cancelled | failed; queued → sending | failed; sending → sent | failed', () => {
    const ok: Array<[BroadcastStatus, BroadcastStatus]> = [
      ['draft', 'scheduled'], ['draft', 'queued'], ['draft', 'cancelled'], ['scheduled', 'queued'], ['scheduled', 'cancelled'], ['scheduled', 'failed'],
      ['queued', 'sending'], ['queued', 'failed'], ['sending', 'sent'], ['sending', 'failed'],
    ];
    for (const from of BROADCAST_STATUSES) for (const to of BROADCAST_STATUSES) {
      expect([from, to, canTransition(from, to)]).toEqual([from, to, ok.some(([a, b]) => a === from && b === to)]);
    }
  });
  it('terminal states, the editable one, the fanned-out one; an illegal move is a typed 409', () => {
    expect(BROADCAST_STATUSES.filter(isTerminal)).toEqual(['sent', 'failed', 'cancelled']);
    expect(BROADCAST_STATUSES.filter(isEditable)).toEqual(['draft']);
    expect(BROADCAST_STATUSES.filter(hasFannedOut)).toEqual(['sent']);
    expect(() => assertTransition('sent', 'queued')).toThrow(IllegalBroadcastTransitionError);
    expect(() => assertTransition('draft', 'queued')).not.toThrow();
    const e = new IllegalBroadcastTransitionError('sent', 'queued');
    expect([e.code, e.httpStatus]).toEqual(['BROADCAST_ILLEGAL_TRANSITION', 409]);
    expect(isBroadcastStatus('queued')).toBe(true); expect(isBroadcastStatus('delivered')).toBe(false); expect(isBroadcastStatus(3)).toBe(false);
  });
  it('a person sends a draft only, and cancels a draft or a scheduled broadcast', () => {
    expect(BROADCAST_ACTS).toEqual(['send', 'cancel']);
    expect(BROADCAST_STATUSES.filter((s) => actAllowedFrom('send', s))).toEqual(['draft']);
    expect(BROADCAST_STATUSES.filter((s) => actAllowedFrom('cancel', s))).toEqual(['draft', 'scheduled']);
    expect(BROADCAST_FAILURE_REASONS).toEqual(['no_template', 'no_recipients', 'role_retired', 'unrecorded']);
  });
});

describe('the entity', () => {
  const draft = (scheduledAt: Date | null = null) => Broadcast.draft({ id: 'b1', tenantId: 't1', createdByUserId: 'u1', audienceRoleCode: null, title: 'Hi', body: 'Body', scheduledAt });
  it('is born a draft on channel inapp, with no counts at all (the log is the count)', () => {
    const b = draft(); const p = b.toProps();
    expect([p.status, p.channel, p.eligibleCount, p.sendRequestedBy, p.fannedOutAt]).toEqual(['draft', 'inapp', 0, null, null]);
    expect('sentCount' in p).toBe(false); expect('recipientCount' in p).toBe(false);
    expect(Object.keys(b.toJSON())).not.toContain('sentCount');
  });
  it('send now → queued (with who, when, eligible); with a time → scheduled, not queued', () => {
    const b = draft(); b.requestSend('u2', NOW, 87);
    expect([b.status, b.toProps().sendRequestedBy, b.toProps().eligibleCount, b.toProps().queuedAt]).toEqual(['queued', 'u2', 87, NOW]);
    const s = draft(new Date('2026-10-02T03:00:00Z')); s.requestSend('u2', NOW, 5);
    expect([s.status, s.toProps().queuedAt]).toEqual(['scheduled', null]);
    s.queueScheduled(NOW); expect([s.status, s.toProps().queuedAt]).toEqual(['queued', NOW]);
  });
  it('queued → sending → sent stamps the fan-out; failed carries a code and a time; cancel carries who, when, why', () => {
    const b = draft(); b.requestSend('u', NOW, 1); b.markSending(); b.markSent(NOW);
    expect([b.status, b.toProps().fannedOutAt]).toEqual(['sent', NOW]);
    const f = draft(); f.requestSend('u', NOW, 1); f.markFailed('no_template', NOW);
    expect([f.status, f.toProps().failureReason, f.toProps().failedAt]).toEqual(['failed', 'no_template', NOW]);
    const c = draft(); c.cancel('u3', NOW, 'wrong day');
    expect([c.status, c.toProps().cancelledBy, c.toProps().cancelReason]).toEqual(['cancelled', 'u3', 'wrong day']);
  });
  it('refuses what the machine refuses: sent from queued, edit after send, send twice', () => {
    const b = draft(); b.requestSend('u', NOW, 1);
    expect(() => b.markSent(NOW)).toThrow(IllegalBroadcastTransitionError);
    expect(() => b.edit({ title: 'x', body: 'y', audienceRoleCode: null, scheduledAt: null })).toThrow(IllegalBroadcastTransitionError);
    expect(() => b.requestSend('u', NOW, 1)).toThrow(IllegalBroadcastTransitionError);
    const d = draft(); d.edit({ title: 'New', body: 'B2', audienceRoleCode: 'farmer', scheduledAt: null });
    expect([d.toProps().title, d.toProps().audienceRoleCode]).toEqual(['New', 'farmer']);
  });
});

describe('the form review (W2841–W2844)', () => {
  const facts = (o: Partial<BroadcastDraftFacts> = {}): BroadcastDraftFacts => ({ canSend: true, roleKnown: null, audienceSize: 12, whatsappConnected: false, zone: ZONE, now: NOW, existing: null, ...o });
  const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => `${x.field ?? '-'}/${x.code}`);
  it('a clean draft is ready; the words are stored trimmed and collapsed; the channel is inapp', () => {
    const r = reviewBroadcastDraft({ title: '  Mandi   closed ', body: '  Line one  \n  Line   two ' }, facts());
    expect(r.ready).toBe(true);
    expect(r.stored).toEqual({ title: 'Mandi closed', body: 'Line one\n Line two', audienceRoleCode: null, scheduledAt: null, channel: 'inapp' });
    expect(r.mode).toBe('create'); expect(r.diff).toBeNull(); expect(r.entityType).toBe('tenant_broadcast');
    expect(r.fields.map((f) => f.name)).toEqual(['title', 'body', 'audienceRoleCode', 'scheduledAt', 'channel']);
    expect(r.fields.find((f) => f.name === 'title')!.normalised).toBe(true);
  });
  it('a title is one line', () => {
    expect(reviewBroadcastDraft({ title: 'a\n b', body: 'x' }, facts()).stored.title).toBe('a b');
  });
  it('every refusal at once, each against its field', () => {
    const r = reviewBroadcastDraft({ title: '', body: '', audienceRoleCode: 'farmerr', channel: 'sms', scheduledAt: '2026-13-01T10:00' }, facts({ canSend: false, roleKnown: false }));
    expect(codes(r)).toEqual(['-/NO_PERMISSION', 'title/TITLE_REQUIRED', 'body/BODY_REQUIRED', 'audienceRoleCode/ROLE_UNKNOWN', 'channel/CHANNEL_UNKNOWN', 'scheduledAt/SCHEDULE_INVALID']);
    expect(r.ready).toBe(false);
  });
  it('bounds and markup', () => {
    expect(codes(reviewBroadcastDraft({ title: 'x'.repeat(BROADCAST_TITLE_MAX), body: 'y'.repeat(BROADCAST_BODY_MAX) }, facts()))).toEqual([]);
    expect(codes(reviewBroadcastDraft({ title: 'x'.repeat(BROADCAST_TITLE_MAX + 1), body: 'y'.repeat(BROADCAST_BODY_MAX + 1) }, facts()))).toEqual(['title/TITLE_TOO_LONG', 'body/BODY_TOO_LONG']);
    expect(codes(reviewBroadcastDraft({ title: '<b>hi</b>', body: 'a > b' }, facts()))).toEqual(['title/TEXT_HAS_MARKUP', 'body/TEXT_HAS_MARKUP']);
  });
  it('F-16 · a typo role is ROLE_UNKNOWN (never "everyone"); a known role with nobody is AUDIENCE_EMPTY; everyone with nobody too', () => {
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', audienceRoleCode: 'farmerr' }, facts({ roleKnown: false, audienceSize: 0 })))).toEqual(['audienceRoleCode/ROLE_UNKNOWN']);
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', audienceRoleCode: 'vet' }, facts({ roleKnown: true, audienceSize: 0 })))).toEqual(['audienceRoleCode/AUDIENCE_EMPTY']);
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b' }, facts({ audienceSize: 0 })))).toEqual(['audienceRoleCode/AUDIENCE_EMPTY']);
    const r = reviewBroadcastDraft({ title: 't', body: 'b', audienceRoleCode: ' Farmer ' }, facts({ roleKnown: true }));
    expect([r.ready, r.stored.audienceRoleCode]).toEqual([true, 'farmer']);
  });
  it('whatsapp is refused by name while no provider exists; admitted only with one', () => {
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', channel: 'WhatsApp' }, facts()))).toEqual(['channel/CHANNEL_NO_PROVIDER']);
    const w = reviewBroadcastDraft({ title: 't', body: 'b', channel: 'whatsapp' }, facts({ whatsappConnected: true }));
    expect([w.ready, w.stored.channel]).toEqual([true, 'whatsapp']);
    expect(reviewBroadcastDraft({ title: 't', body: 'b', channel: 'inapp' }, facts()).ready).toBe(true);
  });
  it('the schedule is the cooperative\'s wall-clock, at least 5 minutes and at most 30 days ahead', () => {
    const r = reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2026-10-02T08:30' }, facts());
    expect(r.ready).toBe(true);
    expect(r.stored.scheduledAt!.toISOString()).toBe('2026-10-02T03:00:00.000Z');
    expect(r.fields.find((f) => f.name === 'scheduledAt')!.stored).toBe('2026-10-02T08:30');
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2026-10-01T12:04' }, facts()))).toEqual(['scheduledAt/SCHEDULE_TOO_SOON']);
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2026-10-01T12:05' }, facts()))).toEqual([]);
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2026-10-31T12:00' }, facts()))).toEqual([]);
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2026-10-31T12:01' }, facts()))).toEqual(['scheduledAt/SCHEDULE_TOO_FAR']);
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2026-10-02T08:30' }, facts({ zone: null })))).toEqual(['scheduledAt/ZONE_UNKNOWN']);
    expect(MIN_LEAD_MINUTES).toBe(5); expect(MAX_LEAD_DAYS).toBe(30);
  });
  it('a wall-clock that does not exist in the zone (a DST gap) is refused by name, never shifted', () => {
    expect(parseSchedule('2027-03-14T02:30', 'America/New_York')).toEqual({ kind: 'not_on_clock' });
    const ok = parseSchedule('2027-03-14T03:30', 'America/New_York');
    expect(ok.kind).toBe('ok');
    expect(parseSchedule('', ZONE)).toEqual({ kind: 'none' });
    for (const bad of ['2026-02-30T10:00', '2026-10-01 25:00', '2026-10-01T10:60', '1999-01-01T10:00', '2101-01-01T00:00', '2026-1-1T1:00', '2026-00-10T10:00', '2026-10-00T10:00', 'tomorrow']) expect([bad, parseSchedule(bad, ZONE).kind]).toEqual([bad, 'invalid']);
    expect(parseSchedule('2026-10-02 08:30', ZONE).kind).toBe('ok');
    expect(parseSchedule('2026-10-02T08:30', null)).toEqual({ kind: 'no_zone' });
    expect(toLocalWall(new Date('2026-10-02T03:00:00Z'), ZONE)).toBe('2026-10-02T08:30');
    expect(toLocalWall(new Date('2026-01-05T18:35:00Z'), ZONE)).toBe('2026-01-06T00:05');
  });
  it('an edit: the diff against the draft, NOTHING_CHANGED, NOT_EDITABLE after send', () => {
    const existing = { status: 'draft', title: 'Old', body: 'B', audienceRoleCode: null, scheduledAt: null, channel: 'inapp' };
    const r = reviewBroadcastDraft({ title: 'New', body: 'B' }, facts({ existing }));
    expect(r.mode).toBe('update'); expect(r.diff).toEqual([{ field: 'title', before: 'Old', after: 'New' }]);
    expect(codes(reviewBroadcastDraft({ title: 'Old', body: 'B' }, facts({ existing })))).toEqual(['-/NOTHING_CHANGED']);
    expect(codes(reviewBroadcastDraft({ title: 'Old', body: 'B' }, facts({ existing: { ...existing, status: 'sent' } })))).toEqual(['-/NOT_EDITABLE']);
    const sch = reviewBroadcastDraft({ title: 'Old', body: 'B', scheduledAt: '2026-10-02T08:30', audienceRoleCode: 'farmer' }, facts({ existing, roleKnown: true }));
    expect(sch.diff).toEqual([{ field: 'audienceRoleCode', before: null, after: 'farmer' }, { field: 'scheduledAt', before: null, after: '2026-10-02T08:30' }]);
  });
  it('helpers: blank words are nothing; markup is < or >', () => {
    expect(cleanWords('   ')).toBeNull(); expect(cleanWords(undefined)).toBeNull(); expect(cleanWords(' a\tb ')).toBe('a b');
    expect(hasMarkup(null)).toBe(false); expect(hasMarkup('a<b')).toBe(true); expect(hasMarkup('a>b')).toBe(true); expect(hasMarkup('a b')).toBe(false);
    expect(BROADCAST_FORM_REFUSALS).toContain('CHANNEL_NO_PROVIDER');
  });
});

describe('the act verdicts (W2845–W2847)', () => {
  const f = (o: Partial<ActFacts> = {}): ActFacts => ({ status: 'draft', canSend: true, templateGaps: [], roleCode: null, roleKnown: true, audienceSize: 4, scheduledAt: null, channel: 'inapp', whatsappConnected: false, now: NOW, ...o });
  it('send a draft now → queued; with a time → scheduled', () => {
    expect(actVerdict('send', f(), 'monday notice')).toEqual({ act: 'send', allowed: true, refusals: [], gaps: [], to: 'queued' });
    expect(actVerdict('send', f({ scheduledAt: new Date('2026-10-02T03:00:00Z') }), 'ok go').to).toBe('scheduled');
  });
  it('F-2 · a frame that does not serve refuses the send (with the gaps), never a no_template per member', () => {
    const v = actVerdict('send', f({ templateGaps: ['push:gu'] }), 'reason');
    expect([v.allowed, v.refusals, v.gaps, v.to]).toEqual([false, ['TEMPLATE_MISSING'], ['push:gu'], null]);
  });
  it('a role retired since the draft, an emptied audience, a schedule now too close, a channel with no provider', () => {
    expect(actVerdict('send', f({ roleCode: 'vet', roleKnown: false, audienceSize: 0 }), 'r r r').refusals).toEqual(['ROLE_UNKNOWN']);
    expect(actVerdict('send', f({ audienceSize: 0 }), 'r r r').refusals).toEqual(['AUDIENCE_EMPTY']);
    expect(actVerdict('send', f({ scheduledAt: new Date(NOW.getTime() + 4 * 60_000) }), 'r r r').refusals).toEqual(['SCHEDULE_PASSED']);
    expect(actVerdict('send', f({ scheduledAt: new Date(NOW.getTime() + 5 * 60_000) }), 'r r r').refusals).toEqual([]);
    expect(actVerdict('send', f({ channel: 'whatsapp' }), 'r r r').refusals).toEqual(['CHANNEL_NO_PROVIDER']);
    expect(actVerdict('send', f({ channel: 'whatsapp', whatsappConnected: true }), 'r r r').refusals).toEqual([]);
    expect(actVerdict('send', f({ channel: 'sms', whatsappConnected: true }), 'r r r').refusals).toEqual(['CHANNEL_NO_PROVIDER']);
  });
  it('F-19 · without the verb nothing moves; an illegal state is said, and the send checks are not asked of it', () => {
    expect(actVerdict('send', f({ canSend: false }), 'r r r').refusals).toEqual(['NO_PERMISSION']);
    expect(actVerdict('send', f({ status: 'sent', templateGaps: ['push:gu'] }), 'r r r').refusals).toEqual(['ILLEGAL_FROM_STATE']);
    expect(actVerdict('cancel', f({ status: 'queued' }), 'r r r').refusals).toEqual(['ILLEGAL_FROM_STATE']);
    expect(actVerdict('cancel', f({ status: 'scheduled', templateGaps: ['push:gu'], audienceSize: 0 }), 'wrong day')).toEqual({ act: 'cancel', allowed: true, refusals: [], gaps: [], to: 'cancelled' });
  });
  it('the reason: required (≥3), bounded (≤300), and not judged on the confirm page before it is typed', () => {
    expect(reasonRefusal('ab')).toBe('REASON_REQUIRED'); expect(reasonRefusal(' abc ')).toBeNull(); expect(reasonRefusal(undefined)).toBe('REASON_REQUIRED');
    expect(reasonRefusal('x'.repeat(MAX_ACT_REASON))).toBeNull(); expect(reasonRefusal('x'.repeat(MAX_ACT_REASON + 1))).toBe('REASON_TOO_LONG');
    expect(actVerdict('send', f(), '').refusals).toEqual(['REASON_REQUIRED']);
    expect(actVerdict('send', f(), '', true).allowed).toBe(true);
    expect(actVerdict('send', f(), 'x'.repeat(301), true).allowed).toBe(true);
    expect(BROADCAST_ACT_REFUSALS).toContain('REFUSED_BY_DATABASE');
  });
});

describe('the audience and the quiet-hours estimate', () => {
  const event = { code: 'tenant.broadcast', priority: 'promotional' as const, defaultChannels: ['push', 'inapp'] as NotifChannel[], userCanOptOut: true };
  const m = (o: Partial<{ userId: string; own: { starts: string; ends: string; timezone: string } | null; prefs: Map<NotifChannel, boolean>; hasPushDevice: boolean }> = {}) =>
    ({ userId: 'u', own: null, prefs: new Map<NotifChannel, boolean>(), hasPushDevice: true, ...o });
  const DEFAULT = { starts: '21:00', ends: '06:00' };
  it('the role code: normalised, never guessed; shape-checked before a query', () => {
    expect(normaliseRoleCode('  Farmer ')).toBe('farmer'); expect(normaliseRoleCode('')).toBeNull(); expect(normaliseRoleCode(undefined)).toBeNull();
    expect(looksLikeRoleCode('dairy_farmer')).toBe(true); expect(looksLikeRoleCode('x')).toBe(false); expect(looksLikeRoleCode('1farmer')).toBe(false); expect(looksLikeRoleCode('farmer;drop')).toBe(false);
    expect(looksLikeRoleCode('a'.repeat(50))).toBe(true); expect(looksLikeRoleCode('a'.repeat(51))).toBe(false);
    expect(audienceRefusals({ roleCode: 'farmerr', known: false, size: 9 })).toEqual(['ROLE_UNKNOWN']);
    expect(audienceRefusals({ roleCode: 'farmer', known: null, size: 9 })).toEqual(['ROLE_UNKNOWN']);
    expect(audienceRefusals({ roleCode: 'farmer', known: true, size: 0 })).toEqual(['AUDIENCE_EMPTY']);
    expect(audienceRefusals({ roleCode: null, known: null, size: 1 })).toEqual([]);
  });
  it('at 22:00 IST: a member with no window is HELD in the cooperative\'s default until 06:00; in-app is never held', () => {
    const at = new Date('2026-09-30T16:30:00Z');
    const r = quietImpact({ event, members: [m({ userId: 'a' }), m({ userId: 'b', hasPushDevice: false })], audience: 2, tenantDefault: DEFAULT, tenantZone: ZONE, at });
    expect(r.channels).toEqual([{ channel: 'push', now: 0, held: 2, optedOut: 0, noDevice: 0 }, { channel: 'inapp', now: 2, held: 0, optedOut: 0, noDevice: 0 }]);
    expect(r.heldUntil!.toISOString()).toBe('2026-10-01T00:30:00.000Z');
    expect(r.windows).toEqual({ own: 0, tenantDefault: 2, none: 0 }); expect(r.cut).toBe(false); expect(r.examined).toBe(2);
  });
  it('at noon: push now for a member with a device, no_device for one without; switched-off push is opted out', () => {
    const r = quietImpact({ event, members: [m(), m({ hasPushDevice: false }), m({ prefs: new Map([['push', false]]) })], audience: 3, tenantDefault: DEFAULT, tenantZone: ZONE, at: NOW });
    expect(r.channels[0]).toEqual({ channel: 'push', now: 1, held: 0, optedOut: 1, noDevice: 1 });
    expect(r.channels[1]).toEqual({ channel: 'inapp', now: 3, held: 0, optedOut: 0, noDevice: 0 });
    expect(r.heldUntil).toBeNull();
  });
  it('a member\'s own window wins over the cooperative\'s, and the latest release is reported; no default and no zone = none', () => {
    const own = { starts: '11:00', ends: '13:30', timezone: ZONE };
    const r = quietImpact({ event, members: [m({ own }), m()], audience: 5, tenantDefault: DEFAULT, tenantZone: ZONE, at: NOW });
    expect(r.channels[0]).toMatchObject({ held: 1, now: 1 }); expect(r.heldUntil!.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect(r.windows).toEqual({ own: 1, tenantDefault: 1, none: 0 }); expect(r.cut).toBe(true);
    const n = quietImpact({ event, members: [m()], audience: 1, tenantDefault: null, tenantZone: null, at: new Date('2026-09-30T16:30:00Z') });
    expect(n.windows).toEqual({ own: 0, tenantDefault: 0, none: 1 }); expect(n.channels[0].now).toBe(1);
    const two = quietImpact({ event, members: [m({ own: { starts: '11:00', ends: '14:00', timezone: ZONE } }), m({ own }), m({ own: { starts: '11:30', ends: '12:30', timezone: ZONE } })], audience: 3, tenantDefault: DEFAULT, tenantZone: ZONE, at: NOW });
    expect(two.heldUntil!.toISOString()).toBe('2026-10-01T08:30:00.000Z');
    expect(IMPACT_SAMPLE_MAX).toBe(5000);
  });
  it('a channel outside the event\'s defaults is never counted', () => {
    const r = quietImpact({ event: { ...event, defaultChannels: ['inapp'] }, members: [m()], audience: 1, tenantDefault: DEFAULT, tenantZone: ZONE, at: NOW });
    expect(r.channels).toEqual([{ channel: 'inapp', now: 1, held: 0, optedOut: 0, noDevice: 0 }]);
  });
});

describe('the counts are the log\'s (F-2)', () => {
  const g = (channel: string, status: string, n: number, o: { s?: string | null; f?: string | null; released?: boolean } = {}) =>
    ({ channel, status, suppressedReason: o.s ?? null, failureReason: o.f ?? null, released: o.released ?? false, n });
  it('sent = sent + delivered + read rows; held apart from suppressed; failed by reason; in-app items counted', () => {
    const c = countBroadcast(5, [
      g('inapp', 'sent', 3), g('inapp', 'read', 2),
      g('push', 'sent', 1), g('push', 'delivered', 1), g('push', 'failed', 1, { f: 'no_device' }),
      g('push', 'suppressed', 1, { s: 'quiet_hours' }), g('push', 'suppressed', 1, { s: 'opted_out' }),
    ]);
    expect([c.recipients, c.sent, c.delivered, c.read, c.failed, c.held, c.suppressed, c.inapp]).toEqual([5, 7, 1, 2, 1, 1, 1, 5]);
    expect(c.channels.map((x) => x.channel)).toEqual(['inapp', 'push']);
    expect(c.channels[1]).toMatchObject({ total: 5, failedBy: { no_device: 1 }, suppressedBy: { opted_out: 1 }, held: 1, released: 0 });
  });
  it('a released hold counts by its final status, and as released; a still-held one is held', () => {
    const c = countBroadcast(2, [g('push', 'sent', 1, { s: 'quiet_hours', released: true }), g('push', 'suppressed', 1, { s: 'quiet_hours' })]);
    expect(c.channels[0]).toMatchObject({ sent: 1, held: 1, released: 1, suppressed: 0 });
    expect(isHeld({ status: 'suppressed', suppressedReason: 'quiet_hours', released: false })).toBe(true);
    expect(isHeld({ status: 'suppressed', suppressedReason: 'quiet_hours', released: true })).toBe(false);
    expect(isHeld({ status: 'suppressed', suppressedReason: 'opted_out', released: false })).toBe(false);
    expect(isHeld({ status: 'sent', suppressedReason: 'quiet_hours', released: false })).toBe(false);
  });
  it('unknown statuses are counted as other, never dropped; zero and junk counts are ignored; no reason is "unrecorded"', () => {
    const c = countBroadcast(1.9, [g('sms', 'bounced', 2), g('sms', 'failed', 1), g('sms', 'queued', 1), g('sms', 'sent', 0), g('sms', 'sent', -3), g('sms', 'sent', Number.NaN), g('sms', 'suppressed', 2)]);
    expect([c.recipients, c.other, c.failed, c.queued, c.sent]).toEqual([1, 2, 1, 1, 0]);
    expect(c.channels[0].failedBy).toEqual({ unrecorded: 1 }); expect(c.channels[0].suppressedBy).toEqual({ unrecorded: 2 });
    expect(countBroadcast(-2, []).recipients).toBe(0);
    expect(countBroadcast(1, [g('push', 'sent', 2.7)]).sent).toBe(2);
  });
  it('channels in the receipt\'s order (in-app first, then push, sms, whatsapp, email, ivr, then anything else by name)', () => {
    const c = countBroadcast(1, ['zz', 'ivr', 'aa', 'email', 'whatsapp', 'sms', 'push', 'inapp'].map((ch) => g(ch, 'sent', 1)));
    expect(c.channels.map((x) => x.channel)).toEqual(['inapp', 'push', 'sms', 'whatsapp', 'email', 'ivr', 'aa', 'zz']);
    expect(countBroadcast(1, []).inapp).toBe(0);
  });
  it('the hub adds broadcasts up', () => {
    const a = countBroadcast(2, [g('inapp', 'sent', 2), g('push', 'failed', 1, { f: 'no_device' })]);
    const b = countBroadcast(3, [g('inapp', 'read', 3), g('push', 'suppressed', 2, { s: 'quiet_hours' })]);
    expect(addCounts([a, b])).toEqual({ recipients: 5, sent: 5, delivered: 0, read: 3, failed: 1, held: 2, suppressed: 0, queued: 0, other: 0, inapp: 5 });
    expect(addCounts([])).toEqual({ recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, held: 0, suppressed: 0, queued: 0, other: 0, inapp: 0 });
  });
});

describe('W430 · the opt-in policy and the refused-by-name register', () => {
  const vocabulary = ['storefront_checkbox', 'qr_till_card', 'assisted_kiosk_own_otp'];
  const statement = 'I agree to receive messages from my cooperative on WhatsApp.';
  const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => `${x.field ?? '-'}/${x.code}`);
  it('a clean policy is ready, and says consent is NOT collected', () => {
    const r = reviewOptinPolicy({ sources: [' Storefront_Checkbox ', 'qr_till_card'], consentStatement: `  ${statement}  ` }, { canManage: true, vocabulary, existing: null });
    expect(r.ready).toBe(true); expect(r.stored).toEqual({ sources: ['storefront_checkbox', 'qr_till_card'], consentStatement: statement });
    expect([r.collectionState, r.mode, r.diff, r.entityType]).toEqual(['not_collected', 'create', null, 'whatsapp_optin_policy']);
  });
  it('every refusal at once', () => {
    expect(codes(reviewOptinPolicy({ sources: [], consentStatement: '' }, { canManage: false, vocabulary, existing: null }))).toEqual(['-/NO_PERMISSION', 'sources/SOURCES_REQUIRED', 'consentStatement/STATEMENT_REQUIRED']);
    expect(codes(reviewOptinPolicy({ sources: ['qr_till_card', 'qr_till_card', 'sms_reply'], consentStatement: 'short <b>' }, { canManage: true, vocabulary, existing: null })))
      .toEqual(['sources/SOURCE_REPEATED', 'sources/SOURCE_UNKNOWN', 'consentStatement/STATEMENT_TOO_SHORT', 'consentStatement/TEXT_HAS_MARKUP']);
    expect(codes(reviewOptinPolicy({ sources: ['a', 'b', 'c', 'd'], consentStatement: statement }, { canManage: true, vocabulary: ['a', 'b', 'c', 'd'], existing: null }))).toEqual(['sources/TOO_MANY_SOURCES']);
    expect(codes(reviewOptinPolicy({ sources: ['a', 'b', 'c'], consentStatement: statement }, { canManage: true, vocabulary: ['a', 'b', 'c'], existing: null }))).toEqual([]);
    expect(codes(reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: 'x'.repeat(OPTIN_STATEMENT_MAX + 1) }, { canManage: true, vocabulary, existing: null }))).toEqual(['consentStatement/STATEMENT_TOO_LONG']);
    expect(codes(reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: 'x'.repeat(20) }, { canManage: true, vocabulary, existing: null }))).toEqual([]);
    expect(codes(reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: 'x'.repeat(19) }, { canManage: true, vocabulary, existing: null }))).toEqual(['consentStatement/STATEMENT_TOO_SHORT']);
    expect(codes(reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: 'x'.repeat(OPTIN_STATEMENT_MAX) }, { canManage: true, vocabulary, existing: null }))).toEqual([]);
    expect(OPTIN_FORM_REFUSALS).toContain('NOTHING_CHANGED');
  });
  it('an edit: the diff, and NOTHING_CHANGED', () => {
    const existing = { sources: ['qr_till_card'], consentStatement: statement };
    expect(codes(reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: statement }, { canManage: true, vocabulary, existing }))).toEqual(['-/NOTHING_CHANGED']);
    const r = reviewOptinPolicy({ sources: ['qr_till_card', 'storefront_checkbox'], consentStatement: statement }, { canManage: true, vocabulary, existing });
    expect([r.mode, r.diff]).toEqual(['update', [{ field: 'sources', before: 'qr_till_card', after: 'qr_till_card, storefront_checkbox' }]]);
    const s = reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: statement + ' Reply STOP to stop.' }, { canManage: true, vocabulary, existing });
    expect(s.diff!.map((d) => d.field)).toEqual(['consentStatement']);
    expect(normaliseSources(undefined)).toEqual([]); expect(normaliseSources([' ', 'A'])).toEqual(['a']);
  });
  it('every WhatsApp surface refused names an owner and, where something exists, where it is', () => {
    const codesList = WHATSAPP_REFUSED.map((r) => r.code);
    expect(new Set(codesList).size).toBe(codesList.length);
    for (const c of ['inbox', 'conversation', 'assign', 'markResolved', 'metaSubmission', 'businessNumber', 'channelToggle', 'webhookHealth', 'whatsappBroadcast', 'whatsappExport']) expect(codesList).toContain(c);
    expect(WHATSAPP_REFUSED.find((r) => r.code === 'conversation')!.instead).toBe('/inbox');
    expect(WHATSAPP_REFUSED.find((r) => r.code === 'whatsappBroadcast')!.instead).toBe('/comms');
    for (const r of WHATSAPP_REFUSED) expect(['founder_provider_decision', 'admin_11b_q1', 'tenant_support_desk', 'platform_whatsapp_bot']).toContain(r.owner);
  });
});

describe('W2839/W2840 · the export says there is no WhatsApp dataset', () => {
  const b = { id: 'b1', status: 'sent', channel: 'inapp', audienceRoleCode: null, title: 'T', createdAt: new Date('2026-10-01T00:00:00Z'), scheduledAt: null,
    sendRequestedAt: new Date('2026-10-01T01:00:00Z'), fannedOutAt: new Date('2026-10-01T01:00:05Z'), eligibleCount: 3, failureReason: null, cancelReason: null };
  it('a fanned-out broadcast carries the log\'s counts; one that never fanned out has empty cells, not zeros', () => {
    const c = countBroadcast(3, [{ channel: 'inapp', status: 'sent', suppressedReason: null, failureReason: null, released: false, n: 3 }]);
    const row = broadcastExportRow(b, c);
    expect(row).toHaveLength(BROADCAST_EXPORT_HEADER.length);
    expect(row).toEqual(['b1', 'sent', 'inapp', 'everyone', 'T', '2026-10-01T00:00:00.000Z', null, '2026-10-01T01:00:00.000Z', '2026-10-01T01:00:05.000Z', 3, 3, 3, 3, 0, 0, 0, 0, null, null]);
    const draft = broadcastExportRow({ ...b, status: 'draft', sendRequestedAt: null, fannedOutAt: null, audienceRoleCode: 'farmer' }, null);
    expect(draft.slice(3, 4)).toEqual(['farmer']); expect(draft.slice(9, 17)).toEqual([null, null, null, null, null, null, null, null]);
  });
  it('the first note says no WhatsApp dataset exists; an empty file says so too', () => {
    expect(broadcastExportNotes({ rows: 1 })[0]).toMatch(/^no WhatsApp dataset exists/);
    expect(broadcastExportNotes({ rows: 1 })).toHaveLength(5);
    expect(broadcastExportNotes({ rows: 0 }).at(-1)).toMatch(/no broadcast yet/);
  });
});

// Pinned by the mutation pass (each survived once; each is now a test).
describe('the edges the mutation pass found unpinned', () => {
  const facts = (o: Partial<BroadcastDraftFacts> = {}): BroadcastDraftFacts => ({ canSend: true, roleKnown: null, audienceSize: 12, whatsappConnected: false, zone: ZONE, now: NOW, existing: null, ...o });
  const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => `${x.field ?? '-'}/${x.code}`);
  it('the title bound is 160, literally; one refusal is enough to be not ready', () => {
    expect(BROADCAST_TITLE_MAX).toBe(160); expect(BROADCAST_BODY_MAX).toBe(2000);
    const r = reviewBroadcastDraft({ title: 'x'.repeat(161), body: 'b' }, facts());
    expect([r.ready, codes(r)]).toEqual([false, ['title/TITLE_TOO_LONG']]);
  });
  it('a cancelled or scheduled broadcast is not editable; a named role the registry did not answer for is unknown', () => {
    const e = { status: 'cancelled', title: 'Old', body: 'B', audienceRoleCode: null, scheduledAt: null, channel: 'inapp' };
    expect(codes(reviewBroadcastDraft({ title: 'New', body: 'B' }, facts({ existing: e })))).toEqual(['-/NOT_EDITABLE']);
    expect(codes(reviewBroadcastDraft({ title: 'New', body: 'B' }, facts({ existing: { ...e, status: 'scheduled' } })))).toEqual(['-/NOT_EDITABLE']);
    expect(codes(reviewBroadcastDraft({ title: 't', body: 'b', audienceRoleCode: 'farmer' }, facts({ roleKnown: null })))).toEqual(['audienceRoleCode/ROLE_UNKNOWN']);
  });
  it('the review refuses a DST-gap wall-clock by name; hour 24 is not a time', () => {
    const ny = reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2026-11-01T01:30' }, facts({ zone: 'America/New_York', now: new Date('2026-10-20T00:00:00Z') }));
    expect(ny.ready).toBe(true);   // a repeated hour exists (DST end) — accepted
    const gap = reviewBroadcastDraft({ title: 't', body: 'b', scheduledAt: '2027-03-14T02:30' }, facts({ zone: 'America/New_York', now: new Date('2027-03-01T00:00:00Z') }));
    expect(codes(gap)).toEqual(['scheduledAt/SCHEDULE_NOT_ON_CLOCK']);
    expect(parseSchedule('2026-10-01T24:00', ZONE)).toEqual({ kind: 'invalid' });
  });
  it('acts: no role named is never ROLE_UNKNOWN; the reason is judged trimmed', () => {
    const f: ActFacts = { status: 'draft', canSend: true, templateGaps: [], roleCode: null, roleKnown: false, audienceSize: 4, scheduledAt: null, channel: 'inapp', whatsappConnected: false, now: NOW };
    expect(actVerdict('send', f, 'fine reason').refusals).toEqual([]);
    expect(reasonRefusal('   ab   ')).toBe('REASON_REQUIRED');
  });
  it('the estimate: the latest release wins whatever the member order; examined is the members seen, not the audience', () => {
    const event = { code: 'tenant.broadcast', priority: 'promotional' as const, defaultChannels: ['push', 'inapp'] as NotifChannel[], userCanOptOut: true };
    const m = (own: { starts: string; ends: string; timezone: string }) => ({ userId: 'u', own, prefs: new Map<NotifChannel, boolean>(), hasPushDevice: true });
    const r = quietImpact({ event, members: [m({ starts: '11:30', ends: '12:30', timezone: ZONE }), m({ starts: '11:00', ends: '14:00', timezone: ZONE })], audience: 9, tenantDefault: null, tenantZone: ZONE, at: NOW });
    expect(r.heldUntil!.toISOString()).toBe('2026-10-01T08:30:00.000Z');
    expect([r.examined, r.audience, r.cut]).toEqual([2, 9, true]);
  });
  it('counts: infinite and zero groups are ignored (no empty channel row); a suppressed quiet-hours row already released is not "held"', () => {
    const g = (status: string, n: number, s: string | null = null, released = false) => ({ channel: 'push', status, suppressedReason: s, failureReason: null, released, n });
    expect(countBroadcast(1, [g('sent', 0)]).channels).toEqual([]);
    expect(countBroadcast(1, [g('sent', Number.POSITIVE_INFINITY)]).sent).toBe(0);
    const c = countBroadcast(1, [g('suppressed', 1, 'quiet_hours', true)]);
    expect([c.held, c.suppressed]).toEqual([0, 1]);
  });
  it('the policy statement: > alone is markup; runs of spaces collapse', () => {
    const vocabulary = ['qr_till_card'];
    expect(reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: 'I agree that 2 > 1 messages is fine to get' }, { canManage: true, vocabulary, existing: null }).refusals).toEqual([{ field: 'consentStatement', code: 'TEXT_HAS_MARKUP' }]);
    expect(reviewOptinPolicy({ sources: ['qr_till_card'], consentStatement: 'I  agree   to   WhatsApp   messages' }, { canManage: true, vocabulary, existing: null }).stored.consentStatement).toBe('I agree to WhatsApp messages');
  });
  it('the export row keeps held before suppressed', () => {
    const c = countBroadcast(3, [
      { channel: 'push', status: 'suppressed', suppressedReason: 'quiet_hours', failureReason: null, released: false, n: 2 },
      { channel: 'push', status: 'suppressed', suppressedReason: 'opted_out', failureReason: null, released: false, n: 1 }]);
    const row = broadcastExportRow({ id: 'b', status: 'sent', channel: 'inapp', audienceRoleCode: null, title: 'T', scheduledAt: null, sendRequestedAt: null, fannedOutAt: null, eligibleCount: 0, failureReason: null, cancelReason: null }, c);
    expect([row[BROADCAST_EXPORT_HEADER.indexOf('held_rows')], row[BROADCAST_EXPORT_HEADER.indexOf('suppressed_rows')]]).toEqual([2, 1]);
  });
});
