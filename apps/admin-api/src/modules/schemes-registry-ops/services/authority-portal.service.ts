// apps/admin-api/src/modules/schemes-registry-ops/services/authority-portal.service.ts · DELTA-018, answered with no
// new table (canon W072's "Portal sync" column and its own "per-authority sync config BACKEND PENDING" footnote).
//
// THE ANSWER IS THE ONE DELTA-008 GOT IN 0104, FOR THE SAME REASON. `external_entity_refs` (0015) already models
// internal-entity → provider → external-id, with UNIQUE both ways, and its `entity_type` is a free varchar precisely
// so a new kind needs no migration. An authority's filing portal is exactly that shape. The second UNIQUE — one
// external id per provider — is the constraint a purpose-built table forgets, and it is the one that matters here:
// two authorities both claiming the same PM-KISAN portal id is how one authority's submissions land under the
// other's name.
//
// WHAT THIS DELIBERATELY DOES NOT STORE. Credentials. W072 states the rule ("portal credentials live in Secrets
// Manager, never here") and `assertEndpointLabel` enforces it by refusing anything that looks like a key, token or
// PEM block — because the one free-text field on a screen is where a well-meaning operator pastes a token.
//
// AND THE WORD. `sync_status` is written as 'pending' and never 'synced'; the state the console renders is 'mapped'
// or 'manual'. Nothing in this monorepo has ever called any of these portals — the PFMS provider is a Noop that
// returns providerAvailable:false and there is no iKhedut client at all — so a row asserting a successful exchange
// would be the registry lying about work that never happened.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';
import { AuthorityNotFoundError, PortalMappingConflictError, InvalidSchemeInputError } from '../domain/schemes-registry.errors';
import { assertEndpointLabel, isPortalProvider, PORTAL_PROVIDER_CODES } from '../domain/scheme-version';
import { assertPlainText } from '../domain/scheme-rules';
import type { MapPortalDto, UnmapPortalDto } from '../dto/schemes-registry.dto';

@Injectable()
export class AuthorityPortalService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: SchemesRegistryRepository) {}

  async mapPortal(actor: AdminRequestContext, authorityId: string, dto: MapPortalDto) {
    if (!isPortalProvider(dto.providerCode)) {
      throw new InvalidSchemeInputError(`providerCode must be one of ${PORTAL_PROVIDER_CODES.join('|')} — a portal must be a registered government integration provider, not free text`);
    }
    const externalId = assertPlainText(dto.externalId, 'externalId', 200);
    const endpointLabel = dto.endpointLabel === undefined || dto.endpointLabel === null ? null : assertEndpointLabel(dto.endpointLabel);

    return this.pool.withTx(async (client) => {
      const authority = await this.repo.getAuthorityForUpdate(client, authorityId);
      if (!authority) throw new AuthorityNotFoundError(authorityId);

      // Checked BEFORE the upsert so the 409 can NAME the authority already holding this id. The unique index would
      // catch it either way, as a constraint violation that names an index and helps nobody.
      const owner = await this.repo.portalExternalIdOwner(client, dto.providerCode, externalId);
      if (owner && owner !== authorityId) throw new PortalMappingConflictError(dto.providerCode, externalId, owner);

      const before = (await this.repo.portalRefsByAuthority([authorityId])).get(authorityId) ?? null;
      await this.repo.upsertPortalRef(client, { authorityId, providerCode: dto.providerCode, externalId, endpointLabel, actorUserId: actor.userId });

      const newValue = { providerCode: dto.providerCode, externalId, endpointLabel, syncStatus: 'pending' };
      await this.repo.insertChange(client, { entityType: 'authority_portal', entityId: authorityId, action: 'bound', oldValue: before, newValue, reason: dto.reason, actorUserId: actor.userId });
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'schemes.authority.portal_mapped', entityType: 'scheme_authority', entityId: authorityId, oldValue: before, newValue, reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null });
      return { authorityId, ...newValue, portalState: 'mapped' as const, portalSyncEverAttempted: false };
    });
  }

  /** Unmapping returns the authority to `manual` — which for every authority on the platform today is the truth
   *  anyway, since no portal has ever been called. */
  async unmapPortal(actor: AdminRequestContext, authorityId: string, dto: UnmapPortalDto) {
    if (!isPortalProvider(dto.providerCode)) {
      throw new InvalidSchemeInputError(`providerCode must be one of ${PORTAL_PROVIDER_CODES.join('|')}`);
    }
    return this.pool.withTx(async (client) => {
      const authority = await this.repo.getAuthorityForUpdate(client, authorityId);
      if (!authority) throw new AuthorityNotFoundError(authorityId);
      const before = (await this.repo.portalRefsByAuthority([authorityId])).get(authorityId) ?? null;
      const removed = await this.repo.deletePortalRef(client, authorityId, dto.providerCode, actor.userId);
      if (removed === 0) throw new InvalidSchemeInputError(`authority '${authorityId}' has no '${dto.providerCode}' portal mapping to remove`);
      await this.repo.insertChange(client, { entityType: 'authority_portal', entityId: authorityId, action: 'unbound', oldValue: before, newValue: null, reason: dto.reason, actorUserId: actor.userId });
      await this.audit.write(client, { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action: 'schemes.authority.portal_unmapped', entityType: 'scheme_authority', entityId: authorityId, oldValue: before, newValue: null, reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null });
      return { authorityId, providerCode: dto.providerCode, portalState: 'manual' as const };
    });
  }
}
