// apps/admin-api/src/modules/payout-ops/payout-ops.controller.ts · W062/W063/W066/W067/W442 (PC-56 ADMIN-6b).
//
// THREE NEW OWNER PERMISSIONS, all three named by the canon and none of them previously existing in this realm:
//   `payouts.approve`  — W066: "execution approval needs `payouts.approve` (checker)"
//   `settlement.read`  — W062: "Statements need `billing.read`" + W063: "…+ `ledger.read` for the txn view"
//   `ledger.settle`    — W062: "running the cycle needs `ledger.settle`"
//
// THE APPROVE AND RETURN ROUTES ARE STEP-UP GATED. Every other write in this console is gated on the permission alone;
// this one asks for the second factor again, because it is the only act in admin-api that moves money OUT of the
// platform to a third party's bank account. A correction can be corrected and a listing can be republished; a
// disbursement to 214 bank accounts cannot be recalled. A stolen session should not be able to spend the escrow.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { PayoutBatchesService, AdminActor } from './services/payout-batches.service';
import { SettlementOversightService } from './services/settlement-oversight.service';
import {
  QueryBatchesSchema, QueryBatchesDto, QueryBatchLinesSchema, QueryBatchLinesDto,
  ReturnBatchSchema, ReturnBatchDto, QuerySettlementSchema, QuerySettlementDto,
  QueryRunsSchema, QueryRunsDto, RequestCycleSchema, RequestCycleDto,
} from './dto/payout-ops.dto';

/** The realm's actor.
 *
 *  `adminId` IS `AdminPrincipal.userId` FROM THE TOKEN, and never from the request body — it is one half of every
 *  maker-checker comparison on this plane, and a client-supplied identity would make the two-person rule a formality.
 *
 *  The name is `userId` on the principal and there is no `users` row behind it: admin-api verifies a self-contained JWT
 *  with no database identity, which is the realm-identity finding this programme has now hit five times (ADMIN-2d's
 *  support reply, the ticket ATTACH, 0067's checker columns, 0112's `handled_by_admin_id`, and 0114's approval columns).
 *  It is renamed `adminId` at this boundary so that nothing downstream is tempted to join it to `users`. */
function actorOf(req: unknown): AdminActor {
  const a = (req as { admin: AdminRequestContext }).admin;
  return {
    adminId: a.userId,
    permissions: a.permissions ?? new Set<string>(),
    ip: a.ip ?? null,
  };
}

@Controller({ path: 'payouts', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class PayoutOpsController {
  constructor(
    private readonly batches: PayoutBatchesService,
    private readonly settlement: SettlementOversightService,
  ) {}

  /* ======================= W066 · payout batches ======================= */

  /** VIEWING IS `ledger.read`, NOT `payouts.approve` — W066's own restricted state says so: "Viewing needs
   *  `ledger.read`; execution approval needs `payouts.approve` (checker)." A finance analyst reconciling disbursements
   *  should be able to see every batch without being able to authorise one, and the canon separated those two before
   *  either permission existed. */
  @Get('batches') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  listBatches(@ZodQuery(QueryBatchesSchema) q: QueryBatchesDto) {
    return this.batches.list(q).then((r) => ({
      data: r.items,
      meta: { nextCursor: r.nextCursor, awaitingChecker: r.awaitingChecker, held: r.held },
    }));
  }

  @Get('batches/:id') @RequireOwnerPermission(OwnerPermissions.LedgerRead)
  batch(@Req() req: unknown, @Param('id') id: string, @ZodQuery(QueryBatchLinesSchema) q: QueryBatchLinesDto) {
    return this.batches.detail(actorOf(req), id, q).then((r) => (r ? { data: r } : { data: null }));
  }

  /** Re-run the preflight without approving. A read in spirit and a write in fact — it records the verdict, including a
   *  FAILING one, which is the evidence that somebody looked. Gated on `payouts.approve` rather than `ledger.read`
   *  because it writes to the batch. */
  @Post('batches/:id/preflight') @RequireOwnerPermission(OwnerPermissions.PayoutApprove)
  preflight(@Req() req: unknown, @Param('id') id: string) {
    return this.batches.runPreflight(actorOf(req), id).then((data) => ({ data }));
  }

  /* ======================= W067 · the money door ======================= */

  /** NO REQUEST BODY. The batch is in the path, the approver is in the token, the time is the database's, and the
   *  preflight is re-run here. There is nothing a client could usefully say and a great deal it could usefully lie
   *  about. */
  @Post('batches/:id/approve')
  @RequireOwnerPermission(OwnerPermissions.PayoutApprove)
  @UseGuards(StepUpReauthGuard)
  approve(@Req() req: unknown, @Param('id') id: string) {
    return this.batches.approve(actorOf(req), id).then((data) => ({ data }));
  }

  /** Returning is also step-up gated, though it moves no money — because a session that can stop the platform's
   *  disbursements can hold every farmer's settlement overnight, and denial is an attack too. */
  @Post('batches/:id/return')
  @RequireOwnerPermission(OwnerPermissions.PayoutApprove)
  @UseGuards(StepUpReauthGuard)
  returnToMaker(@Req() req: unknown, @Param('id') id: string, @ZodBody(ReturnBatchSchema) body: ReturnBatchDto) {
    return this.batches.returnToMaker(actorOf(req), id, body.reason).then((data) => ({ data }));
  }

  /* ======================= W062 · the settlement cycle ======================= */

  @Get('settlement') @RequireOwnerPermission(OwnerPermissions.SettlementRead)
  settlementBoard(@ZodQuery(QuerySettlementSchema) q: QuerySettlementDto) {
    return this.settlement.board(q).then((r) => ({
      data: r.items,
      meta: {
        nextCursor: r.nextCursor, cycle: r.cycle, basis: r.basis, run: r.run, tiles: r.tiles,
        statementCount: r.statementCount,
      },
    }));
  }

  @Get('settlement/runs') @RequireOwnerPermission(OwnerPermissions.SettlementRead)
  settlementRuns(@ZodQuery(QueryRunsSchema) q: QueryRunsDto) {
    return this.settlement.runs(q).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }

  /* ======================= W063 + W442 · one statement ======================= */

  @Get('settlement/statements/:id') @RequireOwnerPermission(OwnerPermissions.SettlementRead)
  statement(@Req() req: unknown, @Param('id') id: string) {
    return this.settlement.statement(actorOf(req), id).then((r) => (r ? { data: r } : { data: null }));
  }

  /** W062's "Run settlement cycle". Records the request; the worker generates the statements. Step-up gated: a cycle
   *  produces the statements the payouts are built from, and requesting one for the wrong period is not the sort of
   *  mistake a hijacked tab should be able to make. */
  @Post('settlement/cycles')
  @RequireOwnerPermission(OwnerPermissions.LedgerSettle)
  @UseGuards(StepUpReauthGuard)
  requestCycle(@Req() req: unknown, @ZodBody(RequestCycleSchema) body: RequestCycleDto) {
    return this.settlement.requestCycle(actorOf(req), body).then((data) => ({ data }));
  }
}
