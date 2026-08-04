// Unit tests for the PURE offer + chat logic. No React/native deps (SDK/ui types are type-only). Money is bigint
// minor strings (Law 2) — the rupee→paise helper uses BigInt, never a float.
import { offerStatusTone, offerActions, isNegotiable, currentOfferPriceMinor, rupeesToOfferMinor, normalizeQuantity, offerTotalMinor, pctDiffVsAsk, listPriceRupees } from '../../features/offers/offer-status';

describe('make-offer preview (screen 99)', () => {
  it('offerTotalMinor = per-unit × qty (bigint, decimal qty)', () => {
    expect(offerTotalMinor('265000', '2')).toBe('530000');       // ₹2,650 × 2 = ₹5,300
    expect(offerTotalMinor('265000', '2.5')).toBe('662500');     // × 2.5
    expect(offerTotalMinor('265000', '')).toBe('0');
    expect(offerTotalMinor('bad', '2')).toBe('0');
  });
  it('pctDiffVsAsk rounds signed % (positive = below ask)', () => {
    expect(pctDiffVsAsk('265000', '288000')).toBe(8);   // ~8% below
    expect(pctDiffVsAsk('288000', '288000')).toBe(0);
    expect(pctDiffVsAsk('300000', '288000')).toBe(-4);  // above ask
    expect(pctDiffVsAsk('265000', '0')).toBeNull();
  });
  it('listPriceRupees strips paise', () => {
    expect(listPriceRupees('288000')).toBe('2880');
    expect(listPriceRupees('x')).toBe('');
  });
});
import { presentMessage, canSend, normalizeBody, dayKey, isDayBoundary } from '../../features/messaging/message-view';
import type { Message } from '@krishalaya/sdk-js';

describe('chat day dividers (screen 98)', () => {
  const v = (id: string, createdAt?: string) => ({ id, mine: false, kind: 'text' as const, body: 'x', mediaId: null, flagged: false, createdAt });
  it('dayKey returns UTC yyyy-mm-dd or empty', () => {
    expect(dayKey('2026-08-18T14:15:00Z')).toBe('2026-08-18');
    expect(dayKey(undefined)).toBe('');
    expect(dayKey('nope')).toBe('');
  });
  it('marks the oldest message of each day (desc list) as a boundary', () => {
    // newest-first: two on 08-18, one on 08-17
    const views = [v('a', '2026-08-18T14:20:00Z'), v('b', '2026-08-18T14:15:00Z'), v('c', '2026-08-17T09:00:00Z')];
    expect(isDayBoundary(views, 0)).toBe(false); // newest of 18th
    expect(isDayBoundary(views, 1)).toBe(true);  // oldest of 18th → divider above
    expect(isDayBoundary(views, 2)).toBe(true);  // last item overall
  });
});

describe('offer-status', () => {
  it('maps status → tone', () => {
    expect(offerStatusTone('accepted')).toBe('success');
    expect(offerStatusTone('converted')).toBe('success');
    expect(offerStatusTone('countered')).toBe('info');
    expect(offerStatusTone('open')).toBe('warning');
    expect(offerStatusTone('rejected')).toBe('danger');
    expect(offerStatusTone('???')).toBe('neutral');
  });
  it('offers accept/counter/reject only while negotiable', () => {
    expect(offerActions('open', 'outgoing')).toEqual(['accept', 'counter', 'reject']);
    expect(offerActions('countered', 'incoming')).toEqual(['accept', 'counter', 'reject']);
    expect(offerActions('accepted', 'outgoing')).toEqual([]);
    expect(offerActions('converted', 'incoming')).toEqual([]);
    expect(isNegotiable('open')).toBe(true);
    expect(isNegotiable('rejected')).toBe(false);
  });
  it('shows the counter price when present, else the original', () => {
    expect(currentOfferPriceMinor({ offeredPriceMinor: '10000', counterPriceMinor: null })).toBe('10000');
    expect(currentOfferPriceMinor({ offeredPriceMinor: '10000', counterPriceMinor: '12000' })).toBe('12000');
  });
  it('rupeesToOfferMinor: positive integer rupees → paise, else null', () => {
    expect(rupeesToOfferMinor('250')).toBe('25000');
    expect(rupeesToOfferMinor('0')).toBeNull();
    expect(rupeesToOfferMinor('12.5')).toBeNull();
    expect(rupeesToOfferMinor('')).toBeNull();
  });
  it('normalizeQuantity: positive decimal (≤3dp) string or null', () => {
    expect(normalizeQuantity('10')).toBe('10');
    expect(normalizeQuantity('2.5')).toBe('2.5');
    expect(normalizeQuantity('0')).toBeNull();
    expect(normalizeQuantity('1.2345')).toBeNull();
    expect(normalizeQuantity('abc')).toBeNull();
  });
});

describe('message-view', () => {
  const base: Message = { id: 'm1', conversationId: 'c1', senderUserId: 'u1', body: null, voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false };
  it('classifies kind from which field is set; mine from sender', () => {
    expect(presentMessage({ ...base, body: 'hi' }, 'u1')).toMatchObject({ mine: true, kind: 'text', body: 'hi' });
    expect(presentMessage({ ...base, body: 'hi', senderUserId: 'u2' }, 'u1').mine).toBe(false);
    expect(presentMessage({ ...base, attachmentMediaId: 'a1' }, 'u1')).toMatchObject({ kind: 'image', mediaId: 'a1' });
    expect(presentMessage({ ...base, voiceMediaId: 'v1' }, 'u1')).toMatchObject({ kind: 'voice', mediaId: 'v1' });
    expect(presentMessage(base, 'u1').kind).toBe('empty');
  });
  it('canSend requires text or an attachment', () => {
    expect(canSend('  ', false)).toBe(false);
    expect(canSend('hi', false)).toBe(true);
    expect(canSend('', true)).toBe(true);
  });
  it('normalizeBody trims and bounds to 4000 chars', () => {
    expect(normalizeBody('  hi  ')).toBe('hi');
    expect(normalizeBody('x'.repeat(5000)).length).toBe(4000);
  });
});
