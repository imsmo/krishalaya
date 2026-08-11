// modules/platform-api-ops/services/platform-api-ops.service.ts · W106 / W007 (PC-56 ADMIN-11c).
//
// Cross-tenant oversight of two key registries, the outbound delivery pipeline, the inbound receipt log this wave
// created, and the circuit state of every external dependency.
//
// **THIS PLANE OVERSEES AND REVOKES; IT DOES NOT ISSUE.** W106's empty state says "keys are tenant-created from their
// console; this view is oversight, not issuance", and Law 11 agrees for a stronger reason than screen fidelity: the
// platform creating a tenant's credential would be the god-mode realm minting an identity that acts as the tenant.
// Revocation is the opposite direction — taking access away is exactly what an oversight plane is for.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ApiOversightRepository } from '../repositories/api-oversight.repository';
import {
  HOURLY_USAGE_HAS_NO_ADMIN_SOURCE, LATENCY_HAS_NO_SOURCE, LATENCY_OWNER, PROBE_OWNER,
  TENANT_REGISTRY_HAS_NO_ISSUER, daysSince, fallbackActive, fleetState, keyState, successRateBp,
} from '../domain/api-oversight';
import { ApiKeyAlreadyRevokedError, ApiKeyNotFoundError } from '../domain/platform-api-ops.errors';

/** Named so the console can print it beside the empty tenant registry rather than implying tenants have not got round
 *  to creating keys. */
export const KEY_ISSUANCE_OWNER = 'ADMIN-11c-Q4';
export const USAGE_COUNTER_OWNER = 'ADMIN-11c-Q6';

@Injectable()
export class PlatformApiOpsService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: ApiOversightRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  async listKeys(q: { registry?: 'tenant' | 'partner'; revoked?: boolean; cursor?: string; limit: number }) {
    const now = new Date();
    const [rows, census] = await Promise.all([this.repo.listKeys(q), this.repo.keyCensus()]);
    return {
      data: rows.map((k) => ({
        ...k,
        state: keyState(k, now),
        idleDays: k.lastUsedAt ? daysSince(k.lastUsedAt, now) : null,
        // **THE LIMIT IS A COLUMN; THE USAGE IS NOT.** The hourly counter lives in Redis inside apps/api and this realm
        // has no Redis client at all, so the cell is rendered absent rather than filled with a different number that
        // would look like a rate limit.
        hourlyUsage: null as number | null,
        hourlyUsageNote: HOURLY_USAGE_HAS_NO_ADMIN_SOURCE,
      })),
      meta: {
        ...census,
        // **THE SENTENCE THIS SCREEN NEEDED AND COULD NOT SAY.** `api_keys` has existed since migration 0002 and no code
        // in the monorepo has ever written a row: no issuer, no gateway, no last-used stamp, no tenant console screen.
        // Zero keys there is not "no tenant has got round to it".
        tenantRegistryHasNoIssuer: TENANT_REGISTRY_HAS_NO_ISSUER,
        keyIssuanceOwner: KEY_ISSUANCE_OWNER,
        usageCounterOwner: USAGE_COUNTER_OWNER,
        nextCursor: rows.length === q.limit && rows.length > 0 ? rows[rows.length - 1].createdAt : null,
      },
    };
  }

  /**
   * Revoke a key.
   *
   * **THE REASON AND THE ACTOR ARE WRITTEN IN THE SAME TRANSACTION AS THE REVOCATION** (Law 4), and re-revoking is a 409
   * rather than a no-op: a second revocation would overwrite the first one's reason, which is the only record of why an
   * integration stopped working.
   *
   * W106 promises "the tenant is notified with a re-issue path". The notification EVENT and its template ship in 0123,
   * and the send itself belongs to the tenant realm's notification spine — a cross-realm dispatch this plane does not
   * make, named rather than faked (ADMIN-11c-Q7).
   */
  async revokeKey(actor: AdminRequestContext, id: string, dto: { registry: 'tenant' | 'partner'; reason: string }) {
    return this.pool.withTx(async (c) => {
      const key = await this.repo.keyById(c, dto.registry, id);
      if (!key) throw new ApiKeyNotFoundError(id);
      if (key.revokedAt) throw new ApiKeyAlreadyRevokedError(id, key.revokedAt);

      await this.repo.revokeKey(c, dto.registry, id, actor.userId, dto.reason);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'platform_api.key_revoked',
        entityType: dto.registry === 'tenant' ? 'api_key' : 'partner_api_key', entityId: id,
        oldValue: { keyPrefix: key.keyPrefix, revoked: false },
        newValue: { keyPrefix: key.keyPrefix, revoked: true, ownerId: key.ownerId, registry: dto.registry },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        id, registry: dto.registry, revoked: true, keyPrefix: key.keyPrefix,
        // Said on the response so the console does not have to guess: the gateway's own key cache is what decides how
        // long "takes effect within 60s" actually is, and this plane does not flush it.
        notificationOwner: 'ADMIN-11c-Q7',
      };
    });
  }

  /** W106's three delivery figures, and the fourth one that matters more than any of them. */
  async webhookHealth() {
    const s = await this.repo.deliveryStats();
    const bp = successRateBp(s);
    return {
      data: {
        ...s,
        successRateBp: bp,
        // A ratio in integer basis points, never a float — and NULL where nothing was attempted, because a hopeful
        // 100% over an empty window is how a dead dispatcher looks healthy.
        successRatePct: bp === null ? null : (bp / 100).toFixed(2),
      },
      meta: {
        // The worker gives up after 8 attempts (`MAX_ATTEMPTS`) by clearing `next_retry_at`. From that moment the tenant
        // will never receive the event and no other surface on this platform mentions it again.
        exhaustedMeaning: 'ap11.deliv.exhaustedMeaning',
      },
    };
  }

  async inbound(q: { providerCode?: string; failuresOnly?: boolean; limit: number }) {
    const [rows, census] = await Promise.all([this.repo.listInbound(q), this.repo.inboundFailureCensus()]);
    return {
      data: rows,
      meta: {
        ...census,
        // **THIS LOG WAS EMPTY UNTIL THIS RELEASE, AND THE CONSOLE SAYS SO.** An audit log that starts today reads
        // exactly like a clean one, which is the misreading ADMIN-5e and ADMIN-11 both had to guard against.
        beganWithRelease: 'ap11.inbound.beganWithRelease',
      },
    };
  }

  /** W007's provider health, with the two columns that have no source rendered as absent. */
  async providerHealth() {
    const rows = await this.repo.circuits();
    return {
      data: rows.map((r) => {
        const fleet = fleetState(r.instances);
        return {
          ...r,
          fleetState: fleet.state,
          instancesOpen: fleet.open,
          instancesReporting: fleet.total,
          // Derivable and honest: a declared fallback carries traffic exactly when the breaker is not closed, which is
          // what W007's "voice-OTP (active)" means.
          fallbackActive: fallbackActive(r, fleet.state),
          // **NO p95, NO ERROR RATE.** Nothing persists a per-call sample; the metrics registry is scraped out-of-band
          // and this realm does not read it. The consecutive-failure count that IS here is not an error rate.
          p95LatencyMs: null as number | null,
          errorRateBp: null as number | null,
          latencyNote: LATENCY_HAS_NO_SOURCE,
        };
      }),
      meta: {
        latencyOwner: LATENCY_OWNER,
        probeOwner: PROBE_OWNER,
        // The sentence that keeps the Circuit column honest: a breaker is per-process, so this is a set of per-pod
        // opinions and not one platform state.
        circuitIsPerInstance: 'ap11.circ.perInstance',
      },
    };
  }

  async circuitHistory(dep: string, q: { limit: number }) {
    const rows = await this.repo.circuitHistory(dep, q.limit);
    return {
      data: rows,
      meta: {
        // An empty history means either that nothing has ever failed or that nothing is reporting, and those are
        // opposite conclusions. The console must not draw the first from silence.
        emptyMeaning: 'ap11.circ.emptyMeaning',
      },
    };
  }
}
