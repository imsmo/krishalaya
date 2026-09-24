// modules/education/repositories/course.repository.ts · courses. tenant_id in every tenant query (Law 1) + RLS
// (NULL tenant = platform library, visible to all). No version → mutations lock FOR UPDATE. Keyset browse.
//
// PC-56 TENANT-7a — THE PLATFORM LIBRARY IS ITS PUBLISHED ROWS. The policy on `courses` admits every `tenant_id IS
// NULL` row, and until this wave every read here passed that through: a KVK's DRAFT course, a course the platform had
// PAUSED, and one it had ARCHIVED were all readable by every tenant's desk and every learner's `get`. What a tenant may
// see of the library is what the library has published — `libraryVisible()` says so once, and every read applies it.
// A tenant's OWN rows are visible in every status, because they are its own.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Course } from '../domain/course.entity';
import { CourseTemplateRow } from '../domain/course-template';
import { CourseStatus, CourseLevel } from '../domain/education.events';
import { MoneyShape, minorToMajorText } from '../domain/course-money';

const COLS = `c.id, c.tenant_id, c.instructor_id, c.default_title, c.topic_id, c.audience_role_ids, c.level, c.price_minor, c.currency_code, c.cert_enabled, c.cover_media_id, c.status, c.created_at,
  c.submitted_at, c.submitted_by, c.reviewed_at, c.reviewed_by, c.review_note, c.published_at, c.archived_at,
  lv.code AS topic_code, lv.default_name AS topic_name, cu.minor_units AS minor_units,
  (SELECT count(*)::int FROM course_lessons l WHERE l.course_id = c.id AND l.deleted_at IS NULL) AS lesson_count`;
const FROM = `FROM courses c LEFT JOIN lookup_values lv ON lv.id = c.topic_id LEFT JOIN currencies cu ON cu.code = c.currency_code`;
/** A tenant's own rows in any status; the platform library's PUBLISHED rows only. */
const libraryVisible = (tenantParam: string) => `(c.tenant_id=${tenantParam} OR (c.tenant_id IS NULL AND c.status='published'))`;

function toDomain(r: any): Course {
  return Course.rehydrate({ id: r.id, tenantId: r.tenant_id, instructorId: r.instructor_id, defaultTitle: r.default_title, topicId: r.topic_id,
    audienceRoleIds: (r.audience_role_ids ?? []) as string[], level: r.level as CourseLevel, priceMinor: BigInt(r.price_minor), currencyCode: r.currency_code,
    certEnabled: r.cert_enabled, coverMediaId: r.cover_media_id, status: r.status as CourseStatus, createdAt: r.created_at,
    submittedAt: r.submitted_at ?? null, submittedBy: r.submitted_by ?? null, reviewedAt: r.reviewed_at ?? null, reviewedBy: r.reviewed_by ?? null,
    reviewNote: r.review_note ?? null, publishedAt: r.published_at ?? null, archivedAt: r.archived_at ?? null,
    topicCode: r.topic_code ?? null, topicName: r.topic_name ?? null, lessonCount: r.lesson_count ?? null,
    // The price as MAJOR text, computed here from the currency's own scale — null when the platform holds no scale for it.
    priceMajor: r.minor_units == null ? null : minorToMajorText(String(r.price_minor), Number(r.minor_units)) });
}
const templateRow = (x: any): CourseTemplateRow => ({ id: x.id, tenantId: x.tenant_id ?? null, code: x.code, title: x.title, topicCode: x.topic_code, level: x.level, outline: x.outline, isActive: x.is_active });
export interface CourseListQuery { box: 'browse' | 'mine' | 'all'; instructorId?: string; topicId?: string; level?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

/** W178's table columns and tiles, from `enrollments` — this tenant's learners only, which for a platform course is what this tenant may know. */
export interface CourseStats { courseId: string; learners: number; completed: number; certificates: number }
export interface DeskSummary {
  byStatus: Record<CourseStatus, number>;   // the tenant's OWN rows
  libraryPublished: number;                 // platform library rows this tenant can see
  learners30d: number; completions30d: number; certificates30d: number; certificatesLifetime: number;
}

@Injectable()
export class CourseRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, c: Course, tenantId: string | null, createdBy: string): Promise<void> {
    const p = c.toProps();
    await tx.query(
      `INSERT INTO courses (id, tenant_id, instructor_id, default_title, topic_id, audience_role_ids, level, price_minor, currency_code, cert_enabled, cover_media_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
      [p.id, tenantId, p.instructorId, p.defaultTitle, p.topicId, JSON.stringify(p.audienceRoleIds), p.level, p.priceMinor.toString(), p.currencyCode, p.certEnabled, p.coverMediaId, p.status, createdBy]);
  }
  /** The tenant's OWN row, locked. A platform row is never edited through a tenant's request (Law 11). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Course | null> {
    const r = await tx.query(`SELECT ${COLS} ${FROM} WHERE c.id=$1 AND c.tenant_id=$2 AND c.deleted_at IS NULL FOR UPDATE OF c`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<Course | null> {
    const sql = `SELECT ${COLS} ${FROM} WHERE c.id=$1 AND ${libraryVisible('$2')} AND c.deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, c: Course, tenantId: string, updatedBy: string): Promise<void> {
    const p = c.toProps();
    await tx.query(`UPDATE courses SET default_title=$3, topic_id=$4, audience_role_ids=$5::jsonb, level=$6, price_minor=$7, cert_enabled=$8, cover_media_id=$9, status=$10,
         currency_code=$11, submitted_at=$12, submitted_by=$13, reviewed_at=$14, reviewed_by=$15, review_note=$16, published_at=$17, archived_at=$18, updated_by=$19, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, tenantId, p.defaultTitle, p.topicId, JSON.stringify(p.audienceRoleIds), p.level, p.priceMinor.toString(), p.certEnabled, p.coverMediaId, p.status,
       p.currencyCode, p.submittedAt ?? null, p.submittedBy ?? null, p.reviewedAt ?? null, p.reviewedBy ?? null, p.reviewNote ?? null, p.publishedAt ?? null, p.archivedAt ?? null, updatedBy]);
  }
  async listFor(tenantId: string, q: CourseListQuery): Promise<Course[]> {
    const params: unknown[] = [tenantId]; let where = `${libraryVisible('$1')} AND c.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.box === 'browse') where += ` AND c.status='published'`;
    if (q.box === 'mine' && q.instructorId) where += ` AND c.instructor_id=${p(q.instructorId)}`;
    if (q.topicId) where += ` AND c.topic_id=${p(q.topicId)}`;
    if (q.level) where += ` AND c.level=${p(q.level)}`;
    if (q.status) where += ` AND c.status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (c.created_at < ${cc} OR (c.created_at=${cc} AND c.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} ${FROM} WHERE ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /* ---- PC-56 TENANT-7a · the desk's reads ---------------------------------------------------------------- */

  /** A registry topic by CODE — `course_topic` only, so a code from another vocabulary is "unknown", not a topic. */
  async topicByCode(tenantId: string, code: string, tx?: TxContext): Promise<{ id: string; code: string; name: string } | null> {
    const sql = `SELECT id, code, default_name FROM lookup_values WHERE type_code='course_topic' AND code=$1 AND (tenant_id IS NULL OR tenant_id=$2) AND is_active AND deleted_at IS NULL ORDER BY tenant_id NULLS LAST LIMIT 1`;
    const r = tx ? await tx.query(sql, [code, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [code, tenantId]);
    return r.rows[0] ? { id: r.rows[0].id, code: r.rows[0].code, name: r.rows[0].default_name } : null;
  }
  async topics(tenantId: string): Promise<Array<{ id: string; code: string; name: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      // DISTINCT ON (code): 6c-4 found platform lookup rows duplicated because `ON CONFLICT` cannot fire on a NULL tenant_id.
      `SELECT DISTINCT ON (code) id, code, default_name, sort_order FROM lookup_values WHERE type_code='course_topic' AND (tenant_id IS NULL OR tenant_id=$1) AND is_active AND deleted_at IS NULL ORDER BY code, tenant_id NULLS LAST`, [tenantId]);
    return r.rows.sort((a: any, b: any) => (a.sort_order - b.sort_order) || String(a.code).localeCompare(String(b.code))).map((x: any) => ({ id: x.id, code: x.code, name: x.default_name }));
  }
  /** Is this media asset one of this tenant's (a cover from another tenant's bucket is not a cover)? */
  async mediaExists(tenantId: string, id: string, tx?: TxContext): Promise<boolean> {
    const sql = `SELECT 1 FROM media_assets WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows.length > 0;
  }
  /** The tenant's currency and its scale — 6e-1's query, unchanged: `tenants.country_code → countries → currencies`. */
  async moneyShape(tenantId: string, tx?: TxContext): Promise<MoneyShape | null> {
    const sql = `SELECT co.currency_code, cu.minor_units FROM tenants t JOIN countries co ON co.code = t.country_code LEFT JOIN currencies cu ON cu.code = co.currency_code WHERE t.id=$1`;
    const r = tx ? await tx.query(sql, [tenantId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    if (!x || x.currency_code == null || x.minor_units == null) return null;
    return { currencyCode: String(x.currency_code), minorUnits: Number(x.minor_units) };
  }
  /* ---- PC-56 TENANT-7d · course templates (0173) — a registry read; nothing in apps/api writes one ---------------- */
  /** The templates this tenant may start from: the platform's (tenant_id NULL) and its own, active first-class rows only. */
  async templates(tenantId: string, tx?: TxContext): Promise<CourseTemplateRow[]> {
    const sql = `SELECT id, tenant_id, code, title, topic_code, level, outline, is_active FROM course_templates WHERE (tenant_id IS NULL OR tenant_id=$1) AND is_active AND deleted_at IS NULL ORDER BY sort_order, code`;
    const r = tx ? await tx.query(sql, [tenantId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId]);
    return r.rows.map(templateRow);
  }
  /** One template by code — a tenant's own row wins over a platform row of the same code. Inactive rows ARE returned, so the review can refuse TEMPLATE_INACTIVE by name. */
  async templateByCode(tenantId: string, code: string, tx?: TxContext): Promise<CourseTemplateRow | null> {
    const sql = `SELECT id, tenant_id, code, title, topic_code, level, outline, is_active FROM course_templates WHERE (tenant_id IS NULL OR tenant_id=$1) AND code=$2 AND deleted_at IS NULL ORDER BY tenant_id NULLS LAST LIMIT 1`;
    const r = tx ? await tx.query(sql, [tenantId, code]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, code]);
    return r.rows[0] ? templateRow(r.rows[0]) : null;
  }
  /** W178's Learners / Completion columns, for the page's rows only — never a count over every course a tenant has. */
  async statsFor(tenantId: string, courseIds: readonly string[]): Promise<Map<string, CourseStats>> {
    const out = new Map<string, CourseStats>();
    if (courseIds.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT course_id, count(*)::int AS learners, count(completed_at)::int AS completed, count(certificate_media_id)::int AS certificates
         FROM enrollments WHERE tenant_id=$1 AND course_id = ANY($2::uuid[]) AND deleted_at IS NULL GROUP BY course_id`, [tenantId, courseIds]);
    for (const x of r.rows) out.set(x.course_id, { courseId: x.course_id, learners: x.learners, completed: x.completed, certificates: x.certificates });
    return out;
  }
  /** W178's tiles and status chips. Two bounded aggregates: this tenant's rows, and this tenant's enrolments in a window. */
  async deskSummary(tenantId: string, since: Date): Promise<DeskSummary> {
    const db = this.replica.forTenant(tenantId);
    const [own, lib, enr] = await Promise.all([
      db.query(`SELECT status, count(*)::int n FROM courses WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status`, [tenantId]),
      db.query(`SELECT count(*)::int n FROM courses WHERE tenant_id IS NULL AND status='published' AND deleted_at IS NULL`),
      db.query(`SELECT count(*) FILTER (WHERE created_at >= $2)::int AS learners30d,
                       count(*) FILTER (WHERE completed_at >= $2)::int AS completions30d,
                       count(*) FILTER (WHERE certificate_media_id IS NOT NULL AND completed_at >= $2)::int AS certificates30d,
                       count(certificate_media_id)::int AS certificates_lifetime
                  FROM enrollments WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId, since]),
    ]);
    const byStatus: Record<CourseStatus, number> = { draft: 0, review: 0, published: 0, paused: 0, archived: 0 };
    for (const x of own.rows) if (x.status in byStatus) byStatus[x.status as CourseStatus] = x.n;
    const e = enr.rows[0] ?? {};
    return { byStatus, libraryPublished: lib.rows[0]?.n ?? 0, learners30d: e.learners30d ?? 0, completions30d: e.completions30d ?? 0, certificates30d: e.certificates30d ?? 0, certificatesLifetime: e.certificates_lifetime ?? 0 };
  }
}
