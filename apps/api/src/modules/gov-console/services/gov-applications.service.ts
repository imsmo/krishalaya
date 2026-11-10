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
// roster, member files, payouts, orders or finance — no such route exists in this realm. NO WRITE: the review acts stay where they are
// today (GOV-2's doors).
import { Injectable } from '@nestjs/common';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { GovConsoleRepository } from '../repositories/gov-console.repository';
import { clampGovLimit } from '../domain/gov-membership.rules';
import { govRefused } from '../domain/gov-console.errors';
import { GovSession } from '../guards/gov-session.guard';
import { govActorRole } from './gov-members.service';
import { GovOverview, shapeOverview } from '../domain/gov-overview';

const strip = <T extends { cursorTs: string }>(r: T): Omit<T, 'cursorTs'> => { const { cursorTs: _c, ...rest } = r; return rest; };
const who = (s: GovSession) => ({ actorUserId: s.userId, actorRole: govActorRole(s), authorityId: s.authorityId, requestId: s.requestId });

@Injectable()
export class GovApplicationsService {
  constructor(private readonly repo: GovConsoleRepository) {}

  async list(s: GovSession, q: { status?: string; cursor?: string; limit?: number }) {
    const limit = clampGovLimit(q.limit);
    const rows = await this.repo.listApplications(s.authorityId, { status: q.status, cursor: decodeKeyset(q.cursor, UUID_RE), limit }, who(s));
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
    return { ...strip(row), recorded: true as const };
  }
}
