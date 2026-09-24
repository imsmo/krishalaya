// modules/education/services/instructor.service.ts · PC-56 TENANT-7d · THE INSTRUCTOR — the record behind W410 (the
// studio home), W419 (profile & credentials) and their two chains (W2636–W2639 form, W2640–W2642 mutate).
//
// WHAT IS DECLARED HONESTLY. `instructors.is_verified` was INSERTed `false` by PC-26 and written by nothing anywhere (7a's
// grep: the INSERT and a spec). A "verified instructor" badge is a TRUST surface, so the verification exists here first
// as an ACT of the tenant's content desk (`course.publish`) — never on themselves (maker ≠ checker, the verdict AND
// 0173's trigger), only on the strength of at least one ACCEPTED credential — and its revocation exists beside it. A
// credential is a document the instructor files through core/media (store · scan · serve) that the desk ACCEPTS (the
// scan clean) or REJECTS with a note the instructor reads on W419 and answers by RE-FILING through the same form.
// W419's *"verified against the certificate face"* is that human act; nothing here matches a face or reads a
// certificate, and its *"Retry"* is refused by name. The *"Rating 4.8 / 5 from enrolled learners"* has no table and is
// printed as not measured (NAMED).
//
// THE RULES THIS FILE KEEPS, all 7a's:
//   1. THE REVIEW AND THE WRITE ARE ONE FUNCTION. `preview` and the writers (`saveProfile`, `fileCredential`,
//      `refileCredential`) call the same reviewer over the same facts (the platform language registry, the media asset in
//      THIS tenant's bucket, the row as it stands); a write is refused with the review's own codes.
//   2. EVERY ACT IS A VERDICT FIRST. `instructorActVerdict` answers the confirm screen and is re-taken on the locked row.
//   3. EVERY WRITE HAS A KEY AND AN AUDIT ROW. `education.instructor.<profile|credential.file|credential.refile|verify|
//      unverify|accept|reject|withdraw>` on entity `instructor` (the credential acts name the credential in the value).
// PC-26's `become(bio)` remains as a thin caller of `saveProfile` so nothing that used it moves.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ReviewResult, looksLikeId, submittedValues, writerIssuesOf } from '../../../shared/form-review';
import { Instructor } from '../domain/instructor.entity';
import { InstructorCredential } from '../domain/instructor-credential.entity';
import { InstructorListRow, InstructorRepository, StudioFacts } from '../repositories/instructor.repository';
import { CourseRepository, CourseStats } from '../repositories/course.repository';
import { InstructorNotFoundError, EducationForbiddenError, InstructorFormRefusedError, InstructorActRefusedError, CredentialNotFoundError } from '../domain/education.errors';
import {
  COMPLETENESS_CHECKS, CompletenessCheck, CredentialReviewInput, CurrentCredential, CurrentProfile, ProfileReviewInput, credentialFormValues, profileCompleteness, profileFormValues,
  reviewCredential, reviewInstructorProfile, storedCredential, storedProfile,
} from '../domain/instructor-review';
import { InstructorAct, InstructorActVerdict, CREDENTIAL_ACTS, allInstructorVerdicts, instructorActVerdict, isInstructorAct } from '../domain/instructor-acts';
import { CredentialFormDto, CredentialWriterSchema, PreviewInstructorDto, ProfileFormDto, ProfileWriterSchema } from '../dto/create-instructor.dto';

export interface EducationActor { userId: string; canAuthor: boolean; canPublish: boolean; isAdmin: boolean; canHost: boolean; canModerate: boolean; }

const STUDIO_WINDOW_DAYS = 30;   // W410: "this month" — declared as a 30-day window, as W178's tiles are

export interface CredentialView { credential: ReturnType<InstructorCredential['toJSON']>; document: { kind: string; scanStatus: string; mimeType: string } | null }
export interface InstructorView {
  instructor: ReturnType<Instructor['toJSON']>;
  /** `display_name`, or the user's full name behind the row. */
  name: string | null;
  /** The caller is this instructor; the caller is the desk. */
  isSelf: boolean; privileged: boolean;
  credentials: CredentialView[];
  completeness: Array<{ check: CompletenessCheck; done: boolean }>;
  acts: Array<InstructorActVerdict & { credentialId: string | null }>;
  /** The registry, for the form's language choices. */
  languages: Array<{ code: string; nameEnglish: string; nameNative: string }>;
  form: Record<string, string>;
  /** W419's "Rating": nothing on this platform records one. Always null, and typed so a page cannot print a number. */
  rating: null;
}
export interface StudioView {
  instructor: InstructorView | null;
  windowDays: number;
  facts: StudioFacts | null;
  courses: Array<ReturnType<import('../domain/course.entity').Course['toJSON']> & { stats: CourseStats | null }>;
  byStatus: Record<string, number>;
  templates: Array<{ code: string; title: string; topicCode: string; level: string }>;
}

@Injectable()
export class InstructorService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: InstructorRepository,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly courses: CourseRepository,
  ) {}

  /* ---- PC-26's surface, kept ------------------------------------------------------------------------------------- */

  /** A bio-only save (PC-26's `PUT /instructors/me`). Creates the row when there is none. Unkeyed callers get a derived key. */
  async become(tenantId: string, actor: EducationActor, bio: string | null) {
    if (!actor.canAuthor) throw new EducationForbiddenError('requires course.author');
    return timed(this.metrics, 'education.instructor.become', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const existing = await this.repo.findByUser(tenantId, actor.userId, tx);
        if (existing) { existing.update({ bio }); await this.repo.update(tx, existing, tenantId); return existing.toJSON(); }
        const i = Instructor.create({ id: uuidv7(), userId: actor.userId, tenantId, bio });
        await this.repo.insert(tx, i, tenantId);
        return i.toJSON();
      }, { userId: actor.userId }));
  }
  async getMine(tenantId: string, actor: EducationActor) {
    const i = await this.repo.findByUser(tenantId, actor.userId);
    if (!i) throw new InstructorNotFoundError('me');
    return i.toJSON();
  }

  /* ---- READS ------------------------------------------------------------------------------------------------------ */

  /** W419 for the caller's own row. */
  async viewMine(tenantId: string, actor: EducationActor): Promise<InstructorView> {
    const i = await this.repo.findByUser(tenantId, actor.userId);
    if (!i) throw new InstructorNotFoundError('me');
    return this.view(tenantId, actor, i);
  }
  /** W419 for an instructor by id: the instructor themselves, the desk, or — a PUBLIC profile — any member. */
  async viewById(tenantId: string, actor: EducationActor, id: string): Promise<InstructorView> {
    const i = looksLikeId(id) ? await this.repo.getById(tenantId, id) : null;
    if (!i) throw new InstructorNotFoundError(id);
    const isSelf = i.userId === actor.userId;
    if (!isSelf && !actor.canPublish && i.toProps().visibility !== 'public') throw new InstructorNotFoundError(id);   // 404-shaped, as 7a
    return this.view(tenantId, actor, i);
  }
  private async view(tenantId: string, actor: EducationActor, i: Instructor): Promise<InstructorView> {
    const p = i.toProps();
    const isSelf = p.userId === actor.userId; const privileged = actor.canPublish;
    const [creds, registry, name] = await Promise.all([
      isSelf || privileged ? this.repo.credentialsOf(tenantId, i.id) : Promise.resolve([] as InstructorCredential[]),
      this.repo.languages(tenantId), p.displayName ? Promise.resolve(p.displayName) : this.repo.fullNameOf(tenantId, p.userId),
    ]);
    const scans = await this.repo.documentScans(tenantId, creds.map((c) => c.toProps().documentMediaId));
    const credentials: CredentialView[] = creds.map((c) => ({ credential: c.toJSON(), document: scans.get(c.toProps().documentMediaId) ?? null }));
    const acts = (isSelf || privileged) ? allInstructorVerdicts(
      { canAuthor: actor.canAuthor, canPublish: actor.canPublish, isSelf, isTenantInstructor: p.tenantId !== null, isVerified: p.isVerified, credentialStatuses: creds.map((c) => c.status) },
      creds.map((c) => ({ id: c.id, status: c.status, documentScanStatus: scans.get(c.toProps().documentMediaId)?.scanStatus ?? 'unknown' })),
    ) : [];
    return {
      instructor: i.toJSON(), name, isSelf, privileged, credentials,
      completeness: profileCompleteness({ bio: p.bio, languages: p.languages, credentials: creds.map((c) => ({ status: c.status })), isVerified: p.isVerified }),
      acts, languages: registry.filter((l) => l.isActive).map(({ code, nameEnglish, nameNative }) => ({ code, nameEnglish, nameNative })),
      form: profileFormValues(this.currentProfile(i)), rating: null,
    };
  }
  /** The registry's active rows — the form's language choices, before a profile exists to carry them. */
  async languages(tenantId: string): Promise<Array<{ code: string; nameEnglish: string; nameNative: string }>> {
    return (await this.repo.languages(tenantId)).filter((l) => l.isActive).map(({ code, nameEnglish, nameNative }) => ({ code, nameEnglish, nameNative }));
  }
  /** The desk's list — the instructors of this tenant, what is waiting on each. */
  async listForDesk(tenantId: string, actor: EducationActor, q: { verified?: boolean; cursor?: { c: string; id: string }; limit: number }): Promise<{ items: Array<Omit<InstructorListRow, 'instructor'> & { instructor: ReturnType<Instructor['toJSON']> }>; nextCursor: string | null }> {
    if (!actor.canPublish) throw new EducationForbiddenError('requires course.publish');
    const rows = await this.repo.listForDesk(tenantId, q);
    const items = rows.map((r) => ({ ...r, instructor: r.instructor.toJSON() }));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? Buffer.from(`${last.instructor.toProps().createdAt?.toISOString()}|${last.instructor.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  /** W410 — the instructor's honest desk: their profile (or none), their courses by state, their classes, three measured tiles. */
  async studio(tenantId: string, actor: EducationActor, now = new Date()): Promise<StudioView> {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    const courses = this.courses;
    const templates = (await courses.templates(tenantId)).map(({ code, title, topicCode, level }) => ({ code, title, topicCode, level }));
    const me = await this.repo.findByUser(tenantId, actor.userId);
    if (!me) return { instructor: null, windowDays: STUDIO_WINDOW_DAYS, facts: null, courses: [], byStatus: {}, templates };
    const since = new Date(now.getTime() - STUDIO_WINDOW_DAYS * 86_400_000);
    const [view, facts, rows] = await Promise.all([this.view(tenantId, actor, me), this.repo.studioFacts(tenantId, me.id, actor.userId, since, now), courses.listFor(tenantId, { box: 'mine', instructorId: me.id, limit: 100 })]);
    const stats = await courses.statsFor(tenantId, rows.map((c) => c.id));
    const byStatus: Record<string, number> = {};
    for (const c of rows) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    return { instructor: view, windowDays: STUDIO_WINDOW_DAYS, facts, courses: rows.map((c) => ({ ...c.toJSON(), stats: stats.get(c.id) ?? null })), byStatus, templates };
  }

  /* ---- THE FORMS: review and write, one function ---------------------------------------------------------------- */

  async preview(tenantId: string, actor: EducationActor, dto: PreviewInstructorDto, now = new Date()): Promise<ReviewResult> {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    const { form, credentialId, ...rest } = dto;
    return this.uow.run(tenantId, async (tx) => {
      if (form === 'profile') return reviewInstructorProfile(await this.profileInput(tx, tenantId, actor, rest as ProfileFormDto));
      return reviewCredential(await this.credentialInput(tx, tenantId, actor, rest as CredentialFormDto, credentialId ?? null, now));
    }, { userId: actor.userId });
  }

  /** W419 *Save profile*: creates the instructor row on the first save (PC-26's `become`), updates it afterwards. */
  async saveProfile(tenantId: string, actor: EducationActor, idemKey: string, dto: ProfileFormDto, ip: string | null) {
    if (!actor.canAuthor) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.instructor.profile', () =>
      timed(this.metrics, 'education.instructor.profile', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const input = await this.profileInput(tx, tenantId, actor, dto);
          const stored = storedProfile(input);
          if (!stored) throw new InstructorFormRefusedError(reviewInstructorProfile(input).refusals);
          const existing = await this.repo.findByUser(tenantId, actor.userId, tx);
          if (existing) {
            const before = existing.toJSON();
            existing.updateProfile(stored);
            await this.repo.update(tx, existing, tenantId);
            await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.instructor.profile', entityType: 'instructor', entityId: existing.id, oldValue: before, newValue: existing.toJSON(), ip });
            return existing.toJSON();
          }
          const i = Instructor.create({ id: uuidv7(), userId: actor.userId, tenantId, bio: stored.bio, displayName: stored.displayName, languages: stored.languages, visibility: stored.visibility });
          await this.repo.insert(tx, i, tenantId);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.instructor.profile', entityType: 'instructor', entityId: i.id, newValue: i.toJSON(), ip });
          return i.toJSON();
        }, { userId: actor.userId })));
  }

  /** W419 *Add credential*: files a document for the desk. */
  async fileCredential(tenantId: string, actor: EducationActor, idemKey: string, dto: CredentialFormDto, ip: string | null, now = new Date()) {
    if (!actor.canAuthor) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.instructor.credential.file', () =>
      this.uow.run(tenantId, async (tx) => {
        const input = await this.credentialInput(tx, tenantId, actor, dto, null, now);
        const stored = storedCredential(input);
        if (!stored) throw new InstructorFormRefusedError(reviewCredential(input).refusals);
        const me = (await this.repo.findByUser(tenantId, actor.userId, tx)) as Instructor;
        const c = InstructorCredential.file({ id: uuidv7(), tenantId, instructorId: me.id, at: now, ...stored });
        await this.repo.insertCredential(tx, c, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.instructor.credential.file', entityType: 'instructor', entityId: me.id, newValue: c.toJSON(), ip });
        return c.toJSON();
      }, { userId: actor.userId }));
  }

  /** W419 *Re-upload a clearer scan*: a REJECTED credential re-filed, back to the desk's queue. */
  async refileCredential(tenantId: string, actor: EducationActor, idemKey: string, credentialId: string, dto: CredentialFormDto, ip: string | null, now = new Date()) {
    if (!actor.canAuthor) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.instructor.credential.refile', () =>
      this.uow.run(tenantId, async (tx) => {
        const me = await this.repo.findByUser(tenantId, actor.userId, tx);
        const locked = me && looksLikeId(credentialId) ? await this.repo.getCredentialForUpdate(tx, tenantId, me.id, credentialId) : null;
        const input = await this.credentialInput(tx, tenantId, actor, dto, credentialId, now, locked);
        const stored = storedCredential(input);
        if (!stored || !locked) throw new InstructorFormRefusedError(reviewCredential(input).refusals);
        const before = locked.toJSON();
        locked.refile(stored, now);
        await this.repo.updateCredential(tx, locked, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.instructor.credential.refile', entityType: 'instructor', entityId: me!.id, oldValue: before, newValue: locked.toJSON(), ip });
        return locked.toJSON();
      }, { userId: actor.userId }));
  }

  private async profileInput(tx: TxContext, tenantId: string, actor: EducationActor, form: ProfileFormDto): Promise<ProfileReviewInput> {
    const body = submittedValues(form as Record<string, unknown>);
    const [me, registry] = await Promise.all([this.repo.findByUser(tenantId, actor.userId, tx), this.repo.languages(tenantId, tx)]);
    return { canAuthor: actor.canAuthor, current: me ? this.currentProfile(me) : null, entered: form, registry, writerIssues: writerIssuesOf(ProfileWriterSchema, body) };
  }
  private async credentialInput(tx: TxContext, tenantId: string, actor: EducationActor, form: CredentialFormDto, credentialId: string | null, now: Date, locked?: InstructorCredential | null): Promise<CredentialReviewInput> {
    const body = submittedValues(form as Record<string, unknown>);
    const me = await this.repo.findByUser(tenantId, actor.userId, tx);
    let current: CurrentCredential | null | undefined = undefined;
    if (credentialId !== null) {
      const c = locked !== undefined ? locked : (me && looksLikeId(credentialId) ? await this.repo.getCredential(tenantId, me.id, credentialId, tx) : null);
      current = c ? this.currentCredential(c) : null;
    }
    const docId = body.documentMediaId;
    const document = docId ? (looksLikeId(docId) ? (await this.repo.documentScans(tenantId, [docId], tx)).get(docId) ?? null : null) : undefined;
    return { canAuthor: actor.canAuthor, hasProfile: me !== null, current, entered: form, document, thisYear: now.getUTCFullYear(), writerIssues: writerIssuesOf(CredentialWriterSchema, body) };
  }
  private currentProfile(i: Instructor): CurrentProfile { const p = i.toProps(); return { displayName: p.displayName, bio: p.bio, languages: [...p.languages], visibility: p.visibility }; }
  private currentCredential(c: InstructorCredential): CurrentCredential { const p = c.toProps(); return { id: p.id, status: p.status, title: p.title, issuer: p.issuer, yearAwarded: p.yearAwarded, documentMediaId: p.documentMediaId, reviewNote: p.reviewNote }; }
  /** The re-upload form's first values. */
  async credentialForm(tenantId: string, actor: EducationActor, credentialId: string): Promise<Record<string, string> & { reviewNote: string }> {
    const me = await this.repo.findByUser(tenantId, actor.userId);
    const c = me && looksLikeId(credentialId) ? await this.repo.getCredential(tenantId, me.id, credentialId) : null;
    if (!c) throw new CredentialNotFoundError(credentialId);
    return { ...credentialFormValues(this.currentCredential(c)), reviewNote: c.toProps().reviewNote ?? '' };
  }

  /* ---- THE ACTS: verdict, then act ------------------------------------------------------------------------------ */

  async act(tenantId: string, actor: EducationActor, idemKey: string, instructorId: string, actName: string, body: { reason: string; credentialId?: string }, ip: string | null, now = new Date()) {
    if (!isInstructorAct(actName)) throw new InstructorActRefusedError(actName, ['ILLEGAL_FROM_STATUS']);
    const act: InstructorAct = actName;
    return this.idem.remember(idemKey, actor.userId, `education.instructor.${act}`, () =>
      this.uow.run(tenantId, async (tx) => {
        const i = looksLikeId(instructorId) ? await this.repo.getForUpdate(tx, tenantId, instructorId) : null;
        if (!i) throw new InstructorNotFoundError(instructorId);
        const p = i.toProps();
        const isSelf = p.userId === actor.userId;
        if (!isSelf && !actor.canPublish) throw new InstructorNotFoundError(instructorId);   // 404-shaped for a probe, as 7a
        const creds = await this.repo.credentialsOf(tenantId, i.id, tx);
        const scans = await this.repo.documentScans(tenantId, creds.map((c) => c.toProps().documentMediaId), tx);
        const credTyped = (body.credentialId ?? '').trim();
        let target: InstructorCredential | null | undefined = undefined;
        if (CREDENTIAL_ACTS.has(act)) target = credTyped.length === 0 ? undefined : (looksLikeId(credTyped) ? await this.repo.getCredentialForUpdate(tx, tenantId, i.id, credTyped) : null);
        const v = instructorActVerdict({
          act, canAuthor: actor.canAuthor, canPublish: actor.canPublish, isSelf, isTenantInstructor: p.tenantId !== null, isVerified: p.isVerified, credentialStatuses: creds.map((c) => c.status),
          credential: target === undefined ? undefined : target === null ? null : { status: target.status, documentScanStatus: scans.get(target.toProps().documentMediaId)?.scanStatus ?? 'unknown' },
          reason: body.reason,
        });
        if (!v.allowed) throw new InstructorActRefusedError(act, v.refusals);
        let before: Record<string, unknown>; let after: Record<string, unknown>;
        switch (act) {
          case 'verify': before = { isVerified: false }; i.verify(actor.userId, now, body.reason.trim()); after = { isVerified: true, verifiedBy: actor.userId, verifiedAt: now }; await this.repo.update(tx, i, tenantId); break;
          case 'unverify': before = { isVerified: true, verifiedBy: p.verifiedBy, verifiedAt: p.verifiedAt }; i.unverify(); after = { isVerified: false }; await this.repo.update(tx, i, tenantId); break;
          case 'accept': case 'reject': case 'withdraw': {
            const c = target as InstructorCredential;
            before = { credentialId: c.id, status: c.status };
            if (act === 'accept') c.accept(actor.userId, now, body.reason.trim());
            else if (act === 'reject') c.reject(actor.userId, now, body.reason.trim());
            else c.withdraw();
            await this.repo.updateCredential(tx, c, actor.userId);
            after = { credentialId: c.id, status: c.status, reviewNote: c.toProps().reviewNote };
            break;
          }
        }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `education.instructor.${act}`, entityType: 'instructor', entityId: i.id, oldValue: before, newValue: after, reason: body.reason, ip });
        this.metrics.inc('education.instructor.acts', { act });
        return { instructor: i.toJSON(), credential: target ? target.toJSON() : null };
      }, { userId: actor.userId }));
  }

  /** Exposed for the studio page's completeness list and for specs. */
  static readonly COMPLETENESS = COMPLETENESS_CHECKS;
}
