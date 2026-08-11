// modules/identity/controllers/v1/member-roster.controller.ts · W153 (PC-56 TENANT-1b).
//
// The people roster and the per-field PII reveal. Two routes, two grants: `report.view` to see that a member exists,
// `member.pii.reveal` to see how to telephone them. **W153's restricted state is exactly this split** — "viewing needs
// member-desk scope; PII stays masked — full reveal is per-field, recorded, and reasoned" — and one grant covering both
// would make the masking a formality.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { MemberRosterReadModel } from '../../read-models/member-roster.read-model';
import { MemberPiiService } from '../../services/member-pii.service';
import { IdentityPermissions } from '../../policies/identity.policies';
import { QueryRosterSchema, QueryRosterDto, RevealPiiSchema, RevealPiiDto } from '../../dto/member-roster.dto';

const ipOf = (req: Request) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
const reqIdOf = (req: Request) => (req.headers['x-request-id'] as string) || null;

@Controller({ path: 'members/roster', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class MemberRosterController {
  constructor(
    private readonly roster: MemberRosterReadModel,
    private readonly pii: MemberPiiService,
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
