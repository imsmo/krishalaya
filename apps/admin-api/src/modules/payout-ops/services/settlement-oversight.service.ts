// apps/admin-api/src/modules/payout-ops/services/settlement-oversight.service.ts · W062 + W063 + W442 (PC-56 ADMIN-6b).
//
// Reads only, plus one write: opening a `settlement_runs` row for an on-demand cycle. The cycle itself is executed by
// `SettlementStatementsJob` in apps/api — this realm does not generate statements, it asks for a cycle and records that
// it asked. Same division as ADMIN-6's recon "Run check now": admin-api records the request, the worker does the work.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { PayoutOpsRepository } from '../repositories/payout-ops.repository';
import {
  awaitingPayoutTile, componentTile, cycleTile, formatMinor, parseCycleDate,
  pdfState, runOutcome, statementBalance, statementEquation,
} from '../domain/settlement-cycle';
import { InvalidPayoutOpsError, InvalidPayoutQueryError } from '../domain/payout-ops.errors';
import type { AdminActor } from './payout-batches.service';

@Injectable()
export class SettlementOversightService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: PayoutOpsRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  /** W062. The board, the tiles, and the statements for a cycle.
   *
   *  THE TILES CARRY THEIR OWN KNOWN/UNKNOWN and the console renders the unknown case as words rather than as ₹0. "No
   *  cycle has run today" and "today's cycle settled nothing" are opposite findings that look identical as a number —
   *  the first is a broken scheduler on the money path and the second is a quiet Tuesday. 0113 found exactly this
   *  collapse on the recon board; it is the same mistake one table over.
   */
  async board(q: { cycle?: string; tenantId?: string; cursor?: string; limit: number }) {
    const cycle = parseCycleDate(q.cycle, 'cycle');
    const run = await this.repo.latestRun(cycle);

    // The run's own aggregates are authoritative when it has them. Every statement generated BEFORE 0114 has no
    // `run_id` and no run to describe it, so for those cycles the totals are computed over the PERIOD instead — and the
    // response says which basis it used, because a total that silently switches its own definition is worse than one
    // that is absent.
    const basis: 'run' | 'period' | 'none' = run && run.grossMinor !== 0n ? 'run' : cycle ? 'period' : 'none';
    const period = basis === 'period' && cycle ? await this.repo.periodTotals(cycle) : null;

    const cursor = decodeCursor(q.cursor);
    const statements = await this.repo.listStatements({
      periodEnd: cycle, tenantId: q.tenantId, cursor, limit: q.limit,
    });
    const last = statements[statements.length - 1];

    const held = await this.repo.awaitingApprovalTotal();

    return {
      cycle,
      basis,
      run: run ? {
        id: run.id,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        status: run.status,
        outcome: runOutcome(run, Date.now()),
        sellersScanned: run.sellersScanned,
        generatedCount: run.generatedCount,
        failedCount: run.failedCount,
        triggeredByAdminId: run.triggeredByAdminId,
        failureDetail: run.failureDetail,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
      } : null,
      tiles: {
        cycleGross: serialiseTile(period ? { known: true as const, minor: period.grossMinor } : cycleTile(run)),
        commission: serialiseTile(period ? { known: true as const, minor: period.commissionMinor } : componentTile(run, 'commission')),
        tax: serialiseTile(period ? { known: true as const, minor: period.taxMinor } : componentTile(run, 'tax')),
        // Awaiting payout is NOT a settlement figure — it is the Σ held behind unapproved batches, a number that only
        // began to exist when 0114 made a batch a gate. Before the gate, nothing waited: payouts left on a timer.
        awaitingPayout: serialiseTile(awaitingPayoutTile(held)),
      },
      statementCount: period ? period.statements : run?.generatedCount ?? null,
      items: statements.map((s) => {
        const bal = statementBalance(s);
        return {
          id: s.id,
          tenantId: s.tenantId,
          sellerUserId: s.sellerUserId,
          statementNo: s.statementNo,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          grossMinor: s.grossMinor.toString(),
          commissionMinor: s.commissionMinor.toString(),
          taxMinor: s.taxMinor.toString(),
          netMinor: s.netMinor.toString(),
          // Recomputed per row even in the list. A statement whose four numbers do not add up is a corrupted financial
          // document, and it should be visible in the list rather than only on the one screen somebody happens to open.
          balanced: bal.balanced,
          pdf: pdfState(s),
          runId: s.runId,
          createdAt: s.createdAt,
        };
      }),
      nextCursor: statements.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
    };
  }

  async runs(q: { status?: string; cursor?: string; limit: number }) {
    const rows = await this.repo.listRuns({ status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit });
    const last = rows[rows.length - 1];
    const now = Date.now();
    return {
      items: rows.map((r) => ({
        id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status,
        outcome: runOutcome(r, now),
        sellersScanned: r.sellersScanned, generatedCount: r.generatedCount, failedCount: r.failedCount,
        netMinor: r.netMinor.toString(),
        triggeredByAdminId: r.triggeredByAdminId, finishedAt: r.finishedAt, createdAt: r.createdAt,
      })),
      nextCursor: rows.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
    };
  }

  /** W063 + W442. One statement: its lines, its arithmetic, and the state of its PDF anchor. */
  async statement(actor: AdminActor, id: string) {
    const s = await this.repo.getStatement(id);
    if (!s) return null;
    const lines = await this.repo.statementLines(id);
    const bal = statementBalance(s);

    // A statement names one seller, their gross earnings for a period, and their commission — a financial picture of a
    // named person. Reading it is an audited act for the same reason W039/W040 made reading the audit trail one.
    await this.audit.log({
      actorUserId: actor.adminId,
      action: 'settlement.statement.read',
      entityType: 'settlement_statement',
      entityId: id,
      newValue: { statementNo: s.statementNo, tenantId: s.tenantId },
      ip: actor.ip,
    });

    // The Σ of the lines against the statement's own gross. `settlement_lines` is where the per-order attribution
    // lives and the statement is an aggregate of it, so a disagreement means the aggregate no longer describes its
    // parts — and W063 shows both tables on one screen, so a reader would otherwise be left to add up 41 rows by hand
    // to notice.
    const lineGross = lines.reduce((a, l) => a + l.grossMinor, 0n);
    const lineNet = lines.reduce((a, l) => a + l.netMinor, 0n);

    return {
      id: s.id,
      tenantId: s.tenantId,
      sellerUserId: s.sellerUserId,
      statementNo: s.statementNo,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      grossMinor: s.grossMinor.toString(),
      commissionMinor: s.commissionMinor.toString(),
      taxMinor: s.taxMinor.toString(),
      netMinor: s.netMinor.toString(),
      // W442 prints the arithmetic as arithmetic so a reader can check it by eye. That is the point of showing it
      // rather than a tick, and it is the same argument as W065's zero-sum equation on a ledger transaction.
      equation: statementEquation(s),
      balanced: bal.balanced,
      balanceDetail: bal.balanced ? null : {
        storedNetMinor: bal.storedNetMinor.toString(),
        computedNetMinor: bal.computedNetMinor.toString(),
        driftMinor: bal.driftMinor.toString(),
      },
      pdf: pdfState(s),
      runId: s.runId,
      lines: lines.map((l) => ({
        id: l.id, orderId: l.orderId,
        grossMinor: l.grossMinor.toString(), commissionMinor: l.commissionMinor.toString(),
        gstMinor: l.gstMinor.toString(), tdsMinor: l.tdsMinor.toString(), netMinor: l.netMinor.toString(),
        createdAt: l.createdAt,
      })),
      lineTotals: {
        count: lines.length,
        grossMinor: lineGross.toString(),
        netMinor: lineNet.toString(),
        // TRUE means the aggregate matches its parts. Reported as its own field rather than folded into `balanced`,
        // which is about the statement's internal arithmetic — these are two different things that can fail
        // independently, and one flag covering both would tell an investigator nothing about where to look.
        agreesWithStatement: lineGross === s.grossMinor && lineNet === s.netMinor,
      },
      // The lines table is capped by the repository. A statement with more lines than the cap would render a total that
      // silently described a prefix, so the truncation is stated.
      linesTruncated: lines.length >= 500,
      createdAt: s.createdAt,
      // Formatted once, server-side, from bigint — never in the browser from a number.
      display: {
        gross: formatMinor(s.grossMinor),
        commission: formatMinor(s.commissionMinor),
        tax: formatMinor(s.taxMinor),
        net: formatMinor(s.netMinor),
      },
    };
  }

  /** W062's "Run settlement cycle".
   *
   *  RECORDS THE REQUEST; DOES NOT GENERATE STATEMENTS. Generation is `SettlementStatementsJob` in apps/api, which owns
   *  the tenant-scoped unit of work, the zero-sum validation of each aggregate and the line linking that makes the run
   *  idempotent. Reimplementing any of that here would be a second settlement engine in a different service — the
   *  duplicate-money-logic mistake ADMIN-6 spent a page on. What this realm can honestly do is open the run row and let
   *  the worker fill it in, which is also what makes an operator-triggered cycle distinguishable from the cadence.
   *
   *  ONE RUNNING CYCLE AT A TIME, and the refusal is the point: two concurrent cycles over the same period would both
   *  scan the same un-statemented lines. `SettlementStatementService.generate` is idempotent per seller+period so the
   *  money would survive it, but the two runs would each claim a share of the statements and neither row would describe
   *  the cycle. `uq_settlement_run_completed_period` (0114) is the database's half of this.
   */
  async requestCycle(actor: AdminActor, body: { periodStart: string; periodEnd: string }) {
    const from = parseCycleDate(body.periodStart, 'periodStart');
    const to = parseCycleDate(body.periodEnd, 'periodEnd');
    if (!from || !to) throw new InvalidPayoutQueryError('a cycle needs both a periodStart and a periodEnd');
    if (from > to) throw new InvalidPayoutQueryError('periodStart cannot be after periodEnd');

    const existing = await this.repo.latestRun(to);
    if (existing && existing.status === 'running') {
      const o = runOutcome(existing, Date.now());
      // An ABANDONED run is allowed to be superseded — it has no `finished_at` and never will, because the process that
      // would have written one is gone. Refusing for ever on the strength of a crashed row would make one bad night
      // permanent.
      if (o.kind !== 'abandoned') {
        throw new InvalidPayoutOpsError(
          `a settlement cycle for ${to} is already running (started ${existing.createdAt}). Two cycles over one period `
          + 'would each claim a share of the same statements and neither row would describe the cycle.');
      }
    }
    if (existing && existing.status === 'completed') {
      throw new InvalidPayoutOpsError(
        `the cycle for ${to} has already completed and generated ${existing.generatedCount} statements. Settlement `
        + 'lines are linked once, so a second run would find nothing — and a run row claiming otherwise would be worse '
        + 'than no row.');
    }

    return this.pool.withTx(async (c) => {
      const id = await this.repo.openRunTx(c, from, to, actor.adminId);
      await this.audit.write(c, {
        actorUserId: actor.adminId,
        action: 'settlement.cycle.requested',
        entityType: 'settlement_run',
        entityId: id,
        newValue: { periodStart: from, periodEnd: to },
        ip: actor.ip,
      });
      return {
        id,
        periodStart: from,
        periodEnd: to,
        status: 'running' as const,
        // Said in the response rather than implied by a 202: the row exists and the work has not happened yet, and a
        // console that reported "cycle complete" here would be the fourth status-column-with-no-act on this platform.
        note: 'the cycle is recorded as running; statements appear as the settlement worker generates them',
      };
    });
  }
}

function serialiseTile(t: { known: true; minor: bigint; note?: string } | { known: false; reason: string }) {
  return t.known ? { known: true, minor: t.minor.toString(), note: t.note ?? null } : { known: false, reason: t.reason };
}

function decodeCursor(c?: string): { c: string; id: string } | undefined {
  if (!c) return undefined;
  const [ts, id] = Buffer.from(c, 'base64').toString('utf8').split('|');
  return ts && id ? { c: ts, id } : undefined;
}
