// modules/memberships/read-models/share-register.read-model.ts · W197's register, tiles and bylaw panel (PC-56 TENANT-1e).
//
// W197 is titled "Cooperative governance · Share register, voting rights, resolutions — the democratic machinery of your FPO,
// kept as carefully as the money." Four tiles, a paginated register, and a panel headed "Voting eligibility (bylaws, as data)"
// whose third rule ends with the word ENFORCED.
//
// **NOTHING HERE STORES OR TRUSTS A VERDICT.** Every "eligible / not yet" on the screen is `eligibility()` answering from the
// same facts the vote path uses, so the table cannot promise a ballot the gate will refuse — the failure mode a stored
// `voting_eligible` column produces on its first share transfer (0130 §130.2).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { maskPhone } from '../../../shared/utils/phone';
import { GovernanceRepository } from '../repositories/governance.repository';
import { Bylaws, EligibilityVerdict, bylawsFrom, eligibility } from '../domain/voting-eligibility';

export interface RegisterRow {
  userId: string;
  fullName: string | null;
  phoneMasked: string | null;
  sharesHeld: number;
  /** Law 2 — minor units, as a string. */
  valueMinor: string;
  memberSince: string | null;
  verdict: EligibilityVerdict;
}

export interface ShareRegisterTiles {
  members: number;
  shareholders: number;
  /** W197: "72 pending share allotment". Members with no holding — the tile that tells staff there is work to do. */
  pendingAllotment: number;
  totalShares: number;
  shareCapitalMinor: string;
  /**
   * W197: "12,120 shares × ₹200 face value". **null WHEN THE DIVISION IS NOT EXACT**, because shares issued in different
   * years at different prices are a real co-operative rather than a data error, and a rounded "₹200 face value" printed over
   * a mixed-price register is a claim the register itself contradicts.
   */
  faceValueMinor: string | null;
  votingEligible: number;
  /** Eligible as a share of SHAREHOLDERS, matching W197's own "98% of shareholders". null when there are none. */
  eligibleOfShareholdersBp: number | null;
  lastAgm: { resolutionId: string; title: string; closedAt: string | null; cast: number; eligible: number | null; turnoutBp: number | null } | null;
}

export interface ShareRegisterView {
  tiles: ShareRegisterTiles;
  bylaws: Bylaws;
  rows: RegisterRow[];
  /** Keyset cursor for the next page, or null at the end. W197's pager reads "1 2 … 49". */
  nextCursor: string | null;
}

const PAGE = 25;

@Injectable()
export class ShareRegisterReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly repo: GovernanceRepository,
  ) {
    void this.replica; // the repository owns the SQL; this read model composes and decides
  }

  async view(tenantId: string, cursor?: string, now = new Date()): Promise<ShareRegisterView> {
    const bylaws = bylawsFrom(await this.repo.bylawSettings(tenantId));
    const after = parseCursor(cursor);

    const [totals, page, lastClosed] = await Promise.all([
      this.repo.registerTotals(tenantId, bylaws.minShares, bylaws.minMembershipMonths),
      // One row more than the page, which is how "is there a next page" is answered without a second COUNT over 1,212 rows.
      this.repo.registerPage(tenantId, PAGE + 1, after),
      this.repo.lastClosed(tenantId),
    ]);

    const slice = page.slice(0, PAGE);
    const last = slice[slice.length - 1];

    return {
      tiles: {
        members: totals.members,
        shareholders: totals.shareholders,
        pendingAllotment: Math.max(0, totals.members - totals.shareholders),
        totalShares: totals.totalShares,
        shareCapitalMinor: totals.capitalMinor,
        faceValueMinor: faceValueOf(totals.capitalMinor, totals.totalShares),
        votingEligible: totals.eligible,
        eligibleOfShareholdersBp: totals.shareholders > 0
          ? Math.floor((totals.eligible * 10_000) / totals.shareholders)
          : null,
        lastAgm: lastClosed
          ? {
              resolutionId: lastClosed.id,
              title: lastClosed.title,
              closedAt: lastClosed.closedAt,
              cast: lastClosed.cast,
              eligible: lastClosed.eligibleAtClose,
              // **UNKNOWN, NOT ZERO.** A resolution closed before 0130 has no recorded denominator, and there is no honest
              // way to reconstruct one — so the tile says "not recorded" rather than inventing 0% for an AGM that filled a
              // village hall. Also null when the snapshot is 0, because dividing by it is not a turnout.
              turnoutBp: lastClosed.eligibleAtClose && lastClosed.eligibleAtClose > 0
                ? Math.floor((lastClosed.cast * 10_000) / lastClosed.eligibleAtClose)
                : null,
            }
          : null,
      },
      bylaws,
      rows: slice.map((r) => ({
        userId: r.userId,
        fullName: r.fullName,
        // W197 prints "+91 98••• ••210". The register is a list of people, and a staff member who needs to telephone one of
        // them goes through `member.pii.reveal` on the member page (TENANT-1b) — a register read is not a reveal.
        phoneMasked: r.phone ? maskPhone(r.phone) : null,
        sharesHeld: r.sharesHeld,
        valueMinor: r.valueMinor,
        memberSince: r.memberSince,
        verdict: eligibility(
          { isMember: true, memberSince: r.memberSince, sharesHeld: r.sharesHeld, suspended: r.suspended },
          bylaws,
          now,
        ),
      })),
      nextCursor: page.length > PAGE && last ? `${last.sharesHeld}:${last.userId}` : null,
    };
  }
}

/**
 * Face value per share.
 *
 * Integer division only, and null unless it is exact — see `faceValueMinor`. Done on BigInt because capital is a bigint
 * minor-unit string and a 15,000-member federation's share capital will exceed 2^53 paise (Law 2).
 */
function faceValueOf(capitalMinor: string, totalShares: number): string | null {
  if (totalShares <= 0) return null;
  let capital: bigint;
  try { capital = BigInt(capitalMinor); } catch { return null; }
  const shares = BigInt(totalShares);
  if (capital % shares !== 0n) return null;
  return (capital / shares).toString();
}

/** `shares:userId`. Malformed cursors are IGNORED rather than rejected — a truncated URL should show page one, not an error. */
function parseCursor(cursor?: string): { shares: number; userId: string } | undefined {
  if (!cursor) return undefined;
  const at = cursor.indexOf(':');
  if (at <= 0) return undefined;
  const shares = Number(cursor.slice(0, at));
  const userId = cursor.slice(at + 1);
  if (!Number.isInteger(shares) || shares < 0) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return undefined;
  return { shares, userId };
}
