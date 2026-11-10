// modules/gov-console/services/gov-applications.service.ts · PC-56 GOV-0 · THE RECORDED READ (GOV-1 Q3-A).
//
// An authority reads ONLY applications to schemes it runs (`schemes.authority_id` — the direct link, 0011), across organisations, on the
// `kv_gov` axis (0239). An application to another authority's scheme, an unknown id and a malformed id answer the same 404
// (GOV_APPLICATION_NOT_FOUND) — never "not yours". EVERY OPENING writes one recorded-read row the application's organisation can see
// (`audit_read_log`, purpose `gov_application_open`: who, as which authority and roles, which application, when) in the read's own
// transaction; a list writes one `gov_application_list` row per organisation on the page before the page is returned.
// What the read returns: the application's id, organisation id, scheme (id, code, name), version, status and dates; on an opening, the
// stored form MASKED by the database (phone / Aadhaar / bank / account / IFSC / UPI / PAN → ••••••xyz) with every location key dropped (no
// officer-of-record notion exists for an authority). Never the applicant's id, name or account, the free-text rejection reason, the member
// roster, member files, payouts, orders or finance — no such route exists in this realm.
//
// PC-56 GOV-2a (GOV-2 Q1-A…Q5-A, lead-applied 2026-11-10; the founder may reopen):
//   • B1 — a farmer's DRAFT never reaches the authority (the DTO, both queries, and 0240's policy — the wall). C-6 corrected: "an authority
//     reads ONLY applications to schemes it runs" was true by scheme and ALSO admitted unsent drafts; it no longer does.
//   • B2f — the opened form is the DECLARED fields of the version it was filed under, personal ones masked; an undeclared key never leaves.
//   • B4 — the list takes a scheme filter.
//   • B2 — THE ACT (`act`): verify / clarify (authority.applications.verify) and approve / reject (authority.applications.decide, the head
//     only). THE REFUSAL ORDER (E2): the key → the input → the permission → the facts (404, the legal step, the second person) — ALL before
//     `idem.remember` and before any write (pinned with a spy). Then ONE transaction on the application's shard: 0240's DEFINER (which
//     re-checks everything), the audit row the farmer's organisation can read, and the outbox event. Approval carries no amount (Q1-A).
//   • B3 — the authority's own schemes, versions and a version diff (published fields only; no amount; no draft content; no operator id).
import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { SchemesEventType } from '../../schemes/domain/schemes.events';
import { GovAct, actFactsRefusal, actInputRefusal, actPermissionRefusal } from '../domain/gov-application-act.rules';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { GovConsoleRepository } from '../repositories/gov-console.repository';
import { clampGovLimit } from '../domain/gov-membership.rules';
import { govRefused, namedGovRefusal } from '../domain/gov-console.errors';
import { GovSession } from '../guards/gov-session.guard';
import { govActorRole } from './gov-members.service';
import { GovOverview, shapeOverview } from '../domain/gov-overview';

const strip = <T extends { cursorTs: string }>(r: T): Omit<T, 'cursorTs'> => { const { cursorTs: _c, ...rest } = r; return rest; };
const who = (s: GovSession) => ({ actorUserId: s.userId, actorRole: govActorRole(s), authorityId: s.authorityId, requestId: s.requestId });
const EVENT_OF: Record<GovAct, string> = {
  verify: SchemesEventType.ApplicationVerifying, clarify: SchemesEventType.ApplicationClarification,
  approve: SchemesEventType.ApplicationApproved, reject: SchemesEventType.ApplicationRejected,
};

@Injectable()
export class GovApplicationsService {
  constructor(
    private readonly repo: GovConsoleRepository,
    private readonly audit: AuditWriter,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}

  async list(s: GovSession, q: { status?: string; schemeId?: string; cursor?: string; limit?: number }) {
    const limit = clampGovLimit(q.limit);
    const rows = await this.repo.listApplications(s.authorityId, { status: q.status, schemeId: q.schemeId, cursor: decodeKeyset(q.cursor, UUID_RE), limit }, who(s));
    const last = rows[rows.length - 1];
    return { items: rows.map(strip), nextCursor: rows.length === limit && last ? encodeKeyset(last.cursorTs, last.id) : null, asOf: new Date().toISOString(), limit };
  }

  /** PC-56 GOV-1b · GOV1-B5 — the overview: counts only, computed in SQL over the whole set on the kv_gov axis; `computedAt` is the server's.
   *  No recorded-read row: no application is opened and no application row leaves the server (the brief's recommendation, applied). */
  async overview(s: GovSession): Promise<GovOverview> {
    const { schemes, cells } = await this.repo.overview(s.authorityId);
    return shapeOverview(schemes, cells, new Date().toISOString());
  }

  async open(s: GovSession, id: string) {
    const row = UUID_RE.test(id) ? await this.repo.openApplication(s.authorityId, id, who(s)) : null;
    if (!row) throw govRefused('GOV_APPLICATION_NOT_FOUND');
    // B2f: `formDeclared` false → the version this application was filed under declares no field, so no form field is shown (the API says so)
    return { ...strip(row), formDeclared: row.form.length > 0, recorded: true as const };
  }

  /** B2 — one act. Every refusal below runs BEFORE `idem.remember` and before any write. */
  async act(s: GovSession, id: string, dto: { act: GovAct; reasonCode?: string; note?: string }, key: string | undefined) {
    if (!key) throw govRefused('GOV_IDEMPOTENCY_KEY_REQUIRED');
    const input = actInputRefusal(dto.act, dto.reasonCode, dto.note); if (input) throw govRefused(input);
    const perm = actPermissionRefusal(dto.act, s.permissions); if (perm) throw govRefused(perm, { required: [dto.act === 'approve' || dto.act === 'reject' ? 'authority.applications.decide' : 'authority.applications.verify'] });
    const found = UUID_RE.test(id) ? await this.repo.actFacts(s.authorityId, s.userId, id) : null;
    const refusal = actFactsRefusal(dto.act, found?.facts ?? null); if (refusal) throw govRefused(refusal);
    const note = dto.note?.trim() ? dto.note.trim() : null;
    const reasonCode = dto.act === 'reject' ? dto.reasonCode! : null;
    try {
      return await this.idem.remember(key, s.userId, 'gov.applications.act', async () => {
        const out = await this.repo.act(found!.shard, s.authorityId, s.userId, id, dto.act, reasonCode, note, async (tx, r) => {
          // the farmer's ORGANISATION can read this row (a tenant row of the application's organisation); no amount — none exists
          await this.audit.write(tx, { tenantId: r.tenantId, actorUserId: s.userId, actorRole: govActorRole(s), action: `gov.application.${dto.act}`,
            entityType: 'scheme_application', entityId: id, oldValue: { status: r.fromStatus },
            newValue: { status: r.toStatus, realm: 'gov', authorityId: s.authorityId, ...(reasonCode ? { reasonCode } : {}) },
            reason: note, ip: s.ip, requestId: s.requestId });
          await this.outbox.write(tx, { tenantId: r.tenantId, aggregateType: 'scheme_application', aggregateId: id, eventType: EVENT_OF[dto.act],
            payload: { v: 1, applicationId: id, from: r.fromStatus, to: r.toStatus, realm: 'gov', authorityId: s.authorityId, ...(reasonCode ? { reasonCode } : {}) } });
        });
        return { id, act: dto.act, status: out.toStatus, from: out.fromStatus, decidedAt: out.decidedAt, recorded: true as const };
      });
    } catch (e) { throw namedGovRefusal(e); }
  }

  /** B3 — the authority's own schemes (published fields only). */
  async schemes(s: GovSession) { return this.repo.schemes(s.authorityId, null); }
  async scheme(s: GovSession, id: string) {
    const row = UUID_RE.test(id) ? (await this.repo.schemes(s.authorityId, id))[0] : undefined;
    if (!row) throw govRefused('GOV_SCHEME_NOT_FOUND');
    return row;
  }
  async schemeVersions(s: GovSession, id: string) {
    await this.scheme(s, id);
    return this.repo.schemeVersions(s.authorityId, id);
  }
  async schemeVersionDiff(s: GovSession, id: string, version: string) {
    await this.scheme(s, id);
    const n = /^[0-9]{1,6}$/.test(version) ? Number(version) : NaN;
    const rows = Number.isFinite(n) ? await this.repo.schemeVersionDiff(s.authorityId, id, n) : [];
    if (rows.length === 0) throw govRefused('GOV_SCHEME_VERSION_NOT_FOUND');
    return { version: n, comparedWith: rows[0].comparedWith, changes: rows.filter((r) => r.field !== null).map((r) => ({ field: r.field, from: r.from, to: r.to })) };
  }
}
