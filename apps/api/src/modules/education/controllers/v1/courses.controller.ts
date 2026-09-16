// modules/education/controllers/v1/courses.controller.ts · course authoring + lifecycle + lessons + browse.
// Authoring/lessons need course.author and the OWN course (service enforces, 404 on non-owner); the desk's acts need
// course.publish. Browse/get are any authenticated user (published + platform library). `education` flag.
//
// PC-56 TENANT-7a — the course RECORD and the DESK (W178, W179, W416 + the course-form and course-mutate chains):
//   POST   /education/courses/preview        the form chain's review — what will be stored and every refusal (no key)
//   GET    /education/courses/desk           W178's tiles, status chips and the topic registry (course.publish)
//   POST   /education/courses                create, from the FORM body, Idempotency-Key required, audited
//   PATCH  /education/courses/:id            edit, same body, same review, audited before/after
//   GET    /education/courses/:id/acts       every act's verdict for this caller + the publish gate (W416)
//   POST   /education/courses/:id/acts/:act  submit · publish · return · pause · resume · archive — WITH A REASON
// The four PC-26 lifecycle routes (`/submit`, `/publish`, `/pause`, `/archive`) are gone: they took no reason, wrote no
// audit row, and let the course's own instructor publish. One write path per act (6d-4's rule).
//
// Static segments (`preview`, `desk`) are declared BEFORE `:id` — the route-order reason this programme has documented.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { CourseService } from '../../services/course.service';
import { EducationPermissions, canAuthor, canPublish, isEducationAdmin, canHost, canModerateContent } from '../../policies/education.policies';
import { CourseFormSchema, CourseFormDto, PreviewCourseSchema, PreviewCourseDto, CourseActSchema, CourseActDto } from '../../dto/create-course.dto';
import { QueryCoursesSchema, QueryCoursesDto } from '../../dto/query-course.dto';
import { UpsertLessonSchema, UpsertLessonDto } from '../../dto/create-course-lesson.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'education/courses', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class CoursesController {
  constructor(private readonly svc: CourseService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canAuthor: canAuthor(ctx), canPublish: canPublish(ctx), isAdmin: isEducationAdmin(ctx), canHost: canHost(ctx), canModerate: canModerateContent(ctx) }; }

  /** The review step. No idempotency key: it writes nothing. `course.author` OR the desk (which may edit any course). */
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(PreviewCourseSchema) dto: PreviewCourseDto) { return this.svc.preview(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }
  /** W178's tiles and chips. */
  @Get('desk') @RequirePermissions(EducationPermissions.Publish)
  desk(@CurrentContext() ctx: RequestContext) { return this.svc.desk(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  /** The topic registry, for the form's select — any author. */
  @Get('topics') @RequirePermissions(EducationPermissions.Author)
  topics(@CurrentContext() ctx: RequestContext) { return this.svc.topics(ctx.tenantId).then((data) => ({ data })); }

  @Post() @RequirePermissions(EducationPermissions.Author)
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CourseFormSchema) dto: CourseFormDto) {
    return this.svc.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryCoursesSchema) q: QueryCoursesDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, topicId: q.topicId, level: q.level, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit, withStats: q.withStats })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, stats: res.stats } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, id).then((data) => ({ data })); }
  @Patch(':id')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(CourseFormSchema) dto: CourseFormDto) {
    return this.svc.update(ctx.tenantId, this.actor(ctx), key, id, dto, ipOf(r)).then((data) => ({ data }));
  }

  /** W179/W416: every act's verdict and the publish gate, for this caller. */
  @Get(':id/acts')
  acts(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.verdicts(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  /** The act, with its reason. The permission is judged by the verdict (an author's or the desk's), not by a decorator. */
  @Post(':id/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('act') act: string, @ZodBody(CourseActSchema) dto: CourseActDto) {
    return this.svc.act(ctx.tenantId, this.actor(ctx), key, id, act, dto.reason, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/lessons') @RequirePermissions(EducationPermissions.Author)
  upsertLesson(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(UpsertLessonSchema) dto: UpsertLessonDto) { return this.svc.upsertLesson(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Get(':id/lessons')
  lessons(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.listLessons(ctx.tenantId, id).then((data) => ({ data })); }
}
