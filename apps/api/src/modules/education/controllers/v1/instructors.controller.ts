// modules/education/controllers/v1/instructors.controller.ts · PC-56 TENANT-7d · THE INSTRUCTOR (W410 · W419 + the
// instructor-form and instructor-mutate chains). `education` flag; auth; the permission is judged by the review or the
// verdict (the instructor themselves, or the desk's key), not by a decorator, so a refused act is a sentence and never a
// bare 403. Every write takes an Idempotency-Key (Law 3). PC-26's `PUT /instructors/me` (a bio, no key, no audit row)
// stays for its callers but is the form chain's write now.
//
//   GET    /education/instructors                         the desk's list (course.publish): who is verified, what is waiting
//   GET    /education/instructors/languages               the platform language registry's active rows (Law 6) — the form's choices before a profile exists
//   GET    /education/instructors/studio                  W410 — the caller's own desk: profile, courses by state, classes, three measured tiles
//   POST   /education/instructors/preview                 the form's review (no key — writes nothing); `form` = profile | credential
//   GET    /education/instructors/me                      W419 for the caller (PC-26's shape, extended)
//   PUT    /education/instructors/me                      W419 "Save profile" — creates the row on the first save; keyed, audited
//   POST   /education/instructors/me/credentials          W419 "Add credential" — keyed, audited
//   PATCH  /education/instructors/me/credentials/:cid     W419 "Re-upload a clearer scan" — a rejected credential re-filed
//   GET    /education/instructors/me/credentials/:cid/form  the re-upload form's first values
//   GET    /education/instructors/:id                     W419 for an instructor: themselves, the desk, or anyone for a PUBLIC profile
//   POST   /education/instructors/:id/acts/:act           verify · unverify · accept · reject · withdraw — WITH A REASON
//
// Static segments (`languages`, `studio`, `preview`, `me`) are declared BEFORE `:id` — the route-order reason this programme has documented since 6d.
import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { InstructorService } from '../../services/instructor.service';
import { canAuthor, canPublish, isEducationAdmin, canHost, canModerateContent } from '../../policies/education.policies';
import {
  CreateInstructorSchema, CredentialFormSchema, CredentialFormDto, InstructorActSchema, InstructorActDto, PreviewInstructorSchema, PreviewInstructorDto, ProfileFormSchema, ProfileFormDto,
  QueryInstructorsSchema, QueryInstructorsDto,
} from '../../dto/create-instructor.dto';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [at, id] = Buffer.from(c, 'base64').toString().split('|'); return at && id ? { c: at, id } : undefined; };
const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'education/instructors', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('education')
export class InstructorsController {
  constructor(private readonly svc: InstructorService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canAuthor: canAuthor(ctx), canPublish: canPublish(ctx), isAdmin: isEducationAdmin(ctx), canHost: canHost(ctx), canModerate: canModerateContent(ctx) }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInstructorsSchema) q: QueryInstructorsDto) {
    return this.svc.listForDesk(ctx.tenantId, this.actor(ctx), { verified: q.verified === undefined ? undefined : q.verified === 'true', cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('languages')
  languages(@CurrentContext() ctx: RequestContext) { return this.svc.languages(ctx.tenantId).then((data) => ({ data })); }
  @Get('studio')
  studio(@CurrentContext() ctx: RequestContext) { return this.svc.studio(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(PreviewInstructorSchema) dto: PreviewInstructorDto) { return this.svc.preview(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data })); }

  @Get('me')
  mine(@CurrentContext() ctx: RequestContext) { return this.svc.viewMine(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  /** The profile write. A body with only `bio` is PC-26's shape and is saved as such; the form chain sends the four fields. */
  @Put('me')
  save(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Body() raw: unknown) {
    const body = (raw ?? {}) as Record<string, unknown>;
    const legacy = Object.keys(body).every((k) => k === 'bio');
    if (legacy) { const dto = CreateInstructorSchema.parse(body); return this.svc.become(ctx.tenantId, this.actor(ctx), dto.bio ?? null).then((data) => ({ data })); }
    const dto: ProfileFormDto = ProfileFormSchema.parse(body);
    return this.svc.saveProfile(ctx.tenantId, this.actor(ctx), key ?? `profile:${ctx.tenantId}:${ctx.userId}:${Date.now()}`, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('me/credentials')
  file(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(CredentialFormSchema) dto: CredentialFormDto) {
    return this.svc.fileCredential(ctx.tenantId, this.actor(ctx), key, dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get('me/credentials/:cid/form')
  credentialForm(@CurrentContext() ctx: RequestContext, @Param('cid') cid: string) { return this.svc.credentialForm(ctx.tenantId, this.actor(ctx), cid).then((data) => ({ data })); }
  @Patch('me/credentials/:cid')
  refile(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('cid') cid: string, @ZodBody(CredentialFormSchema) dto: CredentialFormDto) {
    return this.svc.refileCredential(ctx.tenantId, this.actor(ctx), key, cid, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.viewById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('act') act: string, @ZodBody(InstructorActSchema) dto: InstructorActDto) {
    return this.svc.act(ctx.tenantId, this.actor(ctx), key, id, act, dto, ipOf(r)).then((data) => ({ data }));
  }
}
