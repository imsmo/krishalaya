// modules/memberships/services/governance.service.ts · PC-54 W54-7, PC-56 TENANT-1e, PC-56 TENANT-9b. The AGM lifecycle:
// draft → open (voting window live) → closed | withdrawn. Votes land ONLY while open AND inside the window (server clock
// AND 0182's trigger); one ballot per member (DB PK); a ballot is a choice DECLARED for the resolution's type (0182).
// Results are a tally read — dividend/bonus EXECUTION (money) is a separate settlement concern (`coop-payout-runs`).
//
// [PC-56 TENANT-9b] WHAT CHANGED, AND WHY (survey_t9 F-13 / F-14 / F-15 / F-17 / F-18):
//   • `results` READ TODAY'S ROLL FOR A CLOSED RESOLUTION (F-13). A closed resolution is now read from its snapshot —
//     the roll recorded at close (0130), the rule fixed at open (0182) and the OUTCOME the database wrote at close; one
//     closed before the snapshot existed says "not recorded". Today's roll and today's bylaws are read only for an OPEN
//     resolution, whose vote is still today's.
//   • CREATE / EDIT / OPEN / CLOSE / WITHDRAW are recorded acts: each is reviewed by the API first (the form chain's
//     review, the mutate chain's confirm), re-judged on the locked row, written with an audit row (actor · time · reason ·
//     before/after · the request's IP or NULL) in the same transaction, keyed by the Idempotency-Key the review / confirm
//     page minted (Law 3). They need `governance.manage` (0182 — no board role exists on this platform; named). A special
//     or dividend-class resolution is closed by somebody OTHER than its opener (and 0182's trigger refuses it underneath).
//   • Opening and closing tell the members (F-15): `governance.resolution_opened` / `_closed` on the outbox (Law 4),
//     bridged to the catalogue's `resolution.opened` / `resolution.closed` (en/hi/gu, seed 0007).
//   • Times are typed as the cooperative's CIVIL time and turned into instants by the database in its own zone (F-17).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { encodeKeyset, KeysetCursor } from '../../../shared/pagination/us-keyset';
import { GovernanceRepository, Resolution, ResolutionFilters } from '../repositories/governance.repository';
import { bylawsFrom, eligibility, assertEligible, mayChangeVote } from '../domain/voting-eligibility';
import {
  RESOLUTION_TYPES as RULE_TYPES, ResolutionAct, DraftInput, GovernanceCatalogue, PassRule, ResultView,
  actVerdict, ballotVerdict, buildDraftReview, choicesFor, isCivilDateTime, passRuleFor, resultView, specialMajorityFrom, Majority,
} from '../domain/resolution-rules';
import { BallotChoiceUndeclaredError, GovernanceRefusedError } from '../domain/memberships.errors';

export const RESOLUTION_TYPES = RULE_TYPES;
export interface GovActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
export const canManageGovernance = (a: { permissions: ReadonlySet<string> }) => a.permissions.has('governance.manage') || a.permissions.has('*');

/** The outbox types (Law 4), mapped to the catalogue in communication's event map. */
export const RESOLUTION_OPENED_EVENT = 'governance.resolution_opened';
export const RESOLUTION_CLOSED_EVENT = 'governance.resolution_closed';

const pgCode = (e: unknown) => (e as { code?: string })?.code;

export function snapshotRule(r: Pick<Resolution, 'quorumBp' | 'passNum' | 'passDen' | 'passStrict'>): PassRule | null {
  return r.quorumBp === null || r.passNum === null || r.passDen === null || r.passStrict === null
    ? null : { quorumBp: r.quorumBp, num: r.passNum, den: r.passDen, strict: r.passStrict };
}
const inFavourCodes = (cat: GovernanceCatalogue) => cat.choices.filter((c) => c.inFavour).map((c) => c.code);

/** A civil instant for a notice, digits only (DD/MM/YYYY HH:MM) — readable in every script the platform sends in. */
function noticeWhen(civil: string | null): string | null {
  if (!civil) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(civil);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : null;
}

@Injectable()
export class GovernanceService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
              private readonly repo: GovernanceRepository, private readonly audit: AuditWriter,
              @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter, private readonly ui: UiMessageRepository) {}

  /** The form's catalogue: types, declared choices per type, act reasons, today's rule, the zone, the currency, the FY. */
  async catalogue(tenantId: string) {
    const [cat, settings, clock] = await Promise.all([this.repo.catalogue(tenantId), this.repo.bylawSettings(tenantId), this.repo.clockOf(tenantId)]);
    const bylaws = bylawsFrom(settings); const special = specialMajorityFrom(settings);
    return {
      ...cat,
      choicesByType: Object.fromEntries(cat.types.map((t) => [t.code, choicesFor(cat, t.code)])),
      rules: { ordinary: passRuleFor('ordinary', bylaws, special), special: passRuleFor('special', bylaws, special) },
      zone: clock.zone, currency: clock.currency, fiscalYearStartMonth: clock.fyMonth,
    };
  }

  /* -------------------------------------------------------------------------------------------------------- */
  /* THE DRAFT (W2741–W2744)                                                                                  */
  /* -------------------------------------------------------------------------------------------------------- */

  private async draftReview(tenantId: string, actor: GovActor, input: DraftInput, current: Resolution | null) {
    const [cat, settings, clock] = await Promise.all([this.repo.catalogue(tenantId), this.repo.bylawSettings(tenantId), this.repo.clockOf(tenantId)]);
    const civil = async (v: string | null | undefined) => {
      const s = (v ?? '').trim();
      return s && isCivilDateTime(s) ? this.repo.civilToInstant(tenantId, clock.zone, s) : null;
    };
    const [opensAt, closesAt] = await Promise.all([civil(input.votingOpens), civil(input.votingCloses)]);
    const cur = current ? {
      status: current.status, title: current.title, body: current.body, resolutionType: current.resolutionType, majority: current.majority,
      votingOpensCivil: await this.repo.instantToCivil(tenantId, clock.zone, current.votingOpens),
      votingClosesCivil: await this.repo.instantToCivil(tenantId, clock.zone, current.votingCloses),
      payload: current.payload,
    } : null;
    return buildDraftReview(input, {
      canManage: canManageGovernance(actor), catalogue: cat, zone: clock.zone, currency: clock.currency, fyMonth: clock.fyMonth,
      bylaws: bylawsFrom(settings), special: specialMajorityFrom(settings), opensAt, closesAt, now: new Date(), current: cur,
    });
  }

  /** W2742: the review the API computes — read-only. `id` = an edit of that draft. */
  async previewDraft(tenantId: string, actor: GovActor, input: DraftInput, id?: string) {
    const current = id ? await this.repo.get(tenantId, id) : null;
    if (id && !current) throw new NotFoundError('resolution not found');
    return this.draftReview(tenantId, actor, input, current);
  }

  /** The draft's editable values in the form's own shape (the edit chain's prefill). */
  async draftValues(tenantId: string, id: string) {
    const r = await this.repo.get(tenantId, id);
    if (!r) throw new NotFoundError('resolution not found');
    const clock = await this.repo.clockOf(tenantId);
    return {
      id: r.id, status: r.status, title: r.title, body: r.body, resolutionType: r.resolutionType, majority: r.majority,
      votingOpens: await this.repo.instantToCivil(tenantId, clock.zone, r.votingOpens),
      votingCloses: await this.repo.instantToCivil(tenantId, clock.zone, r.votingCloses),
      payload: r.payload, zone: clock.zone, currency: clock.currency,
      // PC-56 TENANT-12 (F-14): read-only — the twin run a proposal cites (none can exist yet: no run is ever done).
      sourceRef: r.sourceRef,
    };
  }

  /** W2743: create — the review re-taken, then the row and its audit entry in one transaction. */
  async create(tenantId: string, actor: GovActor, key: string, input: DraftInput) {
    return this.idem.remember(key, actor.userId, 'governance.resolution.create', async () => {
      const review = await this.draftReview(tenantId, actor, input, null);
      if (!review.ready) throw new GovernanceRefusedError(review.refusals);
      const v = Object.fromEntries(review.fields.map((f) => [f.name, f.stored])) as Record<string, string | null>;
      const id = uuidv7();
      await this.uow.run(tenantId, async (tx) => {
        await this.repo.insert(tx, {
          id, tenantId, title: v.title as string, body: v.body ?? null, resolutionType: v.resolutionType as string, majority: v.majority as string,
          votingOpens: review.window.opensAt, votingCloses: review.window.closesAt, payload: review.payload, createdBy: actor.userId,
        });
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'governance.resolution.created', entityType: 'coop_resolution', entityId: id,
          oldValue: null,
          newValue: { status: 'draft', title: v.title, resolutionType: v.resolutionType, majority: v.majority, votingOpens: review.window.opensAt,
            votingCloses: review.window.closesAt, zone: review.window.zone, payload: review.payload },
          reason: null, ip: actor.ip, requestId: actor.requestId,
        });
      }, { userId: actor.userId });
      return { id, status: 'draft' as const };
    });
  }

  /** Edit while a draft — the diff is the audit row's before/after. */
  async update(tenantId: string, actor: GovActor, id: string, key: string, input: DraftInput) {
    return this.idem.remember(key, actor.userId, 'governance.resolution.edit', async () => {
      const current = await this.repo.get(tenantId, id);
      if (!current) throw new NotFoundError('resolution not found');
      const review = await this.draftReview(tenantId, actor, input, current);
      if (!review.ready) throw new GovernanceRefusedError(review.refusals);
      const v = Object.fromEntries(review.fields.map((f) => [f.name, f.stored])) as Record<string, string | null>;
      await this.uow.run(tenantId, async (tx) => {
        let after: Resolution | null;
        try {
          after = await this.repo.updateDraft(tx, tenantId, id, {
            title: v.title as string, body: v.body ?? null, resolutionType: v.resolutionType as string, majority: v.majority as string,
            votingOpens: review.window.opensAt, votingCloses: review.window.closesAt, payload: review.payload, userId: actor.userId,
          });
        } catch (e) { if (pgCode(e) === '23514') throw new GovernanceRefusedError([{ field: null, code: 'NOT_A_DRAFT' }]); throw e; }
        if (!after) throw new GovernanceRefusedError([{ field: null, code: 'NOT_A_DRAFT' }]);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'governance.resolution.edited', entityType: 'coop_resolution', entityId: id,
          oldValue: { title: current.title, body: current.body, resolutionType: current.resolutionType, majority: current.majority,
            votingOpens: current.votingOpens, votingCloses: current.votingCloses, payload: current.payload },
          newValue: { title: after.title, body: after.body, resolutionType: after.resolutionType, majority: after.majority,
            votingOpens: after.votingOpens, votingCloses: after.votingCloses, payload: after.payload, diff: review.diff },
          reason: null, ip: actor.ip, requestId: actor.requestId,
        });
      }, { userId: actor.userId });
      return { id, status: 'draft' as const };
    });
  }

  /**
   * W198's list — keyset (µs), GET-form filters. Each row's result is the SNAPSHOT for a closed resolution (its own roll,
   * its own rule, the outcome the database recorded) or "not recorded"; an open row carries its live ballot count only (the
   * open card reads the full live tally).
   */
  async list(tenantId: string, filters: ResolutionFilters, cursor?: KeysetCursor, limit = 20) {
    const clock = await this.repo.clockOf(tenantId);
    const lim = Math.min(Math.max(limit, 1), 50);
    const rows = await this.repo.page(tenantId, clock.zone, filters, lim + 1, cursor);
    const page = rows.slice(0, lim);
    const items = page.map((r) => {
      const rule = snapshotRule(r);
      const turnoutBp = r.status === 'closed' && r.eligibleAtClose !== null && r.eligibleAtClose > 0 ? Math.floor((r.cast * 10_000) / r.eligibleAtClose) : null;
      const recorded = r.status === 'closed' && r.outcome !== 'not_recorded' && rule !== null && r.eligibleAtClose !== null;
      // The cursor's instant travels as `nextCursor`, never on the row.
      const rest: Omit<typeof r, 'cursorTs'> & { cursorTs?: string } = { ...r };
      delete rest.cursorTs;
      return {
        ...rest,
        result: {
          basis: r.status === 'open' ? 'live' : r.status === 'closed' ? (recorded ? 'snapshot' : 'not_recorded') : 'none',
          outcome: r.status === 'closed' ? (r.outcome ?? 'not_recorded') : null,
          cast: r.cast, eligibleAtClose: r.eligibleAtClose, turnoutBp,
          quorumBp: rule?.quorumBp ?? null,
          quorumMet: turnoutBp !== null && rule !== null ? turnoutBp >= rule.quorumBp : null,
        },
      };
    });
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > lim && last ? encodeKeyset(last.cursorTs, last.id) : null, zone: clock.zone };
  }

  /* -------------------------------------------------------------------------------------------------------- */
  /* THE ACTS (W2745–W2747) — open · close · withdraw                                                         */
  /* -------------------------------------------------------------------------------------------------------- */

  /** W2745: the verdict at confirm, on the resolution as it stands, with what the act will record. */
  async previewAct(tenantId: string, actor: GovActor, id: string, act: ResolutionAct, input: { reasonCode?: string | null; note?: string | null }) {
    const res = await this.repo.get(tenantId, id);
    if (!res) throw new NotFoundError('resolution not found');
    const [cat, settings] = await Promise.all([this.repo.catalogue(tenantId), this.repo.bylawSettings(tenantId)]);
    const bylaws = bylawsFrom(settings); const special = specialMajorityFrom(settings);
    const verdict = actVerdict(act, res, { userId: actor.userId, canManage: canManageGovernance(actor) }, input, cat, new Date());
    const ruleNow = passRuleFor(res.majority as Majority, bylaws, special);
    const byChoice = await this.repo.tally(tenantId, id);
    const eligibleNow = act === 'close' ? await this.repo.eligibleCount(tenantId, bylaws.minShares, bylaws.minMembershipMonths) : null;
    return {
      ...verdict,
      resolution: { id: res.id, title: res.title, status: res.status, resolutionType: res.resolutionType, majority: res.majority,
        openedAt: res.openedAt, openedBy: res.openedBy, votingCloses: res.votingCloses, openedByYou: res.openedBy !== null && res.openedBy === actor.userId },
      // What the act will fix: the rule (at open), the roll and the rule's snapshot (at close).
      willRecord: act === 'open' ? { rule: ruleNow, choices: choicesFor(cat, res.resolutionType) }
        : act === 'close' ? { eligibleNow, cast: byChoice.reduce((n, r) => n + r.votes, 0), rule: snapshotRule(res) ?? ruleNow, ruleFixedAt: res.ruleFixedAt ?? 'close' }
        : { cast: byChoice.reduce((n, r) => n + r.votes, 0) },
      reasons: act === 'close' ? cat.closeReasons : act === 'withdraw' ? cat.withdrawReasons : [],
    };
  }

  /**
   * Open · close · withdraw — the act re-takes the verdict on the LOCKED row; the audit row and the outbox notice are in the
   * same transaction (Law 4); the Idempotency-Key is the confirm page's.
   *
   * The eligible roll is read BEFORE the transaction and written INSIDE it: a closing resolution must carry the
   * denominator of its own turnout, because eligibility is derived from facts that keep moving (0130 §130.3). Read outside
   * because it is a whole-roll count (`eligibleCount(`) and must not hold the resolution's row lock while it runs. The
   * close and its snapshot are ONE statement (`closeWithSnapshot(`), and the OUTCOME is the database's (0182).
   */
  async transition(tenantId: string, actor: GovActor, id: string, act: ResolutionAct, input: { reasonCode?: string | null; note?: string | null }, key: string) {
    const [cat, settings] = await Promise.all([this.repo.catalogue(tenantId), this.repo.bylawSettings(tenantId)]);
    const bylaws = bylawsFrom(settings); const special = specialMajorityFrom(settings);
    const eligible = act === 'close' ? await this.repo.eligibleCount(tenantId, bylaws.minShares, bylaws.minMembershipMonths) : null;
    const clock = await this.repo.clockOf(tenantId);
    const note = (input.note ?? '').trim();
    return this.idem.remember(key, actor.userId, `governance.resolution.${act}`, () => this.uow.run(tenantId, async (tx) => {
      const res = await this.repo.getForUpdate(tx, tenantId, id);
      if (!res) throw new NotFoundError('resolution not found');
      const v = actVerdict(act, res, { userId: actor.userId, canManage: canManageGovernance(actor) }, input, cat, new Date());
      if (!v.allowed) throw new GovernanceRefusedError(v.refusals.map((code) => ({ field: null, code })));
      const rule = passRuleFor(res.majority as Majority, bylaws, special);
      let after: Resolution | null;
      try {
        after = act === 'open' ? await this.repo.open(tx, tenantId, id, actor.userId, rule)
          : act === 'close' ? await this.repo.closeWithSnapshot(tx, tenantId, id, actor.userId, String(input.reasonCode), eligible as number, res.ruleFixedAt ? null : rule)
          : await this.repo.withdraw(tx, tenantId, id, actor.userId, String(input.reasonCode));
      } catch (e) {
        // 0182's wall said no to something the verdict allowed — a race, or a rule the verdict does not model. The
        // database's sentence travels as the refusal; nothing was written.
        if (pgCode(e) === '23514') throw new GovernanceRefusedError([{ field: null, code: 'DATABASE_REFUSED' }]);
        throw e;
      }
      if (!after) throw new ConflictError('the resolution moved while you were confirming — reload it');

      const done = act === 'open' ? 'opened' : act === 'close' ? 'closed' : 'withdrawn';
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: `governance.resolution.${done}`, entityType: 'coop_resolution', entityId: id,
        oldValue: { status: res.status, openedBy: res.openedBy },
        newValue: {
          status: after.status, reasonCode: input.reasonCode ?? null,
          ...(act === 'open' ? { openedAt: after.openedAt, rule: snapshotRule(after), ruleFixedAt: after.ruleFixedAt } : {}),
          ...(act === 'close' ? { closedAt: after.closedAt, eligibleAtClose: after.eligibleAtClose, rule: snapshotRule(after), ruleFixedAt: after.ruleFixedAt, outcome: after.outcome, secondPerson: v.secondPerson } : {}),
          ...(act === 'withdraw' ? { withdrawnAt: after.withdrawnAt } : {}),
        },
        reason: note, ip: actor.ip, requestId: actor.requestId,
      });

      if (act === 'open' || act === 'close') {
        const recipientUserIds = await this.repo.memberUserIds(tx, tenantId);
        if (act === 'open') {
          const closesCivil = await this.repo.instantToCivil(tenantId, clock.zone, after.votingCloses);
          const words = await this.ui.mapsUnder('governance.notice.', tx);
          await this.outbox.write(tx, { tenantId, aggregateType: 'coop_resolution', aggregateId: id, eventType: RESOLUTION_OPENED_EVENT, payload: {
            v: 1, resolutionId: id, title: after.title, recipientUserIds,
            closes: noticeWhen(closesCivil) ?? words.get('governance.notice.no_close') ?? { en: 'when the board closes it' },
          } });
        } else {
          const byChoice = await this.repo.tallyTx(tx, tenantId, id);
          const n = (c: string) => String(byChoice.find((r) => r.choice === c)?.votes ?? 0);
          const cast = byChoice.reduce((s, r) => s + r.votes, 0);
          const turnout = after.eligibleAtClose && after.eligibleAtClose > 0 ? `${Math.floor((cast * 100) / after.eligibleAtClose)}%` : '—';
          const words = await this.ui.mapsUnder('governance.outcome.', tx);
          await this.outbox.write(tx, { tenantId, aggregateType: 'coop_resolution', aggregateId: id, eventType: RESOLUTION_CLOSED_EVENT, payload: {
            v: 1, resolutionId: id, title: after.title, recipientUserIds, outcome: after.outcome,
            result: words.get(`governance.outcome.${after.outcome}`) ?? { en: String(after.outcome) },
            for: n('for'), against: n('against'), abstain: n('abstain'), turnout,
          } });
        }
      }
      return { id, status: after.status, outcome: after.outcome };
    }, { userId: actor.userId }));
  }

  /**
   * Cast — or CHANGE — one member's vote.
   *
   * **THE ELIGIBILITY GATE IS THE POINT OF THIS METHOD AND IT DID NOT EXIST (PC-56 TENANT-1e).** Before 0130 this checked
   * the resolution's status, the voting window, and whether the user had already voted — and nothing else. W197 prints
   * "Voting eligibility (bylaws, as data)" with the word "enforced" beside the coop principle.
   *
   * **AND A VOTE IS NOW CHANGEABLE UNTIL THE WINDOW CLOSES**, which W198 promises twice. The change is an UPDATE on the same
   * row, because the composite primary key IS the one-member-one-vote guarantee.
   *
   * [9b] **AND THE CHOICE IS ONE THE RESOLUTION DECLARES** (F-13: "yes" was a ballot, counted in `cast`, never in favour).
   * Refused 422 with the declared list before any lock; 0182's trigger refuses it again underneath.
   */
  async vote(tenantId: string, memberUserId: string, id: string, choice: string) {
    if (!choice || choice.length > 20) throw new BadRequestError('choice required (max 20)');

    // The bylaws and the voter's facts are READS, so they happen before the transaction rather than inside it: a ballot that
    // is going to be refused should not hold a row lock on the resolution while the refusal is decided.
    const bylaws = bylawsFrom(await this.repo.bylawSettings(tenantId));
    const facts = await this.repo.voterFacts(tenantId, memberUserId);
    // Throws a 403 naming the reason — "you need 4 more shares" and "eligible from November" are answers somebody can act on.
    assertEligible(eligibility(facts, bylaws));

    const [cat, current] = await Promise.all([this.repo.catalogue(tenantId), this.repo.get(tenantId, id)]);
    if (!current) throw new NotFoundError('resolution not found');
    const refused = ballotVerdict(cat, current.resolutionType, choice);
    if (refused) throw new BallotChoiceUndeclaredError(choice, current.resolutionType, choicesFor(cat, current.resolutionType), refused);

    try {
      return await this.uow.run(tenantId, async (tx) => {
        const res = await this.repo.getForUpdate(tx, tenantId, id);
        if (!res) throw new NotFoundError('resolution not found');
        const now = new Date().toISOString();
        if (res.status !== 'open') throw new ConflictError('voting is not open');
        if (res.votingOpens && now < res.votingOpens) throw new ConflictError('voting has not started');
        if (res.votingCloses && now > res.votingCloses) throw new ConflictError('voting has closed');

        if (await this.repo.castVote(tx, id, memberUserId, choice)) return { resolutionId: id, choice, changed: false };

        // A row already exists. **THE WINDOW IS RE-CHECKED THROUGH THE DOMAIN RULE RATHER THAN ASSUMED FROM THE CHECKS ABOVE**,
        // because "may this be changed" is its own question with its own answer after close — W198: "votes immutable after close".
        if (!mayChangeVote(res.status, res.votingCloses, new Date())) {
          throw new ConflictError('voting has closed — your vote is final');
        }
        if (!(await this.repo.changeVote(tx, id, memberUserId, choice))) {
          // The UPDATE's WHERE excludes an unchanged choice, so this is "you already voted that way" rather than a failure.
          throw new ConflictError('that is already your vote');
        }
        return { resolutionId: id, choice, changed: true };
      }, { userId: memberUserId });
    } catch (e) {
      // 0182's ballot-box trigger: the window closed (or the resolution closed) between the checks and the write.
      if (pgCode(e) === '23514') throw new ConflictError('voting is not open — your ballot was not recorded');
      throw e;
    }
  }

  /** Is this member eligible, and if not, what would they need? Read-only — the console shows it before offering a ballot. */
  async eligibilityFor(tenantId: string, memberUserId: string) {
    const bylaws = bylawsFrom(await this.repo.bylawSettings(tenantId));
    const facts = await this.repo.voterFacts(tenantId, memberUserId);
    return { bylaws, facts, verdict: eligibility(facts, bylaws) };
  }

  /**
   * The tally, with a real denominator — and, for a CLOSED resolution, ONLY its own.
   *
   * **W198 PRINTS "618 / 1,186 · 52% · quorum 33% ✓ met"** — for an OPEN resolution that is today's roll (`eligibleCount(`)
   * and the rule fixed at open (or, opened before 0182, today's `quorumBp`). For a CLOSED one it is the roll recorded at
   * close, the rule recorded with it and the outcome the database wrote — or "not recorded" (F-13: the old path recomputed
   * every past AGM against today's roll).
   */
  async results(tenantId: string, id: string): Promise<{ resolution: Resolution; tally: ResultView['tally']; result: ResultView; choices: string[] }> {
    const res = await this.repo.get(tenantId, id);
    if (!res) throw new NotFoundError('resolution not found');
    const settings = await this.repo.bylawSettings(tenantId);
    const bylaws = bylawsFrom(settings);
    const [byChoice, cat] = await Promise.all([this.repo.tally(tenantId, id), this.repo.catalogue(tenantId)]);
    // Today's roll is counted ONLY for an open resolution.
    const liveEligible = res.status === 'open' ? await this.repo.eligibleCount(tenantId, bylaws.minShares, bylaws.minMembershipMonths) : null;
    const liveRule = passRuleFor(res.majority as Majority, { quorumBp: bylaws.quorumBp }, specialMajorityFrom(settings));
    const view = resultView({ status: res.status, eligibleAtClose: res.eligibleAtClose, rule: snapshotRule(res), ruleFixedAt: res.ruleFixedAt, outcome: res.outcome },
      byChoice, inFavourCodes(cat), liveEligible, liveRule);
    return { resolution: res, tally: view.tally, result: view, choices: choicesFor(cat, res.resolutionType) };
  }
}
