// modules/livestock/repositories/health.repository.ts · PC-54 W54-4. SQL for the lifetime health file
// (animal_health_events, PARTITIONED by created_at — reads bound created_at so PG prunes, Law 8) and
// prescriptions (+items; Schedule-H flag = restricted-drug audit trail). tenant_id everywhere (Law 1).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

export interface HealthEvent {
  id: string; animalId: string; eventTypeId: string; eventTypeCode?: string; vetBookingId: string | null;
  batchNo: string | null; diagnosis: string | null; outcome: string | null; nextDueDate: string | null; recordedBy: string | null; createdAt: string;
}
export interface PrescriptionItem { drugName: string; dosage: string; durationDays: number | null; isScheduleH: boolean; productId: string | null }
export interface Prescription { id: string; vetBookingId: string; vetId: string; animalId: string | null; validUntil: string | null; items: PrescriptionItem[] }

@Injectable()
export class HealthRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async resolveEventTypeId(tx: TxContext, code: string): Promise<string | null> {
    const r = await tx.query(`SELECT id FROM lookup_values WHERE type_code='animal_health_event' AND code=$1 AND tenant_id IS NULL AND is_active=true`, [code]);
    return r.rows[0]?.id ?? null;
  }
  async insertEvent(tx: TxContext, e: { id: string; tenantId: string; animalId: string; eventTypeId: string; vetBookingId?: string; batchNo?: string; diagnosis?: string; outcome?: string; nextDueDate?: string; recordedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO animal_health_events (id, tenant_id, animal_id, event_type_id, vet_booking_id, batch_no, diagnosis, outcome, next_due_date, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [e.id, e.tenantId, e.animalId, e.eventTypeId, e.vetBookingId ?? null, e.batchNo ?? null, e.diagnosis ?? null, e.outcome ?? null, e.nextDueDate ?? null, e.recordedBy]);
  }
  async listEvents(tenantId: string, animalId: string): Promise<HealthEvent[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT e.id, e.animal_id, e.event_type_id, lv.code AS event_type_code, e.vet_booking_id, e.batch_no, e.diagnosis, e.outcome, e.next_due_date, e.recorded_by, e.created_at
         FROM animal_health_events e LEFT JOIN lookup_values lv ON lv.id = e.event_type_id
        WHERE e.tenant_id=$1 AND e.animal_id=$2 AND e.created_at >= now() - interval '10 years'
        ORDER BY e.created_at DESC LIMIT 200`, [tenantId, animalId]);
    return r.rows.map((x: any) => ({
      id: x.id, animalId: x.animal_id, eventTypeId: x.event_type_id, eventTypeCode: x.event_type_code ?? undefined,
      vetBookingId: x.vet_booking_id, batchNo: x.batch_no, diagnosis: x.diagnosis, outcome: x.outcome,
      nextDueDate: x.next_due_date ? pgDate(x.next_due_date) : null, recordedBy: x.recorded_by,
      createdAt: new Date(x.created_at).toISOString(),
    }));
  }

  async insertPrescription(tx: TxContext, p: { id: string; tenantId: string; vetBookingId: string; vetId: string; animalId?: string; validUntil?: string; items: Array<{ id: string; drugName: string; dosage: string; durationDays?: number; isScheduleH?: boolean; productId?: string }> }): Promise<void> {
    await tx.query(`INSERT INTO prescriptions (id, tenant_id, vet_booking_id, vet_id, animal_id, valid_until) VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.id, p.tenantId, p.vetBookingId, p.vetId, p.animalId ?? null, p.validUntil ?? null]);
    for (const it of p.items) {
      await tx.query(`INSERT INTO prescription_items (id, prescription_id, product_id, drug_name, dosage, duration_days, is_schedule_h) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [it.id, p.id, it.productId ?? null, it.drugName, it.dosage, it.durationDays ?? null, it.isScheduleH ?? false]);
    }
  }
  async getPrescriptionByBooking(tenantId: string, vetBookingId: string): Promise<Prescription | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, vet_booking_id, vet_id, animal_id, valid_until FROM prescriptions WHERE tenant_id=$1 AND vet_booking_id=$2 AND deleted_at IS NULL LIMIT 1`, [tenantId, vetBookingId]);
    if (!r.rows[0]) return null;
    const p = r.rows[0];
    const items = await this.replica.forTenant(tenantId).query(`SELECT drug_name, dosage, duration_days, is_schedule_h, product_id FROM prescription_items WHERE prescription_id=$1`, [p.id]);
    return {
      id: p.id, vetBookingId: p.vet_booking_id, vetId: p.vet_id, animalId: p.animal_id,
      validUntil: p.valid_until ? String(p.valid_until).slice(0, 10) : null,
      items: items.rows.map((i: any) => ({ drugName: i.drug_name, dosage: i.dosage, durationDays: i.duration_days, isScheduleH: i.is_schedule_h, productId: i.product_id })),
    };
  }
}
