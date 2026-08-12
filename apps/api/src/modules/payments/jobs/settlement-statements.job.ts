// modules/payments/jobs/settlement-statements.job.ts
// Worker job (kv_relay): the periodic settlement-statement RUN. Finds every (tenant, seller) with un-statemented
// settlement_lines in [from, to) and generates ONE statement each via SettlementStatementService.generate (which
// is itself idempotent per seller+period and links the lines so they're never double-counted). Each generated
// statement is validated through the SettlementStatement value object (zero-sum: net = gross − commission − tax)
// before it counts. Cross-tenant scan, bounded per tick. NO money moves here — payout is a separate flow. NOT a DI
// provider — apps/worker instantiates it with the kv_relay Pool, mirroring the other worker jobs.
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';
import { SettlementStatementService } from '../services/settlement-statement.service';
import { SettlementStatement } from '../domain/settlement-statement.entity';

export class SettlementStatementsJob {
  constructor(private readonly systemPool: Pool, private readonly lines: SettlementLineRepository, private readonly statements: SettlementStatementService) {}

  /** Generate statements for the cycle [from, to) (YYYY-MM-DD). `actorUserId` attributes the audit rows. */
  async run(from: string, to: string, actorUserId = 'system', limit = 500): Promise<{ generated: number; skipped: number; failed: number }> {
    const client = await this.systemPool.connect();
    let sellers: Array<{ tenantId: string; sellerUserId: string }> = [];
    try {
      await client.query('BEGIN');
      const tx: TxContext = { query: (sql, params) => client.query(sql, params as any) as any, tenantId: '', userId: actorUserId };
      sellers = await this.lines.findSellersWithOpenLines(tx, from, to, limit);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }

    let generated = 0; let failed = 0;
    const skipped = 0;   // never incremented — the loop either generates or fails (prefer-const)
    for (const s of sellers) {
      try {
        const row = await this.statements.generate(s.tenantId, s.sellerUserId, from, to, actorUserId, null);
        // validate the zero-sum invariant before counting it as generated (fail loud on a bad aggregate)
        SettlementStatement.fromAggregate({
          id: row.id, tenantId: s.tenantId, sellerUserId: s.sellerUserId, statementNo: row.statementNo,
          periodStart: row.periodStart, periodEnd: row.periodEnd,
          grossMinor: BigInt(row.grossMinor), commissionMinor: BigInt(row.commissionMinor), taxMinor: BigInt(row.taxMinor), netMinor: BigInt(row.netMinor),
        });
        generated++;
      } catch { failed++; }
    }
    return { generated, skipped, failed };
  }
}
