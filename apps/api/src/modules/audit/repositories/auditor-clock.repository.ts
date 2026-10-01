// modules/audit/repositories/auditor-clock.repository.ts · PC-56 TENANT-9c (F-17) · THE COOPERATIVE'S OWN CLOCK, CURRENCY
// AND FISCAL YEAR, read from declared data — never `'INR'`, never UTC days, never an assumed April.
//   zone      ← countries.timezone (7c's resolution: tenants → countries)
//   currency  ← countries.currency_code
//   fyMonth   ← tenant_fiscal_year_start_month(tenant) (0181: the tenant setting, else the country's declared year, else NULL)
//   today     ← the civil day in that zone, as the DATABASE computes it
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

export interface TenantClock { zone: string; currency: string; fyMonth: number | null; today: string }

@Injectable()
export class AuditorClockRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async clockOf(tenantId: string): Promise<TenantClock> {
    const r = await this.replica.forTenant(tenantId).query<{ zone: string; currency: string; fy_month: number | null; today: string }>(
      `SELECT c.timezone AS zone, c.currency_code AS currency, tenant_fiscal_year_start_month(t.id) AS fy_month,
              to_char((now() AT TIME ZONE c.timezone)::date, 'YYYY-MM-DD') AS today
         FROM tenants t JOIN countries c ON c.code = t.country_code
        WHERE t.id = $1`, [tenantId]);
    const row = r.rows[0];
    if (!row) {
      // A tenant with no country is a corrupt row (country_code is NOT NULL). UTC is the technical floor 8b named
      // (`LAST_RESORT_ZONE`), the currency is UNKNOWN rather than a guess, and no fiscal year is declared.
      const u = await this.replica.forTenant(tenantId).query<{ today: string }>(`SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today`);
      return { zone: 'UTC', currency: 'XXX', fyMonth: null, today: u.rows[0].today };
    }
    return { zone: row.zone, currency: String(row.currency).trim(), fyMonth: row.fy_month === null ? null : Number(row.fy_month), today: row.today };
  }
}
