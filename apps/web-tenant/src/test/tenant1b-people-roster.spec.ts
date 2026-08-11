// apps/web-tenant/src/test/tenant1b-people-roster.spec.ts · PC-56 TENANT-1b.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A KEYSET CURSOR MUST NOT SURVIVE A FILTER CHANGE.**
//
// A cursor is a position in ONE ordered result set. Carrying `cursor=<Meera Ben J.>` across a switch to "KYC: pending"
// would silently skip every pending member sorted before her — and then present what remains as the whole answer. On a
// screen whose job is telling staff which members still need verification, that is not a cosmetic bug: it is a list of
// people who need chasing, with an unknown number of them invisible.
import {
  parseRosterFilters, rosterHref, isFiltered, buildReveal, disputeRecordKey, sharePct,
  hasRoleLabel, hasKycLabel, ROSTER_PAGE_SIZES, DORMANT_DAYS, MIN_REVEAL_REASON,
} from '../features/people/roster';

describe('TENANT-1b · the URL is read through closed lists', () => {
  it('keeps a recognised role and drops anything else', () => {
    expect(parseRosterFilters({ role: 'farmer' }).roleCode).toBe('farmer');
    expect(parseRosterFilters({ role: 'super_admin' }).roleCode).toBeUndefined();
    expect(parseRosterFilters({ role: "' OR 1=1 --" }).roleCode).toBeUndefined();
  });

  it('keeps a recognised KYC state and drops anything else', () => {
    expect(parseRosterFilters({ kyc: 'pending' }).kycStatus).toBe('pending');
    // Not a value the `kyc_status` enum holds. Forwarding it would earn a 400 the user has to decode.
    expect(parseRosterFilters({ kyc: 'maybe' }).kycStatus).toBeUndefined();
  });

  /**
   * **THE DORMANCY WINDOW IS OURS, NOT THE URL's.** `?dormant=2` must not mean "dormant over 2 days": that would let
   * anybody produce a screen showing almost every member as dormant, which is a number staff would act on.
   */
  it('treats dormancy as a toggle with a fixed window', () => {
    expect(parseRosterFilters({ dormant: '1' }).dormantDays).toBe(DORMANT_DAYS);
    expect(parseRosterFilters({ dormant: '2' }).dormantDays).toBeUndefined();
    expect(parseRosterFilters({ dormant: '0' }).dormantDays).toBeUndefined();
    expect(parseRosterFilters({}).dormantDays).toBeUndefined();
  });

  it('accepts only the three page sizes W153 offers', () => {
    for (const n of ROSTER_PAGE_SIZES) expect(parseRosterFilters({ rows: String(n) }).limit).toBe(n);
    // 5,000 rows in one response is a denial of service written as a query string.
    expect(parseRosterFilters({ rows: '5000' }).limit).toBe(25);
    expect(parseRosterFilters({ rows: 'all' }).limit).toBe(25);
  });

  it('caps the free-text search and the cursor rather than refusing them', () => {
    // The search term CANNOT be checked against a list — it is a person's name, in Gujarati. So it is bounded and
    // passed as data; the API parameterises it.
    expect(parseRosterFilters({ q: 'क'.repeat(500) }).q).toHaveLength(80);
    expect(parseRosterFilters({ cursor: 'z'.repeat(400) }).cursor).toHaveLength(200);
    // Whitespace is not a search: it would be a full-table ILIKE '%  %'.
    expect(parseRosterFilters({ q: '   ' }).q).toBeUndefined();
  });

  it('takes the first value when a param is repeated', () => {
    // Next hands repeated params through as an array; reading `String(arr)` would search for "farmer,worker".
    expect(parseRosterFilters({ role: ['farmer', 'worker'] }).roleCode).toBe('farmer');
  });
});

describe('TENANT-1b · the cursor and the filters', () => {
  const paged = { roleCode: 'farmer', limit: 25, cursor: 'Y3Vy' };

  it('DROPS the cursor when a filter changes', () => {
    // Every one of these is a new result set.
    expect(rosterHref(paged, { kycStatus: 'pending' })).not.toContain('cursor');
    expect(rosterHref(paged, { roleCode: 'worker' })).not.toContain('cursor');
    expect(rosterHref(paged, { q: 'meera' })).not.toContain('cursor');
    expect(rosterHref(paged, { dormantDays: DORMANT_DAYS })).not.toContain('cursor');
    // **INCLUDING A PAGE-SIZE CHANGE**, which is the one people forget: 25→100 re-slices the same order, so the
    // cursor points into the middle of a page that no longer starts where it did.
    expect(rosterHref(paged, { limit: 100 })).not.toContain('cursor');
  });

  it('KEEPS the cursor only for an explicit cursor change, and keeps the filters with it', () => {
    const next = rosterHref(paged, { cursor: 'bmV4dA' });
    expect(next).toContain('cursor=bmV4dA');
    expect(next).toContain('role=farmer');
  });

  it('resets to page one on an explicit null', () => {
    expect(rosterHref(paged, { cursor: null })).toBe('/people?role=farmer');
  });

  it('leaves the default page size out of the URL', () => {
    // A link that always spells out rows=25 makes two identical views two different URLs, which breaks the
    // is-active comparison and pollutes every bookmark.
    expect(rosterHref({ limit: 25 }, {})).toBe('/people');
    expect(rosterHref({ limit: 50 }, {})).toBe('/people?rows=50');
  });

  it('knows the difference between an empty roster and an empty result', () => {
    // "No members yet" invites a bulk import; "nothing matched" invites clearing a filter. Different readers.
    expect(isFiltered({ limit: 25 })).toBe(false);
    expect(isFiltered({ limit: 25, cursor: 'abc' })).toBe(false);   // page two of everything is not "filtered"
    expect(isFiltered({ limit: 25, q: 'meera' })).toBe(true);
    expect(isFiltered({ limit: 25, dormantDays: 60 })).toBe(true);
  });
});

describe('TENANT-1b · the reveal form', () => {
  const reason = 'Calling about the delayed groundnut payout';

  it('refuses a field that is not on the closed list', () => {
    // The vault references are the ones that must never be revealable, and they are not on the list.
    expect(buildReveal({ field: 'aadhaar_vault_ref', reason })).toEqual({ ok: false, error: 'field' });
    expect(buildReveal({ field: 'pan_vault_ref', reason })).toEqual({ ok: false, error: 'field' });
    expect(buildReveal({ field: '', reason })).toEqual({ ok: false, error: 'field' });
    for (const f of ['phone', 'email', 'aadhaar_last4']) {
      expect(buildReveal({ field: f, reason }).ok).toBe(true);
    }
  });

  /** **TRIMMED BEFORE MEASURED**, so twenty spaces is not a reason — and the trimmed text is what gets sent, so the
   *  audit row does not store whitespace somebody happened to paste. */
  it('measures the reason after trimming, and sends the trimmed text', () => {
    expect(buildReveal({ field: 'phone', reason: ' '.repeat(40) })).toEqual({ ok: false, error: 'reason' });
    const padded = buildReveal({ field: 'phone', reason: `   ${reason}   ` });
    expect(padded.ok).toBe(true);
    if (padded.ok) expect(padded.value.reason).toBe(reason);
  });

  it('holds the boundary exactly at the documented minimum', () => {
    expect(MIN_REVEAL_REASON).toBe(20);
    expect(buildReveal({ field: 'phone', reason: 'a'.repeat(19) })).toEqual({ ok: false, error: 'reason' });
    expect(buildReveal({ field: 'phone', reason: 'a'.repeat(20) }).ok).toBe(true);
    // And "Support call" — the example the server's own comment refuses — is short by design.
    expect(buildReveal({ field: 'phone', reason: 'Support call' })).toEqual({ ok: false, error: 'reason' });
  });
});

describe('TENANT-1b · W154 tiles', () => {
  /**
   * **A MEMBER WITH NO DISPUTES IS NOT "CLEAN".** They have not been tested. Printing "clean" over an empty record
   * would flatter somebody who simply has not sold anything yet — and the tile is read as evidence of trustworthiness.
   */
  it('separates an untested record from a clean one', () => {
    expect(disputeRecordKey({ disputesAgainst: 0, disputesAgainstUpheld: 0, disputesOpen: 0 })).toBe('none');
    expect(disputeRecordKey({ disputesAgainst: 4, disputesAgainstUpheld: 0, disputesOpen: 0 })).toBe('clean');
    expect(disputeRecordKey({ disputesAgainst: 4, disputesAgainstUpheld: 1, disputesOpen: 0 })).toBe('upheld');
  });

  it('lets an OPEN dispute outrank a clean history', () => {
    // Something unresolved is the fact staff need first, whatever the history says.
    expect(disputeRecordKey({ disputesAgainst: 9, disputesAgainstUpheld: 0, disputesOpen: 1 })).toBe('open');
    expect(disputeRecordKey({ disputesAgainst: 9, disputesAgainstUpheld: 3, disputesOpen: 2 })).toBe('open');
  });

  /** **null, NOT 0%, WHEN THERE IS NOTHING TO DIVIDE BY.** A brand-new FPO showing "0% verified" reads as a failure
   *  when the truth is that it has no members yet. Ninth application of unknown ≠ zero. */
  it('returns null rather than a flattering or damning zero', () => {
    expect(sharePct(0, 0)).toBeNull();
    expect(sharePct(5, 0)).toBeNull();
    expect(sharePct(1146, 1284)).toBe(89);       // W153's own figure
    expect(sharePct(918, 1284)).toBe(71);        // and its second
    // Floored: 99.9% is not 100%, and a console claiming full verification when one member is pending is a lie the
    // money gate will contradict.
    expect(sharePct(999, 1000)).toBe(99);
  });
});

describe('TENANT-1b · labels degrade to the raw code, never to a translation key', () => {
  it('labels the seeded roles and passes an unknown one through', () => {
    expect(hasRoleLabel('farmer')).toBe(true);
    expect(hasRoleLabel('sardar')).toBe(true);
    // A tenant in a market this console has never seen. Rule zero: a hard-coded list must not block a country, and a
    // cell reading "people.role.jute_grower" is worse than one reading "jute_grower".
    expect(hasRoleLabel('jute_grower')).toBe(false);
    expect(hasRoleLabel('')).toBe(false);
  });

  it('labels the five KYC states the enum holds', () => {
    for (const s of ['pending', 'verified', 'expired', 'rejected', 'none']) expect(hasKycLabel(s)).toBe(true);
    expect(hasKycLabel('under_review')).toBe(false);
  });
});
