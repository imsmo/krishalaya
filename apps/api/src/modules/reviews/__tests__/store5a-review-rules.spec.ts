// modules/reviews/__tests__/store5a-review-rules.spec.ts · PC-56 STORE-5a · B1 — the review rules the canon states, pinned (PURE):
//   • the edit window: locked AT the instant (strictly before = editable); no recorded lock → locked (fail closed); the entity refuses an edit
//     after it by name (REVIEW_LOCKED) with the clock passed in;
//   • the invite window: open strictly before the expiry; no recorded expiry → open;
//   • the ONE reminder: invited, not reminded, `afterDays` since the invite, the window open, nobody reviewed;
//   • the dimensions: the unknown keys by name;
//   • the reply is the ORGANISATION's (never a person) and the reviewer is "Verified buyer" on every shape;
//   • who may moderate: flag with review.flag OR review.moderate; hide / remove / restore with review.moderate only; `listing.moderate` no
//     longer admits review moderation (survey F-6).
import {
  editLocksAt, canEdit, eligibilityExpiresAt, isWindowOpen, reminderDue, unknownDimensions, validDimensions, organisationReply, reviewerLabel,
  mayModerate, positiveInt, ORGANISATION_REPLY, VERIFIED_BUYER, REVIEW_EDIT_WINDOW_FALLBACK_H, REVIEW_INVITE_WINDOW_FALLBACK_D, REVIEW_REMINDER_AFTER_FALLBACK_D,
} from '../domain/review-rules';
import { Review } from '../domain/review.entity';
import { ReviewLockedError } from '../domain/reviews.errors';
import { projectReview, publicReview } from '../domain/review-projection';
import { canModerateReview, canFlagReview } from '../policies/reviews.policies';

const T0 = new Date('2026-10-17T06:00:00.000Z');
const H = 3_600_000; const D = 24 * H;
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('STORE-5a · the edit window (founder D3)', () => {
  it('locks edit_window_hours after the submit; editable strictly before the instant; no lock recorded → locked', () => {
    const lock = editLocksAt(T0, 168);
    expect(lock.toISOString()).toBe('2026-10-24T06:00:00.000Z');
    expect(canEdit(at(168 * H - 1), lock)).toBe(true);
    expect(canEdit(lock, lock)).toBe(false);
    expect(canEdit(at(169 * H), lock)).toBe(false);
    expect(canEdit(T0, null)).toBe(false);
    expect(canEdit(T0, undefined)).toBe(false);
    expect(canEdit(T0, new Date('nope'))).toBe(false);
  });
  it('the entity refuses an edit after the lock by name, with the clock passed in; inside it the edit lands', () => {
    const r = Review.submit({ id: 'r', tenantId: 't', orderId: 'o', reviewerUserId: 'b', targetType: 'seller', targetId: 's', stars: 4, now: T0, editLocksAt: editLocksAt(T0, 168) });
    r.edit({ stars: 5 }, at(167 * H));
    expect(r.toProps().stars).toBe(5);
    expect(() => r.edit({ stars: 1 }, at(168 * H))).toThrow(ReviewLockedError);
    try { r.edit({ stars: 1 }, at(200 * H)); } catch (e) { expect((e as ReviewLockedError).code).toBe('REVIEW_LOCKED'); expect((e as ReviewLockedError).httpStatus).toBe(409); }
    expect(r.toProps().stars).toBe(5);
    const unlocked = Review.submit({ id: 'r2', tenantId: 't', orderId: 'o', reviewerUserId: 'b', targetType: 'seller', targetId: 's', stars: 4, now: T0 });
    expect(() => unlocked.edit({ stars: 2 }, T0)).toThrow(ReviewLockedError);   // no lock stamped → fail closed
  });
});

describe('STORE-5a · the invite window and the ONE reminder (founder D3)', () => {
  it('the window: open strictly before the expiry; no expiry recorded → open', () => {
    const exp = eligibilityExpiresAt(T0, 30);
    expect(exp.toISOString()).toBe('2026-11-16T06:00:00.000Z');
    expect(isWindowOpen(at(30 * D - 1), exp)).toBe(true);
    expect(isWindowOpen(exp, exp)).toBe(false);
    expect(isWindowOpen(T0, null)).toBe(true);
  });
  it('the reminder is due once: invited, not reminded, afterDays since the invite, the window open, nobody reviewed', () => {
    const base = { promptedAt: T0, remindedAt: null, expiresAt: at(30 * D), reviewed: false };
    expect(reminderDue(base, at(7 * D), 7)).toBe(true);
    expect(reminderDue(base, at(7 * D - 1), 7)).toBe(false);
    expect(reminderDue({ ...base, remindedAt: at(7 * D) }, at(8 * D), 7)).toBe(false);
    expect(reminderDue({ ...base, reviewed: true }, at(8 * D), 7)).toBe(false);
    expect(reminderDue({ ...base, promptedAt: null }, at(8 * D), 7)).toBe(false);
    expect(reminderDue({ ...base, expiresAt: at(6 * D) }, at(7 * D), 7)).toBe(false);
    expect(reminderDue({ ...base, expiresAt: null }, at(8 * D), 7)).toBe(false);
  });
  it('a setting is a positive whole number or nothing (the named fallbacks then apply)', () => {
    expect([positiveInt('168'), positiveInt(30), positiveInt('0'), positiveInt('-1'), positiveInt('7.5'), positiveInt(null), positiveInt('x')]).toEqual([168, 30, null, null, null, null, null]);
    expect([REVIEW_EDIT_WINDOW_FALLBACK_H, REVIEW_INVITE_WINDOW_FALLBACK_D, REVIEW_REMINDER_AFTER_FALLBACK_D]).toEqual([168, 30, 7]);
  });
});

describe('STORE-5a · the dimensions are a vocabulary (Law 6)', () => {
  const vocab = ['quality', 'freshness', 'packaging'];
  it('names every unknown key; an empty or absent map is valid', () => {
    expect(unknownDimensions({ quality: 5, taste: 4, aroma: 3 }, vocab)).toEqual(['aroma', 'taste']);
    expect(validDimensions({ quality: 5, freshness: 4, packaging: 3 }, vocab)).toBe(true);
    expect(validDimensions({}, vocab)).toBe(true);
    expect(validDimensions(undefined, vocab)).toBe(true);
    expect(validDimensions({ quality: 5 }, [])).toBe(false);
  });
});

describe('STORE-5a · the reply is the organisation\'s; the reviewer is "Verified buyer" (founder D2 / D5)', () => {
  const p = { id: 'r', tenantId: 't', orderId: 'o', reviewerUserId: 'b-uuid', targetType: 'seller' as const, targetId: 's-uuid', stars: 4, subRatings: { quality: 4 },
    body: 'good', tags: [], isVerifiedPurchase: true, status: 'published' as const, sellerResponse: 'thank you', sellerRespondedAt: T0, helpfulCount: 0, createdAt: T0, editLocksAt: at(168 * H) };
  it('organisationReply: the organisation when a reply exists, else nothing', () => {
    expect(organisationReply('thanks', T0)).toEqual({ sellerResponse: 'thanks', sellerRespondedAt: T0, respondedBy: ORGANISATION_REPLY });
    expect(organisationReply(null, T0)).toEqual({ sellerResponse: null, sellerRespondedAt: null, respondedBy: null });
    expect(organisationReply('', null)).toEqual({ sellerResponse: null, sellerRespondedAt: null, respondedBy: null });
    expect([reviewerLabel(true), reviewerLabel(false)]).toEqual([VERIFIED_BUYER, null]);
  });
  it('every shape says "organisation" and "verified_buyer"; the author / staff / desk carry the lock; the public row carries no uuid', () => {
    for (const v of ['moderator', 'staff', 'author', 'party', 'public'] as const) {
      const out = projectReview(p, v);
      expect([v, out.respondedBy, out.label]).toEqual([v, 'organisation', 'verified_buyer']);
    }
    expect(projectReview(p, 'author').editLocksAt).toEqual(at(168 * H));
    expect(projectReview(p, 'party')).not.toHaveProperty('editLocksAt');
    const pub = publicReview(p);
    expect(JSON.stringify(pub)).not.toMatch(/[0-9a-f]{8}-|b-uuid|s-uuid/);
    expect(pub).toMatchObject({ respondedBy: 'organisation', label: 'verified_buyer', sellerResponse: 'thank you' });
  });
});

describe('STORE-5a · who may moderate (founder D2)', () => {
  const ctx = (perms: string[]) => ({ permissions: new Set(perms) }) as never;
  it('flag: review.flag OR review.moderate; hide / remove / restore: review.moderate only', () => {
    const org = { canModerate: false, canFlag: true }; const desk = { canModerate: true, canFlag: true }; const nobody = { canModerate: false, canFlag: false };
    expect(['flag', 'hide', 'remove', 'restore'].map((a) => mayModerate(a as never, org))).toEqual([true, false, false, false]);
    expect(['flag', 'hide', 'remove', 'restore'].map((a) => mayModerate(a as never, desk))).toEqual([true, true, true, true]);
    expect(['flag', 'hide', 'remove', 'restore'].map((a) => mayModerate(a as never, nobody))).toEqual([false, false, false, false]);
  });
  it('listing.moderate (the organisation\'s tenant_admin) no longer admits review moderation; review.flag flags; review.moderate is the desk', () => {
    expect(canModerateReview(ctx(['listing.moderate']))).toBe(false);
    expect(canModerateReview(ctx(['review.flag']))).toBe(false);
    expect(canModerateReview(ctx(['review.moderate']))).toBe(true);
    expect(canFlagReview(ctx(['review.flag']))).toBe(true);
    expect(canFlagReview(ctx(['review.moderate']))).toBe(true);
    expect(canFlagReview(ctx(['listing.moderate', 'review.create']))).toBe(false);
  });
});
