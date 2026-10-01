// modules/audit/services/auditor.service.ts · W200 (overview) · W436 (ledger drill-down) · W437 (compliance pack) · W201
// (the auditor's exports) · W2498 (the enqueue) — PC-56 TENANT-9c.
//
// EVERY TILE IS A FACT OR A REFUSAL BY NAME. The overview's "Ledger integrity · verified · hash chain intact" is replaced by
// what was actually checked, now, by this read: zero-sum over the window's transactions (SQL over the tenant's own legs),
// balance = Σ and the hash chain for each account the cooperative OWNS (walked from genesis with the writer's formula), and
// the platform-account chains WITHHELD BY NAME (ADMIN-6: shared, striped — unverifiable from one tenant). There is no
// "verified" boolean on the wire: the page composes its words from the counts, so a green tick cannot be printed over a
// check that did not run.
//
// EVERY READ IS RECORDED BEFORE IT IS RETURNED (`audit_read_log`), and the realm's one act — the export enqueue — is the
// AuditorReadOnlyGuard's named exception (`@AuditorReadAct('export.enqueue')` on the route).
import { Injectable } from '@nestjs/common';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { ExportPlaneService } from '../../../core/exports-plane/export-plane.service';
import { AuditorLedgerReadModel } from '../../payments/read-models/auditor-ledger.read-model';
import { integrityOf } from '../../payments/domain/auditor-ledger';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { AuditRepository } from '../repositories/audit.repository';
import { AuditReadLogRepository } from '../repositories/audit-read-log.repository';
import { AuditorClockRepository, TenantClock } from '../repositories/auditor-clock.repository';
import { AuditorComplianceReadModel } from '../read-models/auditor-compliance.read-model';
import {
  AUDITOR_REFUSED_BY_NAME, MAX_LIVE_WINDOW_DAYS, ReadPurpose, UNSIGNED_NOTE, fiscalQuarterOf, fiscalYearLabel, fiscalYearOf,
  resolveWindow, roleSetOf, spanOf,
} from '../domain/auditor-realm';
import { AUDITOR_DATASETS, AuditorExportEnqueueDto } from '../domain/auditor-exports';
import { AuditWindowRefusedError, AuditorRealmOffError, AuditorScopeError } from '../domain/auditor.errors';
import { AUDIT_TRAIL_FLAG } from './audit.service';

export interface AuditorActor { userId: string; roles: readonly string[]; permissions: ReadonlySet<string>; requestId: string | null }

const has = (a: AuditorActor, p: string) => a.permissions.has(p) || a.permissions.has('*');

/** W200's "What the auditor can see" — each line is a real read code and where it lands (the page links them). */
export const AUDITOR_SCOPE_LINES = [
  { code: 'ledger', permission: 'ledger.read' },
  { code: 'trail', permission: 'audit.read' },
  { code: 'kyc', permission: 'kyc.read' },
  { code: 'governance', permission: 'governance.read' },
  { code: 'reports', permission: 'report.view' },
] as const;

@Injectable()
export class AuditorService {
  constructor(
    private readonly flags: FlagsService,
    private readonly clocks: AuditorClockRepository,
    private readonly readLog: AuditReadLogRepository,
    private readonly trail: AuditRepository,
    private readonly ledger: AuditorLedgerReadModel,
    private readonly pack: AuditorComplianceReadModel,
    private readonly exportsPlane: ExportPlaneService,
  ) {}

  private async gate(tenantId: string, actor: AuditorActor, permission: string): Promise<TenantClock> {
    const on = await this.flags.isEnabled(AUDIT_TRAIL_FLAG, { tenantId }).catch(() => false);   // fail closed
    if (!on) throw new AuditorRealmOffError();
    if (!has(actor, permission)) throw new AuditorScopeError(permission);
    return this.clocks.clockOf(tenantId);
  }

  private fy(clock: TenantClock) {
    const fy = fiscalYearOf(clock.today, clock.fyMonth);
    return fy.declared
      ? { declared: true as const, label: fiscalYearLabel(fy), start: fy.start, end: fy.end, startMonth: fy.startMonth }
      : { declared: false as const, code: fy.code };
  }

  private window(clock: TenantClock, from?: string, to?: string, max = MAX_LIVE_WINDOW_DAYS) {
    const fy = fiscalYearOf(clock.today, clock.fyMonth);
    const w = resolveWindow(from, to, clock.today, max, fy.declared ? fy.start : null);
    if (!w.ok) throw new AuditWindowRefusedError(w.code, w.maxDays);
    return w;
  }

  private async record(tenantId: string, actor: AuditorActor, purpose: ReadPurpose, surface: string, filter: Record<string, unknown>, ids: string[], win?: { from: string; to: string; zone: string }) {
    const span = spanOf(ids);
    return this.readLog.record({
      tenantId, actorUserId: actor.userId, actorRole: roleSetOf(actor.roles), purpose, surface, filter,
      rowCount: span.count, spanFirst: span.first, spanLast: span.last, window: win ?? null, requestId: actor.requestId,
    });
  }

  /** W200. */
  async overview(tenantId: string, actor: AuditorActor, q: { from?: string; to?: string }) {
    const clock = await this.gate(tenantId, actor, 'ledger.read');
    const w = this.window(clock, q.from, q.to);
    const win = { fromDay: w.from, toDay: w.to, zone: clock.zone };
    const [txns, zeroSum, accounts, latest, privileged] = await Promise.all([
      this.ledger.txnCount(tenantId, win),
      this.ledger.zeroSum(tenantId, win),
      this.ledger.ownAccounts(tenantId, clock.currency),
      this.ledger.page(tenantId, win, { limit: 5 }),
      has(actor, 'audit.read') ? this.trail.countsFor(tenantId, w.from, w.to, clock.zone) : Promise.resolve(null),
    ]);
    const readId = await this.record(tenantId, actor, 'auditor_overview', 'GET /v1/auditor/overview', { from: q.from ?? null, to: q.to ?? null }, latest.items.map((t) => t.txnId), { from: w.from, to: w.to, zone: clock.zone });
    const pageIntegrity = integrityOf(latest.items.map((t) => ({ foot: t.foot, legs: t.legs })));
    return {
      clock: { zone: clock.zone, currency: clock.currency, today: clock.today, fiscalYear: this.fy(clock) },
      window: { from: w.from, to: w.to, days: w.days, maxDays: MAX_LIVE_WINDOW_DAYS, defaulted: w.defaulted },
      session: { roles: [...actor.roles].sort(), auditor: actor.roles.includes('auditor'), readOnly: actor.roles.includes('auditor') },
      integrity: {
        zeroSum,
        ownAccounts: accounts.map((a) => ({ accountCode: a.accountCode, entryCount: a.entryCount, balanceEqualsSum: a.balance.equal, driftMinor: a.balance.driftMinor, chain: a.chain.kind, chainChecked: 'checked' in a.chain ? a.chain.checked : 0, headMatches: a.headMatches })),
        sharedChains: { verdict: 'unverifiable' as const, reason: 'shared_stripe' as const, legsWithheldOnPage: pageIntegrity.withheld.sharedStripe },
        checkedAt: 'this_read' as const,
      },
      transactions: { count: txns },
      privilegedActions: privileged,
      latest: latest.items,
      scope: AUDITOR_SCOPE_LINES.map((l) => ({ code: l.code, permission: l.permission, held: has(actor, l.permission) })),
      refusedByName: AUDITOR_REFUSED_BY_NAME,
      logged: { readId, purpose: 'auditor_overview' },
    };
  }

  /** W436. */
  async ledgerPage(tenantId: string, actor: AuditorActor, q: { from?: string; to?: string; cursor?: string; txnType?: string; limit?: number }) {
    const clock = await this.gate(tenantId, actor, 'ledger.read');
    const w = this.window(clock, q.from, q.to);
    const win = { fromDay: w.from, toDay: w.to, zone: clock.zone };
    const page = await this.ledger.page(tenantId, win, { cursor: q.cursor, txnType: q.txnType, limit: q.limit ?? 20 });
    const readId = await this.record(tenantId, actor, 'ledger_page', 'GET /v1/auditor/ledger', { from: q.from ?? null, to: q.to ?? null, txnType: q.txnType ?? null, cursor: q.cursor ? 'next' : null }, page.items.map((t) => t.txnId), { from: w.from, to: w.to, zone: clock.zone });
    return {
      clock: { zone: clock.zone, currency: clock.currency, today: clock.today, fiscalYear: this.fy(clock) },
      window: { from: w.from, to: w.to, days: w.days, maxDays: MAX_LIVE_WINDOW_DAYS, defaulted: w.defaulted },
      items: page.items, nextCursor: page.nextCursor,
      integrity: integrityOf(page.items.map((t) => ({ foot: t.foot, legs: t.legs }))),
      logged: { readId, purpose: 'ledger_page' },
    };
  }

  /** W437 — the current fiscal quarter by default (when the year is declared), else the bounded window. Computed on read. */
  async compliancePack(tenantId: string, actor: AuditorActor, q: { from?: string; to?: string }) {
    const clock = await this.gate(tenantId, actor, 'ledger.read');
    const qtr = fiscalQuarterOf(clock.today, clock.fyMonth);
    const from = q.from ?? (qtr.declared ? qtr.start : undefined);
    const to = q.to ?? (qtr.declared && !q.from ? clock.today : undefined);
    const w = this.window(clock, from, to);
    const win = { fromDay: w.from, toDay: w.to, zone: clock.zone };
    const [gst, schemes, privacy, zeroSum, accounts, txns] = await Promise.all([
      this.pack.gst(tenantId, win), this.pack.schemes(tenantId, win), this.pack.privacy(tenantId),
      this.ledger.zeroSum(tenantId, win), this.ledger.ownAccounts(tenantId, clock.currency), this.ledger.txnCount(tenantId, win),
    ]);
    const readId = await this.record(tenantId, actor, 'compliance_pack', 'GET /v1/auditor/compliance-pack', { from: q.from ?? null, to: q.to ?? null }, [], { from: w.from, to: w.to, zone: clock.zone });
    return {
      clock: { zone: clock.zone, currency: clock.currency, today: clock.today, fiscalYear: this.fy(clock) },
      window: { from: w.from, to: w.to, days: w.days, maxDays: MAX_LIVE_WINDOW_DAYS, defaulted: w.defaulted },
      quarter: qtr.declared ? { q: qtr.q, start: qtr.start, end: qtr.end } : null,
      attestation: { status: 'unsigned' as const, signable: false, reason: 'no_signing_key' as const },
      sections: {
        gst, schemes, privacy,
        ledger: { transactions: txns, zeroSum, ownAccounts: accounts.map((a) => ({ accountCode: a.accountCode, entryCount: a.entryCount, balanceEqualsSum: a.balance.equal, chain: a.chain.kind, headMatches: a.headMatches })), sharedChains: 'unverifiable' as const },
      },
      unsignedNote: UNSIGNED_NOTE,
      logged: { readId, purpose: 'compliance_pack' },
    };
  }

  /** W201 — the caller's own export jobs for the three auditor datasets. */
  async exportsList(tenantId: string, actor: AuditorActor, q: { cursor?: string }) {
    const clock = await this.gate(tenantId, actor, 'audit.read');
    const cursor = decodeKeyset(q.cursor, UUID_RE);
    const r = await this.exportsPlane.listMine(tenantId, { userId: actor.userId, permissions: actor.permissions }, AUDITOR_DATASETS, cursor, 20);
    const readId = await this.record(tenantId, actor, 'export_list', 'GET /v1/auditor/exports', { cursor: q.cursor ? 'next' : null }, r.items.map((j) => j.id));
    return { items: r.items, nextCursor: r.next ? encodeKeyset(r.next.ts, r.next.id) : null, zone: clock.zone, today: clock.today, fiscalYear: this.fy(clock), unsignedNote: UNSIGNED_NOTE, logged: { readId, purpose: 'export_list' } };
  }

  /** W2498 — THE REALM'S ONE ACT. The plane validates the params with the producer's schema, checks the dataset's read
   *  code, dedupes the open twin and audits the enqueue; this records the read-log row for it. */
  async enqueueExport(tenantId: string, actor: AuditorActor, key: string, dto: AuditorExportEnqueueDto, ip: string | null) {
    await this.gate(tenantId, actor, 'audit.read');
    const job = await this.exportsPlane.enqueue(tenantId, { userId: actor.userId, permissions: actor.permissions }, key, { datasetCode: dto.datasetCode, params: dto.params }, ip);
    await this.record(tenantId, actor, 'export_enqueue', 'POST /v1/auditor/exports', { datasetCode: dto.datasetCode, params: dto.params }, [job.id]);
    return job;
  }
}
