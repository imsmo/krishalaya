// apps/admin-api/src/modules/demand-map/services/demand-map.service.ts · W108 + W2136–W2140 (PC-56 ADMIN-SWEEP-c3).
//
// ASSEMBLE-OR-REFUSE (the Farmer 360 discipline on a population read): every source is awaited through a namer,
// and a failed read refuses the whole map as 503 with the source named — W108's own error state says "underlying
// marketplaces are unaffected", which is only true if this surface never renders a partial map as complete.
// No view log here: this plane answers questions about POPULATIONS at district grain (the per-person lens is
// Farmer 360's, with its own permission and its access register).
//
// The export is the wave's privacy edge: the k-anonymity floor (domain) is applied BEFORE the digest, so the
// receipt hashes what actually left; the suppressed-cell count rides in the receipt's filters and the watermark
// preamble. Synchronous BY DECISION (ADMIN-10-Q1, third application) — the response says so instead of an ETA.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';
import { buildReceipt, contentDigest, DIGEST_BASIS, watermarkPreamble } from '../../../core/export/receipt';
import { DemandMapRepository, DemandCellRow } from '../repositories/demand-map.repository';
import {
  BASES, DemandRuleError, K_ANONYMITY_FLOOR, assertExportReason, belowFloor, exportFloor, gapVerdict,
  searchInterest, weekWindow, type GapVerdict,
} from '../domain/demand-map';
import { DemandAssemblyFailedError, ExportGrantMissingError, InvalidDemandRequestError } from '../domain/demand-map.errors';

const GAP_LIMIT = 50;

export interface DemandCellView extends DemandCellRow { verdict: GapVerdict; belowFloor: boolean }

@Injectable()
export class DemandMapService {
  constructor(
    private readonly audit: AdminAuditWriter,
    private readonly repo: DemandMapRepository,
  ) {}

  private window(week: string | undefined) {
    try { return weekWindow(week, new Date()); } catch (e) {
      if (e instanceof DemandRuleError) throw new InvalidDemandRequestError(e);
      throw e;
    }
  }

  private async assemble(week: string | undefined) {
    const win = this.window(week);
    const src = async <T,>(name: string, p: Promise<T>): Promise<T> => {
      try { return await p; } catch { throw new DemandAssemblyFailedError(name); }
    };
    const [cells, flow, reqAcct, ordersUnloc] = await Promise.all([
      src('requirements-and-supply', this.repo.cells()),
      src('order-flow', this.repo.orderFlow(win.start, win.end)),
      src('requirements-accounting', this.repo.requirementsAccounting()),
      src('order-accounting', this.repo.ordersUnlocatable(win.start, win.end)),
    ]);
    const districtIds = [...new Set([...cells.map((c) => c.districtId), ...flow.map((f) => f.districtId)])];
    const centroids = await src('districts', this.repo.districtCentroids(districtIds));
    return { win, cells, flow, reqAcct, ordersUnloc, centroids };
  }

  private cellViews(cells: DemandCellRow[]): DemandCellView[] {
    return cells.map((c) => ({ ...c, verdict: gapVerdict(c.demandMinor, c.supplyMinor), belowFloor: belowFloor(c) }));
  }

  /** The page model: intensity by district, the gap list, the honest third column, and every basis. */
  async page(week: string | undefined) {
    const { win, cells, flow, reqAcct, ordersUnloc, centroids } = await this.assemble(week);
    const views = this.cellViews(cells);

    const flowBy = new Map(flow.map((f) => [f.districtId, f]));
    const centroidBy = new Map(centroids.map((c) => [c.id, c]));
    const districts = new Map<string, { districtId: string; districtName: string; demandMinor: bigint; buyersN: number; requirementsN: number }>();
    for (const c of views) {
      const d = districts.get(c.districtId) ?? { districtId: c.districtId, districtName: c.districtName, demandMinor: 0n, buyersN: 0, requirementsN: 0 };
      d.demandMinor += c.demandMinor === null ? 0n : BigInt(c.demandMinor);
      d.buyersN += c.buyersN; d.requirementsN += c.requirementsN;
      districts.set(c.districtId, d);
    }
    for (const f of flow) {
      if (!districts.has(f.districtId)) {
        districts.set(f.districtId, { districtId: f.districtId, districtName: f.districtName, demandMinor: 0n, buyersN: 0, requirementsN: 0 });
      }
    }
    const intensity = [...districts.values()]
      .map((d) => {
        const f = flowBy.get(d.districtId); const c = centroidBy.get(d.districtId);
        return {
          districtId: d.districtId, districtName: d.districtName,
          demandMinor: d.demandMinor.toString(), requirementsN: d.requirementsN,
          orderFlowMinor: f?.flowMinor ?? null, ordersN: f?.ordersN ?? 0,
          centroid: c && c.lat !== null && c.lng !== null ? { lat: Number(c.lat), lng: Number(c.lng) } : null,
        };
      })
      .sort((a, b) => (BigInt(b.demandMinor) > BigInt(a.demandMinor) ? 1 : BigInt(b.demandMinor) < BigInt(a.demandMinor) ? -1 : a.districtName.localeCompare(b.districtName)));

    const gaps = views
      .filter((v) => v.verdict.kind === 'gap')
      .sort((a, b) => {
        const pa = (a.verdict as { pct: number }).pct, pb = (b.verdict as { pct: number }).pct;
        if (pb !== pa) return pb - pa;
        return (BigInt(b.demandMinor ?? '0') > BigInt(a.demandMinor ?? '0') ? 1 : -1);
      });

    return {
      week: { isoWeek: win.isoWeek, start: win.start.toISOString(), end: win.end.toISOString() },
      intensity,
      gaps: gaps.slice(0, GAP_LIMIT),
      gapsTotal: gaps.length,               // a capped list SAYS what it dropped
      cellsTotal: views.length,
      searchInterest: searchInterest(),     // the third source, told as it is
      floor: { k: K_ANONYMITY_FLOOR, basis: `district × product cells with fewer than ${K_ANONYMITY_FLOOR} distinct buyers are marked here and dropped from any export — below that, an aggregate is one buyer's demand wearing a number` },
      accounting: {
        openRequirements: reqAcct.openN,
        categoryOnly: { n: reqAcct.categoryOnlyN, basis: 'open requirements naming only a category, no product row — counted, not mapped into any cell' },
        nonInr: { n: reqAcct.nonInrN, basis: 'open requirements in a currency other than INR — counted, never converted at an invented rate' },
        unlocatable: { n: reqAcct.unlocatableN, basis: 'open requirements whose delivery pincode resolves to no district — counted, never guessed' },
        ordersUnlocatable: { n: ordersUnloc, basis: 'orders in the selected week whose delivery address resolves to no district' },
      },
      bases: BASES,
    };
  }

  /** The audited file: analytics.read let the operator look; analytics.export lets them take it away. */
  async exportCells(actor: AdminRequestContext, dto: { week?: string; reason: string }) {
    if (!hasOwnerPermission(actor.permissions ?? new Set(), OwnerPermissions.AnalyticsExport)) {
      throw new ExportGrantMissingError();
    }
    let reason: string;
    try { reason = assertExportReason(dto.reason); } catch (e) {
      if (e instanceof DemandRuleError) throw new InvalidDemandRequestError(e);
      throw e;
    }
    const { win, cells } = await this.assemble(dto.week);
    const views = this.cellViews(cells);
    const { kept, suppressed } = exportFloor(views);   // BEFORE the digest — the receipt hashes what left

    const columns = ['district', 'product', 'open_requirements', 'distinct_buyers', 'demand_value_minor', 'unvalued_requirements', 'published_listings', 'listed_supply_minor', 'gap_pct'];
    const rows = kept.map((c) => [
      c.districtName, c.productName, c.requirementsN, c.buyersN, c.demandMinor ?? '',
      c.unvaluedN, c.listingsN, c.supplyMinor ?? '',
      c.verdict.kind === 'gap' ? c.verdict.pct : c.verdict.kind === 'covered' ? 0 : '',
    ]);
    const sha = contentDigest(columns, rows);
    const fileName = `demand_map_${win.isoWeek}_${new Date().toISOString().slice(0, 10)}.csv`;
    const filters = { week: win.isoWeek, kFloor: K_ANONYMITY_FLOOR, suppressedCells: suppressed };
    const receiptId = await this.repo.insertReceipt({
      report: 'demand_map', generatedByAdminId: actor.userId, rowCount: rows.length, truncated: false,
      fileName, contentSha256: sha, digestBasis: DIGEST_BASIS, watermarked: true,
      piiMasked: false,     // nothing here identifies a person AFTER the floor; false is the honest value — no masking happened
      filters, objectKey: null, expiresAt: null,
    });
    const receipt = buildReceipt({
      id: receiptId, report: 'demand_map', generatedAt: new Date(), generatedBy: actor.userId,
      columns, rows, truncated: false, fileName, filters, piiMasked: false,
    });
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'analytics.demand_map_exported', entityType: 'report_export_receipt', entityId: receiptId,
      oldValue: null, newValue: { week: win.isoWeek, rowCount: rows.length, suppressedCells: suppressed, contentSha256: sha },
      reason, ip: actor.ip, requestId: actor.requestId || null,
    });
    return {
      receipt, columns, rows,
      suppressed: { cells: suppressed, k: K_ANONYMITY_FLOOR, note: `${suppressed} district × product cell(s) fell below the ${K_ANONYMITY_FLOOR}-buyer floor and are not in this file — DELTA-027's own rule: the floor applies before anything leaves the platform` },
      watermark: watermarkPreamble(receipt),
      delivery: { async: false, queuePosition: null, etaSeconds: null, note: 'generated synchronously (ADMIN-10-Q1: no export queue exists, and a position nothing enqueues into would be a status recording an act nobody performs)' },
    };
  }
}
