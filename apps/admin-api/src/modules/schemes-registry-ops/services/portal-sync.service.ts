// apps/admin-api/src/modules/schemes-registry-ops/services/portal-sync.service.ts · W077 (PC-56 ADMIN-SWEEP-c1).
//
// Read-only, by construction: the one thing this plane must not do is write sync state nothing performed. The
// registry (mapping rows), the two real figures (pending pushes, ack lag where 0136's clock has run) and the
// truth vocabulary from domain/portal-sync.ts — nothing else.
import { Injectable } from '@nestjs/common';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';
import { portalTruth, ackLag, pendingPushes, neverSynced } from '../domain/portal-sync';

@Injectable()
export class PortalSyncService {
  constructor(private readonly repo: SchemesRegistryRepository) {}

  async registry() {
    const rows = await this.repo.portalRegistry();
    const manual = await this.repo.manualAuthorityCount();
    return {
      portals: rows.map((r) => ({
        authorityId: r.authorityId, authorityName: r.authorityName, level: r.level,
        providerCode: r.providerCode, externalId: r.externalId, endpointLabel: r.endpointLabel,
        mappedAt: r.mappedAt,
        // 'Last pull': never — and the registry row's own state agrees (pending, last_synced_at null).
        lastPull: r.lastSyncedAt,                       // null for every row today; the console words it 'never'
        truth: portalTruth(true),
        pendingPushes: pendingPushes(Number(r.pendingPushes ?? 0)),
        ackLag: ackLag(Number(r.ackedN ?? 0), r.ackLagP50Hours === null ? null : Number(r.ackLagP50Hours)),
      })),
      manualAuthorities: manual,
      // Asserted from the data, not assumed: if any row ever claims a sync, this flips and the console must change.
      neverSynced: neverSynced(rows.map((r) => ({ syncStatus: r.syncStatus, lastSyncedAt: r.lastSyncedAt }))),
    };
  }
}
