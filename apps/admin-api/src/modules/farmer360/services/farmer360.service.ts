// apps/admin-api/src/modules/farmer360/services/farmer360.service.ts · W109 (PC-56 ADMIN-SWEEP-b4).
//
// THE ORDER IS: FIND → RECORD → ASSEMBLE → RETURN, the tenant twin's law (W155) applied to the god-mode realm:
//   • FIND first, so a probe for a nonexistent person leaves no access row (404 is not a view);
//   • RECORD with NO try/catch — a failure to write the access row REFUSES the view ("the VIEW-level access log,
//     not just the export log" is this wave's brief, and a log that can be skipped is a log that will be);
//   • ASSEMBLE with named refusal — every source is awaited individually so the 503 says WHICH read failed, and
//     partial data is NEVER returned as complete;
//   • figures never enter the audit row — the row says a view happened, not what it showed.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';
import { buildReceipt, contentDigest, DIGEST_BASIS, watermarkPreamble } from '../../../core/export/receipt';
import { Farmer360Repository } from '../repositories/farmer360.repository';
import {
  identityView, moneyTile, listedValueMinor, engagementView, disputeView, mergeTimeline, exportRows,
  assertExportReason, Farmer360RuleError, type TimelineItem,
} from '../domain/farmer360';
import {
  FarmerNotFoundError, InvalidFarmer360RequestError, ExportGrantMissingError, ProfileAssemblyFailedError,
} from '../domain/farmer360.errors';

const TIMELINE_LIMIT = 20;

@Injectable()
export class Farmer360Service {
  constructor(
    private readonly audit: AdminAuditWriter,
    private readonly repo: Farmer360Repository,
  ) {}

  async searchFarmers(q: string, limit: number) {
    const rows = await this.repo.search(q, limit);
    // Masked in the RESULTS too — a search page is not a lower court.
    return rows.map((r) => identityView({ ...r, tenants: [] }));
  }

  /** One farmer's derived profile. Assembled at query time; no new tables, no overnight cache. */
  async profile(userId: string, actor: AdminRequestContext) {
    const who = await this.repo.identity(userId);
    if (!who) throw new FarmerNotFoundError();

    // RECORD — before assembly, no try/catch: the ATTEMPT to open a person's whole life is the loggable act, and
    // if this write fails the view is refused with it.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'analytics.farmer360_opened', entityType: 'user', entityId: userId,
      oldValue: null, newValue: { tenants: (who.tenants as string[]).length },   // shape, never figures
      reason: 'farmer 360 view', ip: actor.ip, requestId: actor.requestId || null,
    });

    // ASSEMBLE — each source awaited through a namer, so the refusal says which module read failed (W109's own
    // error state: "one or more module reads failed; partial data is never shown as complete").
    const src = async <T,>(name: string, p: Promise<T>): Promise<T> => {
      try { return await p; } catch { throw new ProfileAssemblyFailedError(name); }
    };
    const [gmv, listings, wallet, dairy, schemes, disputes, activeDays, risk, ro, rl, rb] = await Promise.all([
      src('orders', this.repo.gmv(userId)),
      src('listings', this.repo.publishedListings(userId)),
      src('wallet', this.repo.walletBalance(userId)),
      src('dairy', this.repo.dairyIncome30d(userId)),
      src('schemes', this.repo.schemeBenefitsYtd(userId)),
      src('disputes', this.repo.disputes(userId)),
      src('engagement', this.repo.activeDays30(userId)),
      src('risk', this.repo.riskScore(userId)),
      src('orders', this.repo.recentOrders(userId, 8)),
      src('listings', this.repo.recentListings(userId, 8)),
      src('schemes', this.repo.recentBenefits(userId, 8)),
    ]);

    const listed = listedValueMinor(listings);
    const timeline: TimelineItem[] = mergeTimeline([
      ...ro.map((o: any): TimelineItem => ({ kind: 'order', at: iso(o.at), label: `order ${String(o.id).slice(0, 8)} · ${o.status}`, amountMinor: o.amountMinor, ref: o.id })),
      ...rl.map((l: any): TimelineItem => ({ kind: 'listing', at: iso(l.at), label: `listed: ${l.title ?? ''} · ${l.status}`, amountMinor: l.priceMinor, ref: l.id })),
      ...rb.map((b: any): TimelineItem => ({ kind: 'benefit', at: iso(b.at), label: `benefit credited${b.scheme ? ` · ${b.scheme}` : ''}`, amountMinor: b.amountMinor, ref: b.id })),
    ], TIMELINE_LIMIT);

    return {
      identity: identityView(who),
      gmv: moneyTile(gmv.totalMinor, `sum of ${gmv.n} delivered/completed orders as seller — lifetime`, gmv.n),
      // W109's own catalog note ("stored-stock honesty"): this is stock AS LISTED, not a harvest forecast.
      listed: moneyTile(listed, `Σ price × qty over ${listings.length} published listings — stored stock as listed, not a harvest forecast`, listings.length),
      dairy30d: moneyTile(dairy.totalMinor, dairy.memberships === 0 ? 'no dairy membership exists — unknown, not zero' : `paid milk bills ending in the last 30 days across ${dairy.memberships} membership(s)`, dairy.memberships),
      schemesYtd: moneyTile(schemes.totalMinor, schemes.n === 0 ? 'no DBT credit observed this year — unknown, not zero' : `${schemes.n} DBT credit(s) this calendar year, ${schemes.attributed} attributed to an application`, schemes.n),
      wallet: moneyTile(wallet.balanceMinor, wallet.balanceMinor === null ? 'no wallet account exists' : 'cached main-account balance (read-only; Law 2 untouched)', wallet.balanceMinor === null ? 0 : 1),
      risk,
      engagement: engagementView({ activeDays30: activeDays, lastActiveAt: who.lastActiveAt, languageCode: who.languageCode }),
      disputes: disputeView(disputes),
      timeline,
    };
  }

  /** The audited export: BOTH grants (farmer360 to be here, analytics.export to take a file away), a mandatory
   *  reason, the MASKED profile only, digest + receipt in 0120's append-only register, synchronous BY DECISION
   *  (ADMIN-10-Q1: a queue position nothing enqueues into is a status recording an act nobody performs) — and the
   *  response says so instead of printing an ETA. */
  async exportProfile(userId: string, actor: AdminRequestContext, dto: { reason: string }) {
    if (!hasOwnerPermission(actor.permissions ?? new Set(), OwnerPermissions.AnalyticsExport)) {
      throw new ExportGrantMissingError();
    }
    let reason: string;
    try { reason = assertExportReason(dto.reason); } catch (e) {
      if (e instanceof Farmer360RuleError) throw new InvalidFarmer360RequestError(e);
      throw e;
    }
    const p = await this.profile(userId, actor);   // the view log rides along — an export IS a view, plus a file
    const { columns, rows } = exportRows(p);
    const sha = contentDigest(columns, rows);
    const fileName = `farmer360_${userId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`;
    const receiptId = await this.repo.insertReceipt({
      report: 'farmer360_profile', generatedByAdminId: actor.userId, rowCount: rows.length, truncated: false,
      fileName, contentSha256: sha, digestBasis: DIGEST_BASIS, watermarked: true, piiMasked: true,
      filters: { userId }, objectKey: null, expiresAt: null,
    });
    const receipt = buildReceipt({
      id: receiptId, report: 'farmer360_profile', generatedAt: new Date(), generatedBy: actor.userId,
      columns, rows, truncated: false, fileName, filters: { userId }, piiMasked: true,
    });
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'analytics.farmer360_exported', entityType: 'report_export_receipt', entityId: receiptId,
      oldValue: null, newValue: { userId, rowCount: rows.length, contentSha256: sha },
      reason, ip: actor.ip, requestId: actor.requestId || null,
    });
    return {
      receipt, columns, rows,
      watermark: watermarkPreamble(receipt),
      delivery: { async: false, queuePosition: null, etaSeconds: null, note: 'generated synchronously (ADMIN-10-Q1: no export queue exists, and a position nothing enqueues into would be a status recording an act nobody performs)' },
    };
  }
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? '');
}
