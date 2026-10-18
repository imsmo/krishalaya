// modules/partner-console/services/partner-keys.service.ts · PC-56 PARTNER-1b · founder D1 — THE PARTNER'S OWN API KEYS: read, and the ONE write.
//
//   list    — `partner.keys.read` (every partner role, 0227): this partner's keys through 0227's `partner_console_keys()` on the axis, projected
//             field by field (domain/partner-keys.rules.ts `projectKey` — there is no hash on the type): name, prefix, scopes, the hourly quota,
//             last used, active / inactive / revoked (+ when and the administrator's reason). NOT AUDITED: a partner's own configuration,
//             not applicant data (1a's dashboard read is audited because it counts applicant records).
//   revoke  — `partner.keys.revoke` (partner_admin only): an Idempotency-Key (the house 400 without one), a reason of 20–300 characters (422),
//             then 0227's `partner_console_revoke_key` INSIDE the axis — another partner's key is 404 PARTNER_KEY_NOT_FOUND (never "not yours"),
//             a revoked one 409 PARTNER_KEY_ALREADY_REVOKED — and the partner-realm audit row `partner.key.revoked` (the reason, the prefix;
//             never the hash) in the same transaction. A replay of the same Idempotency-Key answers the first answer. The partner-API guard
//             refuses the key at once (`isUsable` reads revoked_at / is_active on every call). NO outbox event (a `partner.key_revoked` event
//             would need a handler and the relay gate — named). Mint, rotate-with-overlap, scopes, quota and an IP allow-list stay with the
//             platform's partner operations (DECOR W2907–W2910).
import { Inject, Injectable } from '@nestjs/common';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { UUID_RE } from '../../../shared/pagination/us-keyset';
import { PartnerConsoleRepository } from '../repositories/partner-console.repository';
import { cleanKeyReason, keyReasonOk, projectKey, type PartnerKeyView } from '../domain/partner-keys.rules';
import { namedPartnerRefusal, partnerRefused } from '../domain/partner-console.errors';
import { PartnerSession } from '../guards/partner-session.guard';

const actorRole = (s: PartnerSession) => `partner:${s.partnerId}:${[...s.roles].sort().join('+') || 'no_role'}`.slice(0, 200);

@Injectable()
export class PartnerKeysService {
  constructor(
    private readonly repo: PartnerConsoleRepository,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async list(s: PartnerSession): Promise<{ items: PartnerKeyView[]; computedAt: string }> {
    const rows = await this.repo.keys(s.partnerId);
    return { items: rows.map(projectKey), computedAt: new Date().toISOString() };
  }

  async revoke(s: PartnerSession, id: string, reason: string, idemKey: string | undefined): Promise<{ id: string; keyPrefix: string; revokedAt: string; status: 'revoked' }> {
    if (!idemKey) throw partnerRefused('PARTNER_IDEMPOTENCY_KEY_REQUIRED');
    if (!keyReasonOk(reason)) throw partnerRefused('PARTNER_KEY_REASON_REQUIRED');
    if (!UUID_RE.test(id)) throw partnerRefused('PARTNER_KEY_NOT_FOUND');
    const clean = cleanKeyReason(reason);
    try {
      const out = await this.idem.remember(idemKey, s.userId, 'partner.keys.revoke', async () => {
        const r = await this.repo.revokeKey(s.partnerId, id, clean, s.userId, { actorUserId: s.userId, actorRole: actorRole(s), ip: s.ip, requestId: s.requestId });
        return { ...r, status: 'revoked' as const };
      });
      this.metrics.inc('partner_console.key_revoked', { partner: s.partnerId });
      return out;
    } catch (e) { throw namedPartnerRefusal(e); }
  }
}
