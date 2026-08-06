// modules/labour/services/mgnrega.service.ts · PC-54 W54-3. Register is idempotency-remembered AND the
// job_card_no UNIQUE constraint is the true guard (409 on a re-used number — a card belongs to ONE worker).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ConflictError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { MgnregaRepository } from '../repositories/mgnrega.repository';
import { STATE_LEDGER_PROVIDER, StateLedgerProvider } from '../providers/state-ledger.provider';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { canMuster, canTransitionWork, musterDateInWindow, observedDays, daysRemaining, mirrorShouldRise, MGNREGA_GUARANTEE_DAYS, type WorkStatus } from '../domain/mgnrega.rules';
import { DEMAND_ALLOTMENT_DAYS, allotmentDueBy, allotmentOverdue, canAllotDemand, canCloseDemand, canWithdrawDemand, daysUntilDue, demandDateAcceptable, daysRequestedAcceptable, unemploymentAllowanceDue, type DemandStatus } from '../domain/mgnrega.rules';
import { AuditWriter } from '../../../core/audit/audit.writer';

@Injectable()
export class MgnregaService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService, private readonly repo: MgnregaRepository, @Inject(STATE_LEDGER_PROVIDER) private readonly stateLedger: StateLedgerProvider, private readonly audit: AuditWriter) {}

  register(tenantId: string, userId: string, key: string, dto: { jobCardNo: string; regionId?: string }) {
    return this.idem.remember(key, userId, 'labour.mgnrega.register', async () => {
      const id = uuidv7();
      await this.uow.run(tenantId, async (tx) => {
        try { await this.repo.register(tx, { id, userId, jobCardNo: dto.jobCardNo, regionId: dto.regionId }); }
        catch (e: any) { if (e?.code === '23505') throw new ConflictError('this job card number is already registered'); throw e; }
      }, { userId });
      return { id, jobCardNo: dto.jobCardNo };
    });
  }
  mine(tenantId: string, userId: string) { return this.repo.mine(tenantId, userId); }
  list(tenantId: string, q: { regionId?: string; limit: number }) { return this.repo.list(tenantId, q); }

  // ===== PC-55 A4 · works (booking.manage) =====
  private assertManage(canManage: boolean) { if (!canManage) throw new ForbiddenError('requires booking.manage'); }

  async createWork(tenantId: string, actor: { userId: string; canManage: boolean }, key: string, dto: { workCode: string; workName: string; workCategory?: string; regionId?: string; siteNote?: string; sanctionedDays?: number; sanctionedAmountMinor?: string; startsOn?: string; endsOn?: string }) {
    this.assertManage(actor.canManage);
    return this.idem.remember(key, actor.userId, 'labour.mgnrega.work.create', async () => {
      const id = uuidv7();
      const res = await this.uow.run(tenantId, (tx) => this.repo.insertWork(tx, { id, tenantId, ...dto }), { userId: actor.userId });
      if (!res.ok) throw new ConflictError(`work code '${dto.workCode}' is already recorded for this tenant`);
      return { id, workCode: dto.workCode, status: 'active' as const };
    });
  }
  async updateWork(tenantId: string, actor: { userId: string; canManage: boolean }, id: string, patch: { workName?: string; siteNote?: string; sanctionedDays?: number; status?: WorkStatus; startsOn?: string; endsOn?: string }) {
    this.assertManage(actor.canManage);
    return this.uow.run(tenantId, async (tx) => {
      const w = await this.repo.lockWork(tx, tenantId, id);
      if (!w) throw new NotFoundError('work not found');
      if (patch.status && !canTransitionWork(w.status as WorkStatus, patch.status)) {
        throw new ConflictError(`a ${w.status} work cannot become ${patch.status}`);
      }
      await this.repo.updateWork(tx, tenantId, id, patch);
      return { id, status: patch.status ?? w.status };
    }, { userId: actor.userId });
  }
  works(tenantId: string, actor: { canManage: boolean }, q: { status?: string; regionId?: string; limit: number }) {
    this.assertManage(actor.canManage);
    return this.repo.listWorks(tenantId, q);
  }

  /** Record attendance. The DB's UNIQUE(work, card, day) is the attendance-fraud guard; the mirror rises only. */
  async recordMuster(tenantId: string, actor: { userId: string; canManage: boolean }, key: string, dto: { workId: string; jobCardId: string; musterNo?: string; attendedOn: string; attended?: boolean; dayFraction?: number; wageMinor?: string }) {
    this.assertManage(actor.canManage);
    return this.idem.remember(key, actor.userId, 'labour.mgnrega.muster.record', async () => {
      const id = uuidv7();
      const out = await this.uow.run(tenantId, async (tx) => {
        const w = await this.repo.lockWork(tx, tenantId, dto.workId);
        if (!w) throw new NotFoundError('work not found');
        if (!canMuster(w.status as WorkStatus)) throw new ConflictError(`attendance cannot be recorded against a ${w.status} work`);
        const today = new Date().toISOString().slice(0, 10);
        if (!musterDateInWindow(dto.attendedOn, w.starts_on ? String(w.starts_on).slice(0, 10) : null, w.ends_on ? String(w.ends_on).slice(0, 10) : null, today)) {
          throw new BadRequestError("attendedOn must be YYYY-MM-DD, inside the work's own window, and never in the future");
        }
        const ins = await this.repo.insertMuster(tx, {
          id, tenantId, workId: dto.workId, jobCardId: dto.jobCardId, musterNo: dto.musterNo,
          attendedOn: dto.attendedOn, attended: dto.attended ?? true, dayFraction: dto.dayFraction ?? 1,
          wageMinor: dto.wageMinor, recordedBy: actor.userId, source: 'operator',
        });
        if (!ins.ok) throw new ConflictError('this job card is already mustered for that work on that day');
        return { id };
      }, { userId: actor.userId });
      // Raise the national mirror to at least what we observed (never lower, never invented).
      const musters = await this.repo.mustersForCard(tenantId, dto.jobCardId);
      const observed = observedDays(musters);
      const card = await this.repo.cardById(tenantId, dto.jobCardId);
      if (card && mirrorShouldRise(card.daysUsedFy, observed)) {
        await this.uow.run(tenantId, (tx) => this.repo.raiseDaysUsed(tx, dto.jobCardId, Math.floor(observed)), { userId: actor.userId });
      }
      return { ...out, observedDays: observed };
    });
  }

  /** THE 100-DAY LEDGER — two numbers, clearly labelled, neither faked. */
  async cardLedger(tenantId: string, actor: { canManage: boolean }, jobCardId: string, opts: { self?: boolean } = {}) {
    if (!opts.self) this.assertManage(actor.canManage);
    const card = await this.repo.cardById(tenantId, jobCardId);
    if (!card) throw new NotFoundError('job card not found');
    const musters = await this.repo.mustersForCard(tenantId, jobCardId);
    const observed = observedDays(musters);
    const state = await this.stateLedger.fetchCardStatus([card.jobCardNo]);
    const stateDays = state.cards.find((c) => c.jobCardNo === card.jobCardNo)?.daysUsedFy ?? null;
    return {
      jobCard: { id: card.id, jobCardNo: card.jobCardNo, daysUsedFyMirrored: card.daysUsedFy, lastSyncedAt: card.lastSyncedAt },
      guaranteeDays: MGNREGA_GUARANTEE_DAYS,
      observedByPlatform: { days: observed, musterCount: musters.length },
      daysRemaining: daysRemaining(observed, stateDays ?? card.daysUsedFy),
      authoritative: 'state_ledger',
      stateLedger: { provider: this.stateLedger.name, available: state.providerAvailable, note: state.note, daysUsedFy: stateDays, fetchedAt: state.fetchedAt },
      musters: musters.slice(0, 200),
    };
  }

  // ===== PC-55 B2 · WORK DEMANDS (MGNREGA §3: demand → work within 15 days, else an allowance is payable) =====
  // Every read below returns the CLOCK, not just a row: dueBy, daysUntilDue, overdue and allowanceDue are derived
  // by the pure rules so that no surface has to re-implement a statutory deadline (and none can get it subtly wrong).

  /** Record a demand at the desk. Idempotency-keyed, and the DB's UNIQUE (tenant, card, day) is the true guard
   *  against the same demand being entered twice. `demandedOn` is the date the HOUSEHOLD asked — never "today" —
   *  because that date is what starts the legal clock. */
  async recordDemand(tenantId: string, actor: { userId: string; canManage: boolean }, key: string, dto: { jobCardId: string; demandedOn: string; daysRequested: number; applicants?: number; regionId?: string; note?: string }) {
    this.assertManage(actor.canManage);
    return this.idem.remember(key, actor.userId, 'labour.mgnrega.demand.record', async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (!demandDateAcceptable(dto.demandedOn, today)) throw new BadRequestError('demandedOn must be YYYY-MM-DD, not in the future, and within the last financial year');
      if (!daysRequestedAcceptable(dto.daysRequested)) throw new BadRequestError(`daysRequested must be a whole number between 1 and ${MGNREGA_GUARANTEE_DAYS}`);
      const card = await this.repo.cardById(tenantId, dto.jobCardId);
      if (!card) throw new NotFoundError('job card not found');
      const id = uuidv7();
      await this.uow.run(tenantId, async (tx) => {
        const ins = await this.repo.insertDemand(tx, { id, tenantId, jobCardId: dto.jobCardId, regionId: dto.regionId, demandedOn: dto.demandedOn, daysRequested: dto.daysRequested, applicants: dto.applicants, note: dto.note, recordedBy: actor.userId });
        if (!ins.ok) throw new ConflictError('a demand for this job card on that date is already recorded');
        // A demand is an entitlement clock starting: the trail says who recorded it, for whom and for when.
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'mgnrega.demand_recorded', entityType: 'mgnrega_work_demand', entityId: id, newValue: { jobCardNo: card.jobCardNo, demandedOn: dto.demandedOn, daysRequested: dto.daysRequested, dueBy: allotmentDueBy(dto.demandedOn) }, ip: null });
      }, { userId: actor.userId });
      return { id, jobCardNo: card.jobCardNo, demandedOn: dto.demandedOn, status: 'demanded' as const, dueBy: allotmentDueBy(dto.demandedOn), daysUntilDue: daysUntilDue(dto.demandedOn, today), guaranteeNote: `work is due within ${DEMAND_ALLOTMENT_DAYS} days of the demand` };
    });
  }

  /** Allot a REAL work against an open demand, withdraw it (the household changed their mind) or close it with a
   *  reason. 0091's CHECK refuses an 'allotted' row without both a work and a date, so an allotment can never be
   *  an empty promise. */
  async transitionDemand(tenantId: string, actor: { userId: string; canManage: boolean }, id: string, dto: { to: 'allotted' | 'withdrawn' | 'closed'; workId?: string; allottedOn?: string; reason?: string }) {
    this.assertManage(actor.canManage);
    const today = new Date().toISOString().slice(0, 10);
    return this.uow.run(tenantId, async (tx) => {
      const d = await this.repo.lockDemand(tx, tenantId, id);
      if (!d) throw new NotFoundError('demand not found');
      const status = d.status as DemandStatus;
      if (dto.to === 'allotted') {
        if (!canAllotDemand(status)) throw new ConflictError(`a ${status} demand cannot be allotted`);
        if (!dto.workId) throw new BadRequestError('workId is required to allot a demand — an allotment must point at a real work');
        const w = await this.repo.lockWork(tx, tenantId, dto.workId);
        if (!w) throw new NotFoundError('work not found');
        const allottedOn = dto.allottedOn ?? today;
        if (allottedOn < d.demandedOn) throw new BadRequestError('allottedOn cannot precede the demand date');
        await this.repo.allotDemand(tx, tenantId, id, dto.workId, allottedOn);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'mgnrega.demand_allotted', entityType: 'mgnrega_work_demand', entityId: id, oldValue: { status }, newValue: { status: 'allotted', workId: dto.workId, allottedOn, withinStatutoryWindow: !allotmentOverdue(d.demandedOn, 'demanded', allottedOn) }, ip: null });
        return { id, status: 'allotted' as const, allottedOn };
      }
      const ok = dto.to === 'withdrawn' ? canWithdrawDemand(status) : canCloseDemand(status);
      if (!ok) throw new ConflictError(`a ${status} demand cannot be ${dto.to}`);
      const reason = (dto.reason ?? '').trim();
      // A demand that ends WITHOUT work must say why: it is the household's only record of what happened to a right
      // they exercised. Withdrawal is the household's own act, so a reason is requested but not compelled.
      if (dto.to === 'closed' && !reason) throw new BadRequestError('a reason is required to close a demand without work');
      await this.repo.endDemand(tx, tenantId, id, dto.to, reason || null);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `mgnrega.demand_${dto.to}`, entityType: 'mgnrega_work_demand', entityId: id, oldValue: { status }, newValue: { status: dto.to, reason: reason || null, wasOverdue: allotmentOverdue(d.demandedOn, 'demanded', today) }, ip: null });
      return { id, status: dto.to };
    }, { userId: actor.userId });
  }

  /** The demand register + its clock. `authoritative` names the state register for the same reason the 100-day
   *  ledger does: we hold the platform's record of the demand, not the state's obligation ledger. */
  async demands(tenantId: string, actor: { canManage: boolean }, q: { status?: string; regionId?: string; jobCardId?: string; limit: number }) {
    this.assertManage(actor.canManage);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.repo.listDemands(tenantId, q);
    return {
      allotmentWindowDays: DEMAND_ALLOTMENT_DAYS,
      authoritative: 'state_register',
      allowanceNote: 'An unemployment allowance for an unmet demand is payable BY THE STATE; this platform records the demand and its deadline, never the allowance payment.',
      demands: rows.map((d) => {
        const demandedOn = String(d.demandedOn);
        const status = String(d.status) as DemandStatus;
        return {
          ...d,
          dueBy: allotmentDueBy(demandedOn),
          daysUntilDue: daysUntilDue(demandedOn, today),
          overdue: allotmentOverdue(demandedOn, status, today),
          allowanceDue: unemploymentAllowanceDue(demandedOn, status, today),
        };
      }),
    };
  }

  /** GW-5 dashboard counters — computed over the WHOLE register in SQL (never over a page of rows), plus the state
   *  ledger's own availability so the console can say "sync pending" honestly instead of implying freshness. */
  async programSummary(tenantId: string, actor: { canManage: boolean }) {
    this.assertManage(actor.canManage);
    const today = new Date().toISOString().slice(0, 10);
    const [counts, demandCounts, state] = await Promise.all([
      this.repo.programCounts(tenantId),
      this.repo.demandCounts(tenantId, today),
      this.stateLedger.fetchCardStatus([]),
    ]);
    return {
      guaranteeDays: MGNREGA_GUARANTEE_DAYS,
      allotmentWindowDays: DEMAND_ALLOTMENT_DAYS,
      jobCards: counts.jobCards,
      works: counts.works,
      musterDaysObserved: counts.musterDays,
      demands: demandCounts,
      authoritative: 'state_ledger',
      stateLedger: { provider: this.stateLedger.name, available: state.providerAvailable, note: state.note, fetchedAt: state.fetchedAt },
    };
  }

  /** THE AUDIT-STAMPED EXPORT (Ledger Appendix 5 law, as W54-10 established for DBT): an export is a READ THAT
   *  LEAVES A TRAIL. The receipt — who / when / which report / which filters / how many rows — is written to the
   *  audit ledger in the same transaction that produces the rows, and its id is returned WITH the data so the file
   *  an officer saves carries its own provenance. Deliberately implemented here rather than by importing the
   *  schemes module's GovExportService: the LAW is shared, the module boundary is not crossed. */
  async export(tenantId: string, actor: { userId: string; canManage: boolean }, ip: string | null, dto: { report: string; limit?: number; status?: string; regionId?: string }) {
    this.assertManage(actor.canManage);
    const reports = ['job_cards', 'works', 'demands'] as const;
    if (!(reports as readonly string[]).includes(dto.report)) throw new BadRequestError(`report must be one of ${reports.join('|')}`);
    const limit = Math.min(Math.max(1, dto.limit ?? 500), 2000);
    const rows = dto.report === 'job_cards'
      ? await this.repo.exportJobCards(tenantId, limit)
      : dto.report === 'works'
        ? await this.repo.listWorks(tenantId, { status: dto.status, regionId: dto.regionId, limit })
        : (await this.demands(tenantId, actor, { status: dto.status, regionId: dto.regionId, limit })).demands;
    const receiptId = uuidv7();
    const generatedAt = new Date().toISOString();
    await this.uow.run(tenantId, (tx) => this.audit.write(tx, {
      tenantId, actorUserId: actor.userId, action: 'gov.report_exported', entityType: 'gov_export_receipt', entityId: receiptId,
      newValue: { module: 'labour.mgnrega', report: dto.report, filters: { status: dto.status ?? null, regionId: dto.regionId ?? null, limit }, rowCount: rows.length, generatedAt }, ip,
    }), { userId: actor.userId });
    return { receipt: { id: receiptId, report: dto.report, generatedAt, generatedBy: actor.userId, rowCount: rows.length, filters: { status: dto.status ?? null, regionId: dto.regionId ?? null } }, rows };
  }
}
