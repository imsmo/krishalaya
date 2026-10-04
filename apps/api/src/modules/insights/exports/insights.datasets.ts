// modules/insights/exports/insights.datasets.ts · PC-56 TENANT-SW-f (F-18) — the insights on the 6e-2 export plane:
//   mandi_pulse_member_crops   W2678 / W2679 — the member-crop filter × the latest modal per mandi × listed stock
//   demand_map                 W2569 / W2570 — open requirements with stock fit, value (or its refusal) and reach (or its refusal)
//   wastage_events             W2824 / W2825 — every recorded loss fact of the 90-day window, with its source reference and method
//   report_run                 W2738–W2740 — the report builder's file: EXACTLY the rows the run froze, with the watermark before the header
//
// THE FILES ARE UNSIGNED AND SAY SO (founder-physical key); the plane prints each file's sha256. Every producer READS only (the plane's
// rule). A refused figure is never a column: the notes name it, with its sentence.
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { METHODS, REFUSED, REFUSAL_SENTENCES, thousandths, fromThousandths, stockFit, demandValue, reachOf, WASTAGE_WINDOW_DAYS } from '../domain/insights';
import { InsightsRepository } from '../repositories/insights.repository';
import { ReportRepository } from '../repositories/report.repository';
import { modalChange } from '../services/insights.service';
import { REPORT_RUN_DATASET } from '../services/report.service';

export const MANDI_DATASET = 'mandi_pulse_member_crops';
export const DEMAND_DATASET = 'demand_map';
export const WASTAGE_DATASET = 'wastage_events';
export const UNSIGNED_NOTE = 'unsigned — signing is a founder-physical key; the sha256 is printed';

export const NoParamsSchema = z.object({}).strict();
export const DemandExportSchema = z.object({ reach: z.enum(['all', 'districts']).default('all') }).strict();
export const ReportRunParamsSchema = z.object({ runId: z.string().uuid() }).strict();
const off = (flag: string) => ({ kind: 'refused' as const, code: 'dataset_disabled' as const, detail: `flag ${flag} is off for this tenant` });
const gen = <T,>(rows: T[]) => (async function* () { for (const r of rows) yield r; })();

@Injectable()
export class MandiPulseDataset implements DatasetProducer<Record<string, never>> {
  readonly code = MANDI_DATASET; readonly permission = 'report.view'; readonly params = NoParamsSchema as never;
  constructor(private readonly repo: InsightsRepository, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${MANDI_DATASET}`); }
  async produce(ctx: ProduceContext): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled('market_intel', { tenantId: ctx.tenantId }).catch(() => false))) return off('market_intel');
    const crops = await this.repo.memberCrops(ctx.tenantId);
    const [modals, stock] = await Promise.all([this.repo.latestModals(ctx.tenantId, crops.map((c) => c.productId)), this.repo.listedStock(ctx.tenantId)]);
    const rows: Array<Array<string | number>> = [];
    for (const c of crops) {
      const st = stock.filter((s) => s.productId === c.productId).map((s) => `${fromThousandths(thousandths(s.quantity))} ${s.unit}`).join('; ');
      const ms = modals.filter((m) => m.productId === c.productId);
      if (ms.length === 0) rows.push([c.crop, c.productId, c.listed ? 'yes' : 'no', c.declared ? 'yes' : 'no', '', '', '', '', '', '', st]);
      for (const m of ms) { const ch = modalChange(m); rows.push([c.crop, c.productId, c.listed ? 'yes' : 'no', c.declared ? 'yes' : 'no', m.mandi, m.priceDate, m.modalMinor, m.currency, m.unit, ch ? String(ch.changeBps) : '', st]); }
    }
    return { kind: 'file', file: {
      header: ['crop', 'product_id', 'in_published_listing', 'declared_in_season', 'mandi', 'price_date', 'modal_minor', 'currency', 'price_unit', 'change_bps_vs_previous_day', 'listed_stock'],
      rows: gen(rows),
      notes: [UNSIGNED_NOTE, METHODS.member_crops, METHODS.mandi_modal, METHODS.listed_stock,
        `refused by name: ${REFUSED.storedStock} — ${REFUSAL_SENTENCES.NO_STOCK_DECLARATION}`, `refused by name: ${REFUSED.soldOnAlert} — ${REFUSAL_SENTENCES.NO_CAUSAL_METHOD}`,
        `refused by name: ${REFUSED.aiBand} — ${REFUSAL_SENTENCES.NO_REGISTERED_MODEL}`],
      fileSuffix: 'member-crops' } };
  }
}

@Injectable()
export class DemandMapDataset implements DatasetProducer<z.infer<typeof DemandExportSchema>> {
  readonly code = DEMAND_DATASET; readonly permission = 'report.view'; readonly params = DemandExportSchema;
  constructor(private readonly repo: InsightsRepository, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${DEMAND_DATASET}`); }
  async produce(ctx: ProduceContext, p: z.infer<typeof DemandExportSchema>): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled('requirements', { tenantId: ctx.tenantId }).catch(() => false))) return off('requirements');
    const districts = new Set(await this.repo.tenantDistricts(ctx.tenantId));
    const rows: string[][] = [];
    let cursor: { us: string; id: string } | null = null;
    for (let i = 0; i < 100; i++) {                                     // ≤ 100 pages of 500 — bounded, never an unbounded scan
      const page = await this.repo.openRequirements(ctx.tenantId, cursor, 500);
      const cur = page.slice(0, 500);
      if (cur.length === 0) break;
      const [stock, consents, rd] = await Promise.all([
        this.repo.sellerStock(ctx.tenantId, cur.map((r) => r.productId).filter((x): x is string => !!x), cur.map((r) => r.categoryId).filter((x): x is string => !!x)),
        this.repo.quoteConsents(ctx.tenantId, cur.map((r) => r.id)), this.repo.requirementDistricts(ctx.tenantId, cur.map((r) => r.id))]);
      for (const r of cur) {
        const reach = districts.size ? reachOf(rd.get(r.id) ?? null, districts) : REFUSED.geoReach;
        if (p.reach === 'districts' && reach !== 'in_reach') continue;
        const wanted = thousandths(r.quantity) - thousandths(r.fulfilled); const w = wanted > 0n ? wanted : 0n;
        const own = stock.filter((s) => s.unit === r.unit && s.sellerUserId !== r.buyerUserId && (r.productId ? s.productId === r.productId : s.categoryId === r.categoryId));
        const listed = own.reduce((a, s) => a + thousandths(s.quantity), 0n);
        const v = demandValue(fromThousandths(w), r.budgetMinMinor, r.budgetMaxMinor);
        rows.push([r.reqNo ?? r.id, r.title, r.crop ?? '', fromThousandths(w), r.unit, fromThousandths(listed), stockFit(w, listed),
          v.kind === 'value' ? v.upToMinor : `refused: ${v.code}`, v.kind === 'value' ? (v.fromMinor ?? '') : '', r.currency, reach,
          String(consents.filter((c) => c.requirementId === r.id).length)]);
      }
      if (page.length <= 500) break;
      const last = cur[cur.length - 1]; cursor = { us: last.createdUs, id: last.id };
    }
    return { kind: 'file', file: {
      header: ['requirement', 'title', 'crop', 'qty_wanted', 'unit', 'member_listed_stock', 'stock_fit', 'value_up_to_minor', 'value_from_minor', 'currency', 'reach', 'consented_member_quotes'],
      rows: gen(rows),
      notes: [UNSIGNED_NOTE, METHODS.qty_wanted, METHODS.stock_fit, METHODS.demand_value, districts.size ? METHODS.geo_reach : `refused by name: ${REFUSED.geoReach} — ${REFUSAL_SENTENCES.NO_GEO_REACH}`,
        'member stock is an AGGREGATE; no member is named in this file (consented quotes are counted, not listed)',
        `refused by name: ${REFUSED.unmetDemand} — ${REFUSAL_SENTENCES.NO_UNMET_DEMAND_METHOD}`, `filter: reach = ${p.reach}`],
      fileSuffix: p.reach === 'districts' ? 'in-reach' : 'all' } };
  }
}

@Injectable()
export class WastageEventsDataset implements DatasetProducer<Record<string, never>> {
  readonly code = WASTAGE_DATASET; readonly permission = 'report.view'; readonly params = NoParamsSchema as never;
  constructor(private readonly repo: InsightsRepository, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${WASTAGE_DATASET}`); }
  async produce(ctx: ProduceContext): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled('insights_wastage', { tenantId: ctx.tenantId }).catch(() => false))) return off('insights_wastage');
    const rows: string[][] = [];
    let cursor: { us: string; id: string } | null = null;
    for (let i = 0; i < 200; i++) {
      const page = await this.repo.wastageEvents(ctx.tenantId, cursor, 500, WASTAGE_WINDOW_DAYS);
      const cur = page.slice(0, 500);
      for (const w of cur) rows.push([w.id, w.occurredAt, w.kind, w.sourceKind, w.sourceTable, w.sourceId, w.chainKey ?? '', w.crop ?? '', w.subjectType ?? '', w.subjectId ?? '',
        w.quantity ?? '', w.unit ?? '', w.valueMinor ?? '', w.currency ?? '', w.valueReason ?? '', w.methodCode, w.recordedAt]);
      if (page.length <= 500) break;
      const last = cur[cur.length - 1]; cursor = { us: last.occurredUs, id: last.id };
    }
    return { kind: 'file', file: {
      header: ['event_id', 'occurred_at', 'kind', 'source_kind', 'source_table', 'source_id', 'chain_key', 'crop', 'subject_type', 'subject_id', 'quantity', 'unit', 'value_minor', 'currency',
        'value_reason', 'method_code', 'recorded_at'],
      rows: gen(rows),
      notes: [UNSIGNED_NOTE, `${WASTAGE_WINDOW_DAYS} days of recorded loss facts, newest first`, METHODS.measured_loss,
        'every row is one source row; rows sharing a chain_key are ONE loss (count the transit_dispute_variance row when present)',
        'value_minor is present only where the source recorded a money fact — an empty cell is "no money value recorded" (see value_reason), never zero',
        `refused by name: ${REFUSED.externalStatistic}, ${REFUSED.savedMoney}, ${REFUSED.weighbridge}, ${REFUSED.manualWastage}`],
      fileSuffix: `${WASTAGE_WINDOW_DAYS}d` } };
  }
}

@Injectable()
export class ReportRunDataset implements DatasetProducer<z.infer<typeof ReportRunParamsSchema>> {
  readonly code = REPORT_RUN_DATASET; readonly permission = 'report.run'; readonly params = ReportRunParamsSchema;
  constructor(private readonly reports: ReportRepository, private readonly ui: UiMessageRepository) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${REPORT_RUN_DATASET}`); }
  async produce(ctx: ProduceContext, p: z.infer<typeof ReportRunParamsSchema>): Promise<ProduceOutcome> {
    const run = await this.reports.run(ctx.tenantId, p.runId);
    const res = await this.reports.result(ctx.tenantId, p.runId);
    if (!run || run.status !== 'ready' || !res || !run.watermark) return { kind: 'refused', code: 'dataset_disabled', detail: `report run ${p.runId} has no frozen result` };
    const preamble = run.watermark.split('\n').map((l) => { const i = l.indexOf('\t'); return i < 0 ? [l] : [l.slice(0, i), l.slice(i + 1)]; });
    return { kind: 'file', file: {
      preamble, header: res.header, rows: gen(res.rows),
      notes: [UNSIGNED_NOTE, `report run ${run.id}: dataset ${run.datasetCode}, ${run.fromDay} to ${run.toDay} (IST days), ${run.rowCount} rows`,
        'the first lines (before the header) are the watermark: tenant, requester, generated-at (IST), run, definition, row count',
        `statement timeout observed inside the run: ${run.statementTimeout ?? 'n/a'} (${REFUSED.analyticsReplica}: no analytics replica is provisioned)`],
      fileSuffix: run.datasetCode } };
  }
}
