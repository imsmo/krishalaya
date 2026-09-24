// modules/education/repositories/instructor.repository.ts · instructors + instructor_credentials (0173). tenant_id in
// every tenant query (Law 1) + RLS (NULL tenant = platform instructor, read-only here). A user has at most one instructor
// row per tenant.
//
// PC-56 TENANT-7d adds the credential rows, the platform language registry read (the review validates codes against
// it), the desk's list, and W410's three honest aggregates — learners in a window (enrollments), watch-seconds LIFETIME
// (lesson_progress has no timestamp, so "this month" is not a fact this table holds), certificates lifetime. Every read
// of `lesson_progress` here is the first by an instructor-facing surface, and it is made only because 0173 gave the row
// RLS.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Instructor, InstructorVisibility } from '../domain/instructor.entity';
import { InstructorCredential, CredentialStatus } from '../domain/instructor-credential.entity';
import { RegistryLanguage } from '../domain/instructor-review';

const COLS = `id, user_id, tenant_id, bio, royalty_bps, is_verified, created_at, display_name, languages, visibility, verified_at, verified_by, verification_note`;
function toDomain(r: any): Instructor {
  return Instructor.rehydrate({
    id: r.id, userId: r.user_id, tenantId: r.tenant_id, bio: r.bio, royaltyBps: r.royalty_bps, isVerified: r.is_verified, createdAt: r.created_at,
    displayName: r.display_name ?? null, languages: Array.isArray(r.languages) ? (r.languages as string[]) : [], visibility: (r.visibility ?? 'public') as InstructorVisibility,
    verifiedAt: r.verified_at ?? null, verifiedBy: r.verified_by ?? null, verificationNote: r.verification_note ?? null,
  });
}
const CRED_COLS = `id, tenant_id, instructor_id, title, issuer, year_awarded, document_media_id, status, submitted_at, reviewed_at, reviewed_by, review_note`;
function credToDomain(r: any): InstructorCredential {
  return InstructorCredential.rehydrate({
    id: r.id, tenantId: r.tenant_id, instructorId: r.instructor_id, title: r.title, issuer: r.issuer ?? null, yearAwarded: r.year_awarded ?? null, documentMediaId: r.document_media_id,
    status: r.status as CredentialStatus, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at ?? null, reviewedBy: r.reviewed_by ?? null, reviewNote: r.review_note ?? null,
  });
}

/** The desk's list row: the instructor, the user's name behind it, and what is waiting. */
export interface InstructorListRow { instructor: Instructor; fullName: string | null; pendingCredentials: number; acceptedCredentials: number; courses: number }
/** W410's tiles, as facts: learners who enrolled in the window, watch-seconds ever, certificates ever — over THIS instructor's courses. */
export interface StudioFacts { learnersWindow: number; learnersLifetime: number; watchSecondsLifetime: string; certificatesLifetime: number; upcomingClasses: number; nextClass: { id: string; title: string; scheduledAt: Date; localDate: string; localTime: string } | null }

@Injectable()
export class InstructorRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, i: Instructor, tenantId: string): Promise<void> {
    const p = i.toProps();
    await tx.query(`INSERT INTO instructors (id, user_id, tenant_id, bio, royalty_bps, is_verified, created_by, display_name, languages, visibility) VALUES ($1,$2,$3,$4,$5,$6,$2,$7,$8::jsonb,$9)`,
      [p.id, p.userId, tenantId, p.bio, p.royaltyBps, p.isVerified, p.displayName, JSON.stringify(p.languages), p.visibility]);
  }
  async update(tx: TxContext, i: Instructor, tenantId: string): Promise<void> {
    const p = i.toProps();
    await tx.query(`UPDATE instructors SET bio=$3, display_name=$4, languages=$5::jsonb, visibility=$6, is_verified=$7, verified_at=$8, verified_by=$9, verification_note=$10, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, tenantId, p.bio, p.displayName, JSON.stringify(p.languages), p.visibility, p.isVerified, p.verifiedAt, p.verifiedBy, p.verificationNote]);
  }
  async findByUser(tenantId: string, userId: string, tx?: TxContext): Promise<Instructor | null> {
    const sql = `SELECT ${COLS} FROM instructors WHERE user_id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [userId, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [userId, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<Instructor | null> {
    // visible: the tenant's own instructor OR a platform instructor (tenant_id IS NULL)
    const sql = `SELECT ${COLS} FROM instructors WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL) AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The tenant's OWN instructor row, locked for an act. A platform instructor is never locked here (Law 11). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Instructor | null> {
    const r = await tx.query(`SELECT ${COLS} FROM instructors WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The user's name behind an instructor row — the fallback when `display_name` is NULL. */
  async fullNameOf(tenantId: string, userId: string, tx?: TxContext): Promise<string | null> {
    const sql = `SELECT full_name FROM users WHERE id=$1`;
    const r = tx ? await tx.query(sql, [userId]) : await this.replica.forTenant(tenantId).query(sql, [userId]);
    return r.rows[0]?.full_name ?? null;
  }

  /** The desk's list (W419 reached for another instructor): this tenant's instructors, keyset by (created_at, id) descending. */
  async listForDesk(tenantId: string, q: { verified?: boolean; cursor?: { c: string; id: string }; limit: number }): Promise<InstructorListRow[]> {
    const params: unknown[] = [tenantId, q.limit];
    const where = [`i.tenant_id=$1`, `i.deleted_at IS NULL`];
    if (q.verified !== undefined) { params.push(q.verified); where.push(`i.is_verified=$${params.length}`); }
    if (q.cursor) { params.push(q.cursor.c, q.cursor.id); where.push(`(i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS.split(', ').map((c) => `i.${c}`).join(', ')}, u.full_name,
              (SELECT count(*)::int FROM instructor_credentials c WHERE c.instructor_id=i.id AND c.tenant_id=i.tenant_id AND c.status='submitted' AND c.deleted_at IS NULL) AS pending,
              (SELECT count(*)::int FROM instructor_credentials c WHERE c.instructor_id=i.id AND c.tenant_id=i.tenant_id AND c.status='accepted' AND c.deleted_at IS NULL) AS accepted,
              (SELECT count(*)::int FROM courses k WHERE k.instructor_id=i.id AND k.tenant_id=i.tenant_id AND k.deleted_at IS NULL) AS courses
         FROM instructors i JOIN users u ON u.id=i.user_id
        WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC, i.id DESC LIMIT $2`, params);
    return r.rows.map((x: any) => ({ instructor: toDomain(x), fullName: x.full_name ?? null, pendingCredentials: x.pending, acceptedCredentials: x.accepted, courses: x.courses }));
  }

  /* ---- the platform language registry (Law 6) -------------------------------------------------------------------- */
  async languages(tenantId: string, tx?: TxContext): Promise<RegistryLanguage[]> {
    const sql = `SELECT code, name_english, name_native, is_active FROM languages WHERE deleted_at IS NULL ORDER BY sort_order, code`;
    const r = tx ? await tx.query(sql) : await this.replica.forTenant(tenantId).query(sql);
    return r.rows.map((x: any) => ({ code: x.code, nameEnglish: x.name_english, nameNative: x.name_native, isActive: x.is_active }));
  }

  /* ---- credentials ------------------------------------------------------------------------------------------------ */
  async insertCredential(tx: TxContext, c: InstructorCredential, createdBy: string): Promise<void> {
    const p = c.toProps();
    await tx.query(`INSERT INTO instructor_credentials (id, tenant_id, instructor_id, title, issuer, year_awarded, document_media_id, status, submitted_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.tenantId, p.instructorId, p.title, p.issuer, p.yearAwarded, p.documentMediaId, p.status, p.submittedAt, createdBy]);
  }
  async updateCredential(tx: TxContext, c: InstructorCredential, updatedBy: string): Promise<void> {
    const p = c.toProps();
    await tx.query(`UPDATE instructor_credentials SET title=$3, issuer=$4, year_awarded=$5, document_media_id=$6, status=$7, submitted_at=$8, reviewed_at=$9, reviewed_by=$10, review_note=$11, updated_by=$12, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.title, p.issuer, p.yearAwarded, p.documentMediaId, p.status, p.submittedAt, p.reviewedAt, p.reviewedBy, p.reviewNote, updatedBy]);
  }
  async credentialsOf(tenantId: string, instructorId: string, tx?: TxContext): Promise<InstructorCredential[]> {
    const sql = `SELECT ${CRED_COLS} FROM instructor_credentials WHERE tenant_id=$1 AND instructor_id=$2 AND deleted_at IS NULL ORDER BY submitted_at, id`;
    const r = tx ? await tx.query(sql, [tenantId, instructorId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, instructorId]);
    return r.rows.map(credToDomain);
  }
  async getCredential(tenantId: string, instructorId: string, id: string, tx?: TxContext): Promise<InstructorCredential | null> {
    const sql = `SELECT ${CRED_COLS} FROM instructor_credentials WHERE id=$1 AND tenant_id=$2 AND instructor_id=$3 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId, instructorId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId, instructorId]);
    return r.rows[0] ? credToDomain(r.rows[0]) : null;
  }
  async getCredentialForUpdate(tx: TxContext, tenantId: string, instructorId: string, id: string): Promise<InstructorCredential | null> {
    const r = await tx.query(`SELECT ${CRED_COLS} FROM instructor_credentials WHERE id=$1 AND tenant_id=$2 AND instructor_id=$3 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId, instructorId]);
    return r.rows[0] ? credToDomain(r.rows[0]) : null;
  }
  /** The scan states of the documents behind a set of credentials — THIS tenant's bucket only. */
  async documentScans(tenantId: string, mediaIds: readonly string[], tx?: TxContext): Promise<Map<string, { kind: string; scanStatus: string; mimeType: string }>> {
    const out = new Map<string, { kind: string; scanStatus: string; mimeType: string }>();
    if (mediaIds.length === 0) return out;
    const sql = `SELECT id, kind, scan_status, mime_type FROM media_assets WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [tenantId, mediaIds]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, mediaIds]);
    for (const x of r.rows) out.set(x.id, { kind: x.kind, scanStatus: x.scan_status, mimeType: x.mime_type });
    return out;
  }

  /* ---- W410 · the studio's facts ---------------------------------------------------------------------------------- */
  async studioFacts(tenantId: string, instructorId: string, hostUserId: string, since: Date, now: Date): Promise<StudioFacts> {
    const db = this.replica.forTenant(tenantId);
    const [enr, watch, live] = await Promise.all([
      db.query(`SELECT count(*) FILTER (WHERE e.created_at >= $3)::int AS learners_window, count(*)::int AS learners_lifetime, count(e.certificate_media_id)::int AS certificates
                  FROM enrollments e JOIN courses c ON c.id=e.course_id
                 WHERE e.tenant_id=$1 AND c.instructor_id=$2 AND c.tenant_id=$1 AND e.deleted_at IS NULL AND c.deleted_at IS NULL`, [tenantId, instructorId, since]),
      db.query(`SELECT coalesce(sum(lp.seconds_watched), 0)::text AS secs
                  FROM lesson_progress lp JOIN enrollments e ON e.id=lp.enrollment_id JOIN courses c ON c.id=e.course_id
                 WHERE lp.tenant_id=$1 AND e.tenant_id=$1 AND c.instructor_id=$2 AND c.tenant_id=$1 AND e.deleted_at IS NULL AND c.deleted_at IS NULL`, [tenantId, instructorId]),
      // the next class: its instant AND its wall-clock in the COOPERATIVE's zone (7c's rule — never this process's zone)
      db.query(`WITH mine AS (SELECT id, title, scheduled_at FROM live_sessions WHERE tenant_id=$1 AND host_user_id=$2 AND status='scheduled' AND scheduled_at >= $3 AND deleted_at IS NULL),
                     zone AS (SELECT co.timezone FROM tenants t JOIN countries co ON co.code=t.country_code WHERE t.id=$1)
                SELECT (SELECT count(*)::int FROM mine) AS n, nx.id AS next_id, nx.title AS next_title, nx.scheduled_at AS next_at,
                       to_char(nx.scheduled_at AT TIME ZONE zone.timezone, 'YYYY-MM-DD') AS local_date, to_char(nx.scheduled_at AT TIME ZONE zone.timezone, 'HH24:MI') AS local_time
                  FROM (SELECT * FROM mine ORDER BY scheduled_at, id LIMIT 1) nx, zone`, [tenantId, hostUserId, now]),
    ]);
    const e = enr.rows[0] ?? {}; const l = live.rows[0] ?? {};
    return {
      learnersWindow: e.learners_window ?? 0, learnersLifetime: e.learners_lifetime ?? 0, watchSecondsLifetime: String(watch.rows[0]?.secs ?? '0'), certificatesLifetime: e.certificates ?? 0,
      upcomingClasses: l.n ?? 0, nextClass: l.next_id ? { id: l.next_id, title: l.next_title, scheduledAt: l.next_at, localDate: l.local_date, localTime: l.local_time } : null,
    };
  }
}
