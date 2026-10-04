// modules/logistics/services/cold-chain.service.ts · reefer / cooler / chamber / vaccine-box temperature — PC-55/PC-56, rebuilt in
// PC-56 TENANT-SW-e (F-13 · founder decision DEVICE-AUTHENTICATED INGEST + SERVER BANDS).
//
//   • THE BAND IS THE SERVER'S. `cold_chain_thresholds` is the ONLY source; every reading copies the band in force at write (the
//     database does it — trg_ccl_before). A body never carries a band or a time: the manual route's strict DTO refuses
//     `allowedMinC / allowedMaxC / recordedAt`, a manual reading is recorded at the server's time, and kv_app cannot even name the
//     band columns (0201's column grant).
//   • A DEVICE reading arrives signed on the kv_ingest route (ColdChainIngestService). A BREACH is 2 CONSECUTIVE device readings
//     outside the band — opened by the database in the reading's own transaction (cold_chain_breach_on_reading), closed by the
//     first in-band device reading. A manual reading never opens one; it is labelled `manual`.
//   • W239's playbook: the breach is alerted (ops feed + `logistics.cold_chain_breach`) to the operators named on the organisation's
//     cold-chain rules and the shipment's driver; a SHIPMENT breach out of range ≥ 15 minutes offers the BUYER accept /
//     accept-with-test / reject (the watch job; the decision is the buyer's, recorded on the breach; reject → the dispute path).
//   • W240's acts: acknowledge · record action · record outcome (loss only with a reason). "Median alert → action" is computed over
//     the breaches with both, else refused; "Loss" only where recorded.
//   • REFUSED BY NAME: "both tenants" (no cross-tenant shipment exists), the 15-minute "auto-call" (no voice channel — alerted, not
//     called), the playbook run (no playbook object), and "signed" exports (unsigned — founder-physical key; the sha256 is printed).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { uuidv7 } from '../../../core/database/uuid.util';
import { resolveKek, sealEnvelope } from '../../../core/secrets/secret-envelope';
import { encodeKeyset, KeysetCursor } from '../../../shared/pagination/us-keyset';
import { gateRefusal } from '../../../shared/errors/db-gate';
import { ColdChainLog, ColdChainSubject, excursion } from '../domain/cold-chain-log.entity';
import {
  BreachNotFoundError, ColdChainDeviceNotFoundError, LogisticsOpsRefusedError, ShipmentForbiddenError,
} from '../domain/logistics.errors';
import {
  BREACH_LIST_MONTHS, BUYER_OFFER_AFTER_MINUTES, COLD_CHAIN_SILENCE_MINUTES, REFUSED_BY_NAME, BreachAct, BreachOutcome, BuyerDecision,
  breachActsFor, keyHint, medianAlertToAction, newDeviceKey, recordedLoss,
} from '../domain/logistics-ops';
import { ColdChainLogRepository } from '../repositories/cold-chain-log.repository';
import { BreachRow, ColdChainOpsRepository } from '../repositories/cold-chain-ops.repository';
import { RecordColdChainDto, QueryColdChainDto } from '../dto/cold-chain.dto';
import { FleetActor, encodeFleetCursor } from './logistics-partner.service';
import { DisputeService } from '../../disputes/services/dispute.service';
import { TwinDevicesService } from '../../twin/services/twin-devices.service';

export interface ColdActor { userId: string; canManage: boolean; canManageDevices?: boolean; ip?: string | null }
const DAY = 86_400_000;
const subjectRef = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new LogisticsOpsRefusedError(g.code, g.message, g.code === 'BREACH_DECISION_NOT_BUYER' ? 403 : 409);
  throw e;
}

@Injectable()
export class ColdChainService {
  private readonly log = new Logger(ColdChainService.name);
  private readonly kek: Buffer;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: ColdChainLogRepository,
    private readonly ops: ColdChainOpsRepository,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
    config: AppConfig,
    private readonly disputes: DisputeService,
    private readonly devices: TwinDevicesService,
  ) {
    this.kek = resolveKek(config.webhookSigningKek, config.isProd);   // production without a KEK refuses to start (13a)
  }

  private assertManager(a: FleetActor | ColdActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }

  /* ───────────────────────────── readings ───────────────────────────── */
  /** A MANUAL reading (logistics.manage) at the server's time; the band is the database's copy from the store. */
  async record(tenantId: string, actor: FleetActor, dto: RecordColdChainDto) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.cold_chain_record', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        if (!(await this.ops.subjectKnown(tx, tenantId, dto.subjectType, dto.subjectId))) throw new LogisticsOpsRefusedError('COLD_CHAIN_SUBJECT_UNKNOWN', 'That subject is not this organisation\'s', 422);
        const log = ColdChainLog.manual({ tenantId, subjectType: dto.subjectType, subjectId: dto.subjectId, tempC: dto.tempC, humidityPct: dto.humidityPct ?? null, deviceRef: dto.deviceRef ?? null });
        let w;
        try { w = await this.repo.insertManual(tx, log); } catch (e) { rethrowGate(e); }
        return { id: w.id, subjectType: dto.subjectType, subjectId: dto.subjectId, tempC: dto.tempC, source: w.source, recordedAt: w.recordedAt,
          band: w.bandMinC == null ? null : { minC: w.bandMinC, maxC: w.bandMaxC }, isBreach: w.isBreach,
          // a manual reading is LABELLED: it can show an excursion, it never opens a breach
          label: 'manual' as const, opensBreach: false as const };
      }, { userId: actor.userId }));
  }

  /**
   * APPEND A READING ON BEHALF OF THE MODULE THAT OWNS THE SUBJECT (PC-56 TENANT-6d-1, changed in SW-e).
   *
   * The dairy desk route (`DairyBmcReadingService`, `dairy.manage`) writes a COOLER's temperature. Since SW-e it no longer hands a
   * band across this seam: the cooler's band IS its threshold (0201's trg_bmc_units_threshold appends one every time the band is set
   * on the bmc_units row, and 0201 backfilled every existing cooler), and the database copies it onto the reading like any other.
   * The reading is MANUAL (a person or a gateway with a desk's credentials — not a device-signed reading), recorded at the server's
   * time, and returns the band the database applied so the dairy can show its verdict. Not a public route.
   */
  async appendForOwner(tenantId: string, input: { subjectType: ColdChainSubject; subjectId: string; tempC: number; humidityPct?: number | null; deviceRef?: string | null; byUserId?: string | null }) {
    return timed(this.metrics, 'logistics.cold_chain_append_for_owner', { tenant: tenantId, subject: input.subjectType }, () =>
      this.uow.run(tenantId, async (tx) => {
        const log = ColdChainLog.manual({ tenantId, subjectType: input.subjectType, subjectId: input.subjectId, tempC: input.tempC, humidityPct: input.humidityPct ?? null, deviceRef: input.deviceRef ?? null });
        let w;
        try { w = await this.repo.insertManual(tx, log); } catch (e) { rethrowGate(e); }
        return { id: w.id, subjectType: input.subjectType, subjectId: input.subjectId, tempC: input.tempC, isBreach: w.isBreach, recordedAt: w.recordedAt,
          band: w.bandMinC == null ? null : { minC: w.bandMinC, maxC: w.bandMaxC as number }, source: w.source };
      }, { userId: input.byUserId ?? undefined }));
  }

  async listForSubject(tenantId: string, q: Omit<QueryColdChainDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const rows = await this.repo.listForSubject(tenantId, {
      subjectType: q.subjectType, subjectId: q.subjectId, breachOnly: q.breachOnly,
      since: q.since ? new Date(q.since) : undefined, cursor: q.cursor, limit: q.limit,
    });
    const items = rows.map((l) => this.readingWire(l.toProps()));
    const last = rows[rows.length - 1]?.toProps();
    const nextCursor = rows.length === q.limit && last?.id && last.recordedUs ? encodeFleetCursor(last.recordedUs, last.id) : null;
    return { items, nextCursor };
  }
  private readingWire(p: ReturnType<ColdChainLog['toProps']>) {
    const band = p.bandMinC == null ? null : { minC: p.bandMinC, maxC: p.bandMaxC as number };
    return { id: p.id, subjectType: p.subjectType, subjectId: p.subjectId, tempC: p.tempC, humidityPct: p.humidityPct, deviceRef: p.deviceRef,
      // `isBreach` kept for older readers: it means THIS reading is outside the copied band (an excursion)
      isBreach: p.isBreach, excursion: band ? excursion(p.tempC, band) : null, band, source: p.source ?? 'manual', deviceId: p.deviceId ?? null,
      recordedAt: p.recordedAt, serverRecordedAt: p.serverRecordedAt ?? null, sequenceNo: p.sequenceNo ?? null };
  }

  /** PC-54 W54-12 fleet read (logistics.manage — enforced at the controller like the other reads). */
  deviceFleet(tenantId: string) { return this.repo.deviceFleet(tenantId); }

  /* ───────────────────────────── thresholds (the band's only source) ───────────────────────────── */
  async setThreshold(tenantId: string, a: ColdActor, key: string, dto: { subjectType: ColdChainSubject; subjectId: string; minC: number; maxC: number; reason: string }) {
    this.assertManager(a);
    if (dto.subjectType === 'bmc_unit') throw new LogisticsOpsRefusedError('THRESHOLD_IS_THE_COOLERS', 'A cooler\'s band is set on the cooler (dairy) — it becomes its threshold', 409);
    if (!(dto.minC <= dto.maxC)) throw new LogisticsOpsRefusedError('THRESHOLD_INVERTED', 'The lower bound must not be above the upper bound', 422);
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 10) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters is recorded with a threshold', 422);
    return this.idem.remember(key, a.userId, 'logistics.cold_chain_threshold', () => this.uow.run(tenantId, async (tx) => {
      if (!(await this.ops.subjectKnown(tx, tenantId, dto.subjectType, dto.subjectId))) throw new LogisticsOpsRefusedError('COLD_CHAIN_SUBJECT_UNKNOWN', 'That subject is not this organisation\'s', 422);
      const before = (await this.ops.thresholds(tenantId, dto.subjectType, dto.subjectId, tx))[0] ?? null;
      const id = await this.ops.insertThreshold(tx, { tenantId, subjectType: dto.subjectType, subjectId: dto.subjectId, minC: dto.minC, maxC: dto.maxC, setBy: a.userId, reason });
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.cold_chain_threshold_set', entityType: 'cold_chain_threshold', entityId: id,
        oldValue: before ? { minC: before.minC, maxC: before.maxC } : null, newValue: { subjectType: dto.subjectType, subjectId: dto.subjectId, minC: dto.minC, maxC: dto.maxC }, reason, ip: a.ip ?? null });
      return { id, minC: dto.minC, maxC: dto.maxC };
    }, { userId: a.userId }));
  }

  /* ───────────────────────────── W234 · the subjects ───────────────────────────── */
  async overview(tenantId: string, a: ColdActor) {
    this.assertManager(a);
    const [rows, breaches7d] = await Promise.all([this.ops.subjects(tenantId), this.ops.breachesSince(tenantId, 7)]);
    return {
      breaches7d,
      items: rows.map((r) => ({
        subjectType: r.subjectType, subjectId: r.subjectId, label: r.label ?? `${r.subjectType.toUpperCase().slice(0, 3)}-${subjectRef(r.subjectId)}`,
        now: r.lastTempC == null ? null : { tempC: r.lastTempC, at: r.lastAt, source: r.lastSource },
        target: r.bandMinC == null ? null : { minC: r.bandMinC, maxC: r.bandMaxC },
        device: r.deviceId ? { id: r.deviceId, serial: r.deviceSerial, lastReadingAt: r.deviceLastReadingAt } : null,
        status: this.statusOf(r),
      })),
      silenceMinutes: COLD_CHAIN_SILENCE_MINUTES,
      refused: { autoCall: REFUSED_BY_NAME.autoCall, signedExport: REFUSED_BY_NAME.signedExport },
    };
  }
  private statusOf(r: { bandMinC: string | null; lastTempC: string | null; lastExcursion: boolean | null; openBreachId: string | null; openSilence: boolean }) {
    if (r.openBreachId) return 'breach_open' as const;
    if (r.openSilence) return 'silent' as const;
    if (r.bandMinC == null) return 'no_threshold' as const;
    if (r.lastTempC == null) return 'no_reading' as const;
    return r.lastExcursion ? 'excursion' as const : 'in_range' as const;
  }

  /* ───────────────────────────── W239 · one subject ───────────────────────────── */
  async subject(tenantId: string, a: ColdActor, subjectType: ColdChainSubject, subjectId: string, q: { hours: number; cursor?: { c: string; id: string }; limit: number }) {
    this.assertManager(a);
    const since = new Date(Date.now() - q.hours * 3_600_000);
    const [trail, thresholds, breaches, overview] = await Promise.all([
      this.listForSubject(tenantId, { subjectType, subjectId, breachOnly: false, since: since.toISOString(), cursor: q.cursor, limit: q.limit }),
      this.ops.thresholds(tenantId, subjectType, subjectId),
      this.ops.breaches(tenantId, { since: new Date(Date.now() - 400 * DAY), subjectType, subjectId, limit: 50 }),
      this.ops.subjects(tenantId, 500),
    ]);
    const me = overview.find((r) => r.subjectType === subjectType && r.subjectId === subjectId) ?? null;
    return {
      subjectType, subjectId, label: me?.label ?? `${subjectType.toUpperCase().slice(0, 3)}-${subjectRef(subjectId)}`,
      status: me ? this.statusOf(me) : 'no_reading', windowHours: q.hours,
      band: thresholds[0] ?? null, bandHistory: thresholds,
      device: me?.deviceId ? { id: me.deviceId, serial: me.deviceSerial, lastReadingAt: me.deviceLastReadingAt } : null,
      trail: trail.items, nextCursor: trail.nextCursor,
      breaches: breaches.map((b) => this.breachWire(b, a)),
      playbook: { rule: 'two_consecutive_device_readings', manualNeverOpens: true, buyerOfferAfterMinutes: BUYER_OFFER_AFTER_MINUTES, silenceMinutes: COLD_CHAIN_SILENCE_MINUTES,
        alerted: 'operators named on the cold-chain alert rules, and the shipment\'s driver' },
      refused: { bothTenants: REFUSED_BY_NAME.bothTenants, autoCall: REFUSED_BY_NAME.autoCall, playbookRun: REFUSED_BY_NAME.playbookRun, signedExport: REFUSED_BY_NAME.signedExport },
      retentionMonths: 24,
    };
  }

  /* ───────────────────────────── W240 · breaches ───────────────────────────── */
  async breaches(tenantId: string, a: ColdActor, q: { hours?: number; cursor?: KeysetCursor; limit: number }) {
    this.assertManager(a);
    const since = q.hours ? new Date(Date.now() - Math.min(q.hours, 24 * 400) * 3_600_000) : new Date(Date.now() - BREACH_LIST_MONTHS * 30.4375 * DAY);
    const [rows, window] = await Promise.all([this.ops.breaches(tenantId, { since, cursor: q.cursor, limit: q.limit }), this.ops.breachWindow(tenantId, since)]);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((b) => this.breachWire(b, a)),
      nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.id) : null,
      window: { since: since.toISOString(), months: q.hours ? null : BREACH_LIST_MONTHS, hours: q.hours ?? null, count: window.count, open: window.open,
        medianAlertToAction: medianAlertToAction(window.pairs), loss: recordedLoss(window.losses) },
      refused: { playbookRun: REFUSED_BY_NAME.playbookRun, signedExport: REFUSED_BY_NAME.signedExport },
    };
  }
  async breach(tenantId: string, a: ColdActor, id: string) {
    this.assertManager(a);
    const b = await this.ops.breach(tenantId, id);
    if (!b) throw new BreachNotFoundError(id);
    return this.breachWire(b, a);
  }
  private breachWire(b: BreachRow, _a?: ColdActor) {
    return {
      id: b.id, subjectType: b.subjectType, subjectId: b.subjectId, subjectRef: subjectRef(b.subjectId), device: b.deviceId ? { id: b.deviceId, serial: b.deviceSerial } : null,
      band: { minC: b.bandMinC, maxC: b.bandMaxC }, direction: b.direction, peakC: b.peakC, readingsOut: b.readingsOut,
      firstOutAt: b.firstOutAt, openedAt: b.openedAt, closedAt: b.closedAt, durationSeconds: b.durationSeconds,
      alert: { state: b.alertState, recipients: b.alertRecipients, id: b.alertId },
      acknowledgedAt: b.acknowledgedAt, actionAt: b.actionAt, actionNote: b.actionNote, outcome: b.outcome, outcomeAt: b.outcomeAt, outcomeReason: b.outcomeReason,
      loss: b.lossMinor ? { minor: b.lossMinor, currency: b.lossCurrency } : null,
      buyer: { offerState: b.buyerOfferState, offeredAt: b.buyerOfferedAt, decision: b.buyerDecision, decidedAt: b.buyerDecidedAt, reason: b.buyerDecisionReason, disputeId: b.disputeId },
      playbookRun: { kind: 'refused' as const, code: REFUSED_BY_NAME.playbookRun },
      acts: breachActsFor({ acknowledgedAt: b.acknowledgedAt, actionAt: b.actionAt, outcome: b.outcome, closedAt: b.closedAt }),
      // older readers of GET /cold-chain/breaches (web-ops) read these four
      tempC: b.peakC, recordedAt: b.openedAt, deviceRef: b.deviceSerial,
    };
  }

  /** W2536–W2538: acknowledge · record action · record outcome (loss only with a reason). Each once; the database is the wall. */
  async act(tenantId: string, a: ColdActor, id: string, key: string, act: BreachAct, dto: { note?: string; outcome?: BreachOutcome; reason?: string; lossMinor?: string | null; lossCurrency?: string | null }) {
    this.assertManager(a);
    return this.idem.remember(key, a.userId, `logistics.breach_${act}`, () => this.uow.run(tenantId, async (tx) => {
      const b = await this.ops.breach(tenantId, id, tx, true);
      if (!b) throw new BreachNotFoundError(id);
      try {
        if (act === 'acknowledge') await this.ops.acknowledge(tx, tenantId, id, a.userId);
        else if (act === 'record_action') {
          const note = (dto.note ?? '').trim();
          if (note.length < 10) throw new LogisticsOpsRefusedError('ACTION_NOTE_REQUIRED', 'Say what was done, in at least 10 characters', 422);
          await this.ops.recordAction(tx, tenantId, id, a.userId, note);
        } else {
          const reason = (dto.reason ?? '').trim();
          if (!dto.outcome) throw new LogisticsOpsRefusedError('OUTCOME_REQUIRED', 'Name the outcome', 422);
          if (reason.length < 10) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'An outcome is recorded with a reason of at least 10 characters', 422);
          if (dto.outcome === 'loss_recorded' && (!dto.lossMinor || !/^[1-9]\d{0,14}$/.test(dto.lossMinor) || !dto.lossCurrency)) {
            throw new LogisticsOpsRefusedError('LOSS_AMOUNT_REQUIRED', 'A recorded loss names its amount and currency', 422);
          }
          if (dto.outcome !== 'loss_recorded' && dto.lossMinor) throw new LogisticsOpsRefusedError('LOSS_ONLY_WITH_LOSS_OUTCOME', 'A loss is recorded only with the loss outcome', 422);
          await this.ops.recordOutcome(tx, tenantId, id, { by: a.userId, outcome: dto.outcome, reason, lossMinor: dto.outcome === 'loss_recorded' ? dto.lossMinor ?? null : null, lossCurrency: dto.outcome === 'loss_recorded' ? dto.lossCurrency ?? null : null });
        }
      } catch (e) { if (e instanceof LogisticsOpsRefusedError) throw e; rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: `logistics.cold_chain_breach_${act}`, entityType: 'cold_chain_breach', entityId: id,
        oldValue: { acknowledgedAt: b.acknowledgedAt, actionAt: b.actionAt, outcome: b.outcome }, newValue: { act, outcome: dto.outcome ?? null, lossMinor: dto.lossMinor ?? null },
        reason: act === 'record_action' ? (dto.note ?? null) : act === 'record_outcome' ? (dto.reason ?? null) : null, ip: a.ip ?? null });
      return { id, act };
    }, { userId: a.userId }));
  }

  /* ───────────────────────────── the buyer (their app) ───────────────────────────── */
  async buyerOffers(tenantId: string, userId: string) {
    const rows = await this.ops.buyerOffers(tenantId, userId);
    return { items: rows.map((b) => ({ id: b.id, subjectRef: subjectRef(b.subjectId), band: { minC: b.bandMinC, maxC: b.bandMaxC }, peakC: b.peakC, firstOutAt: b.firstOutAt,
      closedAt: b.closedAt, offerState: b.buyerOfferState, decision: b.buyerDecision, decidedAt: b.buyerDecidedAt, disputeId: b.disputeId })) };
  }
  async decide(tenantId: string, userId: string, id: string, key: string, decision: BuyerDecision, reasonRaw?: string | null) {
    const reason = (reasonRaw ?? '').trim() || null;
    if (decision === 'reject' && (!reason || reason.length < 10)) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A rejection says why, in at least 10 characters', 422);
    return this.idem.remember(key, userId, 'logistics.breach_buyer_decision', () => this.uow.run(tenantId, async (tx) => {
      const b = await this.ops.breach(tenantId, id, tx, true);
      if (!b) throw new BreachNotFoundError(id);
      if (b.buyerUserId !== userId) throw new LogisticsOpsRefusedError('BREACH_DECISION_NOT_BUYER', 'Only the buyer decides on the offer', 403);
      if (b.buyerOfferState !== 'offered') throw new LogisticsOpsRefusedError('BREACH_OFFER_MOVE', `This offer is ${b.buyerOfferState}`, 409);
      let disputeId: string | null = null;
      if (decision === 'reject') {
        const sb = await this.ops.shipmentBuyer(tx, tenantId, b.subjectId);
        if (sb) disputeId = (await this.disputes.openFromColdChainBreachInTx(tx, { tenantId, orderId: sb.orderId, buyerUserId: userId, breachId: id,
          description: `Cold-chain breach ${subjectRef(b.subjectId)}: ${b.peakC} °C outside ${b.bandMinC}–${b.bandMaxC} °C. ${reason ?? ''}`.trim() }))?.id ?? null;
      }
      try { await this.ops.decide(tx, tenantId, id, { decision, reason, disputeId }); } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'logistics.cold_chain_buyer_decided', entityType: 'cold_chain_breach', entityId: id,
        oldValue: { offerState: 'offered' }, newValue: { decision, disputeId, dispute: decision === 'reject' ? (disputeId ? 'opened' : 'not_yet_eligible') : 'not_applicable' }, reason });
      return { id, decision, disputeId, dispute: decision === 'reject' ? (disputeId ? 'opened' as const : 'not_yet_eligible' as const) : 'not_applicable' as const };
    }, { userId }));
  }

  /* ───────────────────────────── loggers + keys (logistics.devices.manage) ───────────────────────────── */
  async loggers(tenantId: string, a: ColdActor) {
    this.assertManager(a);
    return { items: await this.ops.loggers(tenantId), silences: await this.ops.silences(tenantId), silenceMinutes: COLD_CHAIN_SILENCE_MINUTES };
  }
  async registerLogger(tenantId: string, a: ColdActor, key: string, dto: { serial: string; label?: string | null }) {
    if (!a.canManageDevices) throw new ShipmentForbiddenError('requires logistics.devices.manage');
    return this.devices.registerColdChainLogger(tenantId, { userId: a.userId, ip: a.ip ?? null }, key, dto);
  }
  /**
   * Issue the logger's signing key, bound to the subject it is mounted on. The key is SHOWN ONCE: it is returned in THIS response
   * only — the idempotency record keeps the response WITHOUT it (a replay answers `key: null`) — and stored sealed (13a's envelope,
   * additional data `device_key:<id>`). Issuing revokes the previous key in the same transaction. Never logged, never audited.
   */
  async issueKey(tenantId: string, a: ColdActor, deviceId: string, idemKey: string, dto: { subjectType: ColdChainSubject; subjectId: string; reason: string }) {
    if (!a.canManageDevices) throw new ShipmentForbiddenError('requires logistics.devices.manage');
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 10) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters is recorded with a key', 422);
    let plaintext: string | null = null;
    const out = await this.idem.remember(idemKey, a.userId, 'logistics.device_key_issue', () => this.uow.run(tenantId, async (tx) => {
      const d = await this.ops.logger(tx, tenantId, deviceId);
      if (!d || d.kind !== 'cold_chain_logger') throw new ColdChainDeviceNotFoundError(deviceId);
      if (!(await this.ops.subjectKnown(tx, tenantId, dto.subjectType, dto.subjectId))) throw new LogisticsOpsRefusedError('COLD_CHAIN_SUBJECT_UNKNOWN', 'That subject is not this organisation\'s', 422);
      const previous = await this.ops.revokeActiveKey(tx, tenantId, deviceId, a.userId, `superseded by a new key: ${reason}`.slice(0, 500));
      const id = uuidv7();
      const key = newDeviceKey();
      try {
        await this.ops.insertKey(tx, { id, tenantId, deviceId, subjectType: dto.subjectType, subjectId: dto.subjectId, keyEnc: sealEnvelope(this.kek, key, `device_key:${id}`), hint: keyHint(key), issuedBy: a.userId, reason });
      } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.device_key_issued', entityType: 'device_key', entityId: id,
        oldValue: previous ? { revokedKeyId: previous } : null, newValue: { deviceId, subjectType: dto.subjectType, subjectId: dto.subjectId, hint: keyHint(key) }, reason, ip: a.ip ?? null });
      plaintext = key;
      return { id, deviceId, hint: keyHint(key), subjectType: dto.subjectType, subjectId: dto.subjectId, revokedKeyId: previous, key: null as string | null, keyShown: false };
    }, { userId: a.userId }));
    return plaintext ? { ...out, key: plaintext, keyShown: true } : out;
  }
  async revokeKey(tenantId: string, a: ColdActor, deviceId: string, idemKey: string, reasonRaw: string) {
    if (!a.canManageDevices) throw new ShipmentForbiddenError('requires logistics.devices.manage');
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < 10) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters is recorded with a revocation', 422);
    return this.idem.remember(idemKey, a.userId, 'logistics.device_key_revoke', () => this.uow.run(tenantId, async (tx) => {
      const id = await this.ops.revokeActiveKey(tx, tenantId, deviceId, a.userId, reason);
      if (!id) throw new LogisticsOpsRefusedError('DEVICE_KEY_NONE_ACTIVE', 'This logger has no active key', 409);
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.device_key_revoked', entityType: 'device_key', entityId: id, newValue: { deviceId, status: 'revoked' }, reason, ip: a.ip ?? null });
      return { id, status: 'revoked' as const };
    }, { userId: a.userId }));
  }

  /* ───────────────────────────── the watch (registered job, kv_app UoW per tenant) ───────────────────────────── */
  /**
   * (1) A logger with an active key silent for more than 15 minutes is flagged ONCE per silence and ALERTED (ops feed + notification)
   * to the operators — "alerted, not called" (no voice channel). (2) A SHIPMENT breach out of range ≥ 15 minutes OFFERS the buyer
   * accept / accept-with-test / reject (the trigger refuses an early offer). Both idempotent: a second tick finds nothing new.
   */
  async watchTenant(tenantId: string): Promise<{ silences: number; offers: number }> {
    return this.uow.run(tenantId, async (tx) => {
      let silences = 0, offers = 0;
      const silent = await this.ops.silentLoggers(tx, tenantId, COLD_CHAIN_SILENCE_MINUTES);
      if (silent.length) {
        const recipients = await this.ops.silenceRecipients(tx, tenantId);
        for (const s of silent) {
          const id = uuidv7(); const alertId = uuidv7();
          await this.ops.insertSilence(tx, { id, tenantId, deviceId: s.deviceId, subjectType: s.subjectType, subjectId: s.subjectId, lastReadingAt: s.lastReadingAt, alertId, recipients });
          await this.ops.insertFiredAlert(tx, { id: alertId, tenantId, kind: 'device_silent', severity: 'warning', subjectType: 'device', subjectRef: s.serial,
            detail: { silenceId: id, deviceId: s.deviceId, lastReadingAt: s.lastReadingAt, thresholdMinutes: COLD_CHAIN_SILENCE_MINUTES, called: false, why: REFUSED_BY_NAME.autoCall },
            recipients, dedupeKey: `cold_chain_silence:${id}` });
          if (recipients.length) {
            await this.outbox.write(tx, { tenantId, aggregateType: 'cold_chain_device_silence', aggregateId: id, eventType: 'logistics.cold_chain_device_silent',
              payload: { v: 1, silenceId: id, deviceSerial: s.serial, subjectRef: subjectRef(s.subjectId), minutes: String(COLD_CHAIN_SILENCE_MINUTES), lastReadingAt: s.lastReadingAt, recipientUserIds: recipients } });
          }
          silences++;
        }
      }
      for (const b of await this.ops.offersDue(tx, tenantId, BUYER_OFFER_AFTER_MINUTES)) {
        const buyer = await this.ops.shipmentBuyer(tx, tenantId, b.subjectId);
        if (!buyer) continue;
        if ((await this.ops.offer(tx, tenantId, b.id, buyer.buyerUserId)) === 0) continue;
        await this.outbox.write(tx, { tenantId, aggregateType: 'cold_chain_breach', aggregateId: b.id, eventType: 'logistics.cold_chain_buyer_offer',
          payload: { v: 1, breachId: b.id, subjectRef: subjectRef(b.subjectId), peakC: b.peakC, bandMinC: b.bandMinC, bandMaxC: b.bandMaxC, minutes: String(BUYER_OFFER_AFTER_MINUTES), recipientUserIds: [buyer.buyerUserId] } });
        offers++;
      }
      return { silences, offers };
    }, { userId: 'system' }).catch((e) => { this.log.error(`cold-chain watch failed for ${tenantId}: ${(e as Error).message}`); throw e; });
  }
}
