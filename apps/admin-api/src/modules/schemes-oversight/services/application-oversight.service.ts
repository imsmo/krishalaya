// apps/admin-api/src/modules/schemes-oversight/services/application-oversight.service.ts · W074, the cross-tenant
// applications pipeline.
//
// THE ONE INVARIANT IN THIS FILE: raw applicant PII exists only between the repository call and `maskApplicant`, and
// it never appears in a return value from `list` or `get`. Full PII travels on ONE path — `unmaskApplicant` — which
// requires a reason of at least ten characters and writes an audit row BEFORE returning anything. That mirrors
// tenant-applications-ops, where the list masks and the single-record read is audited as `tenant_application.viewed`,
// and it is the reason the mask lives in the service rather than in the console: a console-side mask is a mask that
// travelled over the wire and through a log line first.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SchemesOversightRepository } from '../repositories/schemes-oversight.repository';
import { ApplicationNotFoundError } from '../domain/schemes-oversight.errors';
import { assertFilters, countsFrom, totalCount, eligibilityView, needsHumanLook, assistedShare, statusClass, type OversightFilters } from '../domain/application-oversight';
import { maskApplicant, assertUnmaskReason, govtRefFor } from '../domain/pii-mask';

const cursorOf = (createdAt: any, id: string) => Buffer.from(`${createdAt?.toISOString?.() ?? createdAt}|${id}`).toString('base64');

@Injectable()
export class ApplicationOversightService {
  constructor(private readonly audit: AdminAuditWriter, private readonly repo: SchemesOversightRepository) {}

  async list(q: { status?: string; schemeId?: string; tenantId?: string; assistedOnly?: string; cursor?: { c: string; id: string }; limit: number }) {
    const filters: OversightFilters = assertFilters(q);   // THROWS on a bad status — an ignored filter is a lie on screen
    const rows = await this.repo.listApplications(filters, q.cursor, q.limit);

    const items = rows.map((r: any) => {
      const view = eligibilityView(r.eligibility_check);
      return {
        id: r.id,
        tenantId: r.tenant_id, tenantName: r.tenant_name ?? null,
        schemeId: r.scheme_id, schemeCode: r.scheme_code, schemeName: r.scheme_name,
        schemeVersion: r.scheme_version,
        // ADMIN-4's pointer. NULL means the rules this application was judged under are not recoverable — surfaced
        // rather than hidden, because a grievance officer needs to know when we cannot show them the rule.
        schemeVersionResolvable: r.scheme_version_id !== null && r.scheme_version_id !== undefined,
        status: r.status, statusClass: statusClass(r.status),
        applicant: maskApplicant({ userId: r.applicant_user_id, fullName: r.applicant_full_name, phone: r.applicant_phone }),
        // `assisted_by` is a user id and is NOT masked or resolved to a name: an ambassador is staff acting in role,
        // not a data subject on this screen, and the id is what an operator needs to find the ambassador's record.
        assistedBy: r.assisted_by ?? null,
        assisted: r.assisted_by !== null && r.assisted_by !== undefined,
        govtAppRef: govtRefFor(r.govt_app_ref),
        eligibility: view, needsHumanLook: needsHumanLook(view),
        rejectionReasonCode: r.rejection_reason_code ?? null,
        submittedAt: r.submitted_at, decidedAt: r.decided_at, createdAt: r.created_at,
      };
    });
    const last = rows[rows.length - 1] as any;
    return { items, nextCursor: rows.length === q.limit && last ? cursorOf(last.created_at, last.id) : null };
  }

  /** The tab chips. Fetched separately from the list so it degrades on its own (Law 12) — and the caller renders an
   *  ABSENT count as "unknown", never as 0. */
  async counts(q: { schemeId?: string; tenantId?: string; assistedOnly?: string }) {
    const filters = assertFilters(q);
    const [rows, assisted] = await Promise.all([
      this.repo.statusCounts(filters),
      this.repo.assistedCounts(filters),
    ]);
    const counts = countsFrom(rows);
    return { counts, total: totalCount(counts), assistedShare: assistedShare(assisted.assisted, assisted.total) };
  }

  /** One application, still MASKED. The drill-in exists to show the chain — the events trail, the version pointer,
   *  the rejection code — none of which needs a phone number. Reading the phone number is a separate, audited act. */
  async get(id: string) {
    const r: any = await this.repo.getApplication(id);
    if (!r) throw new ApplicationNotFoundError(id);
    const events = await this.repo.applicationEvents(id, 50);
    const view = eligibilityView(r.eligibility_check);
    return {
      id: r.id,
      tenantId: r.tenant_id, tenantName: r.tenant_name ?? null,
      schemeId: r.scheme_id, schemeCode: r.scheme_code, schemeName: r.scheme_name,
      schemeVersion: r.scheme_version,
      schemeVersionResolvable: r.scheme_version_id !== null && r.scheme_version_id !== undefined,
      status: r.status, statusClass: statusClass(r.status),
      applicant: maskApplicant({ userId: r.applicant_user_id, fullName: r.applicant_full_name, phone: r.applicant_phone }),
      assistedBy: r.assisted_by ?? null, assisted: r.assisted_by !== null && r.assisted_by !== undefined,
      govtAppRef: govtRefFor(r.govt_app_ref),
      eligibility: view, needsHumanLook: needsHumanLook(view),
      rejectionReasonCode: r.rejection_reason_code ?? null,
      // The officer's own words. Kept — it is where what actually happened is written, and the CODE never replaces it.
      rejectionReason: r.rejection_reason ?? null,
      submittedAt: r.submitted_at, decidedAt: r.decided_at, createdAt: r.created_at,
      events: events.map((e: any) => ({ fromStatus: e.from_status, toStatus: e.to_status, note: e.note, actorUserId: e.actor_user_id, createdAt: e.created_at })),
      // form_data is NOT returned. It is farmer-entered free-form jsonb that can hold anything an officer typed into
      // an assisted flow, and there is no way to know in advance what PII is inside it.
      formDataWithheld: true,
    };
  }

  /** THE ONLY PATH THAT RETURNS A REAL NAME AND PHONE. Reason first, audit second, data third — in that order, so a
   *  failure to write the audit row means no disclosure rather than an unlogged one. */
  async unmaskApplicant(actor: AdminRequestContext, id: string, rawReason: unknown) {
    const reason = assertUnmaskReason(rawReason);
    const pii = await this.repo.applicantPii(id);
    if (!pii) throw new ApplicationNotFoundError(id);

    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'schemes.applicant_pii_viewed', entityType: 'scheme_application', entityId: id,
      // The AUDIT ROW does not contain the PII either. It records that a disclosure happened, to whom it related, and
      // why — putting the phone number in the ledger would make every future reader of the audit log a recipient.
      newValue: { applicantUserId: pii.userId, disclosed: ['full_name', 'phone'] },
      reason, ip: actor.ip, requestId: actor.requestId || null,
    });

    return { applicationId: id, userId: pii.userId, fullName: pii.fullName, phone: pii.phone, masked: false as const };
  }
}
