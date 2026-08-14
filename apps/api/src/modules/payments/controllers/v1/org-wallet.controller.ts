// modules/payments/controllers/v1/org-wallet.controller.ts · W143 + W144, the ORGANISATION's wallet
// (PC-56 TENANT-4a). Separate from wallet.controller.ts on purpose: that one is the caller's PERSONAL
// wallet (subject = ctx.userId, no permission, a core read of your own money), and this one is the
// tenant's book (subject = ctx.tenantId, gated by `wallet.org_view`, which 0142 seeds). Conflating them
// is the defect this wave fixes — the tenant console was showing a staff member's personal balance where
// the FPO's balance belongs.
//
// EVERY endpoint here is read-only. There is no add-funds route, because no tenant top-up product exists
// (0142's defect list); a route that accepted an amount and had nowhere to send it is exactly the kind of
// surface this programme refuses to build.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { OrgWalletReadModel } from '../../read-models/org-wallet.read-model';
import { OrgWalletExportService } from '../../services/org-wallet-export.service';
import { isTenantAccountCode, ORG_WALLET_GAPS, type TenantAccountCode } from '../../domain/org-wallet';

const ORG_WALLET_PERM = 'wallet.org_view';

/** The cursor arrives base64("<iso>|<entryId>"); an unparseable one is IGNORED rather than 400'd, so a
 *  stale link lands on page one instead of an error page. */
const decodeCursor = (c?: string) => {
  if (!c) return undefined;
  const [iso, id] = Buffer.from(c, 'base64').toString().split('|');
  return iso && id && !Number.isNaN(Date.parse(iso)) ? { c: iso, id } : undefined;
};

/** An account code from the client is accepted ONLY as one of the tenant's three known codes; anything
 *  else becomes undefined (= all accounts). The read-model resolves accounts from the tenant context
 *  regardless, so this is the second gate, not the only one. */
const accountOf = (v?: string): TenantAccountCode | undefined => (isTenantAccountCode(v) ? v : undefined);

@Controller({ path: 'org-wallet', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class OrgWalletController {
  constructor(
    private readonly read: OrgWalletReadModel,
    private readonly exporter: OrgWalletExportService,
  ) {}

  /** W143 whole: the three accounts with their basis, today's movement, the escrow the platform holds for
   *  this tenant, and the ledger health this tenant can actually assert about itself. */
  @Get() @RequirePermissions(ORG_WALLET_PERM)
  overview(@CurrentContext() ctx: RequestContext, @Query('currency') currency?: string) {
    return this.read.overview(ctx.tenantId, { currencyCode: currency }).then((data) => ({
      // The gaps ride the payload so every surface names the same three, in the same words.
      data: { ...data, gaps: ORG_WALLET_GAPS },
    }));
  }

  /** W144: the ledger view. Keyset only — there is no page parameter and no total, by design. */
  @Get('ledger') @RequirePermissions(ORG_WALLET_PERM)
  ledger(
    @CurrentContext() ctx: RequestContext,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('account') account?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('currency') currency?: string,
  ) {
    return this.read.ledger(ctx.tenantId, {
      cursor: decodeCursor(cursor),
      limit: Number(limit) || 50,
      accountCode: accountOf(account),
      txnType: type || undefined,
      from, to, currencyCode: currency,
    }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor, window: res.window } }));
  }

  /** W144's filter chips, drawn from the tenant's own rows (Law 6 — a new money product appears here
   *  without an app change, which is precisely what the screen claims). */
  @Get('txn-types') @RequirePermissions(ORG_WALLET_PERM)
  txnTypes(@CurrentContext() ctx: RequestContext, @Query('currency') currency?: string) {
    return this.read.txnTypesPresent(ctx.tenantId, currency || 'INR').then((data) => ({ data }));
  }

  /** W144's "Export CSV" → W2454/W2455's queued/ready pair. Synchronous with a RECEIPT (row count,
   *  sha256 over the canonical payload, requester, coverage), and it REFUSES a window too large rather
   *  than returning a file that stops mid-month. */
  @Get('export') @RequirePermissions(ORG_WALLET_PERM)
  export(
    @CurrentContext() ctx: RequestContext,
    @Query('account') account?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('currency') currency?: string,
  ) {
    return this.exporter.export(ctx.tenantId, ctx.userId, {
      from, to, accountCode: accountOf(account), txnType: type || undefined, currencyCode: currency,
    }).then((data) => ({ data }));
  }
}
