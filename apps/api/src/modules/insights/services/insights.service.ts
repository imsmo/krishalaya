// modules/insights/services/insights.service.ts · PC-56 TENANT-SW-f — W193 mandi pulse (member crops), W194 demand map, W195 wastage.
//
// Every figure here is READ (the repository) and returned WITH its method code; every figure the platform has no fact for is returned
// as `{ kind: 'refused', code }`. The method / refusal sentences come from `ui_messages` (seed 0029, en / hi / gu) and fall back to the
// domain's English, so a missing seed is a sentence in English, never a blank. The one write is the wastage RE-RUN (idempotent, audited,
// facts only); a typed loss is refused by name.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import {
  METHODS, MethodCode, REFUSED, REFUSAL_SENTENCES, InsightsRefusal, InsightsRefusedError, Refused, refused, istWeekStart, thousandths, fromThousandths,
  stockFit, demandValue, reachOf, measuredLoss, lossShareOfGmv, WASTAGE_WINDOW_DAYS, WASTAGE_RERUN_REASON_MIN, encodeUsCursor, decodeUsCursor,
} from '../domain/insights';
import { InsightsRepository, MandiRow } from '../repositories/insights.repository';

export interface InsightsActor { userId: string; ip?: string | null }

/** Δ against the same mandi's previous earlier day, basis points truncated toward zero (market-intel's `dayOverDayChange` rule). */
export function modalChange(m: Pick<MandiRow, 'modalMinor' | 'prevModalMinor' | 'prevDate'>): { previousDate: string; previousModalMinor: string; changeMinor: string; changeBps: number } | null {
  if (!m.prevModalMinor || !m.prevDate) return null;
  const prev = BigInt(m.prevModalMinor); if (prev === 0n) return null;
  const diff = BigInt(m.modalMinor) - prev;
  return { previousDate: m.prevDate, previousModalMinor: prev.toString(), changeMinor: diff.toString(), changeBps: Number((diff * 10000n) / prev) };
}

@Injectable()
export class InsightsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly repo: InsightsRepository,
    private readonly ui: UiMessageRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** Method sentences (en / hi / gu) for these codes, from ui_messages; the domain's English when a row is missing. */
  async methods(codes: readonly MethodCode[]): Promise<Record<string, LangMap>> {
    const all = await this.ui.mapsUnder('insights.method.').catch(() => new Map<string, LangMap>());
    return Object.fromEntries(codes.map((c) => [c, all.get(`insights.method.${c}`) ?? { en: METHODS[c] }]));
  }
  async refusals(codes: readonly InsightsRefusal[]): Promise<Record<string, LangMap>> {
    const all = await this.ui.mapsUnder('insights.refusal.').catch(() => new Map<string, LangMap>());
    return Object.fromEntries(codes.map((c) => [c, all.get(`insights.refusal.${c}`) ?? { en: REFUSAL_SENTENCES[c] }]));
  }

  /* ════════════════════════════════════ W193 · mandi pulse — your crops ════════════════════════════════════ */
  async memberPulse(tenantId: string, q: { cursor?: string; limit?: number }, now = new Date()) {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const crops = await this.repo.memberCrops(tenantId);
    const after = q.cursor ? Buffer.from(q.cursor, 'base64url').toString('utf8') : null;     // `<crop>|<productId>` keyset over the sorted filter
    const key = (c: { crop: string; productId: string }) => `${c.crop}|${c.productId}`;
    const rest = after ? crops.filter((c) => key(c) > after) : crops;
    const page = rest.slice(0, limit);
    const ids = page.map((c) => c.productId);
    const [modals, stock, alerts] = await Promise.all([this.repo.latestModals(tenantId, ids), this.repo.listedStock(tenantId), this.repo.alerts(tenantId, istWeekStart(now))]);
    const items = page.map((c) => ({
      productId: c.productId, crop: c.crop, listed: c.listed, declared: c.declared,
      listedStock: stock.filter((s) => s.productId === c.productId).map((s) => ({ unit: s.unit, quantity: fromThousandths(thousandths(s.quantity)), listings: s.listings })),
      mandis: modals.filter((m) => m.productId === c.productId).map((m) => ({ mandiId: m.mandiId, mandi: m.mandi, priceDate: m.priceDate, modalMinor: m.modalMinor,
        currency: m.currency, unit: m.unit, change: modalChange(m) })),
    }));
    const last = page[page.length - 1];
    return {
      asOf: now.toISOString(), zone: 'Asia/Kolkata',
      cropsTracked: { count: crops.length, fromListings: crops.filter((c) => c.listed).length, fromSeasons: crops.filter((c) => c.declared).length, method: 'member_crops' },
      alerts: { active: alerts.active, firedThisWeek: alerts.fired, weekStart: istWeekStart(now).toISOString(), methods: ['alerts_active', 'alerts_fired'] },
      storedStock: refused(REFUSED.storedStock), soldOnAlert: refused(REFUSED.soldOnAlert), band: refused(REFUSED.aiBand),
      crops: { items, nextCursor: rest.length > limit && last ? Buffer.from(key(last), 'utf8').toString('base64url') : null },
      methods: await this.methods(['member_crops', 'mandi_modal', 'listed_stock', 'alerts_active', 'alerts_fired']),
      refusals: await this.refusals([REFUSED.storedStock, REFUSED.soldOnAlert, REFUSED.aiBand]),
    };
  }

  /* ════════════════════════════════════ W194 · demand map ════════════════════════════════════ */
  async demandMap(tenantId: string, q: { cursor?: string; limit?: number; reach?: 'all' | 'districts' }, now = new Date()) {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const districts = new Set(await this.repo.tenantDistricts(tenantId));
    const reachAvailable = districts.size > 0;
    const wantReach = q.reach === 'districts' && reachAvailable;
    // the reach filter is a REAL filter: read pages until the page is full of in-reach rows (bounded — never an unbounded scan)
    const out: Array<Record<string, unknown>> = [];
    let cursor = decodeUsCursor(q.cursor);
    let next: string | null = null;
    for (let guard = 0; guard < 20 && out.length < limit; guard++) {
      const rows = await this.repo.openRequirements(tenantId, cursor, limit);
      const more = rows.length > limit; const page = rows.slice(0, limit);
      if (page.length === 0) { next = null; break; }
      const ids = page.map((r) => r.id);
      const [stock, consents, reqDistricts] = await Promise.all([
        this.repo.sellerStock(tenantId, page.map((r) => r.productId).filter((x): x is string => !!x), page.map((r) => r.categoryId).filter((x): x is string => !!x)),
        this.repo.quoteConsents(tenantId, ids), this.repo.requirementDistricts(tenantId, ids)]);
      for (const [idx, r] of page.entries()) {
        const reach = reachAvailable ? reachOf(reqDistricts.get(r.id) ?? null, districts) : null;
        cursor = { us: r.createdUs, id: r.id };
        if (wantReach && reach !== 'in_reach') continue;
        const wanted = thousandths(r.quantity) - thousandths(r.fulfilled);
        const wantedT = wanted > 0n ? wanted : 0n;
        const basis = r.productId ? 'product' : 'category';
        const own = stock.filter((s) => s.unit === r.unit && s.sellerUserId !== r.buyerUserId && (r.productId ? s.productId === r.productId : s.categoryId === r.categoryId));
        const listed = own.reduce((a, s) => a + thousandths(s.quantity), 0n);
        const v = demandValue(fromThousandths(wantedT), r.budgetMinMinor, r.budgetMaxMinor);
        out.push({
          id: r.id, reqNo: r.reqNo, title: r.title, crop: r.crop, basis, needBy: r.needBy, status: r.status,
          wanted: { quantity: fromThousandths(wantedT), unit: r.unit },
          stock: { quantity: fromThousandths(listed), unit: r.unit, fit: stockFit(wantedT, listed), sellers: new Set(own.map((s) => s.sellerUserId)).size },
          value: v.kind === 'value' ? { ...v, currency: r.currency } : v,
          reach: reach ?? refused(REFUSED.geoReach),
          consented: consents.filter((c) => c.requirementId === r.id).map((c) => ({ memberName: c.memberName, quantity: c.quantity, priceMinor: c.priceMinor, unit: c.unit, recordedAt: c.recordedAt })),
        });
        if (out.length >= limit) { next = (idx < page.length - 1 || more) ? encodeUsCursor(r.createdUs, r.id) : null; break; }
      }
      if (out.length >= limit) break;
      if (!more) { next = null; break; }
      next = cursor ? encodeUsCursor(cursor.us, cursor.id) : null;
    }
    return {
      asOf: now.toISOString(), items: out, nextCursor: next,
      reach: reachAvailable ? { kind: 'filter', districts: districts.size, applied: wantReach } : refused(REFUSED.geoReach),
      unmetDemand: refused(REFUSED.unmetDemand),
      privacy: 'aggregates_until_consent',
      methods: await this.methods(['qty_wanted', 'stock_fit', 'demand_value', 'geo_reach']),
      refusals: await this.refusals([REFUSED.demandValue, REFUSED.geoReach, REFUSED.unmetDemand]),
    };
  }

  /* ════════════════════════════════════ W195 · wastage ════════════════════════════════════ */
  async wastage(tenantId: string, now = new Date()) {
    const [lines, sources, gmv] = await Promise.all([this.repo.lossLines(tenantId, WASTAGE_WINDOW_DAYS), this.repo.sourceCounts(tenantId, WASTAGE_WINDOW_DAYS), this.repo.gmvWindow(tenantId, WASTAGE_WINDOW_DAYS)]);
    const loss = measuredLoss(lines);
    return {
      asOf: now.toISOString(), window: { days: WASTAGE_WINDOW_DAYS, from: new Date(now.getTime() - WASTAGE_WINDOW_DAYS * 86_400_000).toISOString() },
      loss, share: lossShareOfGmv(loss, gmv), gmv, sources,
      refused: { externalStatistic: refused(REFUSED.externalStatistic), savedMoney: refused(REFUSED.savedMoney), weighbridge: refused(REFUSED.weighbridge), manualEntry: refused(REFUSED.manualWastage) },
      methods: await this.methods(['measured_loss', 'loss_share', 'loss_split']),
      refusals: await this.refusals([REFUSED.externalStatistic, REFUSED.savedMoney, REFUSED.weighbridge, REFUSED.manualWastage]),
    };
  }

  async wastageEvents(tenantId: string, q: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const rows = await this.repo.wastageEvents(tenantId, decodeUsCursor(q.cursor), limit, WASTAGE_WINDOW_DAYS);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { items: page, nextCursor: rows.length > limit && last ? encodeUsCursor(last.occurredUs, last.id) : null };
  }

  /** W2826–W2828: "re-run backfill" — every qualifying source row through the database writer (idempotent), audited with its reason. */
  async rerunWastage(tenantId: string, actor: InsightsActor, idemKey: string, reasonRaw: string) {
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < WASTAGE_RERUN_REASON_MIN) throw new InsightsRefusedError('REASON_REQUIRED', `Say why, in at least ${WASTAGE_RERUN_REASON_MIN} characters`, 422);
    return this.idem.remember(idemKey, actor.userId, 'insights.wastage_rerun', () => this.uow.run(tenantId, async (tx) => {
      const counts = await this.repo.backfill(tx, tenantId, 'rerun', actor.userId);
      const written = counts.reduce((a, c) => a + c.written, 0); const existing = counts.reduce((a, c) => a + c.existing, 0);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'insights.wastage_rerun', entityType: 'wastage_events', entityId: null,
        newValue: { counts, written, existing }, reason, ip: actor.ip ?? null });
      return { counts, written, existing };
    }, { userId: actor.userId }));
  }

  /** W2826 "record a manual wastage event": REFUSED BY NAME — facts only (founder). */
  manualWastage(): never {
    throw new InsightsRefusedError(REFUSED.manualWastage, REFUSAL_SENTENCES[REFUSED.manualWastage], 422);
  }
}

export type { Refused };
