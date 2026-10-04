// modules/logistics/repositories/cold-chain-ops.repository.ts · PC-56 TENANT-SW-e · W234 / W239 / W240 — the threshold store, the
// monitored subjects, breaches and their acts, the cold-chain loggers (12's registry) and their keys, and the silence watch.
// tenant_id in every query (Law 1) + RLS (0175 split). Keysets are microsecond-exact (F-14). kv_app never reads `device_keys.key_enc`
// (0201's column grant) — only the kv_ingest lookup function returns it.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const n = (v: unknown) => (v == null ? null : String(v));

export interface ThresholdRow { id: string; minC: string; maxC: string; setBy: string | null; reason: string; effectiveFrom: string; createdAt: string }
export interface SubjectRow {
  subjectType: string; subjectId: string; label: string | null;
  lastTempC: string | null; lastAt: string | null; lastSource: string | null; lastExcursion: boolean | null;
  bandMinC: string | null; bandMaxC: string | null;
  deviceId: string | null; deviceSerial: string | null; deviceLastReadingAt: string | null;
  openBreachId: string | null; openSilence: boolean;
}
export interface BreachRow {
  id: string; subjectType: string; subjectId: string; deviceId: string | null; deviceSerial: string | null; bandMinC: string; bandMaxC: string; direction: string;
  firstOutAt: string; openedAt: string; peakC: string; readingsOut: number; lastOutAt: string; closedAt: string | null; durationSeconds: number | null;
  alertId: string | null; alertState: string; alertRecipients: number; acknowledgedAt: string | null; acknowledgedBy: string | null;
  actionAt: string | null; actionBy: string | null; actionNote: string | null; outcome: string | null; outcomeAt: string | null; outcomeReason: string | null;
  lossMinor: string | null; lossCurrency: string | null; buyerUserId: string | null; buyerOfferState: string; buyerOfferedAt: string | null;
  buyerDecision: string | null; buyerDecidedAt: string | null; buyerDecisionReason: string | null; disputeId: string | null; createdAt: string; createdUs: string;
}
function toBreach(x: any): BreachRow {
  return { id: x.id, subjectType: x.subject_type, subjectId: x.subject_id, deviceId: x.device_id ?? null, deviceSerial: x.device_serial ?? null,
    bandMinC: String(x.band_min_c), bandMaxC: String(x.band_max_c), direction: x.direction, firstOutAt: iso(x.first_out_at) as string, openedAt: iso(x.opened_at) as string,
    peakC: String(x.peak_c), readingsOut: Number(x.readings_out), lastOutAt: iso(x.last_out_at) as string, closedAt: iso(x.closed_at),
    durationSeconds: x.duration_seconds == null ? null : Number(x.duration_seconds), alertId: x.alert_id ?? null, alertState: x.alert_state, alertRecipients: Number(x.alert_recipients),
    acknowledgedAt: iso(x.acknowledged_at), acknowledgedBy: x.acknowledged_by ?? null, actionAt: iso(x.action_at), actionBy: x.action_by ?? null, actionNote: x.action_note ?? null,
    outcome: x.outcome ?? null, outcomeAt: iso(x.outcome_at), outcomeReason: x.outcome_reason ?? null, lossMinor: n(x.loss_minor), lossCurrency: x.loss_currency ?? null,
    buyerUserId: x.buyer_user_id ?? null, buyerOfferState: x.buyer_offer_state, buyerOfferedAt: iso(x.buyer_offered_at), buyerDecision: x.buyer_decision ?? null,
    buyerDecidedAt: iso(x.buyer_decided_at), buyerDecisionReason: x.buyer_decision_reason ?? null, disputeId: x.dispute_id ?? null,
    createdAt: iso(x.created_at) as string, createdUs: x.created_us };
}
const B_COLS = `b.*, ${US_SQL('b.created_at')} AS created_us, d.serial AS device_serial`;

export interface LoggerRow {
  deviceId: string; serial: string; label: string | null; status: string; registeredAt: string; lastReadingAt: string | null;
  key: { id: string; hint: string; subjectType: string; subjectId: string; issuedAt: string; issuedBy: string } | null;
}

@Injectable()
export class ColdChainOpsRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private db(tenantId: string, tx?: SqlExecutor): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ── thresholds ── */
  async insertThreshold(tx: TxContext, t: { tenantId: string; subjectType: string; subjectId: string; minC: number; maxC: number; setBy: string; reason: string }): Promise<string> {
    const r = await tx.query(
      `INSERT INTO cold_chain_thresholds (tenant_id, subject_type, subject_id, min_c, max_c, set_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [t.tenantId, t.subjectType, t.subjectId, t.minC, t.maxC, t.setBy, t.reason]);
    return (r.rows[0] as { id: string }).id;
  }
  async thresholds(tenantId: string, subjectType: string, subjectId: string, tx?: SqlExecutor): Promise<ThresholdRow[]> {
    const r = await this.db(tenantId, tx).query(
      `SELECT id, min_c::text, max_c::text, set_by, reason, effective_from, created_at FROM cold_chain_thresholds
        WHERE tenant_id=$1 AND subject_type=$2 AND subject_id=$3 ORDER BY effective_from DESC, created_at DESC LIMIT 50`, [tenantId, subjectType, subjectId]);
    return (r.rows as any[]).map((x) => ({ id: x.id, minC: x.min_c, maxC: x.max_c, setBy: x.set_by ?? null, reason: x.reason, effectiveFrom: iso(x.effective_from) as string, createdAt: iso(x.created_at) as string }));
  }
  /** Is the subject this organisation's? Shipments and coolers are checked against their tables; chambers and vaccine boxes have no
   *  registry on this platform, so a monitored one is any id the organisation itself named (its threshold / key / reading). */
  async subjectKnown(tx: SqlExecutor, tenantId: string, subjectType: string, subjectId: string): Promise<boolean> {
    if (subjectType === 'shipment') return ((await tx.query(`SELECT 1 FROM shipments WHERE id=$1 AND tenant_id=$2 LIMIT 1`, [subjectId, tenantId])).rowCount ?? 0) > 0;
    if (subjectType === 'bmc_unit') return ((await tx.query(`SELECT 1 FROM bmc_units WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [subjectId, tenantId])).rowCount ?? 0) > 0;
    return true;
  }

  /* ── W234 · monitored subjects ── */
  async subjects(tenantId: string, limit = 200): Promise<SubjectRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH s AS (
         SELECT DISTINCT subject_type, subject_id FROM (
           SELECT subject_type, subject_id FROM cold_chain_thresholds WHERE tenant_id=$1
           UNION SELECT subject_type, subject_id FROM device_keys WHERE tenant_id=$1 AND status = 'active'
           UNION SELECT subject_type, subject_id FROM cold_chain_logs WHERE tenant_id=$1 AND recorded_at >= now() - interval '30 days') u
       )
       SELECT s.subject_type, s.subject_id,
              CASE s.subject_type
                WHEN 'shipment' THEN (SELECT coalesce(sh.awb_no, 'SHP-' || upper(left(replace(sh.id::text, '-', ''), 8))) FROM shipments sh WHERE sh.id = s.subject_id AND sh.tenant_id=$1 LIMIT 1)
                WHEN 'bmc_unit' THEN (SELECT coalesce(b.serial_no, b.model, 'BMC-' || upper(left(replace(b.id::text, '-', ''), 8))) FROM bmc_units b WHERE b.id = s.subject_id AND b.tenant_id=$1)
                ELSE NULL END AS label,
              last.temp_c::text AS last_temp, last.recorded_at AS last_at, last.source AS last_source, last.is_breach AS last_exc,
              band.min_c::text AS band_min, band.max_c::text AS band_max,
              k.device_id, d.serial AS device_serial, d.last_reading_at,
              (SELECT b.id FROM cold_chain_breaches b WHERE b.tenant_id=$1 AND b.subject_type = s.subject_type AND b.subject_id = s.subject_id AND b.closed_at IS NULL LIMIT 1) AS open_breach,
              EXISTS (SELECT 1 FROM cold_chain_device_silences x WHERE x.tenant_id=$1 AND x.subject_id = s.subject_id AND x.resolved_at IS NULL) AS silent
         FROM s
         LEFT JOIN LATERAL (SELECT l.temp_c, l.recorded_at, l.source, l.is_breach FROM cold_chain_logs l
                             WHERE l.tenant_id=$1 AND l.subject_type = s.subject_type AND l.subject_id = s.subject_id AND l.recorded_at >= now() - interval '30 days'
                             ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1) last ON true
         LEFT JOIN LATERAL (SELECT * FROM kv_cold_chain_band($1, s.subject_type, s.subject_id)) band ON true
         LEFT JOIN device_keys k ON k.tenant_id=$1 AND k.subject_type = s.subject_type AND k.subject_id = s.subject_id AND k.status = 'active'
         LEFT JOIN twin_devices d ON d.id = k.device_id
        ORDER BY last.recorded_at DESC NULLS LAST, s.subject_type, s.subject_id LIMIT $2`, [tenantId, limit]);
    return (r.rows as any[]).map((x) => ({ subjectType: x.subject_type, subjectId: x.subject_id, label: x.label ?? null, lastTempC: x.last_temp ?? null, lastAt: iso(x.last_at),
      lastSource: x.last_source ?? null, lastExcursion: x.last_exc == null ? null : !!x.last_exc, bandMinC: x.band_min ?? null, bandMaxC: x.band_max ?? null,
      deviceId: x.device_id ?? null, deviceSerial: x.device_serial ?? null, deviceLastReadingAt: iso(x.last_reading_at), openBreachId: x.open_breach ?? null, openSilence: !!x.silent }));
  }
  async breachesSince(tenantId: string, days: number): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT count(*)::int AS n FROM cold_chain_breaches WHERE tenant_id=$1 AND opened_at >= now() - ($2 || ' days')::interval`, [tenantId, String(days)]);
    return Number((r.rows[0] as any).n);
  }

  /* ── breaches ── */
  async breaches(tenantId: string, q: { since: Date; subjectType?: string; subjectId?: string; cursor?: { ts: string; id: string }; limit: number }): Promise<BreachRow[]> {
    const params: unknown[] = [tenantId, q.since];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `b.tenant_id=$1 AND b.opened_at >= $2`;
    if (q.subjectType) where += ` AND b.subject_type=${p(q.subjectType)}`;
    if (q.subjectId) where += ` AND b.subject_id=${p(q.subjectId)}`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (b.created_at < ${cc}::timestamptz OR (b.created_at = ${cc}::timestamptz AND b.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${B_COLS} FROM cold_chain_breaches b LEFT JOIN twin_devices d ON d.id = b.device_id WHERE ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT ${lp}`, params);
    return r.rows.map(toBreach);
  }
  /** The window's own figures, over EVERY breach in it (not one page): counts, the alert → action pairs, the recorded losses. */
  async breachWindow(tenantId: string, since: Date): Promise<{ count: number; open: number; pairs: Array<{ openedAt: string; actionAt: string | null }>; losses: Array<{ lossMinor: string | null; lossCurrency: string | null }> }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT opened_at, action_at, loss_minor::text, loss_currency, closed_at FROM cold_chain_breaches WHERE tenant_id=$1 AND opened_at >= $2 LIMIT 10000`, [tenantId, since]);
    const rows = r.rows as any[];
    return { count: rows.length, open: rows.filter((x) => !x.closed_at).length,
      pairs: rows.map((x) => ({ openedAt: iso(x.opened_at) as string, actionAt: iso(x.action_at) })),
      losses: rows.map((x) => ({ lossMinor: x.loss_minor ?? null, lossCurrency: x.loss_currency ?? null })) };
  }
  async breach(tenantId: string, id: string, tx?: SqlExecutor, lock = false): Promise<BreachRow | null> {
    const r = await this.db(tenantId, tx).query(
      `SELECT ${B_COLS} FROM cold_chain_breaches b LEFT JOIN twin_devices d ON d.id = b.device_id WHERE b.id=$1 AND b.tenant_id=$2${lock ? ' FOR UPDATE OF b' : ''}`, [id, tenantId]);
    return r.rows[0] ? toBreach(r.rows[0]) : null;
  }
  async acknowledge(tx: TxContext, tenantId: string, id: string, by: string) {
    await tx.query(`UPDATE cold_chain_breaches SET acknowledged_at=now(), acknowledged_by=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by]);
  }
  async recordAction(tx: TxContext, tenantId: string, id: string, by: string, note: string) {
    await tx.query(`UPDATE cold_chain_breaches SET action_at=now(), action_by=$3, action_note=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, note]);
  }
  async recordOutcome(tx: TxContext, tenantId: string, id: string, o: { by: string; outcome: string; reason: string; lossMinor: string | null; lossCurrency: string | null }) {
    await tx.query(`UPDATE cold_chain_breaches SET outcome=$3, outcome_at=now(), outcome_by=$4, outcome_reason=$5, loss_minor=$6, loss_currency=$7, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId, o.outcome, o.by, o.reason, o.lossMinor, o.lossCurrency]);
  }
  /** The breaches due a buyer offer: a SHIPMENT breach out of range for 15 minutes or more (still open, or closed after ≥ 15). */
  async offersDue(tx: SqlExecutor, tenantId: string, minutes: number): Promise<Array<{ id: string; subjectId: string; peakC: string; bandMinC: string; bandMaxC: string }>> {
    const r = await tx.query(
      `SELECT id, subject_id, peak_c::text, band_min_c::text, band_max_c::text FROM cold_chain_breaches
        WHERE tenant_id=$1 AND subject_type='shipment' AND buyer_offer_state='none'
          AND coalesce(closed_at, now()) - first_out_at >= ($2 || ' minutes')::interval
        ORDER BY opened_at LIMIT 200`, [tenantId, String(minutes)]);
    return (r.rows as any[]).map((x) => ({ id: x.id, subjectId: x.subject_id, peakC: x.peak_c, bandMinC: x.band_min_c, bandMaxC: x.band_max_c }));
  }
  async shipmentBuyer(tx: SqlExecutor, tenantId: string, shipmentId: string): Promise<{ buyerUserId: string; orderId: string } | null> {
    const r = await tx.query(`SELECT o.buyer_user_id, o.id AS order_id FROM shipments s JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2`, [shipmentId, tenantId]);
    const x = r.rows[0] as any;
    return x ? { buyerUserId: x.buyer_user_id, orderId: x.order_id } : null;
  }
  async offer(tx: TxContext, tenantId: string, id: string, buyerUserId: string): Promise<number> {
    const r = await tx.query(`UPDATE cold_chain_breaches SET buyer_user_id=$3, buyer_offer_state='offered', buyer_offered_at=now(), updated_at=now()
                                WHERE id=$1 AND tenant_id=$2 AND buyer_offer_state='none'`, [id, tenantId, buyerUserId]);
    return r.rowCount ?? 0;
  }
  async decide(tx: TxContext, tenantId: string, id: string, d: { decision: string; reason: string | null; disputeId: string | null }) {
    await tx.query(`UPDATE cold_chain_breaches SET buyer_offer_state='decided', buyer_decision=$3, buyer_decided_at=now(), buyer_decision_reason=$4, dispute_id=$5, updated_at=now()
                     WHERE id=$1 AND tenant_id=$2`, [id, tenantId, d.decision, d.reason, d.disputeId]);
  }
  async buyerOffers(tenantId: string, buyerUserId: string): Promise<BreachRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${B_COLS} FROM cold_chain_breaches b LEFT JOIN twin_devices d ON d.id = b.device_id
        WHERE b.tenant_id=$1 AND b.buyer_user_id=$2 AND b.buyer_offer_state IN ('offered', 'decided') ORDER BY b.created_at DESC LIMIT 50`, [tenantId, buyerUserId]);
    return r.rows.map(toBreach);
  }

  /* ── loggers + keys ── */
  async loggers(tenantId: string): Promise<LoggerRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT d.id, d.serial, d.label, d.status, d.registered_at, d.last_reading_at,
              k.id AS key_id, k.key_hint, k.subject_type, k.subject_id, k.issued_at, k.issued_by
         FROM twin_devices d LEFT JOIN device_keys k ON k.device_id = d.id AND k.tenant_id = d.tenant_id AND k.status = 'active'
        WHERE d.tenant_id=$1 AND d.kind_code = 'cold_chain_logger' ORDER BY d.registered_at DESC LIMIT 200`, [tenantId]);
    return (r.rows as any[]).map((x) => ({ deviceId: x.id, serial: x.serial, label: x.label ?? null, status: x.status, registeredAt: iso(x.registered_at) as string,
      lastReadingAt: iso(x.last_reading_at),
      key: x.key_id ? { id: x.key_id, hint: x.key_hint, subjectType: x.subject_type, subjectId: x.subject_id, issuedAt: iso(x.issued_at) as string, issuedBy: x.issued_by } : null }));
  }
  async logger(tx: SqlExecutor, tenantId: string, deviceId: string): Promise<{ id: string; status: string; kind: string } | null> {
    const r = await tx.query(`SELECT id, status, kind_code FROM twin_devices WHERE id=$1 AND tenant_id=$2`, [deviceId, tenantId]);
    const x = r.rows[0] as any;
    return x ? { id: x.id, status: x.status, kind: x.kind_code } : null;
  }
  async revokeActiveKey(tx: TxContext, tenantId: string, deviceId: string, by: string, reason: string): Promise<string | null> {
    const r = await tx.query(`UPDATE device_keys SET status='revoked', revoked_by=$3, revoked_at=now(), revoke_reason=$4 WHERE tenant_id=$1 AND device_id=$2 AND status='active' RETURNING id`,
      [tenantId, deviceId, by, reason]);
    return (r.rows[0] as { id: string } | undefined)?.id ?? null;
  }
  async insertKey(tx: TxContext, k: { id: string; tenantId: string; deviceId: string; subjectType: string; subjectId: string; keyEnc: string; hint: string; issuedBy: string; reason: string }) {
    await tx.query(
      `INSERT INTO device_keys (id, tenant_id, device_id, subject_type, subject_id, key_enc, key_hint, issued_by, issue_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [k.id, k.tenantId, k.deviceId, k.subjectType, k.subjectId, k.keyEnc, k.hint, k.issuedBy, k.reason]);
  }

  /* ── the silence watch ── */
  /** Loggers with an active key whose last reading (server time of record) is older than `minutes`, with no open silence. A logger
   *  that has never reported is not silent — it is "awaiting a first reading" and the console says so. */
  async silentLoggers(tx: SqlExecutor, tenantId: string, minutes: number): Promise<Array<{ deviceId: string; serial: string; subjectType: string; subjectId: string; lastReadingAt: string }>> {
    const r = await tx.query(
      `SELECT d.id, d.serial, k.subject_type, k.subject_id, d.last_reading_at FROM twin_devices d
         JOIN device_keys k ON k.device_id = d.id AND k.tenant_id = d.tenant_id AND k.status = 'active'
        WHERE d.tenant_id=$1 AND d.kind_code = 'cold_chain_logger' AND d.status = 'registered' AND d.last_reading_at IS NOT NULL
          AND d.last_reading_at < now() - ($2 || ' minutes')::interval
          AND NOT EXISTS (SELECT 1 FROM cold_chain_device_silences s WHERE s.device_id = d.id AND s.resolved_at IS NULL)
        LIMIT 200`, [tenantId, String(minutes)]);
    return (r.rows as any[]).map((x) => ({ deviceId: x.id, serial: x.serial, subjectType: x.subject_type, subjectId: x.subject_id, lastReadingAt: iso(x.last_reading_at) as string }));
  }
  /** Who is told about a silent logger: the operators named on this organisation's active device_silent rules (else its cold-chain rules). */
  async silenceRecipients(tx: SqlExecutor, tenantId: string): Promise<string[]> {
    const r = await tx.query(
      `SELECT DISTINCT x FROM (
         SELECT jsonb_array_elements_text(recipient_user_ids) AS x, kind FROM ops_alert_rules WHERE tenant_id=$1 AND is_active AND deleted_at IS NULL AND kind IN ('device_silent', 'cold_chain_breach')) q
        WHERE q.kind = 'device_silent' OR NOT EXISTS (SELECT 1 FROM ops_alert_rules r WHERE r.tenant_id=$1 AND r.is_active AND r.deleted_at IS NULL AND r.kind = 'device_silent')`, [tenantId]);
    return (r.rows as any[]).map((x) => x.x as string);
  }
  async insertSilence(tx: TxContext, s: { id: string; tenantId: string; deviceId: string; subjectType: string; subjectId: string; lastReadingAt: string; alertId: string; recipients: string[] }) {
    await tx.query(
      `INSERT INTO cold_chain_device_silences (id, tenant_id, device_id, subject_type, subject_id, last_reading_at, alert_id, alert_state, alert_recipients) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [s.id, s.tenantId, s.deviceId, s.subjectType, s.subjectId, s.lastReadingAt, s.alertId, s.recipients.length ? 'alerted' : 'no_recipient', s.recipients.length]);
  }
  async insertFiredAlert(tx: TxContext, a: { id: string; tenantId: string; kind: string; severity: string; subjectType: string; subjectRef: string; detail: Record<string, unknown>; recipients: string[]; dedupeKey: string }) {
    await tx.query(
      `INSERT INTO ops_fired_alerts (id, tenant_id, rule_id, kind, severity, subject_type, subject_ref, detail, recipients, dedupe_key, notified)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10) ON CONFLICT (dedupe_key) DO NOTHING`,
      [a.id, a.tenantId, a.kind, a.severity, a.subjectType, a.subjectRef, JSON.stringify(a.detail), JSON.stringify(a.recipients), a.dedupeKey, a.recipients.length > 0]);
  }
  async silences(tenantId: string, limit = 50): Promise<Array<{ id: string; deviceId: string; subjectType: string; subjectId: string; lastReadingAt: string; flaggedAt: string; alertState: string; resolvedAt: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, device_id, subject_type, subject_id, last_reading_at, flagged_at, alert_state, resolved_at FROM cold_chain_device_silences WHERE tenant_id=$1 ORDER BY flagged_at DESC LIMIT $2`, [tenantId, limit]);
    return (r.rows as any[]).map((x) => ({ id: x.id, deviceId: x.device_id, subjectType: x.subject_type, subjectId: x.subject_id, lastReadingAt: iso(x.last_reading_at) as string,
      flaggedAt: iso(x.flagged_at) as string, alertState: x.alert_state, resolvedAt: iso(x.resolved_at) }));
  }
}
