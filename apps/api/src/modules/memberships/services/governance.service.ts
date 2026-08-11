// modules/memberships/services/governance.service.ts · PC-54 W54-7. The AGM lifecycle:
// draft → open (voting window live) → closed. Votes land ONLY while open AND inside the window (server
// clock); one ballot per member (DB PK). Results are a tally read — dividend/bonus EXECUTION (money) is a
// separate settlement concern and stays gated (`coop-payout-runs`).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { GovernanceRepository } from '../repositories/governance.repository';
import { bylawsFrom, eligibility, assertEligible, mayChangeVote, tally as tallyOf } from '../domain/voting-eligibility';

export const RESOLUTION_TYPES = ['agm_vote', 'dividend', 'patronage_bonus', 'board_election'] as const;
export interface GovActor { userId: string; canManage: boolean }

@Injectable()
export class GovernanceService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService, private readonly repo: GovernanceRepository) {}

  async create(tenantId: string, actor: GovActor, key: string, dto: { title: string; body?: string; resolutionType: string; votingOpens?: string; votingCloses?: string; payload?: Record<string, unknown> }) {
    if (!actor.canManage) throw new ForbiddenError('requires tenant.settings');
    if (dto.votingOpens && dto.votingCloses && dto.votingCloses <= dto.votingOpens) throw new BadRequestError('votingCloses must be after votingOpens');
    return this.idem.remember(key, actor.userId, 'governance.resolution.create', async () => {
      const id = uuidv7();
      await this.uow.run(tenantId, (tx) => this.repo.insert(tx, { id, tenantId, ...dto }), { userId: actor.userId });
      return { id, status: 'draft' as const };
    });
  }
  list(tenantId: string, status?: string) { return this.repo.list(tenantId, status); }

  async transition(tenantId: string, actor: GovActor, id: string, to: 'open' | 'closed') {
    if (!actor.canManage) throw new ForbiddenError('requires tenant.settings');
    // The eligible roll is read BEFORE the transaction and written INSIDE it: a closing resolution must carry the
    // denominator of its own turnout, because eligibility is derived from facts that keep moving (0130 §130.3). Read outside
    // because this is a whole-roll count and it must not hold the resolution's row lock while it runs.
    const eligible = to === 'closed'
      ? await (async () => { const b = bylawsFrom(await this.repo.bylawSettings(tenantId)); return this.repo.eligibleCount(tenantId, b.minShares, b.minMembershipMonths); })()
      : null;
    const ok = await this.uow.run(tenantId, async (tx) => {
      const changed = await this.repo.setStatus(tx, tenantId, id, to === 'open' ? ['draft'] : ['open'], to);
      // Only when the transition actually happened — stamping a denominator on a resolution somebody else closed first would
      // overwrite their snapshot with a later roll. (`recordEligibleAtClose` also refuses a non-NULL column, so both halves
      // of that race are covered.)
      if (changed && eligible !== null) await this.repo.recordEligibleAtClose(tx, tenantId, id, eligible);
      return changed;
    }, { userId: actor.userId });
    if (!ok) throw new ConflictError(`resolution is not ${to === 'open' ? 'a draft' : 'open'}`);
    return { id, status: to };
  }

  /**
   * Cast — or CHANGE — one member's vote.
   *
   * **THE ELIGIBILITY GATE IS THE POINT OF THIS METHOD AND IT DID NOT EXIST (PC-56 TENANT-1e).** Before 0130 this checked
   * the resolution's status, the voting window, and whether the user had already voted — and nothing else. No permission
   * decorator on the route, no membership check, no shareholding check, no tenure check. So any authenticated user in the
   * tenant could cast a ballot in an FPO's annual general meeting: a staff member, a delivery partner, a buyer holding a
   * `customer` role, somebody imported by a bulk file that morning. W197 prints "Voting eligibility (bylaws, as data)" with
   * the word "enforced" beside the coop principle.
   *
   * **AND A VOTE IS NOW CHANGEABLE UNTIL THE WINDOW CLOSES**, which W198 promises twice and the code refused twice: a bare
   * INSERT reported its unique-violation to the member as "you have already voted", so a farmer who tapped the wrong button
   * on a feature phone was stuck with it — on a resolution deciding how their own patronage bonus is distributed. The change
   * is an UPDATE on the same row, because the composite primary key IS the one-member-one-vote guarantee.
   */
  async vote(tenantId: string, memberUserId: string, id: string, choice: string) {
    if (!choice || choice.length > 20) throw new BadRequestError('choice required (max 20)');

    // The bylaws and the voter's facts are READS, so they happen before the transaction rather than inside it: a ballot that
    // is going to be refused should not hold a row lock on the resolution while the refusal is decided.
    const bylaws = bylawsFrom(await this.repo.bylawSettings(tenantId));
    const facts = await this.repo.voterFacts(tenantId, memberUserId);
    // Throws a 403 naming the reason — "you need 4 more shares" and "eligible from November" are answers somebody can act
    // on, where a bare "forbidden" sends a farmer to a field officer who cannot explain it either.
    assertEligible(eligibility(facts, bylaws));

    return this.uow.run(tenantId, async (tx) => {
      const res = await this.repo.getForUpdate(tx, tenantId, id);
      if (!res) throw new NotFoundError('resolution not found');
      const now = new Date().toISOString();
      if (res.status !== 'open') throw new ConflictError('voting is not open');
      if (res.votingOpens && now < res.votingOpens) throw new ConflictError('voting has not started');
      if (res.votingCloses && now > res.votingCloses) throw new ConflictError('voting has closed');

      if (await this.repo.castVote(tx, id, memberUserId, choice)) return { resolutionId: id, choice, changed: false };

      // A row already exists. **THE WINDOW IS RE-CHECKED THROUGH THE DOMAIN RULE RATHER THAN ASSUMED FROM THE CHECKS ABOVE**,
      // because "may this be changed" is its own question with its own answer after close — W198: "votes immutable after
      // close" — and expressing it once, in the domain, is what keeps the two halves of the promise consistent.
      if (!mayChangeVote(res.status, res.votingCloses, new Date())) {
        throw new ConflictError('voting has closed — your vote is final');
      }
      if (!(await this.repo.changeVote(tx, id, memberUserId, choice))) {
        // The UPDATE's WHERE excludes an unchanged choice, so this is "you already voted that way" rather than a failure.
        throw new ConflictError('that is already your vote');
      }
      return { resolutionId: id, choice, changed: true };
    }, { userId: memberUserId });
  }

  /** Is this member eligible, and if not, what would they need? Read-only — the console shows it before offering a ballot. */
  async eligibilityFor(tenantId: string, memberUserId: string) {
    const bylaws = bylawsFrom(await this.repo.bylawSettings(tenantId));
    const facts = await this.repo.voterFacts(tenantId, memberUserId);
    return { bylaws, facts, verdict: eligibility(facts, bylaws) };
  }

  /**
   * The live tally, with a real denominator.
   *
   * **W198 PRINTS "618 / 1,186 · 52% · quorum 33% ✓ met" AND NOTHING COMPUTED A QUORUM.** `results` returned a bare
   * per-choice count with no denominator, so turnout, quorum and "passed" were all unanswerable — on a screen whose own copy
   * says "Live tally visible to every member — the same numbers you see."
   */
  async results(tenantId: string, id: string) {
    const res = await this.repo.get(tenantId, id);
    if (!res) throw new NotFoundError('resolution not found');
    const bylaws = bylawsFrom(await this.repo.bylawSettings(tenantId));
    const [byChoice, eligible] = await Promise.all([
      this.repo.tally(tenantId, id),
      this.repo.eligibleCount(tenantId, bylaws.minShares, bylaws.minMembershipMonths),
    ]);
    return { resolution: res, tally: tallyOf(byChoice, eligible, bylaws.quorumBp) };
  }
}
