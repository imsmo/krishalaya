// apps/admin-api/src/modules/schemes-oversight/services/oversight-export.service.ts · the receipt law's SIXTH surface
// (apps/api gov exports, billing, support, taxonomy, scheme registry, now scheme oversight).
//
// ADMIN-4's registry export REFUSED these two reports by name, with reasons. This is where they arrive, and the two
// reasons are answered rather than dropped:
//   • APPLICATIONS carried cross-tenant applicant PII under the registry read permission → it now needs
//     `schemes.applications.read`, and the file itself is MASKED.
//   • DBT carried bank-side references → the columns are enumerated by hand and `assertNoBankFields` checks the rows
//     on the way out.
//
// AND THE STRICTER RULE FOR FILES. An export is the artefact most likely to outlive the permission that produced it —
// it lands in a downloads folder, gets attached to an email, and is read by somebody who never had the permission at
// all. So the export MASKS even though a permitted operator can unmask on screen: there is no per-row audit trail for
// a CSV, and an unmasked file cannot be recalled.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SchemesOversightRepository } from '../repositories/schemes-oversight.repository';
import { OversightExportUnknownError } from '../domain/schemes-oversight.errors';
import { assertFilters } from '../domain/application-oversight';
import { maskName, maskPhone } from '../domain/pii-mask';
import { assertNoBankFields, DBT_EXPORT_COLUMNS, DBT_BOUNCE_EXPORT_COLUMNS } from '../domain/dbt-safety';
import type { OversightExportDto } from '../dto/schemes-oversight.dto';
import { contentDigest, DIGEST_BASIS } from '../../../core/export/receipt';

export const OVERSIGHT_EXPORT_REPORTS = ['applications', 'dbt_credits', 'dbt_bounces', 'rejections'] as const;
export type OversightExportReport = (typeof OVERSIGHT_EXPORT_REPORTS)[number];

export const MAX_OVERSIGHT_EXPORT_ROWS = 20_000;
const DEFAULT_ROWS = 5_000;

/** Applications export columns. `farmer_masked` and `phone_masked`, never a raw name or number — see the header. */
const APPLICATION_EXPORT_COLUMNS: Array<[string, string]> = [
  ['application_id', 'application_id'],
  ['filed_on', 'filed_on'],
  ['tenant', 'tenant_name'],
  ['scheme_code', 'scheme_code'],
  ['scheme_version', 'scheme_version'],
  // ADMIN-4's pointer, as a boolean. A file that says a version number without saying whether its rules are
  // retrievable invites a reader to assume they are.
  ['rules_recoverable', 'rules_recoverable'],
  ['status', 'status'],
  ['farmer_masked', 'farmer_masked'],
  ['phone_masked', 'phone_masked'],
  ['assisted', 'assisted'],
  ['govt_app_ref', 'govt_app_ref'],
  ['rejection_code', 'rejection_reason_code'],
  ['submitted_at', 'submitted_at'],
  ['decided_at', 'decided_at'],
];

/** The rejection breakdown, as a file — and it carries the UNCODED count as a row of its own, so a spreadsheet built
 *  from it cannot compute percentages off a denominator it cannot see. */
const REJECTION_EXPORT_COLUMNS: Array<[string, string]> = [
  ['rejection_code', 'code'], ['applications', 'n'], ['pct_of_coded', 'pct_of_coded'], ['fixable', 'fixable'],
];

@Injectable()
export class OversightExportService {
  constructor(private readonly audit: AdminAuditWriter, private readonly repo: SchemesOversightRepository) {}

  async export(actor: AdminRequestContext, dto: OversightExportDto) {
    if (!(OVERSIGHT_EXPORT_REPORTS as readonly string[]).includes(dto.report)) {
      throw new OversightExportUnknownError(dto.report, OVERSIGHT_EXPORT_REPORTS);
    }
    const report = dto.report as OversightExportReport;
    const limit = Math.min(Math.max(dto.limit ?? DEFAULT_ROWS, 1), MAX_OVERSIGHT_EXPORT_ROWS);
    const days = Math.min(Math.max(dto.days ?? 30, 1), 365);

    const { columns, rows } = await this.build(report, dto, limit, days);
    // The check runs on the FINISHED rows, after every mapper — the point of failure it guards against is a mapper
    // that helpfully spreads a database row into the output.
    assertNoBankFields(rows, `oversight export: ${report}`);

    const receiptId = randomUUID();
    const generatedAt = new Date();
    const truncated = rows.length >= limit;

    // BEFORE the rows go anywhere. If this throws, the caller gets an error and no data.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'schemes.oversight_exported', entityType: 'scheme_oversight_export_receipt', entityId: receiptId,
      newValue: {
        report, rowCount: rows.length, truncated, generatedAt: generatedAt.toISOString(),
        filters: { limit, days, status: dto.status ?? null, schemeId: dto.schemeId ?? null, tenantId: dto.tenantId ?? null, assistedOnly: dto.assistedOnly ?? null },
        // Recorded on the receipt so an auditor reading the ledger later knows the file was masked without having to
        // find the file.
        piiMasked: true,
      },
      reason: `scheme oversight export: ${report}`,
      ip: actor.ip, requestId: actor.requestId || null,
    });

    return {
      receipt: {
        id: receiptId, report, generatedAt: generatedAt.toISOString(), generatedBy: actor.userId,
        rowCount: rows.length, truncated, piiMasked: true,
        contentSha256: contentDigest(columns, rows), digestBasis: DIGEST_BASIS,
        fileName: exportFileName(report, receiptId, generatedAt),
        filters: { limit, days },
      },
      columns, rows,
    };
  }

  private async build(report: OversightExportReport, dto: OversightExportDto, limit: number, days: number) {
    switch (report) {
      case 'applications': {
        const filters = assertFilters({ status: dto.status, schemeId: dto.schemeId, tenantId: dto.tenantId, assistedOnly: dto.assistedOnly });
        const raw = await this.repo.listApplications(filters, undefined, limit);
        return {
          columns: APPLICATION_EXPORT_COLUMNS,
          rows: raw.map((r: any) => ({
            application_id: r.id,
            filed_on: r.created_at,
            tenant_name: r.tenant_name ?? '',
            scheme_code: r.scheme_code,
            scheme_version: r.scheme_version,
            rules_recoverable: r.scheme_version_id ? 'yes' : 'no',
            status: r.status,
            farmer_masked: maskName(r.applicant_full_name) ?? '',
            phone_masked: maskPhone(r.applicant_phone) ?? '',
            assisted: r.assisted_by ? 'yes' : 'no',
            govt_app_ref: r.govt_app_ref ?? '',
            rejection_reason_code: r.rejection_reason_code ?? '',
            submitted_at: r.submitted_at ?? '',
            decided_at: r.decided_at ?? '',
          })),
        };
      }
      case 'dbt_credits': {
        const raw = await this.repo.dbtRecent(days, dto.schemeId, undefined, limit);
        return {
          columns: DBT_EXPORT_COLUMNS,
          rows: raw.map((r: any) => ({
            scheme_code: r.scheme_code,
            credited_on: r.credited_on,
            instalment_no: r.instalment_no ?? '',
            amount_minor: String(r.amount_minor ?? '0'),
            pfms_ref: r.pfms_ref ?? '',
            govt_app_ref: r.govt_app_ref ?? '',
            tenant_name: r.tenant_name ?? '',
            farmer_masked: maskName(r.applicant_full_name) ?? '',
          })),
        };
      }
      case 'dbt_bounces': {
        const raw = await this.repo.dbtBounces(days, dto.resolution, limit);
        return {
          columns: DBT_BOUNCE_EXPORT_COLUMNS,
          rows: raw.map((r: any) => ({
            scheme_code: r.scheme_code,
            bounced_on: r.bounced_on,
            reason_code: r.reason_code,
            amount_minor: String(r.amount_minor ?? '0'),
            resolution: r.resolution,
            resolved_at: r.resolved_at ?? '',
            farmer_masked: maskName(r.applicant_full_name) ?? '',
          })),
        };
      }
      case 'rejections': {
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const raw = await this.repo.rejectionsByCode(since);
        const { rejectionBreakdown } = await import('../domain/performance');
        const b = rejectionBreakdown(raw);
        return {
          columns: REJECTION_EXPORT_COLUMNS,
          rows: [
            ...b.slices.map((s) => ({ code: s.code, n: s.n, pct_of_coded: s.pctOfCoded ?? '', fixable: s.fixable ? 'yes' : 'no' })),
            // The uncoded row. Present so a spreadsheet cannot silently compute shares off the coded subtotal and
            // present them as shares of all rejections — the exact mistake 0106 exists to prevent.
            { code: 'UNCODED (no reason code recorded)', n: b.uncoded, pct_of_coded: '', fixable: 'unknown' },
          ],
        };
      }
    }
  }
}

export function exportFileName(report: OversightExportReport, receiptId: string, generatedAt: Date): string {
  const day = generatedAt.toISOString().slice(0, 10);
  const short = receiptId.replace(/-/g, '').slice(0, 8);
  return `krishalaya-scheme-oversight-${report}-${day}-${short}.csv`;
}
