// modules/tenancy/__tests__/tenant1d-proration.spec.ts · PC-56 TENANT-1d.
//
// **BEFORE THIS WAVE AN UPGRADE WAS FREE.** `changePlan` swapped the plan id and price on the subscription row, wrote an
// audit line, and billed nothing — `grep -rln "prorat" apps packages` returned nothing across the monorepo. A tenant
// could move Starter → Professional on day two, get every capability immediately, and be invoiced ₹0 for the remainder.
//
// The first block below checks the arithmetic against **W119's own printed invoice**, which is the only external
// authority available: if my numbers do not reproduce the screen's, one of us is wrong and it matters which.
import {
  breachBlocksChange, changeIdempotencyKey, daysBetween, directionOf, limitBreaches, nextDay,
  partPeriodCharge, partPeriodCredit, periodDays, prorate, remainingDays, taxOn,
} from '../domain/proration';

// W119: Growth ₹8,999/mo → Professional ₹19,999/mo, period 01–31 Jul, changed on 13 Jul, GST 18%.
const GROWTH = 899_900n;          // ₹8,999.00 in paise
const PROFESSIONAL = 1_999_900n;  // ₹19,999.00
const STARTER = 299_900n;         // ₹2,999.00
const JULY = { periodStart: '2026-07-01', periodEnd: '2026-07-31', today: '2026-07-13', taxBp: 1_800 };

describe('TENANT-1d · the arithmetic reproduces W119’s printed invoice', () => {
  it('counts 31 days in July and 19 days remaining from the 13th', () => {
    // "Professional, 13–31 Jul (19 days prorated)" — the day of the change counts, because the tenant gets the new plan
    // that same day. Counting from tomorrow would charge 18 days for a plan they are already using.
    expect(periodDays('2026-07-01', '2026-07-31')).toBe(31);
    expect(remainingDays('2026-07-13', '2026-07-31')).toBe(19);
  });

  it('charges ₹12,257.45 for 19 days of Professional — the screen’s ₹12,257', () => {
    // 1999900 × 19 = 37,998,100; / 31 = 1,225,745.16 → floor 1,225,745 paise = ₹12,257.45, which the screen shows as
    // ₹12,257. **AND MY FIRST EXPECTATION HERE WAS WRONG BY SIX PAISE** — I did the division by hand and the code was
    // right. Left in the record because the lesson is the reason this file exists: nobody should be doing this
    // arithmetic by hand, least of all on an invoice.
    expect(partPeriodCharge(PROFESSIONAL, 19, 31)).toBe(1_225_745n);
  });

  it('credits ₹5,516 of unused Growth — and rounds UP, "in your favour"', () => {
    // 899900 × 19 = 17,098,100; / 31 = 551,551.6 → ceil 551,552 paise = ₹5,515.52, which the screen shows as ₹5,516.
    // **THE DIRECTION IS THE DECISION**: the charge floors and the credit ceils, both toward the tenant, both by at most
    // one paisa. A platform that rounded its own way on every upgrade of 15,000 tenants would be collecting a rounding
    // error as revenue — indefensible precisely because it is tiny.
    expect(partPeriodCredit(GROWTH, 19, 31)).toBe(551_552n);
  });

  it('nets to ₹6,741.93 due and ₹1,213.55 GST — the screen’s ₹6,741 and ₹1,213', () => {
    const p = prorate({ ...JULY, fromPriceMinor: GROWTH, toPriceMinor: PROFESSIONAL });
    expect(p.direction).toBe('upgrade');
    expect(p.newPlanChargeMinor).toBe(1_225_745n);
    expect(p.unusedCreditMinor).toBe(551_552n);
    // 1,225,745 − 551,552 = 674,193 paise = ₹6,741.93 → the screen's ₹6,741 (excl. GST).
    expect(p.netDueMinor).toBe(674_193n);
    // 674,193 × 1800bp = ₹1,213.5474 → 121,355 paise half-up. The screen prints ₹1,213.
    expect(p.taxMinor).toBe(121_355n);
    /**
     * **AND HERE IS SOMETHING WORTH KNOWING ABOUT THE SCREEN ITSELF.** W119's "Total due" is ₹7,954, which is its two
     * DISPLAYED rupee figures added together (6,741 + 1,213). The true total in paise is ₹7,955.48 — because each
     * displayed line was rounded down for presentation before a reader added them.
     *
     * The invoice must total the PAISE, not the presentation: a tenant who adds the lines on screen and gets a different
     * number from the amount due has been given two answers. The console's job is to show the figures such that they
     * reconcile — so the total is rendered from `totalDueMinor` and never computed in the browser from rounded parts.
     */
    expect(p.totalDueMinor).toBe(795_548n);              // ₹7,955.48, and NOT 6,741 + 1,213 = ₹7,954
    // An upgrade applies TODAY, which is what makes it billable now.
    expect(p.effectiveDate).toBe('2026-07-13');
    expect(p.scheduled).toBe(false);
  });
});

describe('TENANT-1d · no float ever touches money (Law 2)', () => {
  it('multiplies before dividing, so a rate never rounds twice', () => {
    // The naive float version of this is 899900 * (19/31) = 551544.5161290322 → 551544 or 551545 depending on the
    // rounding mode nobody chose. Integer arithmetic makes the answer a decision instead of an accident.
    // 899900 × 19 / 31 = 551,551.6: floor 551,551, ceil 551,552.
    expect(partPeriodCharge(899_900n, 19, 31)).toBe(551_551n);
    expect(partPeriodCredit(899_900n, 19, 31)).toBe(551_552n);
    // And they differ by exactly one paisa — the whole point of the rounding rule.
    expect(partPeriodCredit(899_900n, 19, 31) - partPeriodCharge(899_900n, 19, 31)).toBe(1n);
  });

  it('computes tax in basis points, not by multiplying 0.18', () => {
    // 674100 × 0.18 in floating point is 121338.00000000001 — a tax line ending in a fractional paisa is an invoice a
    // finance team cannot file.
    expect(taxOn(674_100n, 1_800)).toBe(121_338n);
    expect(taxOn(0n, 1_800)).toBe(0n);
    expect(taxOn(674_100n, 0)).toBe(0n);
    // Half-up at the paisa: 100 × 1801bp = 18.01 → 18.
    expect(taxOn(100n, 1_801)).toBe(18n);
    // **AND THE HALF-WAY CASE IS PINNED, BECAUSE "half-up" IS A CHOICE.** 25 paise at 200bp is exactly 0.5 paise, and
    // banker's rounding would give 0 while half-up gives 1. On a tax line the tenant is the one who must not be
    // surprised, and a rule nobody wrote down is a rule that changes when somebody refactors.
    expect(taxOn(25n, 200)).toBe(1n);
  });

  /**
   * **A MUTATION SURVIVED AND THIS TEST IS WHY IT EXISTS.** Replacing the bigint computation with
   * `Math.round(Number(net) * (bp / 10000))` passed every other assertion in this file — because at Indian SaaS
   * magnitudes the float happens to agree. It stops agreeing at scale, which is precisely where this platform is going:
   * an annual enterprise invoice in a weak currency (IDR, VND — both on the Y8-9 map) exceeds 2^53 in minor units, and
   * the float answer is then wrong by tens of units with no error anywhere.
   *
   * The claim in this file's header is "no float ever touches money". A claim needs a case where the difference shows.
   */
  it('stays exact past 2^53, where a float silently loses digits', () => {
    const huge = 123_456_789_012_345_678n;          // ~1.23e17 minor units
    expect(taxOn(huge, 1_800)).toBe(22_222_222_022_222_222n);
    // What the float path would have returned, for the record: 22222222022222220 — twenty units short, no error raised.
    expect(BigInt(Math.round(Number(huge) * 0.18))).not.toBe(taxOn(huge, 1_800));
  });

  it('handles a price larger than Number.MAX_SAFE_INTEGER in minor units', () => {
    // An annual enterprise plan in a weak currency exceeds 2^53 paise. This is exactly where a float silently loses the
    // last digits — and where a tenant notices.
    const huge = 90_071_992_547_409_930n;
    expect(partPeriodCharge(huge, 1, 2)).toBe(45_035_996_273_704_965n);
  });
});

describe('TENANT-1d · a downgrade waits, and W119 says it must', () => {
  it('schedules a downgrade for the day after the period ends', () => {
    // "Downgrade takes effect 01 Aug" for a period ending 31 Jul — the day the NEW period starts, not the last day of
    // the old one.
    const p = prorate({ ...JULY, fromPriceMinor: GROWTH, toPriceMinor: STARTER });
    expect(p.direction).toBe('downgrade');
    expect(p.scheduled).toBe(true);
    expect(p.effectiveDate).toBe('2026-08-01');
  });

  it('bills a downgrade nothing at all — "no clawbacks mid-cycle"', () => {
    // Charging for a downgrade would be charging for less; applying it immediately would take away capability the tenant
    // has already paid for while owing them a refund this platform cannot compute.
    const p = prorate({ ...JULY, fromPriceMinor: GROWTH, toPriceMinor: STARTER });
    expect(p.netDueMinor).toBe(0n);
    expect(p.taxMinor).toBe(0n);
    expect(p.totalDueMinor).toBe(0n);
    expect(p.unusedCreditMinor).toBe(0n);
    // The day counts are still returned: a downgrade screen with no numbers leaves a tenant guessing whether they were
    // charged.
    expect(p.daysInPeriod).toBe(31);
    expect(p.daysRemaining).toBe(19);
  });

  it('applies a lateral change today and bills nothing', () => {
    const p = prorate({ ...JULY, fromPriceMinor: GROWTH, toPriceMinor: GROWTH });
    expect(p.direction).toBe('lateral');
    expect(p.scheduled).toBe(false);
    expect(p.effectiveDate).toBe('2026-07-13');
    expect(p.totalDueMinor).toBe(0n);
  });

  /**
   * **DIRECTION IS BY PRICE, NOT BY PLAN NAME — AND THIS IS THE CASE THAT WOULD HAVE BILLED AN ANCHOR TENANT WRONGLY.**
   * `subscriptions.price_minor` is the NEGOTIATED price (0002 says so). A founding partner on a ₹25,000 anchor deal
   * moving to list-price Professional at ₹19,999 is going DOWN, whatever the plan ladder says — so it schedules and bills
   * nothing, rather than charging them immediately for a change that reduces their bill.
   */
  it('reads an anchor tenant’s move to a "higher" plan as the downgrade it is', () => {
    const anchor = 2_500_000n;   // ₹25,000 negotiated
    expect(directionOf(anchor, PROFESSIONAL)).toBe('downgrade');
    const p = prorate({ ...JULY, fromPriceMinor: anchor, toPriceMinor: PROFESSIONAL });
    expect(p.scheduled).toBe(true);
    expect(p.totalDueMinor).toBe(0n);
  });
});

describe('TENANT-1d · edge days', () => {
  it('charges a full period when the change lands on day one', () => {
    const p = prorate({ ...JULY, today: '2026-07-01', fromPriceMinor: GROWTH, toPriceMinor: PROFESSIONAL });
    expect(p.daysRemaining).toBe(31);
    expect(p.newPlanChargeMinor).toBe(PROFESSIONAL);      // the whole month
    expect(p.unusedCreditMinor).toBe(GROWTH);             // the whole month credited
    expect(p.netDueMinor).toBe(PROFESSIONAL - GROWTH);    // exactly the difference, no rounding artefact
  });

  it('charges one day when the change lands on the last day', () => {
    const p = prorate({ ...JULY, today: '2026-07-31', fromPriceMinor: GROWTH, toPriceMinor: PROFESSIONAL });
    expect(p.daysRemaining).toBe(1);
    expect(p.newPlanChargeMinor).toBe(PROFESSIONAL / 31n);
  });

  it('charges nothing for a change dated after the period has ended', () => {
    // A clock skew or a stale form must not produce a negative or a wrapped charge.
    const p = prorate({ ...JULY, today: '2026-08-05', fromPriceMinor: GROWTH, toPriceMinor: PROFESSIONAL });
    expect(p.daysRemaining).toBe(0);
    expect(p.newPlanChargeMinor).toBe(0n);
    expect(p.netDueMinor).toBe(0n);
  });

  it('never returns a negative amount, whatever the prices', () => {
    // A negotiated price can make the arithmetic surprising, and a negative "due" would be a silent refund nobody
    // authorised.
    const p = prorate({ ...JULY, fromPriceMinor: 5_000_000n, toPriceMinor: 5_000_001n });
    expect(p.netDueMinor >= 0n).toBe(true);
    expect(p.totalDueMinor >= 0n).toBe(true);
  });

  it('handles a malformed date without producing a wild number', () => {
    expect(daysBetween('not-a-date', '2026-07-31')).toBe(0);
    expect(periodDays('bad', 'worse')).toBe(1);
    expect(nextDay('bad')).toBe('bad');
  });

  it('counts a leap-February correctly', () => {
    expect(periodDays('2028-02-01', '2028-02-29')).toBe(29);
    expect(periodDays('2026-02-01', '2026-02-28')).toBe(28);
  });
});

describe('TENANT-1d · limits are disclosed, never enforced by deletion', () => {
  const starterLimits = { max_farmers: '500', max_staff: '2', api_rph: '-1' };

  it('names every limit the tenant is already over', () => {
    const breaches = limitBreaches(starterLimits, { max_farmers: '1284', max_staff: '7' });
    expect(breaches).toEqual([
      { limitCode: 'max_farmers', limitValue: '500', currentUsage: '1284' },
      { limitCode: 'max_staff', limitValue: '2', currentUsage: '7' },
    ]);
  });

  it('treats -1 as unlimited (0002’s own convention)', () => {
    expect(limitBreaches({ api_rph: '-1' }, { api_rph: '999999' })).toEqual([]);
  });

  it('treats an unmeasured limit as unknown rather than as a breach', () => {
    // A limit with no usage counter is not a pass and not a fail — and inventing a zero would make every plan look
    // comfortably within a limit nobody is counting.
    expect(limitBreaches({ storage_gb: '10' }, {})).toEqual([]);
  });

  /**
   * **THE RULE THAT PROTECTS A FARMER RATHER THAN THE PLATFORM.** W119: "Existing members are never removed; you just
   * can't add more until within limits."
   *
   * A platform that dropped 784 members because a co-operative downgraded to save ₹6,000 a month would have destroyed
   * the register those members' payouts depend on, in order to enforce a price. So a breach is a warning on the way in
   * and a ceiling on ADDITIONS afterwards — never a deletion, and never a block on the downgrade itself.
   */
  it('never blocks the change and never implies a deletion', () => {
    expect(breachBlocksChange()).toBe(false);
  });
});

describe('TENANT-1d · "a double click cannot charge twice"', () => {
  it('derives the same key for the same change', () => {
    // Derived, not random: the SECOND click must compute the same key and collide on the unique index (0126). A random
    // key would make the promise depend on a browser disabling a button.
    const a = changeIdempotencyKey('sub-1', 'plan-pro', '2026-07-13');
    const b = changeIdempotencyKey('sub-1', 'plan-pro', '2026-07-13');
    expect(a).toBe(b);
  });

  it('distinguishes a genuinely different change', () => {
    // Same subscription, different target plan, or the same target on a different effective date: both are real, separate
    // decisions and must be able to coexist.
    expect(changeIdempotencyKey('sub-1', 'plan-pro', '2026-07-13'))
      .not.toBe(changeIdempotencyKey('sub-1', 'plan-starter', '2026-07-13'));
    expect(changeIdempotencyKey('sub-1', 'plan-pro', '2026-07-13'))
      .not.toBe(changeIdempotencyKey('sub-1', 'plan-pro', '2026-08-01'));
  });
});
