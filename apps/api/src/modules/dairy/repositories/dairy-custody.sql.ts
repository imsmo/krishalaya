// modules/dairy/repositories/dairy-custody.sql.ts · PC-56 OPS-3b · L1 (lead decision 2026-11-09, from OPS-3a §2) — THE ONE CUSTODY QUERY.
//
// "Which centres does this person hold?" — the ACTIVE centres whose OPEN custody row (`mcc_operator_assignments`, TENANT-6d-2 / 0163:
// `ended_at IS NULL`, not deleted) names the user. The same rule `MccCentreRepository.inCustodyOf` answers for `GET /v1/dairy/mccs/mine`,
// written ONCE here as ids so the three API custody checks (a pour, a manual cooler reading, the centre's roll) cannot drift from each other.
// Tenant-scoped in the SQL (Law 1) and by RLS. Custody is opened and closed only on the organisation's dairy console; nothing here writes it.
import { SqlExecutor } from '../../../core/database/unit-of-work';

export async function openCustodyCentreIds(x: SqlExecutor, tenantId: string, userId: string): Promise<string[]> {
  const r = await x.query(
    `SELECT c.id FROM mcc_centres c
      WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.is_active = true
        AND c.id IN (SELECT a.mcc_id FROM mcc_operator_assignments a
                      WHERE a.tenant_id = $1 AND a.operator_user_id = $2 AND a.ended_at IS NULL AND a.deleted_at IS NULL)
      ORDER BY c.id`, [tenantId, userId]);
  return (r.rows as Array<{ id: string }>).map((row) => String(row.id));
}
