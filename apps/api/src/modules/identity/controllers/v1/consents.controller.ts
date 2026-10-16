// modules/identity/controllers/v1/consents.controller.ts · DPDP consent capture (append-only).
// PC-56 HOTFIX-6 · B5 (survey STORE-4 F-4 / C-10): THIS is the consent route (`/v1/consents`) — the SDK used to call `privacy/consents`, which
// does not exist, so no shipped client could list or withdraw a consent. A grant or a withdrawal accepts an OPTIONAL Idempotency-Key (hashed
// with the owner, the STORE-3a shape): a replay returns the first answer and appends nothing; without a key every POST appends one row, as
// before. A withdrawal is a `granted=false` row — as available as a grant. The list answers camelCase `{ purposeCode, granted, version,
// channel, updatedAt }` (the SDK's ConsentRecord) — it answered raw snake_case columns no client read.
import { createHash } from 'node:crypto';
import { Controller, Get, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { ConsentService } from '../../services/consent.service';
import { GrantConsentSchema, GrantConsentDto } from '../../dto/grant-consent.dto';

@Controller({ path: 'consents', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class ConsentsController {
  constructor(private readonly consents: ConsentService, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService) {}
  @Get() list(@CurrentContext() ctx: RequestContext) { return this.consents.list(ctx.tenantId, ctx.userId).then((data) => ({ data })); }
  @Post() grant(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string | undefined, @ZodBody(GrantConsentSchema) dto: GrantConsentDto) {
    const act = () => this.consents.grant(ctx.tenantId, ctx.userId, dto);
    const run = key ? this.idem.remember(createHash('sha256').update(`consent:${ctx.userId}:${key}`).digest('base64url'), ctx.userId, 'identity.consent.grant', act) : act();
    return run.then((data) => ({ data }));
  }
}
