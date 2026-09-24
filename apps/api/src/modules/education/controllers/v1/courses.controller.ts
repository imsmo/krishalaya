// modules/education/controllers/v1/courses.controller.ts · course authoring + lifecycle + browse. The LESSON routes
// moved to lessons.controller.ts at PC-56 TENANT-7b (the lesson record has chains of its own).
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
// PC-56 TENANT-7d — the STUDIO form (W2775–W2778 "Start from template"):
//   GET    /education/courses/templates      the template registry this tenant may start from (0173)
//   POST   /education/courses/from-template/preview   the studio chain's review — the draft course and lessons the template will write
//   POST   /education/courses/from-template  create the draft course + its draft lessons in one transaction; key; audited
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
import { TemplateFormSchema, TemplateFormDto } from '../../dto/create-instructor.dto';
import { QueryCoursesSchema, QueryCoursesDto } from '../../dto/query-course.dto';

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

  /** PC-56 TENANT-7d · the studio form. */
  @Get('templates') @RequirePermissions(EducationPermissions.Author)
  templates(@CurrentContext() ctx: RequestContext) { return this.svc.templates(ctx.tenantId).then((rows) => ({ data: rows.map(({ id, code, title, topicCode, level, outline, tenantId }) => ({ id, code, title, topicCode, level, outline, platform: tenantId === null })) })); }
  @Post('from-template/preview')
  previewFromTemplate(@CurrentContext() ctx: RequestContext, @ZodBody(TemplateFormSchema) dto: TemplateFormDto) { return this.svc.previewFromTemplate(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }
  @Post('from-template') @RequirePermissions(EducationPermissions.Author)
  createFromTemplate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(TemplateFormSchema) dto: TemplateFormDto) {
    return this.svc.createFromTemplate(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }

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
}
