// modules/partner-console/services/partner-readiness.service.ts · PC-56 PARTNER-1b · founder D3 — "WHAT THE PLATFORM HAS SET UP FOR YOU", FROM FACTS.
//
// `GET /v1/partner/readiness` (any member of the partner; no person data — counts and yes / no only): the six facts of
// domain/partner-readiness.rules.ts, each read where it lives — the organisation and its published promise from `financial_partners`
// (kv_app, the partner-realm unit of work), the team's administrators and their second factor through 0225's `partner_team()` on the axis
// (names never leave this service), the active keys / endpoints through 0227's definers, the last successful delivery scattered over the
// shards — + `computedAt`. NOTHING IS STORED: no ticks, no e-signature, no countersignature, no desk, no clock, no application number, no
// separate test world, no key by mail — each refused by name in the console.
import { Injectable } from '@nestjs/common';
import { PartnerRealmUnitOfWork } from '../../../core/database/partner-realm-uow';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { slaDecisionHours } from '../domain/partner-dashboard.rules';
import { keyStatus } from '../domain/partner-keys.rules';
import { READINESS_DELIVERY_WINDOW_DAYS, readinessFacts, type PartnerReadiness } from '../domain/partner-readiness.rules';
import { PartnerSession } from '../guards/partner-session.guard';

@Injectable()
export class PartnerReadinessService {
  constructor(private readonly repo: PartnerConsoleRepository, private readonly uow: PartnerRealmUnitOfWork) {}

  async read(s: PartnerSession): Promise<PartnerReadiness> {
    const org = await this.uow.run(s.partnerId, (tx) => this.repo.partnerOrgActiveTx(tx, s.partnerId), { userId: s.userId });
    const team = await this.repo.team(s.partnerId);
    const keys = await this.repo.keys(s.partnerId);
    const endpoints = await this.repo.endpoints(s.partnerId);
    let last: string | null = null;
    for (let i = 0; i < this.repo.shards; i++) {
      const at = await this.repo.lastDeliveredShard(i, s.partnerId, READINESS_DELIVERY_WINDOW_DAYS);
      if (at && (last === null || at > last)) last = at;
    }
    return readinessFacts({
      computedAt: new Date().toISOString(),
      organisationActive: org?.active === true,
      team: team.members.map((m: { userId: string; roleCode: string; active: boolean; twoFactor: boolean }) => ({ userId: m.userId, roleCode: m.roleCode, active: m.active, twoFactor: m.twoFactor })),
      activeKeys: keys.filter((k) => keyStatus({ revokedAt: (k.revoked_at as string | null) ?? null, isActive: k.is_active === true }) === 'active').length,
      activeEndpoints: endpoints.filter((e) => e.is_active === true).length,
      lastDeliveredAt: last,
      decisionHours: slaDecisionHours(org?.sla),
    });
  }
}
