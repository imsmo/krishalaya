// modules/audit/read-models/auditor-compliance.read-model.ts · W437 · THE COMPLIANCE PACK, AS FACTS THAT EXIST
// (PC-56 TENANT-9c · F-11).
//
// The canon's pack is a machine-generated, auditor-SIGNED, immutable, watermarked PDF generated at quarter-close. None of
// that exists (no pack table, no attestation record, no signing key — founder-physical, no PDF, no watermark), and this
// read model does not pretend otherwise. What it computes, on read, over the tables that DO exist, for one fiscal quarter
// (or a bounded window when the fiscal year is undeclared):
//   • GST — the tenant's OWN issued trade invoices and credit notes: counts, Σ taxable, Σ tax by supply type (intra-state =
//     CGST + SGST, inter-state = IGST — printed as the type, never split by a guessed rate), Σ total; how many carry an IRN
//     (`trade_invoices.irn` exists and no e-invoicing integration writes it — the count says so) and how many have an
//     incomplete tax basis. NOT "ties to the gst_payable platform account": that account is shared by every tenant.
//   • SCHEMES — the tenant's scheme applications by status. NOT "e-KYC-blocked": no link from an application to an eKYC verdict.
//   • PRIVACY (DPDP) — ADMIN-5 owns the consent and erasure planes; the tenant realm READS them for ITS members only: the
//     latest consent per member per purpose (granted / withdrawn), and data-subject requests by type and status. `consents`
//     and `data_subject_requests` carry no tenant_id and no RLS, so EVERY query here is bounded by the tenant's own member
//     set (`user_tenant_roles.tenant_id = $1`, an RLS'd table) and returns COUNTS — never a person.
//   • LEDGER — from the funnel (`AuditorLedgerReadModel`), by the service; not read here.
// Served from the replica under the tenant's context. Read-only.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

export interface Win { fromDay: string; toDay: string; zone: string }

export interface GstSection {
  invoices: number; taxableMinor: string; taxMinor: string; totalMinor: string;
  bySupplyType: Array<{ supplyType: string; invoices: number; taxMinor: string }>;
  withIrn: number; taxBasisIncomplete: number;
  creditNotes: number; creditNoteTotalMinor: string; creditNoteTaxMinor: string;
}
export interface SchemeSection { applications: number; byStatus: Array<{ status: string; n: number }> }
export interface PrivacySection {
  members: number;
  consents: Array<{ purposeCode: string; granted: number; withdrawn: number; never: number }>;
  requests: Array<{ requestType: string; status: string; n: number }>;
}

const IN_WINDOW = (col: string) => `${col} >= ($2::date)::timestamp AT TIME ZONE $4 AND ${col} < (($3::date) + 1)::timestamp AT TIME ZONE $4`;

@Injectable()
export class AuditorComplianceReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async gst(tenantId: string, w: Win): Promise<GstSection> {
    const db = this.replica.forTenant(tenantId);
    const p = [tenantId, w.fromDay, w.toDay, w.zone];
    const inv = await db.query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT count(*)::int AS n, COALESCE(SUM(taxable_minor),0)::text AS taxable, COALESCE(SUM(tax_minor),0)::text AS tax,
              COALESCE(SUM(total_minor),0)::text AS total, count(*) FILTER (WHERE irn IS NOT NULL AND btrim(irn) <> '')::int AS with_irn,
              count(*) FILTER (WHERE tax_basis_complete IS DISTINCT FROM true)::int AS incomplete
         FROM trade_invoices
        WHERE tenant_id = $1 AND deleted_at IS NULL AND ${IN_WINDOW('COALESCE(issued_at, created_at)')}`, p);
    const by = await db.query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT COALESCE(supply_type, 'unknown') AS supply_type, count(*)::int AS n, COALESCE(SUM(tax_minor),0)::text AS tax
         FROM trade_invoices
        WHERE tenant_id = $1 AND deleted_at IS NULL AND ${IN_WINDOW('COALESCE(issued_at, created_at)')}
        GROUP BY 1 ORDER BY 1`, p);
    const cn = await db.query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT count(*)::int AS n, COALESCE(SUM(total_minor),0)::text AS total, COALESCE(SUM(tax_minor),0)::text AS tax
         FROM credit_notes
        WHERE tenant_id = $1 AND deleted_at IS NULL AND ${IN_WINDOW('issued_at')}`, p);
    const i = inv.rows[0]; const c = cn.rows[0];
    return {
      invoices: Number(i?.n ?? 0), taxableMinor: i?.taxable ?? '0', taxMinor: i?.tax ?? '0', totalMinor: i?.total ?? '0',
      bySupplyType: by.rows.map((x: any) => ({ supplyType: x.supply_type, invoices: Number(x.n), taxMinor: x.tax })), // eslint-disable-line @typescript-eslint/no-explicit-any
      withIrn: Number(i?.with_irn ?? 0), taxBasisIncomplete: Number(i?.incomplete ?? 0),
      creditNotes: Number(c?.n ?? 0), creditNoteTotalMinor: c?.total ?? '0', creditNoteTaxMinor: c?.tax ?? '0',
    };
  }

  async schemes(tenantId: string, w: Win): Promise<SchemeSection> {
    const r = await this.replica.forTenant(tenantId).query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT status::text AS status, count(*)::int AS n
         FROM scheme_applications
        WHERE tenant_id = $1 AND deleted_at IS NULL AND ${IN_WINDOW('created_at')}
        GROUP BY 1 ORDER BY 1`, [tenantId, w.fromDay, w.toDay, w.zone]);
    const byStatus = r.rows.map((x: any) => ({ status: x.status, n: Number(x.n) })); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { applications: byStatus.reduce((a: number, x: { n: number }) => a + x.n, 0), byStatus };
  }

  /** Counts over THIS tenant's members only. `consents` / `data_subject_requests` have no tenant_id: the member set is the
   *  bound, drawn from `user_tenant_roles` (RLS'd, `tenant_id = $1`). */
  async privacy(tenantId: string): Promise<PrivacySection> {
    const db = this.replica.forTenant(tenantId);
    const members = await db.query<{ n: string }>(
      `SELECT count(DISTINCT utr.user_id)::text AS n FROM user_tenant_roles utr
        WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL`, [tenantId]);
    const consents = await db.query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `WITH m AS (
         SELECT DISTINCT utr.user_id FROM user_tenant_roles utr WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL
       ), latest AS (
         SELECT DISTINCT ON (c.user_id, c.purpose_code) c.user_id, c.purpose_code, c.granted
           FROM consents c JOIN m ON m.user_id = c.user_id
          ORDER BY c.user_id, c.purpose_code, c.created_at DESC
       )
       SELECT p.code AS purpose_code,
              count(l.user_id) FILTER (WHERE l.granted)::int AS granted,
              count(l.user_id) FILTER (WHERE NOT l.granted)::int AS withdrawn,
              ((SELECT count(*) FROM m) - count(l.user_id))::int AS never
         FROM consent_purposes p LEFT JOIN latest l ON l.purpose_code = p.code
        GROUP BY p.code ORDER BY p.code`, [tenantId]);
    const requests = await db.query<any>( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT d.request_type, d.status, count(*)::int AS n
         FROM data_subject_requests d
        WHERE d.deleted_at IS NULL
          AND d.user_id IN (SELECT utr.user_id FROM user_tenant_roles utr WHERE utr.tenant_id = $1 AND utr.deleted_at IS NULL)
        GROUP BY 1, 2 ORDER BY 1, 2`, [tenantId]);
    return {
      members: Number(members.rows[0]?.n ?? 0),
      consents: consents.rows.map((x: any) => ({ purposeCode: x.purpose_code, granted: Number(x.granted), withdrawn: Number(x.withdrawn), never: Number(x.never) })), // eslint-disable-line @typescript-eslint/no-explicit-any
      requests: requests.rows.map((x: any) => ({ requestType: x.request_type, status: x.status, n: Number(x.n) })), // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  }
}
