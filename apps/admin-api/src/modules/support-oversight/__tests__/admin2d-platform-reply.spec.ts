// apps/admin-api/src/modules/support-oversight/__tests__/admin2d-platform-reply.spec.ts · PC-56 ADMIN-2d.
//
// The thing this wave had to get right is a VOCABULARY, not an algorithm: a reply an operator has written has not been
// sent, and nothing in the system is allowed to imply otherwise until the notification spine has delivered it. So most
// of these tests are about words — what the status set contains, what `describeReplyState` says, what "delivered" is
// allowed to mean.
import {
  REPLY_STATUSES, isReplyStatus, reachedTheFarmer, awaitingOrStuck, needsAHuman,
  REPLY_LANGUAGES, MIN_BODY, MAX_BODY, assertReply, describeReplyState, deliveredCount, stuckRows,
  type ReplyRow,
} from '../domain/platform-reply';
import { InvalidPlatformReplyError } from '../domain/support-oversight.errors';

const row = (over: Partial<ReplyRow> = {}): ReplyRow => ({
  id: 'r1', ticketId: 't1', status: 'queued', body: 'x'.repeat(30), languageCode: 'hi',
  authorAdminId: 'adm', queuedAt: '2026-08-06T09:00:00.000Z', attempts: 0, ...over,
});

describe('the vocabulary has no word for "sent"', () => {
  it('mirrors 0101 exactly, and offers no status that claims an unprovable delivery', () => {
    expect([...REPLY_STATUSES]).toEqual(['queued', 'delivered', 'refused', 'failed']);
    // the whole point: a platform that cannot prove a delivery does not get to claim one
    expect(REPLY_STATUSES as readonly string[]).not.toContain('sent');
    expect(isReplyStatus('queued')).toBe(true);
    expect(isReplyStatus('sent')).toBe(false);
  });

  it('treats ONLY "delivered" as having reached the farmer', () => {
    expect(reachedTheFarmer('delivered')).toBe(true);
    for (const s of ['queued', 'refused', 'failed', 'sent', '']) expect(reachedTheFarmer(s)).toBe(false);
  });

  it('groups everything else as not-yet-contacted, so no surface can imply otherwise', () => {
    expect(awaitingOrStuck('queued')).toBe(true);
    expect(awaitingOrStuck('refused')).toBe(true);
    expect(awaitingOrStuck('failed')).toBe(true);
    expect(awaitingOrStuck('delivered')).toBe(false);
  });

  it('separates "waiting" from "needs a human" — a queued reply is not stuck', () => {
    // mixing them would make the health view cry wolf every minute and then be ignored
    expect(needsAHuman({ status: 'queued' })).toBe(false);
    expect(needsAHuman({ status: 'delivered' })).toBe(false);
    expect(needsAHuman({ status: 'refused' })).toBe(true);
    expect(needsAHuman({ status: 'failed' })).toBe(true);
  });
});

describe('assertReply', () => {
  it('accepts a real answer and trims it, without otherwise touching the words', () => {
    const body = '  Your refund of ₹4,200 was sent to your bank on 4 August. Reference RZP-8812.  ';
    const r = assertReply({ body, languageCode: 'EN' });
    expect(r.body).toBe(body.trim());
    // no normalising, no tidying: an operator's answer about somebody's money is not the platform's prose to edit
    expect(r.body).toContain('₹4,200');
    expect(r.languageCode).toBe('en');
  });

  it('REFUSES a reply too short to be an answer', () => {
    // a notification saying "noted" consumes the one message the farmer will read
    expect(() => assertReply({ body: 'noted', languageCode: 'hi' })).toThrow(InvalidPlatformReplyError);
    expect(() => assertReply({ body: 'ok thanks', languageCode: 'hi' })).toThrow(/at least 20 characters/);
    expect(() => assertReply({ body: '  '.repeat(40), languageCode: 'hi' })).toThrow(/at least 20 characters/);
    // exactly at the floor is fine
    expect(assertReply({ body: 'a'.repeat(MIN_BODY), languageCode: 'hi' }).body).toHaveLength(MIN_BODY);
  });

  it('refuses a reply nobody would read', () => {
    expect(() => assertReply({ body: 'a'.repeat(MAX_BODY + 1), languageCode: 'hi' })).toThrow(/at most 4000/);
  });

  it('REQUIRES a language and refuses one the platform has no template for', () => {
    // a reply composed in English and delivered under a Hindi template is a message the farmer cannot read wearing a
    // label saying they can
    expect([...REPLY_LANGUAGES]).toEqual(['en', 'hi', 'gu']);
    expect(() => assertReply({ body: 'x'.repeat(30), languageCode: '' })).toThrow(/languageCode must be one of/);
    expect(() => assertReply({ body: 'x'.repeat(30), languageCode: 'ta' })).toThrow(/languageCode must be one of/);
    // and there is NO default: choosing a language is the operator taking responsibility for it
    expect(() => assertReply({ body: 'x'.repeat(30), languageCode: undefined as any })).toThrow(InvalidPlatformReplyError);
  });
});

describe('describeReplyState — the sentence an operator reads', () => {
  it('says plainly that a queued reply has reached nobody', () => {
    expect(describeReplyState(row())).toBe('Recorded. Nobody has been contacted yet.');
    expect(describeReplyState(row({ attempts: 2 })))
      .toBe('Recorded and retrying (attempt 2). Nobody has been contacted yet.');
  });

  it('claims a delivery only for delivered', () => {
    expect(describeReplyState(row({ status: 'delivered' })))
      .toBe('Delivered — the farmer has a notification carrying these words.');
  });

  it('carries the REASON on a refusal and a failure, and says NOT sent in both', () => {
    const refused = describeReplyState(row({ status: 'refused', detail: 'the ticket has no requester recorded' }));
    expect(refused).toContain('NOT sent');
    expect(refused).toContain('the ticket has no requester recorded');
    const failed = describeReplyState(row({ status: 'failed', detail: 'template render failed' }));
    expect(failed).toContain('NOT sent after repeated attempts');
    expect(failed).toContain('template render failed');
  });

  it('does not go silent when a reason is missing — it says so', () => {
    expect(describeReplyState(row({ status: 'refused', detail: null }))).toContain('no reason recorded');
  });

  it('refuses to assume delivery for a status it does not recognise', () => {
    // an unrecognised status must never read as a success — a future enum value would otherwise arrive as good news
    const out = describeReplyState(row({ status: 'sent' }));
    expect(out).toContain('must not be assumed delivered');
    expect(out).not.toMatch(/^Delivered/);
  });
});

describe('counting', () => {
  it('counts what the farmer RECEIVED, not what was written', () => {
    // an operator would otherwise read the reply count as the answer count
    const rows = [row({ status: 'delivered' }), row({ id: 'r2' }), row({ id: 'r3', status: 'failed', detail: 'x' }),
      row({ id: 'r4', status: 'delivered' })];
    expect(rows).toHaveLength(4);
    expect(deliveredCount(rows)).toBe(2);
  });

  it('lists only the rows a human has to act on', () => {
    const rows = [row(), row({ id: 'r2', status: 'delivered' }),
      row({ id: 'r3', status: 'refused', detail: 'no requester' }), row({ id: 'r4', status: 'failed', detail: 'boom' })];
    expect(stuckRows(rows).map((r) => r.id)).toEqual(['r3', 'r4']);
  });

  it('reports nothing delivered and nothing stuck for an empty ticket', () => {
    expect(deliveredCount([])).toBe(0);
    expect(stuckRows([])).toEqual([]);
  });
});
