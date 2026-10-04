// modules/logistics/exports/cold-chain.datasets.ts · PC-56 TENANT-SW-e · W2534 / W2535 (F-18) — the cold chain on the 6e-2 export
// plane: `logistics.cold_chain_trail` (one subject's readings, its band as copied at write, the source of each reading) and
// `logistics.cold_chain_breaches` (every breach in the window, its alert, acts, the buyer's decision and the recorded loss).
//
// THE FILE IS UNSIGNED AND SAYS SO. The canon's "Export trail (signed)" needs a signing key the platform does not hold (founder-
// physical, 9c F-11): every receipt carries "unsigned — signing is a founder-physical key; the sha256 is printed" and the plane prints
// the file's sha256. Both producers READ only (the plane's rule) and are gated by the logistics flag and `logistics.manage`.
import { Injectable } from '@nestjs/common';
import type { DatasetProducer, ProduceContext, ProduceOutcome } from '../../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { LangMap } from '../../../core/i18n/lang-map';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { Inject } from '@nestjs/common';
import { ShipmentPermissions } from '../policies/logistics.policies';
import { ColdExportBreachesParams, ColdExportBreachesSchema, ColdExportTrailParams, ColdExportTrailSchema } from '../dto/cold-chain.dto';
import { REFUSED_BY_NAME, UNSIGNED_EXPORT_NOTE } from '../domain/logistics-ops';

export const COLD_TRAIL_DATASET = 'logistics.cold_chain_trail';
export const COLD_BREACHES_DATASET = 'logistics.cold_chain_breaches';
export const COLD_TRAIL_HEADER = ['recorded_at_device', 'recorded_at_server', 'temp_c', 'humidity_pct', 'band_min_c', 'band_max_c', 'out_of_band', 'source', 'device_serial', 'sequence_no'] as const;
export const COLD_BREACHES_HEADER = ['breach_id', 'subject_type', 'subject_id', 'device_serial', 'band_min_c', 'band_max_c', 'direction', 'peak_c', 'first_out_at', 'opened_at', 'closed_at',
  'duration_seconds', 'alert_state', 'alert_recipients', 'acknowledged_at', 'action_at', 'action_note', 'outcome', 'outcome_reason', 'loss_minor', 'loss_currency',
  'buyer_offer_state', 'buyer_decision', 'dispute_id'] as const;
const iso = (v: unknown) => (v == null ? '' : new Date(v as string).toISOString());

@Injectable()
export class ColdChainTrailDataset implements DatasetProducer<ColdExportTrailParams> {
  readonly code = COLD_TRAIL_DATASET;
  readonly permission: string = ShipmentPermissions.Manage;
  readonly params = ColdExportTrailSchema;
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${COLD_TRAIL_DATASET}`); }

  async produce(ctx: ProduceContext, p: ColdExportTrailParams): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled('logistics', { tenantId: ctx.tenantId }).catch(() => false))) return { kind: 'refused', code: 'dataset_disabled', detail: 'flag logistics is off for this tenant' };
    const db = this.replica.forTenant(ctx.tenantId);
    const r = await db.query(
      `SELECT l.recorded_at, l.server_recorded_at, l.temp_c::text AS t, l.humidity_pct::text AS h, l.band_min_c::text AS bmin, l.band_max_c::text AS bmax, l.is_breach,
              l.source, d.serial, l.sequence_no::text AS seq
         FROM cold_chain_logs l LEFT JOIN twin_devices d ON d.id = l.device_id
        WHERE l.tenant_id=$1 AND l.subject_type=$2 AND l.subject_id=$3 AND l.recorded_at >= now() - ($4 || ' days')::interval
        ORDER BY l.recorded_at, l.id LIMIT 200000`, [ctx.tenantId, p.subjectType, p.subjectId, String(p.days)]);
    const rows = (r.rows as any[]).map((x) => [iso(x.recorded_at), iso(x.server_recorded_at), x.t, x.h ?? '', x.bmin ?? '', x.bmax ?? '',
      x.bmin == null ? 'no_threshold' : (x.is_breach ? 'yes' : 'no'), x.source, x.serial ?? '', x.seq ?? '']);
    return { kind: 'file', file: {
      header: COLD_TRAIL_HEADER, rows: (async function* () { for (const x of rows) yield x; })(),
      notes: [UNSIGNED_EXPORT_NOTE,
        `subject ${p.subjectType} ${p.subjectId}; ${p.days} days of readings, oldest first`,
        'band_min_c / band_max_c are the band COPIED from the threshold store when each reading was written — never a value the sender supplied',
        'source device = signed by a registered logger (HMAC, ±5 min, nonce); source manual = typed on the console or sent by the dairy desk route; a manual reading never opens a breach',
        'a breach is two consecutive device readings out of band (see the breaches export); out_of_band here is per reading',
        `refused by name: ${REFUSED_BY_NAME.signedExport}`],
      fileSuffix: `${p.subjectType}-${p.subjectId.slice(0, 8)}-${p.days}d`,
    } };
  }
}

@Injectable()
export class ColdChainBreachesDataset implements DatasetProducer<ColdExportBreachesParams> {
  readonly code = COLD_BREACHES_DATASET;
  readonly permission: string = ShipmentPermissions.Manage;
  readonly params = ColdExportBreachesSchema;
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider, private readonly ui: UiMessageRepository, private readonly flags: FlagsService) {}
  datasetName(): Promise<LangMap> { return this.ui.map(`exports.dataset.${COLD_BREACHES_DATASET}`); }

  async produce(ctx: ProduceContext, p: ColdExportBreachesParams): Promise<ProduceOutcome> {
    if (!(await this.flags.isEnabled('logistics', { tenantId: ctx.tenantId }).catch(() => false))) return { kind: 'refused', code: 'dataset_disabled', detail: 'flag logistics is off for this tenant' };
    const r = await this.replica.forTenant(ctx.tenantId).query(
      `SELECT b.*, d.serial FROM cold_chain_breaches b LEFT JOIN twin_devices d ON d.id = b.device_id
        WHERE b.tenant_id=$1 AND b.opened_at >= now() - ($2 || ' months')::interval ORDER BY b.opened_at, b.id LIMIT 100000`, [ctx.tenantId, String(p.months)]);
    const rows = (r.rows as any[]).map((x) => [x.id, x.subject_type, x.subject_id, x.serial ?? '', String(x.band_min_c), String(x.band_max_c), x.direction, String(x.peak_c),
      iso(x.first_out_at), iso(x.opened_at), iso(x.closed_at), x.duration_seconds == null ? '' : String(x.duration_seconds), x.alert_state, String(x.alert_recipients),
      iso(x.acknowledged_at), iso(x.action_at), x.action_note ?? '', x.outcome ?? '', x.outcome_reason ?? '', x.loss_minor == null ? '' : String(x.loss_minor), x.loss_currency ?? '',
      x.buyer_offer_state, x.buyer_decision ?? '', x.dispute_id ?? '']);
    return { kind: 'file', file: {
      header: COLD_BREACHES_HEADER, rows: (async function* () { for (const x of rows) yield x; })(),
      notes: [UNSIGNED_EXPORT_NOTE,
        `${p.months} months of breaches, oldest first`,
        'a breach = two consecutive device readings outside the band in force at write; closed by the first in-band device reading',
        'loss_minor is present only where an operator recorded a loss with a reason — an empty cell is "no loss recorded", never zero',
        `refused by name: ${REFUSED_BY_NAME.playbookRun} (no playbook object — action_note is the record), ${REFUSED_BY_NAME.signedExport}`],
      fileSuffix: `${p.months}m`,
    } };
  }
}
