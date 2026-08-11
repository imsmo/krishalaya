// modules/identity/controllers/v1/member-roster.controller.ts · W153 (PC-56 TENANT-1b).
//
// The people roster and the per-field PII reveal. Two routes, two grants: `report.view` to see that a member exists,
// `member.pii.reveal` to see how to telephone them. **W153's restricted state is exactly this split** — "viewing needs
// member-desk scope; PII stays masked — full reveal is per-field, recorded, and reasoned" — and one grant covering both
// would make the masking a formality.
import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { MemberRosterReadModel } from '../../read-models/member-roster.read-model';
import { MemberDetailReadModel } from '../../read-models/member-detail.read-model';
import { MemberPiiService } from '../../services/member-pii.service';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { IdentityPermissions } from '../../policies/identity.policies';
import { QueryRosterSchema, QueryRosterDto, RevealPiiSchema, RevealPiiDto, SuspendMemberSchema, SuspendMemberDto } from '../../dto/member-roster.dto';
import { MemberSuspensionService } from '../../services/member-suspension.service';
import { Farmer360Service } from '../../services/farmer-360.service';

const ipOf = (req: Request) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
const reqIdOf = (req: Request) => (req.headers['x-request-id'] as string) || null;

@Controller({ path: 'members/roster', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class MemberRosterController {
  constructor(
    private readonly roster: MemberRosterReadModel,
    private readonly detail: MemberDetailReadModel,
    private readonly pii: MemberPiiService,
    private readonly suspensions: MemberSuspensionService,
    private readonly farmer360: Farmer360Service,
  ) {}

  /** The roster. Every phone on it is masked in the read model, so this response cannot leak one. */
  @Get()
  @RequirePermissions(IdentityPermissions.Report)
  async list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryRosterSchema) q: QueryRosterDto) {
    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    const [items, census] = await Promise.all([
      this.roster.list(ctx.tenantId, { ...q, cursor }),
      this.roster.census(ctx.tenantId),
    ]);
    const last = items[items.length - 1];
    return {
      data: items,
      meta: {
        ...census,
        // Keyset: the cursor carries the sort key, not a page number.
        nextCursor: items.length === q.limit && last
          ? Buffer.from(`${last.fullName ?? ''}|${last.userId}`).toString('base64')
          : null,
      },
    };
  }

  /**
   * ONE MEMBER (W154). Same grant as the roster — `report.view` — and deliberately so: the detail shows no PII the
   * roster does not already show masked. The money tiles are the tenant's own payouts and orders, which a member desk
   * has to see to answer "have I been paid"; W154's separate "money figures need finance scope" line describes a
   * refinement of report.view this platform's grant vocabulary does not yet carry (TENANT-1b-Q4), and splitting it
   * badly here would be worse than naming it.
   *
   * **404 AND NOT 403 FOR A NON-MEMBER**, matching `MemberPiiService`: "that person exists but is not yours" is an
   * enumeration oracle across 15,000 tenants.
   */
  @Get(':userId')
  @RequirePermissions(IdentityPermissions.Report)
  async member(@CurrentContext() ctx: RequestContext, @Param('userId') userId: string) {
    const data = await this.detail.get(ctx.tenantId, userId);
    if (!data) throw new NotFoundError('member not found in this organisation');
    return { data };
  }

  /**
   * THE 360 (W155). Assembled at query time, no new tables, and **the view is recorded before the data is returned** —
   * `member.view360` is the narrowest grant in this console because this is the deepest per-person read in it.
   *
   * A GET that writes an audit row, which is the one shape this programme otherwise refuses (a proxy caches a GET, a
   * browser prefetches one). It is right here and the reveal was right to be a POST, for opposite reasons: a reveal
   * CHANGES what the caller knows and must be deliberate, while opening a profile IS the read — making it a POST would
   * break the back button on the page a field officer opens forty times a day. The route is `Cache-Control: no-store` at
   * the app level and the audit row carries the request id, so a duplicated prefetch is visible rather than invisible.
   */
  @Get(':userId/360')
  @RequirePermissions(IdentityPermissions.View360)
  async view360(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('userId') userId: string) {
    const data = await this.farmer360.view(
      ctx.tenantId, { userId: ctx.userId!, ip: ipOf(req), requestId: reqIdOf(req) }, userId);
    return { data };
  }

  /**
   * SUSPEND a member of this organisation (W154's danger zone, PC-56 TENANT-1b-2).
   *
   * **`user.approve` AND NOT A NEW PERMISSION.** That grant's seeded description is already "approve users/roles, review
   * KYC, change status" — this IS the status act a member desk performs, and inventing `member.suspend` would leave the
   * two halves of one job behind two grants nobody remembers to give together.
   *
   * The route says `suspension` rather than `status`, because what it writes is a tenant-scoped suspension record and
   * NOT `users.status`. A route named after the global column would invite exactly the mistake 0127 refuses.
   */
  @Post(':userId/suspension')
  @RequirePermissions(IdentityPermissions.Approve)
  async suspend(
    @CurrentContext() ctx: RequestContext,
    @Req() req: Request,
    @Param('userId') userId: string,
    @ZodBody(SuspendMemberSchema) body: SuspendMemberDto,
  ) {
    const data = await this.suspensions.suspend(
      ctx.tenantId, { userId: ctx.userId!, ip: ipOf(req), requestId: reqIdOf(req) }, userId, body.reason);
    return { data };
  }

  /**
   * REINSTATE. A DELETE on the suspension resource, with a reason in the body — the suspension record is not deleted (no
   * DELETE grant exists on that table, by design); the EPISODE is closed and stays readable.
   */
  @Delete(':userId/suspension')
  @RequirePermissions(IdentityPermissions.Approve)
  async lift(
    @CurrentContext() ctx: RequestContext,
    @Req() req: Request,
    @Param('userId') userId: string,
    @ZodBody(SuspendMemberSchema) body: SuspendMemberDto,
  ) {
    const data = await this.suspensions.lift(
      ctx.tenantId, { userId: ctx.userId!, ip: ipOf(req), requestId: reqIdOf(req) }, userId, body.reason);
    return { data };
  }

  /** The live episode plus the history. Same grant as the roster: seeing that a member is suspended is part of reading
   *  the roster, while CHANGING it is the approve grant above. */
  @Get(':userId/suspension')
  @RequirePermissions(IdentityPermissions.Report)
  async suspensionStatus(@CurrentContext() ctx: RequestContext, @Param('userId') userId: string) {
    return { data: await this.suspensions.statusFor(ctx.tenantId, userId) };
  }

  /**
   * **REVEAL ONE FIELD OF ONE MEMBER, WITH A REASON, RECORDED.** A POST rather than a GET because it is an ACT and not a
   * lookup: it writes an audit row, and a GET that writes is a GET a proxy will cache and a browser will prefetch.
   */
  @Post(':userId/reveal')
  @RequirePermissions(IdentityPermissions.RevealPii)
  async reveal(
    @CurrentContext() ctx: RequestContext,
    @Req() req: Request,
    @Param('userId') userId: string,
    @ZodBody(RevealPiiSchema) body: RevealPiiDto,
  ) {
    const data = await this.pii.revealField(
      ctx.tenantId,
      { userId: ctx.userId!, canRevealPii: true, ip: ipOf(req), requestId: reqIdOf(req) },
      userId, body.field, body.reason,
    );
    return { data };
  }
}

/** The keyset cursor: the last row's sort key, base64'd. Malformed input yields UNDEFINED rather than an error — a stale
 *  bookmark should land on page one, not on a 400. */
function decodeCursor(raw: string): { name: string; id: string } | undefined {
  try {
    const [name, id] = Buffer.from(raw, 'base64').toString('utf8').split('|');
    return id ? { name: name ?? '', id } : undefined;
  } catch { return undefined; }
}
