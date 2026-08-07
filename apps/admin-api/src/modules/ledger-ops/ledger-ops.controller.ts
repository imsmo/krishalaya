// apps/admin-api/src/modules/ledger-ops/ledger-ops.controller.ts · W059/W064/W065 (PC-56 ADMIN-6).
//
// ONE NEW PERMISSION, `ledger.read`, named by all three screens' restricted states and previously non-existent. It is
// separate from `recon.read` because recon answers "do the books balance" in aggregate while this answers "who paid
// whom", across every tenant, transaction by transaction. See owner-roles.ts for the full argument.
//
// EVERY ROUTE HERE IS A READ. The only write is a VERIFICATION RECORD, which is append-only and changes no money —
// and it is still step-up gated, because a `broken` row is a P0 declaration and an operator should not be able to
// file one by accident.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { LedgerExplorerService } from './services/ledger-explorer.service';
import { WalletAccountsService } from './services/wallet-accounts.service';
import {
  QueryTxnsSchema, QueryTxnsDto, FindTxnSchema, FindTxnDto,
  VerifyChainSchema, VerifyChainDto, QueryAccountsSchema, QueryAccountsDto,
} from './dto/ledger-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const decodeCursor = (c?: string) => {
  if (!c) return undefined;
  const [cc, id] = Buffer.from(c, 'base64').toString().split('|');
  return cc && id ? { c: cc, id } : undefined;
};

@Controller({ path: 'ledger', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class LedgerOpsController {
  constructor(
    private readonly explorer: LedgerExplorerService,
    private readonly accounts: WalletAccountsService,
  ) {}

  /* ======================= W064 · the explorer ======================= */

  @Get('transactions') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  list(@ZodQuery(QueryTxnsSchema) q: QueryTxnsDto) {
    const { cursor, ...rest } = q;
    return this.explorer.list({ ...rest, cursor: decodeCursor(cursor) })
      .then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor, window: r.window, txnTypes: r.txnTypes } }));
  }

  /** Declared before `transactions/:id` so 'find' is never read as a transaction id. */
  @Get('transactions/find') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  find(@ZodQuery(FindTxnSchema) q: FindTxnDto, @Req() req: any) {
    return this.explorer.txn(admin(req), q).then((data) => ({ data }));
  }

  /* ======================= W065 · one transaction ======================= */

  @Get('transactions/:id') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  txn(@Param('id') id: string, @Req() req: any) {
    return this.explorer.txn(admin(req), { id }).then((data) => ({ data }));
  }

  /** The chain walk. A WRITE (an append-only verification record) and therefore step-up gated, even though it moves no
   *  money: a `broken` row is a P0 declaration about the platform's money record. */
  @Post('chain/verify') @RequireOwnerPermission(OwnerPermissions.LedgerRead) @UseGuards(StepUpReauthGuard)
  verify(@ZodBody(VerifyChainSchema) dto: VerifyChainDto, @Req() req: any) {
    return this.explorer.verify(admin(req), dto).then((data) => ({ data }));
  }

  /* ======================= W059 · accounts ======================= */

  /** The platform board: Σ over stripes per account_code. The read the console never had. */
  @Get('accounts/platform') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  platform() { return this.accounts.platformBoard().then((data) => ({ data })); }

  @Get('accounts') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  owned(@ZodQuery(QueryAccountsSchema) q: QueryAccountsDto) {
    return this.accounts.listOwned(q).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }

  @Post('accounts/:id/verify-balance') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  verifyBalance(@Param('id') id: string, @Req() req: any) {
    return this.accounts.verifyBalance(admin(req), id).then((data) => ({ data }));
  }
}
