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

@Injectable()
export class MgnregaService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService, private readonly repo: MgnregaRepository, @Inject(STATE_LEDGER_PROVIDER) private readonly stateLedger: StateLedgerProvider) {}

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
}
