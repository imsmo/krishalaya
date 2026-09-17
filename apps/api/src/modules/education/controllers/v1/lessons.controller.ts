// modules/education/controllers/v1/lessons.controller.ts · PC-56 TENANT-7b · the lesson record (W411 · W412 · W413 +
// the lesson-form, lesson-mutate and quiz-form chains). `education` flag; auth; the permission is judged by the review
// or the verdict (an author's own course, or the desk's key), not by a decorator, so a refused act is a sentence and
// never a bare 403. Every write takes an Idempotency-Key (Law 3).
//
//   GET    /education/courses/:id/outline                                W411 — the outline, coverage, the gate, canEdit
//   POST   /education/courses/:id/lessons/preview                        the lesson form's review (no key — writes nothing)
//   POST   /education/courses/:id/lessons                                create, FORM body, key, audited
//   GET    /education/courses/:id/lessons                                the lessons (PC-26; unchanged shape + 0171 columns)
//   GET    /education/courses/:id/lessons/:lessonId                      W412/W413 — the record with its acts' verdicts
//   PATCH  /education/courses/:id/lessons/:lessonId                      edit, same body, same review, audited before/after
//   POST   /education/courses/:id/lessons/:lessonId/subtitles/preview    the subtitle form's review
//   PUT    /education/courses/:id/lessons/:lessonId/subtitles            save one track (lesson, language), key, audited
//   POST   /education/courses/:id/lessons/:lessonId/questions/:n/preview the question form's review
//   PUT    /education/courses/:id/lessons/:lessonId/questions/:n         save question n (n = count+1 appends), key, audited
//   POST   /education/courses/:id/lessons/:lessonId/acts/:act            ready · reopen · move_up · move_down — WITH A REASON
//
// Static segments (`preview`, `outline`) are declared BEFORE `:lessonId` — the route-order reason this programme has
// documented since 6d.
import { Controller, Get, Headers, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { LessonService } from '../../services/lesson.service';
import { canAuthor, canPublish, isEducationAdmin, canHost, canModerateContent } from '../../policies/education.policies';
import {
  LessonFormSchema, LessonFormDto, PreviewLessonSchema, PreviewLessonDto, SubtitleFormSchema, SubtitleFormDto, QuestionFormSchema, QuestionFormDto,
  LessonActSchema, LessonActDto, questionNoOf,
} from '../../dto/create-course-lesson.dto';
import { LessonFormRefusedError } from '../../domain/education.errors';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'education/courses/:id', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class LessonsController {
  constructor(private readonly svc: LessonService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canAuthor: canAuthor(ctx), canPublish: canPublish(ctx), isAdmin: isEducationAdmin(ctx), canHost: canHost(ctx), canModerate: canModerateContent(ctx) }; }
  private n(raw: string): number { const n = questionNoOf(raw); if (n === null) throw new LessonFormRefusedError([{ field: null, code: 'QUESTION_NOT_FOUND' }]); return n; }

  @Get('outline')
  outline(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.outline(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post('lessons/preview')
  preview(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(PreviewLessonSchema) dto: PreviewLessonDto) { return this.svc.preview(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Post('lessons')
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(LessonFormSchema) dto: LessonFormDto) {
    return this.svc.create(ctx.tenantId, this.actor(ctx), key, id, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get('lessons')
  async lessons(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return { data: (await this.svc.outline(ctx.tenantId, this.actor(ctx), id)).lessons.map((v) => v.lesson) }; }
  @Get('lessons/:lessonId')
  record(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Param('lessonId') lessonId: string) { return this.svc.record(ctx.tenantId, this.actor(ctx), id, lessonId).then((data) => ({ data })); }
  @Patch('lessons/:lessonId')
  update(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('lessonId') lessonId: string, @ZodBody(LessonFormSchema) dto: LessonFormDto) {
    return this.svc.update(ctx.tenantId, this.actor(ctx), key, id, lessonId, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post('lessons/:lessonId/subtitles/preview')
  previewSubtitle(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Param('lessonId') lessonId: string, @ZodBody(SubtitleFormSchema) dto: SubtitleFormDto) {
    return this.svc.previewSubtitle(ctx.tenantId, this.actor(ctx), id, lessonId, dto).then((data) => ({ data }));
  }
  @Put('lessons/:lessonId/subtitles')
  saveSubtitle(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('lessonId') lessonId: string, @ZodBody(SubtitleFormSchema) dto: SubtitleFormDto) {
    return this.svc.saveSubtitle(ctx.tenantId, this.actor(ctx), key, id, lessonId, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post('lessons/:lessonId/questions/:n/preview')
  previewQuestion(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Param('lessonId') lessonId: string, @Param('n') n: string, @ZodBody(QuestionFormSchema) dto: QuestionFormDto) {
    return this.svc.previewQuestion(ctx.tenantId, this.actor(ctx), id, lessonId, this.n(n), dto).then((data) => ({ data }));
  }
  @Put('lessons/:lessonId/questions/:n')
  saveQuestion(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('lessonId') lessonId: string, @Param('n') n: string, @ZodBody(QuestionFormSchema) dto: QuestionFormDto) {
    return this.svc.saveQuestion(ctx.tenantId, this.actor(ctx), key, id, lessonId, this.n(n), dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post('lessons/:lessonId/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('lessonId') lessonId: string, @Param('act') act: string, @ZodBody(LessonActSchema) dto: LessonActDto) {
    return this.svc.act(ctx.tenantId, this.actor(ctx), key, id, lessonId, act, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
