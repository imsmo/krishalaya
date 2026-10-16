// modules/communication/controllers/v1/conversations.controller.ts · chat threads + messages.
// Membership-gated server-side (non-participant ⇒ 404, no IDOR). open + post require an Idempotency-Key (Law 3).
// `communication` flag. validate→authorize→delegate only.
// PC-56 STORE-4b (founder D1 / D2): + `POST conversations/organisation` (a buyer's ONE thread with the organisation about an order or a listing,
// keyed); `POST conversations` is the STAFF open (a buyer → 403 "use the organisation thread"; every participant must belong here → else 422);
// `GET conversations?scope=organisation`; the report takes `{ reason }` and an Idempotency-Key; lock/unlock carry the kind and are audited with
// `clientIpOf`; cursors are the µs keyset (shared/pagination/us-keyset.ts — a pre-4b millisecond cursor reads as page one).
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { clientIpOf } from '../../../../core/http/client-ip';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import { canModerateMessages } from '../../policies/communication.policies';
import { OpenConversationSchema, OpenConversationDto } from '../../dto/open-conversation.dto';
import { QueryConversationsSchema, QueryConversationsDto } from '../../dto/query-conversation.dto';
import { PostMessageSchema, PostMessageDto } from '../../dto/post-message.dto';
import { QueryMessagesSchema, QueryMessagesDto } from '../../dto/query-message.dto';
import { OpenOrganisationConversationSchema, OpenOrganisationConversationDto } from '../../dto/open-organisation-conversation.dto';
import { FlagMessageSchema, FlagMessageDto } from '../../dto/flag-message.dto';

/** µs keyset (STORE-4b · B4): anything malformed — including a pre-4b millisecond cursor — is page one, never a millisecond guess. */
const decodeCursor = (c?: string) => { const k = decodeKeyset(c, UUID_RE); return k ? { c: k.ts, id: k.id } : undefined; };

@Controller({ path: 'conversations', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('communication')
export class ConversationsController {
  constructor(private readonly convos: ConversationService, private readonly messages: MessageService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, isModerator: canModerateMessages(ctx) }; }

  /** The STAFF open (arbitrary participants, each a member here). A buyer opens `POST conversations/organisation` instead (403 here). */
  @Post()
  open(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(OpenConversationSchema) dto: OpenConversationDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.convos.openGeneric(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  /** PC-56 STORE-4b · D1: the buyer's ONE thread with the ORGANISATION about an order (theirs) or a live listing — the server resolves who answers. */
  @Post('organisation')
  openWithOrganisation(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(OpenOrganisationConversationSchema) dto: OpenOrganisationConversationDto, @Req() req: Request) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.convos.openWithOrganisation(ctx.tenantId, this.actor(ctx), key, dto, clientIpOf(req)).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryConversationsSchema) q: QueryConversationsDto) {
    // Enriched inbox summaries (contract-gap P0-1): each row carries the last-message preview, the caller's unread
    // count, the counterparty name/role, and the per-participant archive flag. `archived` splits inbox vs archive.
    return this.convos.listSummaries(ctx.tenantId, this.actor(ctx), { archived: q.archived, contextType: q.contextType, contextId: q.contextId, cursor: decodeCursor(q.cursor), limit: q.limit, scope: q.scope }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.convos.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/read')
  read(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.convos.markRead(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/archive')
  archive(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.convos.setArchive(ctx.tenantId, this.actor(ctx), id, true).then((data) => ({ data })); }
  @Post(':id/restore')
  restore(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.convos.setArchive(ctx.tenantId, this.actor(ctx), id, false).then((data) => ({ data })); }
  @Post(':id/lock')
  lock(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Req() req: Request, @Body('locked') locked?: boolean) { return this.convos.setLock(ctx.tenantId, this.actor(ctx), id, locked !== false, clientIpOf(req)).then((data) => ({ data })); }

  @Post(':id/messages')
  postMessage(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(PostMessageSchema) dto: PostMessageDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.messages.post(ctx.tenantId, this.actor(ctx), id, key, dto).then((data) => ({ data }));
  }
  @Get(':id/messages')
  listMessages(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryMessagesSchema) q: QueryMessagesDto) {
    return this.messages.list(ctx.tenantId, this.actor(ctx), id, { cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  /** PC-56 STORE-4b · D2a: report WITH A REASON (a `report_reason` code), keyed (Law 3 — it had none). The body is hidden from every
   *  non-moderator from then on; the reporter is never named to anyone but a moderator. */
  @Post('messages/:messageId/flag')
  flag(@CurrentContext() ctx: RequestContext, @Param('messageId') messageId: string, @Headers('idempotency-key') key: string, @ZodBody(FlagMessageSchema) dto: FlagMessageDto, @Req() req: Request) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.messages.flag(ctx.tenantId, this.actor(ctx), messageId, key, dto, clientIpOf(req)).then((data) => ({ data }));
  }
}
