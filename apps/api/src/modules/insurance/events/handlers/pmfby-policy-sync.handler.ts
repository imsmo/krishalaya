// modules/insurance/events/handlers/pmfby-policy-sync.handler.ts
// Consumes insurance.policy_proposed (delivered by the outbox relay) — DEV-25/KV-BL-057, Wave 7 external
// integration #1. Fires the PMFBY govt crop-insurance portal enrolment sync ONLY when:
//   (a) the policy's subjectType === 'crop_season' (PMFBY covers crop-season risk only — a livestock/
//       equipment/person/shipment policy has nothing to do with the govt crop scheme), AND
//   (b) the `pmfby_sync` feature flag is ON for the tenant (default OFF — no named PMFBY portal account is
//       contracted in this environment, §8). Flag OFF -> SILENT skip (not an error, not a DLQ entry — mirrors
//       DisputeResolvedHandler's own `dispute_refunds` kill-switch convention exactly).
//
// HONESTY (Law 7/12): this handler NEVER invents a govt application reference. The port itself already
// degrades to {status:'unavailable'} when no real portal is configured (every environment today) — this
// handler's only job is to call the port and record what actually happened, via audit_log (there is no
// insurance_policies column to durably persist a govtApplicationRef into — the DDL doesn't anticipate one;
// flagged for founder/§8 decision in dev25_report.md, not silently invented as a new column here).
import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { AuditWriter } from '../../../../core/audit/audit.writer';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { InsurancePolicyRepository } from '../../repositories/insurance-policy.repository';
import { InsuranceProductRepository } from '../../repositories/insurance-product.repository';
import { PMFBY_PROVIDER, PmfbyProvider } from '../../gateway/pmfby-provider.port';

@Injectable()
export class PmfbyPolicySyncHandler implements OutboxHandler {
  readonly eventType = 'insurance.policy_proposed';
  constructor(
    @Inject(PMFBY_PROVIDER) private readonly pmfby: PmfbyProvider,
    private readonly flags: FlagsService,
    private readonly audit: AuditWriter,
    private readonly policies: InsurancePolicyRepository,
    private readonly products: InsuranceProductRepository,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const policyId = (typeof p.policyId === 'string' && p.policyId) ? p.policyId : event.aggregateId;
    if (!tenantId || !policyId) return;
    if (p.subjectType !== 'crop_season') return;   // PMFBY covers crop-season risk only — not applicable
    if (!(await this.flags.isEnabled('pmfby_sync', { tenantId }))) return;   // kill-switch (default OFF, §8)

    // Enrich beyond the event payload (validFrom/validUntil aren't carried on PolicyProposed) — read-only,
    // off the replica, mirrors InsurancePolicyService.propose()'s own pre-tx replica-read pattern.
    const policy = await this.policies.getById(tenantId, policyId);
    if (!policy) return;   // gone/not ours — nothing to sync
    const props = policy.toProps();
    const product = await this.products.getById(tenantId, props.productId).catch(() => null);
    const productCode = product ? await this.products.resolveInsuranceKindCode(tx, product.toJSON().productKindId).catch(() => null) : null;

    const holderUserId = typeof p.holderUserId === 'string' ? p.holderUserId : props.holderUserId;
    const sumInsuredMinor = typeof p.sumInsuredMinor === 'string' ? p.sumInsuredMinor : props.sumInsuredMinor.toString();
    const premiumMinor = typeof p.premiumMinor === 'string' ? p.premiumMinor : props.premiumMinor.toString();

    const result = await this.pmfby.submitEnrolment({
      idempotencyKey: policyId, tenantId, policyId, holderUserId,
      productCode: productCode ?? 'unknown', sumInsuredMinor, premiumMinor,
      validFrom: props.validFrom, validUntil: props.validUntil, cropSeasonRef: null,
    });

    // Audit-only record (no column to persist govtApplicationRef into — see file header + dev25_report.md
    // §8 flag). Never throws on an 'unavailable' result — an unreachable govt portal must never fail the
    // relay/DLQ the whole policy-proposed event chain (Law 12: degrade honestly, don't cascade a failure).
    await this.audit.write(tx, {
      tenantId, actorUserId: 'system', action: 'insurance.policy.pmfby_sync_attempted',
      entityType: 'insurance_policy', entityId: policyId,
      newValue: { status: result.status, govtApplicationRef: result.govtApplicationRef ?? null, failureReason: result.failureReason ?? null },
      ip: null,
    });
  }
}
