// modules/schemes/services/scheme-desk.service.ts · PC-56 TENANT-SW-b · D — THE TENANT SCHEMES DESK (W202 `/ops/schemes`, W203 `/ops/schemes/[code]`).
//
//   summary        open applications, rejection rate (FY), benefits landed (FY — a FACT with its method, else "no transfers recorded"),
//                  "eligible but not applied" from the latest sweep per scheme (else "no sweep yet"), status counts for the tabs.
//   schemes        the per-scheme table (open apps, FY benefit, window) — every number read.
//   pipeline       one tab of one scheme: Waiting · Applicant (masked) · Blocker (derived) · Assisted by · Govt ref · rejection reason + its
//                  translated FIX (seed core/0026, en / hi / gu). The tabs are FILTERS — the canon routes three of them to a mutate chain
//                  (F-22, a canon defect; named on the screen).
//   requestSweep   "Run eligibility sweep": a keyed act (scheme.desk, reason) — queued; once per scheme per IST day (UNIQUE). The sweep job
//                  evaluates eligibility_rules over the members through the per-person evaluator (Scheme.evaluate), batched in kv_app's UoW,
//                  and writes verdict rows. THE OUTPUT IS A CALL LIST ONLY — no application is ever created (canon W202).
//   reveal         the per-field reveal of an application's form_data (scheme.desk, reason ≥ 20): one field, one audit row (the field
//                  named, never the value), the 9a / 13b reveal pattern.
// REFUSED BY NAME: the camp-day worklist (no camp object exists on this platform — 9a).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { maskPhone } from '../../identity/read-models/member-roster.read-model';
import { Scheme } from '../domain/scheme.entity';
import { SchemeRepository } from '../repositories/scheme.repository';
import { SchemeDeskRepository } from '../repositories/scheme-desk.repository';
import {
  BENEFITS_METHOD, MIN_REVEAL_REASON, PipelineGroup, deriveBlocker, fyBounds, groupStatuses, memberProfile, waitingDays,
} from '../domain/scheme-desk';
import { SchemeNotFoundError, SchemesForbiddenError, ApplicationNotFoundError } from '../domain/schemes.errors';
import { DomainError } from '../../../shared/errors/app-error';

export interface DeskActor { userId: string; canDesk: boolean }
export class SweepRefusedError extends DomainError { constructor(code: string, message: string, status = 409) { super(code, message, status, {}); } }

const shortName = (full: string | null | undefined): string | null => {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0].slice(0, 40) : `${parts[0].slice(0, 40)} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
};
const TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const encodeDeskCursor = (raw: string, id: string): string | null => (TS.test(raw) && UUID.test(id) ? Buffer.from(`${raw}|${id}`, 'utf8').toString('base64url') : null);
export function decodeDeskCursor(c?: string): { c: string; id: string } | undefined {
  if (!c || c.length > 200) return undefined;
  const s = Buffer.from(c, 'base64url').toString('utf8'); const i = s.lastIndexOf('|');
  if (i < 0) return undefined;
  const raw = s.slice(0, i); const id = s.slice(i + 1);
  return TS.test(raw) && UUID.test(id) ? { c: raw, id } : undefined;
}

@Injectable()
export class SchemeDeskService {
  private readonly log = new Logger(SchemeDeskService.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly schemes: SchemeRepository,
    private readonly desk: SchemeDeskRepository,
  ) {}
  private assertDesk(a: DeskActor) { if (!a.canDesk) throw new SchemesForbiddenError('requires scheme.desk'); }

  async summary(tenantId: string, actor: DeskActor, now: Date = new Date()) {
    this.assertDesk(actor);
    const fy = fyBounds(now);
    const f = await this.desk.summaryFacts(tenantId, fy);
    const notApplied = f.sweeps.length > 0 ? f.sweeps.reduce((s, x) => s + x.eligibleNotApplied, 0) : null;
    return {
      fy,
      openApplications: f.openApplications, openSchemes: f.openSchemes,
      rejectionRateFy: f.decidedFy > 0 ? { rejected: f.rejectedFy, decided: f.decidedFy, ratePct: Math.round((f.rejectedFy * 1000) / f.decidedFy) / 10 } : { rejected: 0, decided: 0, ratePct: null, reason: 'no_decisions_this_fy' },
      benefitsLandedFy: f.transfers > 0 ? { minor: f.landedMinor, transfers: f.transfers, members: f.members, method: BENEFITS_METHOD } : { minor: null, transfers: 0, members: 0, method: BENEFITS_METHOD, reason: 'no_transfers_recorded' },
      eligibleNotApplied: notApplied === null ? { count: null, reason: 'no_sweep_yet' } : { count: notApplied, sweeps: f.sweeps },
      statusCounts: f.statusCounts,
      campWorklist: { built: false, reason: 'no_camp_object' },
    };
  }
  async schemeTable(tenantId: string, actor: DeskActor, now: Date = new Date()) {
    this.assertDesk(actor);
    return this.desk.schemeTable(tenantId, fyBounds(now));
  }

  async pipeline(tenantId: string, actor: DeskActor, code: string, q: { group: PipelineGroup; cursor?: string; limit: number }, now: Date = new Date()) {
    this.assertDesk(actor);
    const scheme = await this.desk.schemeByCode(code, tenantId);
    if (!scheme) throw new SchemeNotFoundError(code);
    const fy = fyBounds(now);
    const [counts, rows, texts, sweeps] = await Promise.all([
      this.desk.pipelineCounts(tenantId, scheme.id, fy),
      this.desk.pipeline(tenantId, { schemeId: scheme.id, statuses: groupStatuses(q.group), fyOnly: q.group === 'approved_disbursed_fy' ? fy : undefined, cursor: decodeDeskCursor(q.cursor), limit: q.limit }),
      this.desk.rejectionTexts(tenantId), this.desk.sweepsFor(tenantId, scheme.id, 5)]);
    const items = rows.map((r) => {
      const blocker = deriveBlocker({ status: r.status, rejectionReasonCode: r.rejectionReasonCode, clarificationNote: r.clarificationNote, openBounceReason: r.openBounceReason });
      return {
        id: r.id, status: r.status, waitingDays: waitingDays(r.changedAt, now), applicantShortName: shortName(r.applicantName), applicantPhoneMasked: maskPhone(r.applicantPhone),
        blocker, assistedBy: r.assistedBy ? { userId: r.assistedBy, shortName: shortName(r.assistedByName) } : null, selfFiled: r.assistedBy === null,
        govtAppRef: r.govtAppRef, rejection: r.rejectionReasonCode ? { code: r.rejectionReasonCode, ...(texts[r.rejectionReasonCode] ?? { label: {}, fix: {} }) } : null,
        submittedAt: r.submittedAt, decidedAt: r.decidedAt, formFields: r.formFields,
      };
    });
    const last = rows[rows.length - 1];
    return { scheme: { id: scheme.id, code: scheme.code, name: scheme.name, benefitSummary: scheme.benefitSummary, version: scheme.version, isActive: scheme.isActive },
      fy, group: q.group, counts, items, nextCursor: rows.length === q.limit && last ? encodeDeskCursor(last.changedAtRaw, last.id) : null,
      sweeps, tabsAreFilters: { canonDefect: 'F-22', note: 'W203 routes three tabs to chain-mutate:scheme; they are filters here' }, campWorklist: { built: false, reason: 'no_camp_object' } };
  }

  /** "Run eligibility sweep" — queue one sweep (once per scheme per IST day). The job evaluates; this act writes no verdict and no application. */
  async requestSweep(tenantId: string, actor: DeskActor, input: { schemeCode: string; reason: string }, idemKey: string, ip: string | null) {
    this.assertDesk(actor);
    const reason = (input.reason ?? '').trim();
    if (reason.length < 3 || reason.length > 300) throw new SweepRefusedError('SWEEP_REASON_REQUIRED', 'A sweep carries a reason (3–300 characters).', 422);
    return this.idem.remember(idemKey, actor.userId, 'schemes.sweep.request', () =>
      this.uow.run(tenantId, async (tx) => {
        const scheme = await this.desk.schemeByCode(input.schemeCode, tenantId);
        if (!scheme) throw new SchemeNotFoundError(input.schemeCode);
        if (!scheme.isActive) throw new SweepRefusedError('SWEEP_SCHEME_INACTIVE', 'This scheme is not active.');
        const id = uuidv7();
        await tx.query('SAVEPOINT sweep_insert');
        try { await this.desk.insertSweep(tx, { id, tenantId, schemeId: scheme.id, schemeVersion: scheme.version, requestedBy: actor.userId, reason }); }
        catch (e) {
          if ((e as { code?: string }).code === '23505') { await tx.query('ROLLBACK TO SAVEPOINT sweep_insert'); throw new SweepRefusedError('SWEEP_ALREADY_RUN_TODAY', 'This scheme was already swept today — the call list from that sweep stands; run it again tomorrow.'); }
          throw e;
        }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'schemes.eligibility_sweep.requested', entityType: 'scheme_eligibility_sweep', entityId: id, reason, ip,
          oldValue: null, newValue: { schemeId: scheme.id, schemeCode: scheme.code, schemeVersion: scheme.version, output: 'call_list_only' } });
        return { id, schemeId: scheme.id, schemeCode: scheme.code, status: 'queued' };
      }, { userId: actor.userId }));
  }

  /** The sweep job's body for one tenant: every queued sweep, members in batches of 200 (≤ 5,000), the per-person evaluator, verdict rows. */
  async processQueued(tenantId: string, now: Date = new Date()): Promise<{ sweeps: number; members: number }> {
    const queued = await this.uow.run(tenantId, (tx) => this.desk.queuedSweeps(tx, tenantId), { userId: 'system' });
    let members = 0;
    for (const sw of queued) {
      try {
        await this.uow.run(tenantId, (tx) => this.desk.markSweep(tx, tenantId, sw.id, { status: 'running' }), { userId: 'system' });
        const scheme = await this.schemes.getById(tenantId, sw.schemeId);
        if (!scheme) throw new SchemeNotFoundError(sw.schemeId);
        let after: string | null = null; let evaluated = 0; let eligible = 0; let notApplied = 0;
        for (let batch = 0; batch < 25; batch++) {
          const res = await this.uow.run(tenantId, async (tx) => {
            const rows = await this.desk.memberBatch(tx, tenantId, sw.schemeId, after, 200);
            for (const m of rows) {
              const { profile, inputs } = memberProfile(m, now);
              const verdict = (scheme as Scheme).evaluate(profile);       // THE per-person evaluator — the same one POST /schemes/:id/eligibility uses
              await this.desk.insertSweepRow(tx, { tenantId, sweepId: sw.id, userId: m.userId, eligible: verdict.eligible, reasons: verdict.reasons, inputs, applied: m.applied });
              evaluated++; if (verdict.eligible) { eligible++; if (!m.applied) notApplied++; }
            }
            return rows;
          }, { userId: 'system' });
          if (res.length < 200) break;
          after = res[res.length - 1].userId;
        }
        members += evaluated;
        await this.uow.run(tenantId, (tx) => this.desk.markSweep(tx, tenantId, sw.id, { status: 'done', membersEvaluated: evaluated, eligible, notApplied }), { userId: 'system' });
      } catch (e) {
        this.log.warn(`eligibility sweep ${sw.id} failed: ${(e as Error).message}`);
        await this.uow.run(tenantId, (tx) => this.desk.markSweep(tx, tenantId, sw.id, { status: 'failed', failure: String((e as Error).message).slice(0, 200) }), { userId: 'system' });
      }
    }
    return { sweeps: queued.length, members };
  }

  async sweepView(tenantId: string, actor: DeskActor, sweepId: string, q: { cursor?: string; limit: number; all?: boolean }) {
    this.assertDesk(actor);
    const sw = await this.desk.sweep(tenantId, sweepId);
    if (!sw) throw new SweepRefusedError('SWEEP_NOT_FOUND', 'Sweep not found', 404);
    const rows = await this.desk.callList(tenantId, sweepId, { cursor: decodeDeskCursor(q.cursor), limit: q.limit, all: q.all });
    const last = rows[rows.length - 1];
    return { sweep: sw, output: 'call_list_only', autoApply: { built: false, reason: 'canon_human_asks_first' },
      items: rows.map((r) => ({ id: r.id, userId: r.userId, shortName: shortName(r.fullName), phoneMasked: maskPhone(r.phone), eligible: r.eligible, reasons: r.reasons,
        inputs: r.inputs, alreadyApplied: r.alreadyApplied })),
      nextCursor: rows.length === q.limit && last ? encodeDeskCursor(last.raw, last.id) : null };
  }

  /** Reveal ONE field of an application's form_data, with a reason (≥ 20) — the audit row names the field, never the value. */
  async reveal(tenantId: string, actor: DeskActor, applicationId: string, input: { field: string; reason: string }, ip: string | null) {
    this.assertDesk(actor);
    const reason = (input.reason ?? '').trim();
    if (reason.length < MIN_REVEAL_REASON || reason.length > 500) throw new SweepRefusedError('REVEAL_REASON_REQUIRED', `A reveal needs a reason of at least ${MIN_REVEAL_REASON} characters.`, 422);
    return this.uow.run(tenantId, async (tx) => {
      const row = await this.desk.formValue(tx, tenantId, applicationId);
      if (!row) throw new ApplicationNotFoundError(applicationId);
      if (!Object.prototype.hasOwnProperty.call(row.formData, input.field)) throw new SweepRefusedError('FORM_FIELD_NOT_FOUND', 'This application has no such field', 404);
      const raw = row.formData[input.field];
      const value = raw === null || raw === undefined ? null : typeof raw === 'string' ? raw : JSON.stringify(raw);
      // the record is written FIRST and in the same transaction — a reveal whose audit fails reveals nothing
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'schemes.form_data.revealed', entityType: 'scheme_application', entityId: applicationId, reason, ip,
        oldValue: null, newValue: { field: input.field } });
      return { applicationId, field: input.field, value };
    }, { userId: actor.userId });
  }
}
