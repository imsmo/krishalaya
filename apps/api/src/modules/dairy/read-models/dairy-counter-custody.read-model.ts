// modules/dairy/read-models/dairy-counter-custody.read-model.ts · PC-56 OPS-3a · OPS3-B14 (founder Q14-A, 2026-11-08) — THE COUNTER'S CENTRE.
//
// The web counter (`/pos/*`, web-ops) records and reads for ONE centre: the one the signed-in person holds in CUSTODY. Custody is recorded
// (`mcc_operator_assignments`, TENANT-6d-2 — opened and closed by the organisation's dairy console, never here). This read answers two
// questions and nothing more:
//   • which active centres have an OPEN custody row naming me (none → the counter says so and offers no form);
//   • what is "today" for my organisation, in its own zone (`tenants.country_code → countries.timezone`, the 6c-1 rule) — the day the
//     counter defaults a pour to and reads the day sheet for. The DATABASE's clock, never this process's and never the browser's.
// No custody history, no other person's id, no member. A READ: dairy.read, dairy.collect or dairy.manage (`actorMayRead`, fail-closed).
import { Injectable } from '@nestjs/common';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { DairyActor } from '../services/mcc-centre.service';
import { actorMayRead } from '../policies/dairy.policies';
import { DairyForbiddenError } from '../domain/dairy.errors';

@Injectable()
export class DairyCounterCustodyReadModel {
  constructor(private readonly centres: MccCentreRepository, private readonly rateCards: MilkRateCardRepository) {}

  async mine(tenantId: string, actor: DairyActor) {
    if (!actorMayRead(actor)) throw new DairyForbiddenError('requires dairy.read, dairy.collect or dairy.manage');
    const [today, centres] = await Promise.all([this.rateCards.tenantToday(tenantId), this.centres.inCustodyOf(tenantId, actor.userId)]);
    return { today, centres: centres.map((c) => c.toJSON()) };
  }
}
