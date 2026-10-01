// modules/audit/exports/auditor.datasets.ts · W201 / W2498 / W2499 · THE AUDITOR'S THREE DATASETS on the 6e-2 plane
// (PC-56 TENANT-9c · F-11). Registered by `AuditTrailModule.onModuleInit`. Each is a READ that happens to be long — no
// producer writes anything — gated by the read code of the screen it is an export OF:
//   `audit.trail`     — audit.read  — the trail over ≤ 366 days, MASKED exactly as on screen (an export is not a reveal)
//   `ledger.entries`  — ledger.read — every tenant-attributed leg through the ONE funnel (`AuditorLedgerReadModel`)
//   `compliance.pack` — ledger.read — one section of the pack per file (≤ 92 days): gst · ledger · schemes · privacy
// Every receipt's notes open with `UNSIGNED_NOTE` (no signing key — founder-physical) and the verification facts that ARE
// true. The `audit_trail` flag gates them as it gates the screens (`dataset_disabled`, with a receipt, when off).
import { Injectable } from '@nestjs/common';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { AuditorLedgerReadModel } from '../../payments/read-models/auditor-ledger.read-model';
import { AuditRepository } from '../repositories/audit.repository';
import { AuditorClockRepository } from '../repositories/auditor-clock.repository';
import { AuditorComplianceReadModel } from '../read-models/auditor-compliance.read-model';
import { maskEntry } from '../domain/audit-diff-mask';
import { decodeAuditCursor, encodeAuditCursor } from '../domain/audit.cursor';
import {
  AUDIT_TRAIL_DATASET, COMPLIANCE_PACK_DATASET, LEDGER_ENTRIES_DATASET, LEDGER_EXPORT_CAP, LEDGER_EXPORT_HEADER, PACK_EXPORT_HEADER,
  PackExportParams, PackExportParamsSchema, LedgerExportParams, LedgerExportParamsSchema, TRAIL_EXPORT_CAP, TRAIL_EXPORT_HEADER,
  TrailExportParams, TrailExportParamsSchema, ledgerNotes, packNotes, trailNotes, trailRow,
} from '../domain/auditor-exports';
import { packRows } from '../domain/auditor-pack';

const FLAG = 'audit_trail';
const off = { kind: 'refused', code: 'dataset_disabled', detail: 'flag audit_trail is off for this tenant' } as const;

@Injectable()
export class AuditTrailDataset implements DatasetProducer<TrailExportParams> {
  readonly code = AUDIT_TRAIL_DATASET;
  readonly permission: string = 'audit.read';
  readonly params = TrailExportParamsSchema;
  constructor(private readonly repo: AuditRepository, private readonly clocks: AuditorClockRepository, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${this.code}`); }

  async produce(ctx: ProduceContext, p: TrailExportParams): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled(FLAG, { tenantId: ctx.tenantId }).catch(() => false))) return off;
    const clock = await this.clocks.clockOf(ctx.tenantId);
    const repo = this.repo; const tenantId = ctx.tenantId;
    const first = await repo.listFor(tenantId, { fromDay: p.from, toDay: p.to, zone: clock.zone, limit: 1 });
    return {
      kind: 'file',
      file: {
        header: TRAIL_EXPORT_HEADER,
        rows: (async function* () {
          let cursor: { ts: string; id: string } | undefined; let n = 0;
          for (;;) {
            const page = await repo.listFor(tenantId, { fromDay: p.from, toDay: p.to, zone: clock.zone, cursor, limit: 100 });
            for (const r of page) {
              if (n >= TRAIL_EXPORT_CAP) return;
              n += 1;
              const m = maskEntry(r.oldValue ?? null, r.newValue ?? null);
              yield trailRow({ id: r.id, createdAt: r.cursorTs, action: r.action, entityType: r.entityType, entityId: r.entityId, actorUserId: r.actorUserId, actorRole: r.actorRole, reason: r.reason, oldValue: m.oldValue, newValue: m.newValue, maskedFields: m.maskedFields });
            }
            if (page.length < 100) return;
            const last = page[page.length - 1];
            cursor = decodeAuditCursor(encodeAuditCursor(last.cursorTs, last.id));
          }
        })(),
        notes: trailNotes({ from: p.from, to: p.to, zone: clock.zone, empty: first.length === 0 }),
        fileSuffix: `${p.from}_${p.to}`,
      },
    };
  }
}

@Injectable()
export class LedgerEntriesDataset implements DatasetProducer<LedgerExportParams> {
  readonly code = LEDGER_ENTRIES_DATASET;
  readonly permission: string = 'ledger.read';
  readonly params = LedgerExportParamsSchema;
  constructor(private readonly ledger: AuditorLedgerReadModel, private readonly clocks: AuditorClockRepository, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${this.code}`); }

  async produce(ctx: ProduceContext, p: LedgerExportParams): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled(FLAG, { tenantId: ctx.tenantId }).catch(() => false))) return off;
    const clock = await this.clocks.clockOf(ctx.tenantId);
    const win = { fromDay: p.from, toDay: p.to, zone: clock.zone };
    // The truncation is known only at the end of the stream; the notes are computed up front, so the file is walked once
    // to count (cheap: the funnel's own pages) and then streamed. A ledger file that hides its truncation is worse than none.
    let count = 0; let truncated = false;
    for await (const x of this.ledger.exportLegs(ctx.tenantId, win, LEDGER_EXPORT_CAP)) { if ('truncated' in x) { truncated = true; break; } count += 1; }
    const ledger = this.ledger; const tenantId = ctx.tenantId;
    return {
      kind: 'file',
      file: {
        header: LEDGER_EXPORT_HEADER,
        rows: (async function* () {
          for await (const x of ledger.exportLegs(tenantId, win, LEDGER_EXPORT_CAP)) {
            if ('truncated' in x) return;
            const { txn, leg } = x; const h = leg.hashLink;
            yield [txn.txnId, txn.createdAt, txn.txnType, txn.referenceType, txn.referenceId, leg.n, leg.kind, leg.accountLabel, leg.side,
              leg.amountMinor, txn.currencyCode, leg.runningMinor, leg.balanceAfterMinor,
              h.kind === 'withheld' ? null : h.prevHash, h.kind === 'withheld' ? null : h.entryHash,
              h.kind === 'withheld' ? `withheld_${h.reason}` : h.kind === 'linked' ? (h.genesis ? 'linked_genesis' : 'linked') : h.kind,
              txn.foot.sumMinor, txn.foot.legsVisible, txn.foot.legsTotal];
          }
        })(),
        notes: [...ledgerNotes({ from: p.from, to: p.to, zone: clock.zone, truncated, cap: LEDGER_EXPORT_CAP }), `${count} legs`],
        fileSuffix: `${p.from}_${p.to}`,
      },
    };
  }
}

@Injectable()
export class CompliancePackDataset implements DatasetProducer<PackExportParams> {
  readonly code = COMPLIANCE_PACK_DATASET;
  readonly permission: string = 'ledger.read';
  readonly params = PackExportParamsSchema;
  constructor(private readonly ledger: AuditorLedgerReadModel, private readonly pack: AuditorComplianceReadModel, private readonly clocks: AuditorClockRepository, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${this.code}`); }

  async produce(ctx: ProduceContext, p: PackExportParams): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled(FLAG, { tenantId: ctx.tenantId }).catch(() => false))) return off;
    const clock = await this.clocks.clockOf(ctx.tenantId);
    const win = { fromDay: p.from, toDay: p.to, zone: clock.zone };
    let rows: Array<Array<string | number | null>>;
    if (p.section === 'gst') rows = packRows('gst', { gst: await this.pack.gst(ctx.tenantId, win), currency: clock.currency });
    else if (p.section === 'schemes') rows = packRows('schemes', { schemes: await this.pack.schemes(ctx.tenantId, win), currency: clock.currency });
    else if (p.section === 'privacy') rows = packRows('privacy', { privacy: await this.pack.privacy(ctx.tenantId), currency: clock.currency });
    else rows = packRows('ledger', { zeroSum: await this.ledger.zeroSum(ctx.tenantId, win), accounts: await this.ledger.ownAccounts(ctx.tenantId, clock.currency), txns: await this.ledger.txnCount(ctx.tenantId, win), currency: clock.currency });
    return {
      kind: 'file',
      file: {
        header: PACK_EXPORT_HEADER,
        rows: (async function* () { for (const r of rows) yield r; })(),
        notes: packNotes(p.section, { from: p.from, to: p.to, zone: clock.zone }),
        fileSuffix: `${p.section}-${p.from}_${p.to}`,
      },
    };
  }
}
