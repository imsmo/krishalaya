// core/jobs/proposal-applier.registry.ts · PC-56 TENANT-SW-a — ONE CLOCK FOR EVERY TENANT MAKER-CHECKER PROPOSAL THAT TAKES EFFECT
// LATER (brief A3: "applied at effective midnight by the 13b apply job (extend it)").
//
// 13b's `SettingProposalsJob` (modules/tenancy/jobs/setting-proposals.job.ts) is the platform's clock for confirmed proposals: it reads
// only `tenants` on the runner pool, then claims per tenant in kv_app's unit of work. Rather than a second clock with the same shape,
// other modules REGISTER an applier here at their own onModuleInit (the OUTBOX_HANDLER_REGISTRY pattern) and the 13b job drives each
// one per tenant, after its own settings. A module never imports the tenancy job; the job never imports a module.
import { Injectable } from '@nestjs/common';
import { TxContext } from '../database/unit-of-work';

export const PROPOSAL_APPLIER_REGISTRY = Symbol('PROPOSAL_APPLIER_REGISTRY');

export interface ProposalApplier {
  /** Stable name for logs (e.g. 'payments.commission_rule_proposals'). */
  readonly name: string;
  /** Ids of confirmed proposals due to take effect now, read in the tenant's kv_app unit of work. */
  dueToApplyTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]>;
  /** Ids of proposals unconfirmed past their expiry. */
  dueToExpireTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]>;
  /** Apply ONE proposal in its own transaction; re-locks and re-checks it (two ticks claiming one row act once). */
  applyDue(tenantId: string, id: string): Promise<'applied' | 'skipped'>;
  /** Expire ONE proposal; returns true when it moved. */
  expireDue(tenantId: string, id: string): Promise<boolean>;
}

@Injectable()
export class ProposalApplierRegistry {
  private readonly byName = new Map<string, ProposalApplier>();
  register(a: ProposalApplier): void {
    if (this.byName.has(a.name)) throw new Error(`ProposalApplierRegistry: duplicate applier "${a.name}"`);
    this.byName.set(a.name, a);
  }
  list(): ProposalApplier[] { return [...this.byName.values()]; }
}
