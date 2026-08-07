// apps/admin-api/src/modules/ledger-ops/domain/accounts.ts · W059's wallet accounts, PURE (PC-56 ADMIN-6).
//
// ---------------------------------------------------------------------------
// THE DEFECT: THE CONSOLE HAS BEEN SHOWING ONE STRIPE AND CALLING IT THE BALANCE
// ---------------------------------------------------------------------------
// 0006's own comment on `wallet_accounts.shard_no` says it plainly: "platform accounts (escrow, fees) are touched by
// EVERY transaction → a single row = lock contention ceiling. Platform accounts are striped into N sub-accounts
// (shard_no 0..15 by hash of txn_id); **true balance = SUM over stripes**."
//
// `GET /v1/recon/accounts/:id` returns ONE ROW by id. So a platform escrow balance read from the reconciliation
// console is wrong by construction the moment striping is on — it shows 1/16th of the money, give or take, and
// nothing on the screen says so. W059 requires "Σ balance" per account_code and "88 stripe rows (16×4 + 8×2 + 4×2)".
//
// AND THE TWO MONEY WRITERS STRIPE DIFFERENTLY. `apps/wallet-service` hashes `idempotencyKey|accountCode` into
// `PLATFORM_STRIPE_COUNT` stripes; `apps/api`'s in-process client hardcodes `shard_no = 0` with the comment
// "(hot-account striping is a documented next step; see README)". So the stripe set for a given account_code depends
// on which writer posted, which is a real inconsistency this module can only REPORT — reconciling the two writers is
// ADMIN-6-Q4.
import { InvalidLedgerQueryError } from './ledger-ops.errors';

export const OWNER_KINDS = ['user', 'tenant', 'platform'] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

/** W059's platform account codes, with the stripe counts the screen states. Data rather than a guess: the screen
 *  prints "8 platform account codes · 88 stripe rows (16×4 + 8×2 + 4×2)", and a console that could not say how many
 *  stripes it EXPECTED could not notice one missing. */
export const PLATFORM_ACCOUNT_CODES = Object.freeze([
  'escrow', 'fees', 'gateway', 'payouts', 'gst_payable', 'tds_payable', 'promo_liability', 'suspense',
] as const);

export interface StripeRow {
  id: string;
  ownerKind: string;
  accountCode: string;
  currencyCode: string;
  shardNo: number;
  /** From `pg` as a STRING (bigint column). Never `Number` — a platform escrow balance of ₹8.64 crore is 864,124,800
   *  minor units today and this platform is aiming considerably higher than that. */
  cachedBalanceMinor: bigint;
  balanceVersion: bigint;
  lastEntryHash: string | null;
  isFrozen: boolean;
  freezeReason: string | null;
}

export interface AccountGroup {
  accountCode: string;
  currencyCode: string;
  stripeCount: number;
  /** Σ over stripes — the true balance, and the figure W059 calls "Σ balance". */
  totalMinor: bigint;
  frozenStripes: number;
  /** The stripe numbers actually present, so a gap is visible rather than absorbed into the sum. */
  shardNumbers: number[];
  /** Whether every stripe carries a chain head. An account_code where some stripes have never been written has NULL
   *  heads, which is normal on a new platform and is NOT the same as a missing stripe row. */
  stripesWithHead: number;
}

/** Group platform stripes by (account_code, currency) and sum them.
 *
 *  THE SUM IS bigint AND THE COUNT IS REPORTED BESIDE IT, deliberately. A total with no stripe count cannot be
 *  sanity-checked by a reader, and the one thing this screen must let somebody notice is a stripe that stopped being
 *  written — which shows up as a count, never as a wrong-looking total.
 */
export function groupStripes(rows: readonly StripeRow[]): AccountGroup[] {
  const by = new Map<string, StripeRow[]>();
  for (const r of rows) {
    const key = `${r.accountCode}|${r.currencyCode}`;
    const arr = by.get(key) ?? [];
    arr.push(r);
    by.set(key, arr);
  }
  return [...by.entries()]
    .map(([key, group]) => {
      const [accountCode, currencyCode] = key.split('|');
      return {
        accountCode,
        currencyCode,
        stripeCount: group.length,
        totalMinor: group.reduce((a, r) => a + r.cachedBalanceMinor, 0n),
        frozenStripes: group.filter((r) => r.isFrozen).length,
        shardNumbers: [...new Set(group.map((r) => r.shardNo))].sort((a, b) => a - b),
        stripesWithHead: group.filter((r) => !!r.lastEntryHash).length,
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode) || a.currencyCode.localeCompare(b.currencyCode));
}

/** A stripe set with a hole in it. `shard_no` runs 0..N-1 by construction, so a missing number means a row that was
 *  never created — and a Σ over the rows that DO exist would silently under-report the platform's money.
 *
 *  Returns the missing numbers rather than a boolean, because "stripe 7 is absent" is actionable and "incomplete" is
 *  not. Called only for platform accounts: user and tenant accounts are always shard 0.
 */
export function missingStripes(g: Pick<AccountGroup, 'shardNumbers'>): number[] {
  if (g.shardNumbers.length === 0) return [];
  const max = g.shardNumbers[g.shardNumbers.length - 1];
  const present = new Set(g.shardNumbers);
  const out: number[] = [];
  for (let i = 0; i <= max; i += 1) if (!present.has(i)) out.push(i);
  return out;
}

/** Whether a Σ can be trusted as the whole balance.
 *
 *  THE HONEST ANSWER IS OFTEN NO, and it must be said rather than implied by a confident number. Two ways it fails:
 *  a hole in the stripe set (a row is missing), and a stripe count that does not match what the platform is
 *  configured for (rows exist for fewer stripes than the writer distributes across, so money is landing somewhere
 *  this query did not look).
 */
export type SumConfidence =
  | { trustworthy: true; stripeCount: number }
  | { trustworthy: false; reason: 'missing_stripes'; missing: number[] }
  | { trustworthy: false; reason: 'fewer_than_configured'; found: number; configured: number };

export function sumConfidence(g: AccountGroup, configuredStripeCount: number | null): SumConfidence {
  const missing = missingStripes(g);
  if (missing.length > 0) return { trustworthy: false, reason: 'missing_stripes', missing };
  // A null configured count means the platform has not told us, and guessing would be worse than reporting the sum
  // with the count beside it.
  if (configuredStripeCount !== null && g.stripeCount < configuredStripeCount) {
    return { trustworthy: false, reason: 'fewer_than_configured', found: g.stripeCount, configured: configuredStripeCount };
  }
  return { trustworthy: true, stripeCount: g.stripeCount };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE CHAIN CLAIM W006 AND W059 PRINT                                                               */
/* ------------------------------------------------------------------------------------------------ */

export type ChainClaim =
  /** Verified, and WHEN. A tamper-evidence claim is worth exactly as much as the last time somebody checked. */
  | { kind: 'verified'; outcome: 'intact' | 'incomplete'; at: string; entriesChecked: number }
  | { kind: 'broken'; at: string; entryId: string }
  /** Never verified. Until 0113 this was the state of every account on the platform, and W006/W059 printed "intact"
   *  over it. */
  | { kind: 'never' };

/** Read the newest verification for an account into the claim the console may make.
 *
 *  `never` is the important branch and it is the default. The screens said "intact" with nothing behind them; the
 *  replacement is not a better guess, it is an admission with a date attached once one exists.
 */
export function chainClaim(v: { outcome: string; createdAt: string; entriesChecked: number; brokenAtEntryId: string | null } | null | undefined): ChainClaim {
  if (!v) return { kind: 'never' };
  if (v.outcome === 'broken') return { kind: 'broken', at: v.createdAt, entryId: v.brokenAtEntryId ?? 'unknown' };
  if (v.outcome === 'intact' || v.outcome === 'incomplete') {
    return { kind: 'verified', outcome: v.outcome, at: v.createdAt, entriesChecked: v.entriesChecked };
  }
  // An outcome this code does not recognise is NOT read as verified. `ck_lcv_*` constrains the column, so this is
  // reachable only if the vocabulary grows — and the safe direction on a tamper claim is to say nothing.
  return { kind: 'never' };
}

/* ------------------------------------------------------------------------------------------------ */
/* MONEY FOR DISPLAY                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

/** Minor units → a rupee string, en-IN grouped. Takes and returns STRINGS; there is no point in this module where a
 *  money value becomes a JS number. */
export function formatMinor(minor: bigint, currency = 'INR'): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const sym = currency === 'INR' ? '₹' : '';
  return `${neg ? '−' : ''}${sym}${(abs / 100n).toLocaleString('en-IN')}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Parse a bigint that arrived from `pg` as a string. Refuses anything else — a money column silently coerced from a
 *  JS number is the one failure this whole plane exists to make impossible. */
export function parseMinor(v: unknown, field = 'amount'): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    throw new InvalidLedgerQueryError(
      `${field} arrived as a JavaScript number. Money columns must cross as strings — a value past 2^53 minor units `
      + 'has already lost precision by the time any check sees it');
  }
  if (typeof v !== 'string' || !/^-?[0-9]{1,19}$/.test(v.trim())) {
    throw new InvalidLedgerQueryError(`${field} could not be read as a whole number of minor units`);
  }
  return BigInt(v.trim());
}
