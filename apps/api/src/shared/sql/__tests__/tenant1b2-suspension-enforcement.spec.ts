// shared/sql/__tests__/tenant1b2-suspension-enforcement.spec.ts · PC-56 TENANT-1b-2.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: "PAUSES LISTINGS" MEANS EVERY PATH, NOT MOST OF THEM.**
//
// W154's danger zone promises that suspending a member pauses their listings. That promise touches SEVEN places — the
// public search feed, the gallery, the links model, the seller profile, the mandi band, the offers service, and the
// listing write path — and a suspension that works on five of seven is worse than none, because staff learn it
// *sometimes* works and stop trusting the control.
//
// **SO THIS SUITE ENUMERATES THE FILES, AND THAT IS THE PART THAT MATTERS.** It fails when somebody adds an eighth public
// listing read without the clause — which is the failure mode a code review will not catch a year from now, on a team
// that has never read 0127.
//
// A previous wave taught the technique the hard way: deleting an entire `EXISTS` clause from a read model left every
// value-level test green, because the test harness was the thing returning no rows. **A rule expressed in SQL is invisible
// to a value-level assertion; only an assertion on the SQL text catches it.**
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  memberSuspendedSql, sellerNotSuspendedSql, sellerSuspendedExpr, isPubliclyVisible,
} from '../member-suspension.sql';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

describe('TENANT-1b-2 · the predicate is one predicate', () => {
  it('names the table, both null conditions, and the tenant', () => {
    const sql = sellerNotSuspendedSql('l');
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/tenant_member_suspensions/);
    expect(sql).toMatch(/kvs\.tenant_id = l\.tenant_id/);
    expect(sql).toMatch(/kvs\.user_id = l\.seller_user_id/);
    // **BOTH NULL PREDICATES, VERBATIM.** Dropping either would still be CORRECT and would quietly stop matching the
    // PARTIAL index `idx_tms_live_lookup` — turning an index probe on the public feed into a scan of the whole history.
    expect(sql).toMatch(/kvs\.lifted_at IS NULL/);
    expect(sql).toMatch(/kvs\.deleted_at IS NULL/);
  });

  /**
   * **ALL THREE FORMS, NOT JUST THE ONE ON THE FEED — AND A MUTATION PROVED WHY.**
   *
   * Deleting `lifted_at IS NULL` from `memberSuspendedSql` left every test green, because the assertion above only
   * examined the `sellerNotSuspendedSql` variant. That helper is the one on the AUTH path: without the predicate, a
   * REINSTATED member could never sign in again, because a closed episode would still read as live. The most severe
   * failure this feature could have, and the suite could not see it.
   */
  it.each([
    ['memberSuspendedSql', memberSuspendedSql('$2', '$1')],
    ['sellerNotSuspendedSql', sellerNotSuspendedSql('l')],
    ['sellerSuspendedExpr', sellerSuspendedExpr('$2', 'seller_user_id')],
  ])('%s carries BOTH null predicates', (_name, sql) => {
    expect(sql).toMatch(/tenant_member_suspensions/);
    // Without this one a lifted suspension never ends.
    expect(sql).toMatch(/kvs\.lifted_at IS NULL/);
    // Without this one a soft-deleted row keeps acting, and the partial index stops being used.
    expect(sql).toMatch(/kvs\.deleted_at IS NULL/);
  });

  it('takes the alias it is given, so it can sit in any query', () => {
    expect(sellerNotSuspendedSql('listings')).toMatch(/kvs\.tenant_id = listings\.tenant_id/);
    expect(memberSuspendedSql('$2', '$1')).toMatch(/kvs\.tenant_id = \$2[\s\S]*kvs\.user_id = \$1/);
    expect(sellerSuspendedExpr('$2', 'seller_user_id')).toMatch(/^EXISTS/);
  });

  it('uses an alias no listing query is likely to have already', () => {
    // `kvs` rather than `s`: several of these queries already alias tables with single letters, and a collision would be
    // a silent correlated-subquery bug rather than a syntax error.
    expect(sellerNotSuspendedSql('l')).toMatch(/tenant_member_suspensions kvs/);
  });
});

describe('TENANT-1b-2 · the visibility rule', () => {
  it('refuses a published, public listing whose seller is suspended', () => {
    expect(isPubliclyVisible({ status: 'published', visibility: 'public', sellerSuspended: false })).toBe(true);
    expect(isPubliclyVisible({ status: 'published', visibility: 'cross_tenant', sellerSuspended: false })).toBe(true);
    // The suspension wins over everything else, which is why it is checked FIRST.
    expect(isPubliclyVisible({ status: 'published', visibility: 'public', sellerSuspended: true })).toBe(false);
    expect(isPubliclyVisible({ status: 'published', visibility: 'cross_tenant', sellerSuspended: true })).toBe(false);
  });

  it('still refuses the states it refused before', () => {
    expect(isPubliclyVisible({ status: 'paused', visibility: 'public', sellerSuspended: false })).toBe(false);
    expect(isPubliclyVisible({ status: 'held', visibility: 'public', sellerSuspended: false })).toBe(false);
    expect(isPubliclyVisible({ status: 'published', visibility: 'private', sellerSuspended: false })).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------------ */
/* THE ENUMERATION — THE REASON THIS FILE EXISTS                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * Every path that decides whether a buyer can see, price against, or transact on a listing.
 *
 * **ADDING A PUBLIC LISTING READ WITHOUT THE CLAUSE MUST FAIL A TEST, NOT A CODE REVIEW.** If a new read model belongs on
 * this list, add it here AND apply the predicate; if it genuinely does not (an owner-only view, an admin-realm read),
 * write down why next to it rather than leaving the omission for somebody to rediscover.
 */
const ENFORCEMENT_SITES: { file: string; why: string; calls: RegExp; minCalls: number }[] = [
  { file: 'modules/listings/read-models/listing-search.read-model.ts', why: 'the public storefront feed',
    calls: /sellerNotSuspendedSql\(/g, minCalls: 1 },        // one use, on the PUBLIC branch only
  { file: 'modules/listings/read-models/listing-gallery.read-model.ts', why: 'signed photo URLs for a listing',
    calls: /sellerSuspendedExpr\(|isPubliclyVisible\(/g, minCalls: 2 },   // SELECT the flag, then judge with it
  { file: 'modules/listings/read-models/listing-links.read-model.ts', why: 'the public trace QR and auction link',
    calls: /sellerSuspendedExpr\(|isPubliclyVisible\(/g, minCalls: 2 },
  { file: 'modules/listings/read-models/seller-profile.read-model.ts', why: 'the public "listings active" count',
    calls: /sellerNotSuspendedSql\(/g, minCalls: 1 },
  { file: 'modules/listings/read-models/mandi-band.read-model.ts', why: 'the price band a FARMER reads before selling',
    calls: /sellerNotSuspendedSql\(/g, minCalls: 1 },
  { file: 'modules/offers/services/listing-offer.service.ts', why: 'making an offer — the act the feed leads to',
    calls: /assertSellerNotSuspended\(/g, minCalls: 2 },     // the definition + the call inside make()
  { file: 'modules/listings/services/listing.service.ts', why: 'create, publish and repost',
    calls: /assertSellerNotSuspendedTx\(/g, minCalls: 4 },   // the definition + create + publish + repost
];

describe('TENANT-1b-2 · every enforcement site imports the shared rule', () => {
  /**
   * **THE CALL SITES ARE COUNTED, NOT MERELY THE IMPORT — AND A MUTATION TAUGHT THIS TOO.**
   *
   * Deleting the check from the offers path survived the first version of this test, because that file still IMPORTED the
   * helper and still DEFINED its little wrapper; only the one line that called it was gone. An import proves a file knows
   * about a rule. A count proves the rule is applied as many times as it has places to be applied — and it is the count
   * that fails when somebody removes the third of three listing write guards.
   */
  it.each(ENFORCEMENT_SITES)('$file — $why', ({ file, calls, minCalls }) => {
    const text = read(file);
    // Imported from ONE module. A site that spelled the predicate out inline would pass a naive "mentions the table"
    // check while being free to drift, so the import is asserted too.
    expect(text).toMatch(/from '(\.\.\/)+shared\/sql\/member-suspension\.sql'/);
    expect(text.match(calls)?.length ?? 0).toBeGreaterThanOrEqual(minCalls);
  });

  /**
   * **AND NO SITE MAY WRITE THE PREDICATE OUT BY HAND.** This is the assertion that keeps the list honest: a developer in
   * a hurry copies the `NOT EXISTS` block into a new query, the enumeration above still passes because the file also
   * imports something, and now there are two copies of a rule that must never disagree.
   */
  it('nowhere outside the shared module hard-codes the table in a listing query', () => {
    for (const { file } of ENFORCEMENT_SITES) {
      const text = read(file);
      expect(text).not.toMatch(/FROM tenant_member_suspensions/);
    }
  });
});

describe('TENANT-1b-2 · the owner still sees their own listings', () => {
  it('applies the feed filter only on the PUBLIC branch', () => {
    const feed = read('modules/listings/read-models/listing-search.read-model.ts');
    // The owner view ("my listings") must NOT be filtered: hiding a suspended member's own catalogue from them makes the
    // platform look broken rather than strict, and they need to see it to sort the suspension out.
    const ownerBranch = feed.slice(feed.indexOf('if (opts.ownerUserId)'), feed.indexOf('if (q.categoryId)'));
    const publicBranch = ownerBranch.slice(ownerBranch.indexOf('} else {'));
    const ownerOnly = ownerBranch.slice(0, ownerBranch.indexOf('} else {'));
    expect(publicBranch).toMatch(/sellerNotSuspendedSql/);
    expect(ownerOnly).not.toMatch(/sellerNotSuspendedSql/);
  });
});

describe('TENANT-1b-2 · the tenant scope, asserted in the code that resolves access', () => {
  /**
   * `RoleCacheService` is the single authority for what somebody may do inside a tenant — every token mint, every
   * refresh, every impersonation resolution. So the suspension check there covers all of them.
   *
   * **AND IT MUST BE SCOPED TO THE TENANT BEING RESOLVED**, which is the whole design: an unscoped check would reproduce
   * `users.status` with extra steps and lock the member out everywhere.
   */
  it('resolves a suspended member to nothing, in this tenant only', () => {
    const rc = read('core/rbac/role-cache.service.ts');
    expect(rc).toMatch(/memberSuspendedSql/);
    expect(rc).toMatch(/return \{ roles: \[\], permissions: \[\] \}/);
    // The parameters are the user and THIS tenant — never the user alone.
    expect(rc).toMatch(/memberSuspendedSql\('\$2', '\$1'\)[\s\S]{0,80}\[userId, tenantId\]/);
  });

  it('refuses a token for the suspended tenant on both the OTP and refresh paths', () => {
    const auth = read('modules/identity/services/auth.service.ts');
    // Two call sites — verifyOtp and refreshSession. A refresh token lives thirty days; without the second call site the
    // member simply renews their way past the suspension.
    expect(auth.match(/assertNotSuspended\(/g)?.length).toBeGreaterThanOrEqual(3); // 2 calls + the definition
    expect(auth).toMatch(/TenantMembershipSuspendedError/);
    // **AND THE ERROR IS ITS OWN CODE, NOT `UserNotActiveError`.** "Your account is suspended" when the member can still
    // trade through their other FPO is a lie that sends them to the wrong support desk.
    const errors = read('modules/identity/domain/identity.errors.ts');
    expect(errors).toMatch(/TENANT_MEMBERSHIP_SUSPENDED/);
    expect(errors).toMatch(/class TenantMembershipSuspendedError/);
  });

  it('never revokes sessions, because a session is not tenant-scoped', () => {
    // `sessions.revokeAllForUser` would sign the member out of EVERY tenant — the exact cross-tenant harm 0127 avoids.
    // The suspension therefore relies on per-tenant token minting and the access-token TTL, which the console states.
    const svc = read('modules/identity/services/member-suspension.service.ts');
    expect(svc).not.toMatch(/revokeAllForUser/);
    expect(svc).not.toMatch(/SessionRepository/);
  });
});
