// modules/education/services/instructor-earnings.service.ts · PC-56 TENANT-7d-money · THE EARNINGS (W418).
//
// The instructor's money desk OVER THE LEDGER (0174's `instructor_royalty_lines`): every tile a SUM per currency at that
// currency's own scale (never a mixed total — 6e-1), MTD and lifetime in the COOPERATIVE's month (7c: the zone is the
// database's, `tenants.country_code → countries.timezone`), the keyset statement, the payout request as the EXISTING
// payout plane's request (purpose `course_royalty`, which rides the tenant's two-person batch — 0174 §174.5), the
// agreement (the desk offers · the instructor accepts, and acceptance RELEASES every held line hold → main in the same
// transaction), and the tenant's split rule (the finance desk proposes · a different person decides — 6c-3's shape).
//
// Who reads: the instructor, their own; the tenant FINANCE desk (`payout.approve` / `wallet.adjust` — W418: *"Only you
// and the tenant finance desk can see this page's amounts"*) any instructor's by id. Nobody else: a member asking is
// 404-shaped (no enumeration), the education desk without the finance verb is told NOT_FINANCE.
// The screen's own flag (`instructor_earnings`) is read HERE so W418's *"Flagged off"* state is a sentence with a code,
// not the guard's bare 404 (6e-1's ruling).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../core/wallet/wallet.port';
import { userMain, userHold } from '../../../core/wallet/account-codes';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { PayoutService } from '../../payments/services/payout.service';
import { InstructorRepository } from '../repositories/instructor.repository';
import { InstructorEarningsRepository, AgreementRow, RoyaltyRuleRow, RoyaltyLineRow, CurrencySums, CourseEarningsRow, RoyaltyPayoutRow } from '../repositories/instructor-earnings.repository';
import {
  agreementNext, availableMinor, monthStartOf, proposalShares, royaltyPayoutRefusals, ruleDecisionRefusals, ruleNext,
  type AgreementAct, type PayoutRefusal, type RoyaltyBalance,
} from '../domain/royalty-split';
import {
  AgreementActRefusedError, AgreementNotFoundError, EarningsDisabledError, EducationForbiddenError, InstructorNotFoundError, RoyaltyPayoutRefusedError, RoyaltyRuleNotFoundError, RoyaltyRuleRefusedError,
} from '../domain/education.errors';
import { EducationActor } from './instructor.service';

export const EARNINGS_FLAG = 'instructor_earnings';
export const SPLIT_FLAG = 'course_royalty_split';
export const MAX_STATEMENT_PAGE = 100;

export interface EarningsActor extends EducationActor { canFinance: boolean }

export interface MoneyFigure { currencyCode: string; minorUnits: number; gross: string; instructor: string; tenant: string; platform: string; held: string; heldLines: number; released: string; purchases: number }
export interface EarningsTile { currencyCode: string; minorUnits: number; lifetime: MoneyFigure; mtd: MoneyFigure | null; paidOut: string; pending: string; available: string }
export interface AgreementView { id: string; version: number; status: string; instructorShareBps: number; tenantShareBps: number; platformShareBps: number; offeredAt: Date; acceptedAt: Date | null; termsNote: string | null; offeredBy: string; acceptedBy: string | null }
export interface RuleView { id: string; source: 'tenant' | 'platform'; instructorShareBps: number; tenantShareBps: number; platformShareBps: number; status: string; proposedBy: string | null; proposedAt: Date; decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null; effectiveFrom: Date | null }
export interface EarningsView {
  instructor: { id: string; userId: string; name: string | null; royaltyBps: number; isSelf: boolean };
  privileged: boolean;
  timezone: string; today: string; monthStart: string;
  splitFlagOn: boolean;
  agreement: { current: AgreementView | null; offered: AgreementView | null; history: AgreementView[] };
  rule: RuleView | null;
  tiles: EarningsTile[];
  courses: CourseEarningsRow[];
  payouts: RoyaltyPayoutRow[];
  bankAccounts: Array<{ id: string; label: string; verified: boolean }>;
  /** Per currency: what a payout request would meet BEFORE the plane's own gates. Empty = may request. */
  payoutRefusals: Array<{ currencyCode: string; refusals: PayoutRefusal[] }>;
  /** Everything W418 draws that no fact on this platform supports, by name. */
  refusedByName: readonly string[];
}
export interface StatementLine { id: string; occurredAt: Date; courseId: string; courseTitle: string | null; enrollmentId: string; currencyCode: string; minorUnits: number; gross: string; instructor: string; tenant: string; platform: string; instructorShareBps: number; state: string; ledgerTxnId: string; releasedAt: Date | null }

/** W418's promises the platform does not keep, each printed on the page as a sentence and never as a figure. */
export const EARNINGS_REFUSED_BY_NAME = ['monthlyLaneClock', 'refunds', 'cachedFigures', 'retry'] as const;

const toAgreementView = (a: AgreementRow): AgreementView => ({ id: a.id, version: a.version, status: a.status, instructorShareBps: a.instructorShareBps, tenantShareBps: a.tenantShareBps, platformShareBps: a.platformShareBps, offeredAt: a.offeredAt, acceptedAt: a.acceptedAt, termsNote: a.termsNote, offeredBy: a.offeredBy, acceptedBy: a.acceptedBy });
const toRuleView = (r: RoyaltyRuleRow): RuleView => ({ id: r.id, source: r.tenantId ? 'tenant' : 'platform', instructorShareBps: r.instructorShareBps, tenantShareBps: r.tenantShareBps, platformShareBps: r.platformShareBps, status: r.status, proposedBy: r.proposedBy, proposedAt: r.proposedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote, effectiveFrom: r.effectiveFrom });
const figure = (s: CurrencySums): MoneyFigure => ({ currencyCode: s.currencyCode, minorUnits: s.minorUnits, gross: s.gross, instructor: s.instructor, tenant: s.tenant, platform: s.platform, held: s.held, heldLines: s.heldLines, released: s.released, purchases: s.purchases });
const toStatementLine = (l: RoyaltyLineRow): StatementLine => ({ id: l.id, occurredAt: l.occurredAt, courseId: l.courseId, courseTitle: l.courseTitle, enrollmentId: l.enrollmentId, currencyCode: l.currencyCode, minorUnits: l.minorUnits, gross: l.grossMinor.toString(), instructor: l.instructorMinor.toString(), tenant: l.tenantMinor.toString(), platform: l.platformMinor.toString(), instructorShareBps: l.instructorShareBps, state: l.state, ledgerTxnId: l.ledgerTxnId, releasedAt: l.releasedAt });

@Injectable()
export class InstructorEarningsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly flags: FlagsService,
    private readonly instructors: InstructorRepository,
    private readonly repo: InstructorEarningsRepository,
    private readonly payouts: PayoutService,
  ) {}

  private async assertEnabled(tenantId: string): Promise<void> {
    const on = await this.flags.isEnabled(EARNINGS_FLAG, { tenantId }).catch(() => false);
    if (!on) throw new EarningsDisabledError(EARNINGS_FLAG);
  }

  /** Whose desk: the caller's own row, or — for the finance desk — the instructor named. A member with no row and no verb is told so. */
  private async subject(tenantId: string, actor: EarningsActor, instructorId: string | null, tx?: TxContext) {
    if (instructorId) {
      const row = await this.instructors.getById(tenantId, instructorId, tx);
      if (!row || row.tenantId !== tenantId) throw new InstructorNotFoundError(instructorId);
      const isSelf = row.userId === actor.userId;
      if (!isSelf && !actor.canFinance) throw new EducationForbiddenError('NOT_FINANCE');
      return { row, isSelf };
    }
    const row = await this.instructors.findByUser(tenantId, actor.userId, tx);
    if (!row) throw new InstructorNotFoundError('me');
    return { row, isSelf: true };
  }

  private balancesOf(sums: CurrencySums[], paid: Array<{ currencyCode: string; paidOut: string; pending: string }>): Map<string, RoyaltyBalance & { pending: bigint }> {
    const m = new Map<string, RoyaltyBalance & { pending: bigint }>();
    for (const s of sums) m.set(s.currencyCode, { currencyCode: s.currencyCode, releasedMinor: BigInt(s.released), heldMinor: BigInt(s.held), paidOutMinor: 0n, pending: 0n });
    for (const p of paid) {
      const b = m.get(p.currencyCode) ?? { currencyCode: p.currencyCode, releasedMinor: 0n, heldMinor: 0n, paidOutMinor: 0n, pending: 0n };
      b.paidOutMinor = BigInt(p.paidOut); b.pending = BigInt(p.pending); m.set(p.currencyCode, b);
    }
    return m;
  }

  /** W418. */
  async view(tenantId: string, actor: EarningsActor, instructorId: string | null = null): Promise<EarningsView> {
    await this.assertEnabled(tenantId);
    return timed(this.metrics, 'education.earnings.view', { tenant: tenantId }, async () => {
      const { row, isSelf } = await this.subject(tenantId, actor, instructorId);
      const clock = await this.repo.tenantToday(tenantId);
      if (!clock) throw new InstructorNotFoundError(row.id);   // a tenant with no country is unreachable in practice; refuse rather than guess a zone
      const monthStart = monthStartOf(clock.today);
      const [lifetime, mtd, paid, courses, payouts, agreements, rule, splitFlagOn, name, banks] = await Promise.all([
        this.repo.sumsByCurrency(tenantId, row.id, null), this.repo.sumsByCurrency(tenantId, row.id, monthStart), this.repo.paidOutByCurrency(tenantId, row.userId),
        this.repo.perCourse(tenantId, row.id), this.repo.royaltyPayouts(tenantId, row.userId), this.repo.agreementsOf(tenantId, row.id), this.repo.ruleInForce(tenantId),
        this.flags.isEnabled(SPLIT_FLAG, { tenantId }).catch(() => false), this.instructors.fullNameOf(tenantId, row.userId), isSelf ? this.repo.bankAccountsOf(tenantId, row.userId) : Promise.resolve([]),
      ]);
      const balances = this.balancesOf(lifetime, paid);
      const mtdBy = new Map(mtd.map((s) => [s.currencyCode, s]));
      const currencies = [...new Set([...lifetime.map((s) => s.currencyCode), ...paid.map((p) => p.currencyCode)])].sort();
      const tiles: EarningsTile[] = currencies.map((c) => {
        const life = lifetime.find((s) => s.currencyCode === c);
        const b = balances.get(c)!;
        const mu = life?.minorUnits ?? mtdBy.get(c)?.minorUnits ?? 0;
        const empty: MoneyFigure = { currencyCode: c, minorUnits: mu, gross: '0', instructor: '0', tenant: '0', platform: '0', held: '0', heldLines: 0, released: '0', purchases: 0 };
        return { currencyCode: c, minorUnits: mu, lifetime: life ? figure(life) : empty, mtd: mtdBy.has(c) ? figure(mtdBy.get(c)!) : null, paidOut: b.paidOutMinor.toString(), pending: b.pending.toString(), available: availableMinor(b).toString() };
      });
      const current = agreements.find((a) => a.status === 'accepted') ?? null;
      const offered = agreements.find((a) => a.status === 'offered') ?? null;
      const payoutRefusals = currencies.map((c) => ({ currencyCode: c, refusals: royaltyPayoutRefusals({ hasInstructor: true, hasAcceptedAgreement: !!current, amountMinor: '1', balance: balances.get(c) ?? null }).filter((r) => r !== 'ROYALTY_INSUFFICIENT' || availableMinor(balances.get(c)!) <= 0n) }));
      return {
        instructor: { id: row.id, userId: row.userId, name: row.toProps().displayName ?? name, royaltyBps: current?.instructorShareBps ?? row.royaltyBps, isSelf },
        privileged: actor.canFinance,
        timezone: clock.timezone, today: clock.today, monthStart, splitFlagOn,
        agreement: { current: current ? toAgreementView(current) : null, offered: offered ? toAgreementView(offered) : null, history: agreements.map(toAgreementView) },
        rule: rule ? toRuleView(rule) : null,
        tiles, courses, payouts, bankAccounts: banks, payoutRefusals, refusedByName: EARNINGS_REFUSED_BY_NAME,
      };
    });
  }

  /** The statement: keyset over (occurred_at, id), newest first. */
  async statement(tenantId: string, actor: EarningsActor, q: { instructorId?: string | null; cursor?: { c: string; id: string }; limit: number }) {
    await this.assertEnabled(tenantId);
    const { row } = await this.subject(tenantId, actor, q.instructorId ?? null);
    const limit = Math.min(Math.max(q.limit, 1), MAX_STATEMENT_PAGE);
    const rows = await this.repo.statement(tenantId, row.id, { cursor: q.cursor, limit });
    const items = rows.map(toStatementLine);
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === limit && last ? Buffer.from(`${last.occurredAt.toISOString()}|${last.id}`).toString('base64') : null };
  }

  /* ---------------------------------------------------------------- money out --------------------------------- */

  /** The confirm step's verdict — what the request would meet, and what will be written. Writes nothing. */
  async payoutReview(tenantId: string, actor: EarningsActor, dto: { amountMinor: string; currencyCode: string; bankAccountId: string }) {
    await this.assertEnabled(tenantId);
    const row = await this.instructors.findByUser(tenantId, actor.userId);
    const [sums, paid, agreement] = row ? await Promise.all([this.repo.sumsByCurrency(tenantId, row.id, null), this.repo.paidOutByCurrency(tenantId, row.userId), this.repo.acceptedAgreement(tenantId, row.id)]) : [[], [], null];
    const balance = row ? this.balancesOf(sums, paid).get(dto.currencyCode) ?? null : null;
    const refusals = royaltyPayoutRefusals({ hasInstructor: !!row, hasAcceptedAgreement: !!agreement, amountMinor: dto.amountMinor, balance });
    return {
      ready: refusals.length === 0, refusals,
      available: balance ? availableMinor(balance).toString() : null, held: balance ? balance.heldMinor.toString() : null,
      currencyCode: dto.currencyCode, amountMinor: dto.amountMinor, purpose: 'course_royalty', ridesBatch: true,
      agreementVersion: agreement?.version ?? null,
    };
  }

  /** W418's payout: the EXISTING plane's request with purpose `course_royalty` — KYC as an instructor (0125), the
   *  caller's own bank account, no overdraw, and the batch gate before any money leaves. This method adds the royalty's
   *  own gates (an accepted agreement, the sum of lines) and nothing else; it never posts a leg itself. */
  async requestPayout(tenantId: string, actor: EarningsActor, idemKey: string, dto: { amountMinor: string; currencyCode: string; bankAccountId: string }) {
    const review = await this.payoutReview(tenantId, actor, dto);
    if (!review.ready) throw new RoyaltyPayoutRefusedError(review.refusals, { available: review.available });
    this.metrics.inc('education.earnings.payout_requested', { tenant: tenantId });
    return this.payouts.requestPayout(tenantId, actor.userId, idemKey, { amountMinor: dto.amountMinor, bankAccountId: dto.bankAccountId, purpose: 'course_royalty', currencyCode: dto.currencyCode });
  }

  /* ---------------------------------------------------------------- the agreement ----------------------------- */

  /** The desk (course.publish) offers an agreement at the rule in force's shares — or a negotiated instructor share, with the
   *  platform's share copied and the tenant's the remainder. One offer stands at a time (uq_ia_one_offered). */
  async offerAgreement(tenantId: string, actor: EarningsActor, idemKey: string, instructorId: string, input: { instructorShareBps?: number | null; termsNote?: string | null }, ip: string | null) {
    await this.assertEnabled(tenantId);
    if (!actor.canPublish) throw new AgreementActRefusedError('offer', ['NOT_DESK']);
    return this.idem.remember(idemKey, actor.userId, 'education.agreement.offer', () =>
      timed(this.metrics, 'education.agreement.offer', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const row = await this.instructors.getForUpdate(tx, tenantId, instructorId);
          if (!row) throw new InstructorNotFoundError(instructorId);
          if (row.userId === actor.userId) throw new AgreementActRefusedError('offer', ['MAKER_IS_CHECKER']);
          const rule = await this.repo.ruleInForce(tenantId, tx);
          if (!rule) throw new AgreementActRefusedError('offer', ['NO_RULE']);
          const shares = input.instructorShareBps == null ? { instructorBps: rule.instructorShareBps, tenantBps: rule.tenantShareBps, platformBps: rule.platformShareBps } : proposalShares({ instructorBps: input.instructorShareBps, platformBps: rule.platformShareBps });
          const existing = (await this.repo.agreementsOf(tenantId, instructorId, tx)).find((a) => a.status === 'offered');
          if (existing) throw new AgreementActRefusedError('offer', ['OFFER_ALREADY_OPEN']);
          const id = uuidv7();
          const version = await this.repo.nextAgreementVersion(tx, tenantId, instructorId);
          await this.repo.insertAgreement(tx, { id, tenantId, instructorId, version, instructorShareBps: shares.instructorBps, tenantShareBps: shares.tenantBps, platformShareBps: shares.platformBps, ruleId: rule.id, offeredBy: actor.userId, termsNote: input.termsNote ?? null });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.agreement.offer', entityType: 'instructor_agreement', entityId: id, newValue: { instructorId, version, ...shares }, ip });
          await this.outbox.write(tx, { tenantId, aggregateType: 'instructor_agreement', aggregateId: id, eventType: 'education.agreement_offered', payload: { v: 1, agreementId: id, instructorId, instructorUserId: row.userId, version, ...shares } });
          return { id, version, status: 'offered', ...shares };
        }, { userId: actor.userId })));
  }

  /** `accept` · `decline` are the INSTRUCTOR's (their own user, and 0174's trigger says so too); `supersede` is the desk's.
   *  Acceptance RELEASES every held line — one wallet transaction per currency, hold → main — in the same transaction. */
  async actAgreement(tenantId: string, actor: EarningsActor, idemKey: string, agreementId: string, act: AgreementAct, ip: string | null) {
    await this.assertEnabled(tenantId);
    return this.idem.remember(idemKey, actor.userId, `education.agreement.${act}`, () =>
      timed(this.metrics, `education.agreement.${act}`, { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const a = await this.repo.getAgreementForUpdate(tx, tenantId, agreementId);
          if (!a) throw new AgreementNotFoundError(agreementId);
          const row = await this.instructors.getForUpdate(tx, tenantId, a.instructorId);
          if (!row) throw new InstructorNotFoundError(a.instructorId);
          const refusals: string[] = [];
          if (act === 'supersede' ? !actor.canPublish : row.userId !== actor.userId) refusals.push(act === 'supersede' ? 'NOT_DESK' : 'NOT_INSTRUCTOR');
          const next = agreementNext(a.status, act);
          if (!next) refusals.push('ILLEGAL_FROM_STATUS');
          if (refusals.length) throw new AgreementActRefusedError(act, refusals);
          let released: Array<{ currencyCode: string; amountMinor: string; lines: number; txnId: string }> = [];
          if (act === 'accept') {
            const prior = (await this.repo.agreementsOf(tenantId, a.instructorId, tx)).find((x) => x.status === 'accepted');
            if (prior) await this.repo.setAgreementStatus(tx, tenantId, prior.id, { status: 'superseded', by: actor.userId });
            await this.repo.setAgreementStatus(tx, tenantId, a.id, { status: 'accepted', by: actor.userId });
            released = await this.releaseHeld(tx, tenantId, row.id, row.userId, a.id, actor.userId);
          } else {
            await this.repo.setAgreementStatus(tx, tenantId, a.id, { status: next!, by: actor.userId });
          }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `education.agreement.${act}`, entityType: 'instructor_agreement', entityId: a.id, oldValue: { status: a.status }, newValue: { status: next, released }, ip });
          await this.outbox.write(tx, { tenantId, aggregateType: 'instructor_agreement', aggregateId: a.id, eventType: `education.agreement_${next}`, payload: { v: 1, agreementId: a.id, instructorId: a.instructorId, instructorUserId: row.userId, version: a.version, released } });
          return { id: a.id, version: a.version, status: next, released };
        }, { userId: actor.userId })));
  }

  /** hold → main for every held line, grouped by currency: Σ per currency is ONE balanced transaction, and every line
   *  it releases names it. Zero-amount currencies post nothing (the wallet refuses a zero leg). */
  private async releaseHeld(tx: TxContext, tenantId: string, instructorId: string, instructorUserId: string, agreementId: string, by: string) {
    const held = await this.repo.heldForUpdate(tx, tenantId, instructorId);
    const byCur = new Map<string, { sum: bigint; ids: string[] }>();
    for (const h of held) { const g = byCur.get(h.currencyCode) ?? { sum: 0n, ids: [] }; g.sum += h.instructorMinor; g.ids.push(h.id); byCur.set(h.currencyCode, g); }
    const out: Array<{ currencyCode: string; amountMinor: string; lines: number; txnId: string }> = [];
    for (const [cur, g] of byCur) {
      if (g.sum <= 0n) continue;
      const legs: LedgerLeg[] = [{ account: userHold(instructorUserId, cur), amountMinor: -g.sum }, { account: userMain(instructorUserId, cur), amountMinor: g.sum }];
      const posted = await this.wallet.post(tx, { tenantId, txnType: 'course_royalty_release', idempotencyKey: `royalty-release:${agreementId}:${cur}`, referenceType: 'instructor_agreement', referenceId: agreementId, initiatedBy: by, legs, description: `royalty released on agreement acceptance (${g.ids.length} lines)` });
      const n = await this.repo.markReleased(tx, tenantId, g.ids, posted.txnId, by);
      out.push({ currencyCode: cur, amountMinor: g.sum.toString(), lines: n, txnId: posted.txnId });
    }
    return out;
  }

  /* ---------------------------------------------------------------- the rule ---------------------------------- */

  async ruleView(tenantId: string, actor: EarningsActor) {
    await this.assertEnabled(tenantId);
    if (!actor.canFinance && !actor.canPublish) throw new EducationForbiddenError('NOT_FINANCE');
    const [inForce, platform, history] = await Promise.all([this.repo.ruleInForce(tenantId), this.repo.platformDefaultRule(tenantId), this.repo.ruleHistory(tenantId)]);
    return { inForce: inForce ? toRuleView(inForce) : null, platformDefault: platform ? toRuleView(platform) : null, history: history.map(toRuleView), canPropose: actor.canFinance, splitFlagOn: await this.flags.isEnabled(SPLIT_FLAG, { tenantId }).catch(() => false) };
  }

  /** The finance desk proposes the tenant's split: only the instructor's share is chosen; the platform's is copied from the
   *  platform default (Law 11) and the tenant's is the remainder. One proposal stands at a time. */
  async proposeRule(tenantId: string, actor: EarningsActor, idemKey: string, input: { instructorShareBps: number; note?: string | null }, ip: string | null) {
    await this.assertEnabled(tenantId);
    if (!actor.canFinance) throw new RoyaltyRuleRefusedError('propose', ['NOT_FINANCE']);
    return this.idem.remember(idemKey, actor.userId, 'education.royalty_rule.propose', () =>
      timed(this.metrics, 'education.royalty_rule.propose', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const platform = await this.repo.platformDefaultRule(tenantId, tx);
          if (!platform) throw new RoyaltyRuleRefusedError('propose', ['NO_PLATFORM_DEFAULT']);
          const shares = proposalShares({ instructorBps: input.instructorShareBps, platformBps: platform.platformShareBps });
          const id = uuidv7();
          try {
            await this.repo.insertRuleProposal(tx, { id, tenantId, instructorShareBps: shares.instructorBps, tenantShareBps: shares.tenantBps, platformShareBps: shares.platformBps, proposedBy: actor.userId, note: input.note ?? null });
          } catch (e) {
            if (String((e as { code?: string }).code) === '23505') throw new RoyaltyRuleRefusedError('propose', ['PROPOSAL_ALREADY_OPEN']);
            throw e;
          }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.royalty_rule.propose', entityType: 'course_royalty_rule', entityId: id, newValue: shares, ip });
          return { id, status: 'proposed', ...shares };
        }, { userId: actor.userId })));
  }

  /** A DIFFERENT finance person approves or rejects (with a note). Approval supersedes the tenant's previous active rule. */
  async decideRule(tenantId: string, actor: EarningsActor, idemKey: string, ruleId: string, act: 'approve' | 'reject', note: string | null, ip: string | null) {
    await this.assertEnabled(tenantId);
    return this.idem.remember(idemKey, actor.userId, `education.royalty_rule.${act}`, () =>
      timed(this.metrics, `education.royalty_rule.${act}`, { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const rule = await this.repo.getRuleForUpdate(tx, tenantId, ruleId);
          if (!rule) throw new RoyaltyRuleNotFoundError(ruleId);
          const refusals = ruleDecisionRefusals({ isDesk: actor.canFinance, proposedBy: rule.proposedBy ?? '', deciderUserId: actor.userId, status: rule.status, act, note });
          if (refusals.length) throw new RoyaltyRuleRefusedError(act, refusals);
          const next = ruleNext(rule.status, act)!;
          if (next === 'active') await this.repo.supersedeActiveRule(tx, tenantId, actor.userId);
          await this.repo.decideRule(tx, tenantId, ruleId, { status: next as 'active' | 'rejected', decidedBy: actor.userId, note });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `education.royalty_rule.${act}`, entityType: 'course_royalty_rule', entityId: ruleId, oldValue: { status: rule.status }, newValue: { status: next }, reason: note ?? undefined, ip });
          return { id: ruleId, status: next };
        }, { userId: actor.userId })));
  }
}
