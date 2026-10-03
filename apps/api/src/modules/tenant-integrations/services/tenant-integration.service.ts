// modules/tenant-integrations/services/tenant-integration.service.ts · PC-56 TENANT-13c · W187 INTEGRATIONS + the W2643–W2649 chains (F-8).
//
// Founder decision 2026-10-03: CREDENTIALS VERIFIED AGAINST THE PROVIDER BEFORE VAULTING; a platform allow-list of tenant-ownable
// providers; DIRECT SETTLEMENT REFUSED BY NAME.
//   • GET  /integrations/providers      the catalogue, each provider ownable or platform-managed (refused by name, never connectable).
//   • GET  /integrations                the connections: status verified / verify_failed / disconnected / unverified (never "active"),
//                                       the masked ref (`…••41`, never the ARN), non-secret config, Health (24 h) = "N checks · last OK"
//                                       from real verification rows, the consumers list (EMPTY today — "not yet used by any platform
//                                       path"), the open proposals, the count. `api.manage` OR `tenant.settings` (F-12).
//   • POST /integrations/proposals      connect / rotate / disconnect, with a reason (20–500). A connect / rotate VERIFIES the candidate
//                                       credential in shadow AT ONCE (a failure refuses by name — auth / network / unknown — with nothing
//                                       stored anywhere); on success the credential is held ENVELOPE-SEALED on the proposal row (bound to
//                                       it), never vaulted yet. One in-flight proposal per provider (the 0193 partial unique index).
//   • POST /integrations/proposals/:id/confirm   a DIFFERENT active tenant_admin (0193 `trg_ip_moves` — not duplicated here). Then:
//                                       the credential is verified AGAIN → only on success VAULTED (a new versioned secret) → the
//                                       connection written in the transaction that closes the proposal `applied` (the 0193 gate admits it
//                                       only there) → the OLD vault ref retired after commit (zero-downtime rotation, now true). A failed
//                                       verify closes it `verify_failed`: nothing vaulted, nothing written, the old credential still serves.
//   • POST /integrations/proposals/:id/refuse    a tenant_admin, with a reason. Closing wipes the sealed credential.
// Every act is audited with actor · reason · before / after · ip; no audit row, log line or response ever carries a credential.
// Idempotency-Key honoured on every write (F-21): a retried proposal is one proposal, a retried confirm is one vault write.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { uuidv7 } from '../../../core/database/uuid.util';
import { SECRET_WRITER, SecretWriter } from '../../../core/secrets/secret-writer.port';
import { SECRET_READER, SecretReader } from '../../../core/secrets/secret-reader.port';
import { openEnvelope, resolveKek, sealEnvelope } from '../../../core/secrets/secret-envelope';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import {
  DIRECT_SETTLEMENT, VerifyResult, cleanCredential, consumersOf, credentialHint, credentialRefusals, healthLine, maskedRef, nonSecretConfig, reasonRefusal, storableResult,
} from '../domain/provider-rules';
import { CONFIRMED_STUCK_MINUTES, ProposalKind, isProposalKind, kindVerdict, proposalActs } from '../domain/integration-proposal.state';
import {
  IntegrationActRefusedError, IntegrationProposalNotFoundError, IntegrationRefusedError, IntegrationVerifyFailedError, IntegrationsForbiddenError,
  ProviderNotFoundError, ProviderNotOwnableError,
} from '../domain/tenant-integrations.errors';
import { PROVIDER_VERIFIER, ProviderVerifier } from '../infra/provider-verifier';
import { ConnectionRow, ProposalRow, ProviderRow, TenantIntegrationRepository } from '../repositories/tenant-integration.repository';

export interface IntegrationsActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
export const canManageIntegrations = (a: Pick<IntegrationsActor, 'permissions'>) =>
  a.permissions.has('api.manage') || a.permissions.has('tenant.settings') || a.permissions.has('*');
export interface ProposalInput { providerCode: string; kind: string; credential?: Record<string, unknown> | null; config?: Record<string, unknown> | null; reason: string }

const aad = (proposalId: string) => `integration_proposal:${proposalId}`;
const TRIGGER_CODES: Record<string, { code: string; status: number; message: string }> = {
  INTEGRATION_CHECKER_IS_MAKER: { code: 'CHECKER_IS_MAKER', status: 409, message: 'The person who proposed this provider change cannot also confirm it — a second administrator must.' },
  INTEGRATION_CHECKER_NOT_ADMIN: { code: 'CHECKER_NOT_ADMIN', status: 403, message: 'Only an active tenant administrator may confirm or refuse a provider change.' },
  INTEGRATION_PROPOSER_NOT_ADMIN: { code: 'PROPOSER_NOT_ADMIN', status: 403, message: 'Only an active tenant administrator may propose a provider change.' },
  INTEGRATION_PROPOSAL_EXPIRED: { code: 'PROPOSAL_EXPIRED', status: 409, message: 'This proposal expired before it was confirmed.' },
  INTEGRATION_PROPOSAL_CLOSED: { code: 'PROPOSAL_CLOSED', status: 409, message: 'This proposal is already closed.' },
  INTEGRATION_PROPOSAL_NOT_YOURS: { code: 'PROPOSAL_NOT_YOURS', status: 403, message: 'A confirmation is made in your own session.' },
  INTEGRATION_PROVIDER_NOT_OWNABLE: { code: 'INTEGRATION_PROVIDER_NOT_OWNABLE', status: 422, message: 'This provider is platform-managed.' },
  INTEGRATION_PROPOSAL_REQUIRED: { code: 'INTEGRATION_PROPOSAL_REQUIRED', status: 409, message: 'A provider credential is written only by a confirmed proposal.' },
};
export function namedTriggerRefusal(e: unknown): unknown {
  const pg = e as { code?: string; constraint?: string; message?: string };
  if (pg?.code === '23505' && String(pg.constraint ?? pg.message ?? '').includes('uq_integration_proposals_in_flight')) {
    return new IntegrationActRefusedError('INTEGRATION_CHANGE_IN_FLIGHT', 'Another change to this provider is already waiting — never parallelize provider changes.');
  }
  const m = /\[([A-Z_]+)\]/.exec(String(pg?.message ?? ''));
  const t = m ? TRIGGER_CODES[m[1]] : undefined;
  return t ? new IntegrationActRefusedError(t.code, t.message, t.status) : e;
}

function connectionView(c: ConnectionRow) {
  return {
    id: c.id, providerCode: c.providerCode, providerName: c.providerName, category: c.category,
    config: c.config, maskedRef: maskedRef(c.secretRef), credentialHint: c.credentialHint,
    status: c.status, verifiedAt: c.verifiedAt, verifyResult: c.verifyResult, lastCheckedAt: c.lastCheckedAt,
    disconnectedAt: c.disconnectedAt, disconnectReason: c.disconnectReason, createdAt: c.createdAt,
    health: healthLine(c),
    consumers: consumersOf(c.providerCode),
    // nothing settles through a tenant connection, so disconnecting never waits on in-flight settlements — and says why
    disconnect: { blockedByInFlightSettlements: false, reason: 'no_platform_path_reads_it' as const },
  };
}
function providerView(p: ProviderRow) {
  return {
    code: p.code, name: p.defaultName, category: p.category, ownable: p.tenantOwnable, managed: !p.tenantOwnable,
    verifyMethod: p.verifyMethod, verifiable: p.tenantOwnable && Boolean(p.verifyUrl),
    credentialFields: p.credentialFields.map((f) => ({ name: f.name, secret: f.secret })),
    consumers: consumersOf(p.code),
  };
}
function proposalView(p: ProposalRow, viewer: string, nowMs: number) {
  return {
    id: p.id, providerCode: p.providerCode, providerName: p.providerName, kind: p.kind, credentialHint: p.credentialHint, config: p.config,
    shadowResult: p.shadowResult, reason: p.reason, proposedBy: p.proposedBy, proposedByName: p.proposedByName, proposedAt: p.proposedAt,
    expiresAt: p.expiresAt, status: p.status, confirmedBy: p.confirmedBy, confirmedAt: p.confirmedAt, outcome: p.outcome, closedAt: p.closedAt,
    refusedBy: p.refusedBy, refuseReason: p.refuseReason, youProposed: p.proposedBy === viewer, ...proposalActs(p, viewer, nowMs),
  };
}

@Injectable()
export class TenantIntegrationService {
  private readonly log = new Logger(TenantIntegrationService.name);
  private readonly kek: Buffer;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(SECRET_WRITER) private readonly secrets: SecretWriter,
    @Inject(SECRET_READER) private readonly reader: SecretReader,
    @Inject(PROVIDER_VERIFIER) private readonly verifier: ProviderVerifier,
    private readonly audit: AuditWriter,
    private readonly repo: TenantIntegrationRepository,
    config: AppConfig,
  ) {
    // the platform envelope key (13a): production without it refuses to start
    this.kek = resolveKek(config.webhookSigningKek, config.isProd);
  }

  private assert(a: IntegrationsActor) { if (!canManageIntegrations(a)) throw new IntegrationsForbiddenError(); }

  async listProviders(tenantId: string, actor: IntegrationsActor) {
    this.assert(actor);
    return timed(this.metrics, 'tenant_integrations.providers', { tenant: tenantId }, async () => (await this.repo.listProviders(tenantId)).map(providerView));
  }

  /** W187 — connections, providers, open proposals, the count, the honest platform-default sentence's facts. */
  async list(tenantId: string, actor: IntegrationsActor) {
    this.assert(actor);
    return timed(this.metrics, 'tenant_integrations.list', { tenant: tenantId }, async () => {
      const [rows, providers, open] = await Promise.all([
        this.repo.listForTenant(tenantId), this.repo.listProviders(tenantId), this.repo.proposals(tenantId, { status: 'open', limit: 50 }),
      ]);
      const now = Date.now();
      const live = rows.filter((r) => r.status !== 'disconnected');
      return {
        items: rows.map(connectionView), providers: providers.map(providerView),
        proposals: open.map((p) => proposalView(p, actor.userId, now)),
        count: { providers: providers.length, ownable: providers.filter((p) => p.tenantOwnable).length, connected: live.length },
        platformDefaults: { payments: 'platform_account' as const, sms: 'platform_route' as const, inUse: true },
        directSettlement: DIRECT_SETTLEMENT,
      };
    });
  }

  async proposals(tenantId: string, actor: IntegrationsActor, q: { status?: string; providerCode?: string; cursor?: string; limit?: number }) {
    this.assert(actor);
    const limit = Math.min(Math.max(Number(q.limit ?? 25) || 25, 1), 100);
    const status = q.status && ['open', 'proposed', 'confirmed', 'applied', 'verify_failed', 'refused', 'expired'].includes(q.status) ? q.status : undefined;
    const rows = await this.repo.proposals(tenantId, { status, providerCode: q.providerCode, cursor: decodeKeyset(q.cursor, UUID_RE), limit });
    const last = rows[rows.length - 1];
    const now = Date.now();
    return { items: rows.map((p) => proposalView(p, actor.userId, now)), nextCursor: rows.length === limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }

  async proposal(tenantId: string, actor: IntegrationsActor, id: string) {
    this.assert(actor);
    const p = await this.uow.run(tenantId, (tx) => this.repo.proposalTx(tx, tenantId, id), { userId: actor.userId });
    if (!p) throw new IntegrationProposalNotFoundError();
    const { sealed: _sealed, ...row } = p;
    return proposalView(row, actor.userId, Date.now());
  }

  /** W2644 — the review: the provider verdict, field refusals, the kind verdict. Writes nothing, calls no provider. */
  async preview(tenantId: string, actor: IntegrationsActor, input: Partial<ProposalInput>) {
    this.assert(actor);
    return this.uow.run(tenantId, async (tx) => {
      const r = await this.judge(tx, tenantId, input);
      return { ready: r.refusals.length === 0, refusals: r.refusals, provider: r.provider ? providerView(r.provider) : null, kind: r.kind,
        willVerifyInShadow: r.kind !== 'disconnect', connection: r.connection ? connectionView(r.connection) : null };
    }, { userId: actor.userId });
  }

  private async judge(tx: TxContext, tenantId: string, input: Partial<ProposalInput>) {
    const refusals: { field: string | null; code: string; detail?: string }[] = [];
    const code = String(input.providerCode ?? '').trim();
    const provider = /^[a-z][a-z0-9_]{1,59}$/.test(code) ? await this.repo.providerTx(tx, code) : null;
    const kind = isProposalKind(String(input.kind ?? '')) ? (input.kind as ProposalKind) : null;
    if (!provider || !provider.isActive) refusals.push({ field: 'providerCode', code: 'INTEGRATION_PROVIDER_NOT_FOUND' });
    else if (!provider.tenantOwnable) refusals.push({ field: 'providerCode', code: 'INTEGRATION_PROVIDER_NOT_OWNABLE' });
    if (!kind) refusals.push({ field: 'kind', code: 'kind_invalid' });
    const connection = provider ? await this.repo.connectionTx(tx, tenantId, provider.code) : null;
    if (provider?.tenantOwnable && kind) {
      const kv = kindVerdict(kind, connection);
      if (!kv.ok) refusals.push({ field: 'kind', code: kv.code });
    }
    if (provider?.tenantOwnable && (kind === 'connect' || kind === 'rotate')) {
      if (!provider.verifyUrl) refusals.push({ field: 'providerCode', code: 'verify_not_configured' });
      for (const r of credentialRefusals(provider.credentialFields, (input.credential ?? {}) as Record<string, unknown>)) refusals.push(r);
    }
    if (kind === 'disconnect' && input.credential) refusals.push({ field: 'credential', code: 'credential_not_allowed' });
    const rr = reasonRefusal(input.reason);
    if (rr) refusals.push({ field: 'reason', code: rr });
    if ((await this.repo.adminCountTx(tx, tenantId)) < 2) refusals.push({ field: null, code: 'NEEDS_SECOND_ADMIN' });
    return { refusals, provider, kind, connection };
  }

  /** W2645 — propose. A credential is verified in shadow NOW; on failure nothing is stored anywhere. */
  async propose(tenantId: string, actor: IntegrationsActor, idemKey: string, input: ProposalInput) {
    this.assert(actor);
    return this.idem.remember(idemKey, actor.userId, 'integrations.propose', async () => {
      // 1. judge (no provider call yet)
      const judged = await this.uow.run(tenantId, (tx) => this.judge(tx, tenantId, input), { userId: actor.userId });
      if (judged.refusals.some((r) => r.code === 'INTEGRATION_PROVIDER_NOT_OWNABLE')) throw new ProviderNotOwnableError(String(input.providerCode));
      if (judged.refusals.some((r) => r.code === 'INTEGRATION_PROVIDER_NOT_FOUND')) throw new ProviderNotFoundError(String(input.providerCode));
      if (judged.refusals.length) throw new IntegrationRefusedError(judged.refusals);
      const provider = judged.provider!; const kind = judged.kind!;
      const id = uuidv7();
      let sealed: string | null = null; let hint: string | null = null; let shadow: Record<string, unknown> | null = null; let config: Record<string, unknown> = {};
      if (kind !== 'disconnect') {
        // 2. VERIFY IN SHADOW before anything is stored
        const cred = cleanCredential(provider.credentialFields, input.credential as Record<string, unknown>);
        const v = await this.verifier.verify(provider, cred);
        this.metrics.inc('tenant_integrations.shadow_verify', { provider: provider.code, ok: String(v.ok) });
        if (!v.ok) throw new IntegrationVerifyFailedError(provider.code, v.errorClass ?? 'unknown', v.detail);
        sealed = sealEnvelope(this.kek, JSON.stringify(cred), aad(id));
        hint = credentialHint(provider.credentialFields, cred);
        shadow = storableResult(v, new Date().toISOString());
        config = { ...(input.config ?? {}), ...nonSecretConfig(provider.credentialFields, cred) };
      }
      // 3. the proposal (sealed credential bound to the row) + audit — one transaction
      try {
        await this.uow.run(tenantId, async (tx) => {
          await this.repo.insertProposalTx(tx, { id, tenantId, providerCode: provider.code, kind, sealed, hint, config, shadow, reason: input.reason.trim(), proposedBy: actor.userId });
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: `integration.${kind}_proposed`, entityType: 'integration_proposal', entityId: id,
            oldValue: judged.connection ? { status: judged.connection.status, credentialHint: judged.connection.credentialHint } : null,
            newValue: { providerCode: provider.code, kind, credentialHint: hint, config, shadowResult: shadow }, reason: input.reason.trim(), ip: actor.ip, requestId: actor.requestId,
          });
        }, { userId: actor.userId });
      } catch (e) { throw namedTriggerRefusal(e); }
      return { id, providerCode: provider.code, kind, status: 'proposed' as const, credentialHint: hint, shadowResult: shadow };
    });
  }

  /** W2647/W2648 — confirm (a different tenant_admin), then verify → vault → write, or close verify_failed with nothing stored. */
  async confirm(tenantId: string, actor: IntegrationsActor, idemKey: string, id: string) {
    this.assert(actor);
    return this.idem.remember(idemKey, actor.userId, `integrations.confirm.${id}`, async () => {
      // 1. the confirmation itself — the trigger is the maker ≠ checker wall; committed BEFORE any provider call or vault write
      let p: (ProposalRow & { sealed: string | null }) | null = null;
      try {
        p = await this.uow.run(tenantId, async (tx) => {
          const row = await this.repo.proposalTx(tx, tenantId, id, true);
          if (!row) throw new IntegrationProposalNotFoundError();
          if (!(await this.repo.confirmTx(tx, tenantId, id, actor.userId))) throw new IntegrationActRefusedError('PROPOSAL_CLOSED', 'This proposal is already closed.');
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: `integration.${row.kind}_confirmed`, entityType: 'integration_proposal', entityId: id,
            oldValue: { status: 'proposed', proposedBy: row.proposedBy }, newValue: { status: 'confirmed', confirmedBy: actor.userId }, reason: row.reason, ip: actor.ip, requestId: actor.requestId,
          });
          return row;
        }, { userId: actor.userId });
      } catch (e) { throw namedTriggerRefusal(e); }
      return this.apply(tenantId, actor, p!);
    });
  }

  /** After the confirmation commits: the second verify, the vault, the write — or a clean verify_failed. */
  private async apply(tenantId: string, actor: IntegrationsActor, p: ProposalRow & { sealed: string | null }) {
    const provider = await this.uow.run(tenantId, (tx) => this.repo.providerTx(tx, p.providerCode), { userId: actor.userId });
    if (!provider) throw new ProviderNotFoundError(p.providerCode);

    if (p.kind === 'disconnect') {
      let oldRef: string | null = null;
      await this.uow.run(tenantId, async (tx) => {
        const before = await this.repo.connectionTx(tx, tenantId, p.providerCode, true);
        oldRef = before?.secretRef ?? null;
        await this.repo.citeProposalTx(tx, p.id);
        const done = before ? await this.repo.disconnectTx(tx, tenantId, p.providerCode, actor.userId, p.reason) : false;
        const outcome = { ok: done, detail: done ? 'disconnected' : 'nothing was connected', at: new Date().toISOString() };
        await this.repo.closeTx(tx, tenantId, p.id, 'applied', outcome);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'integration.disconnected', entityType: 'tenant_integration', entityId: before?.id ?? null,
          oldValue: before ? { status: before.status, credentialHint: before.credentialHint } : null, newValue: { status: 'disconnected', proposalId: p.id },
          reason: p.reason, ip: actor.ip, requestId: actor.requestId,
        });
      }, { userId: actor.userId });
      if (oldRef) await this.secrets.deleteTenantSecret(oldRef).catch(() => undefined);
      return { proposalId: p.id, providerCode: p.providerCode, kind: p.kind, status: 'applied' as const, connectionStatus: 'disconnected' as const };
    }

    // connect / rotate: open the sealed candidate, VERIFY AGAIN (it may have been revoked at the provider since it was proposed)
    let cred: Record<string, string> | null = null;
    try { cred = p.sealed ? JSON.parse(openEnvelope(this.kek, p.sealed, aad(p.id))) : null; } catch { cred = null; }
    const v: VerifyResult = cred ? await this.verifier.verify(provider, cred)
      : { ok: false, errorClass: 'unknown', detail: 'the sealed credential could not be opened', httpStatus: null, durationMs: 0 };
    const result = storableResult(v, new Date().toISOString());
    if (!v.ok) {
      await this.uow.run(tenantId, async (tx) => {
        await this.repo.closeTx(tx, tenantId, p.id, 'verify_failed', result);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: `integration.${p.kind}_verify_failed`, entityType: 'integration_proposal', entityId: p.id,
          oldValue: { status: 'confirmed' }, newValue: { status: 'verify_failed', result }, reason: p.reason, ip: actor.ip, requestId: actor.requestId,
        });
      }, { userId: actor.userId });
      this.metrics.inc('tenant_integrations.verify_failed', { provider: p.providerCode, class: v.errorClass ?? 'unknown' });
      return { proposalId: p.id, providerCode: p.providerCode, kind: p.kind, status: 'verify_failed' as const, result };
    }

    // verified → vault a NEW versioned secret (never overwriting the one in service)
    const { secretRef } = await this.secrets.putTenantSecret(tenantId, p.providerCode, JSON.stringify(cred), p.id);
    let oldRef: string | null = null; let integrationId: string | null = null;
    try {
      await this.uow.run(tenantId, async (tx) => {
        const before = await this.repo.connectionTx(tx, tenantId, p.providerCode, true);
        oldRef = before && before.secretRef !== secretRef ? before.secretRef : null;
        await this.repo.citeProposalTx(tx, p.id);
        const write = { tenantId, providerCode: p.providerCode, secretRef, config: p.config, hint: p.credentialHint ?? '••', verifyResult: result, userId: actor.userId };
        integrationId = p.kind === 'rotate' ? await this.repo.rotateCredentialTx(tx, write) : await this.repo.applyCredentialTx(tx, write);
        if (!integrationId) throw new IntegrationActRefusedError('NOT_CONNECTED', 'There is no live connection to rotate.');
        await this.repo.recordCheckTx(tx, { tenantId, integrationId, providerCode: p.providerCode, kind: 'apply', ok: true, errorClass: null, detail: v.detail, durationMs: v.durationMs });
        await this.repo.closeTx(tx, tenantId, p.id, 'applied', result);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: p.kind === 'rotate' ? 'integration.rotated' : 'integration.connected', entityType: 'tenant_integration', entityId: integrationId,
          oldValue: before ? { status: before.status, credentialHint: before.credentialHint, maskedRef: maskedRef(before.secretRef) } : null,
          newValue: { status: 'verified', credentialHint: p.credentialHint, maskedRef: maskedRef(secretRef), config: p.config, proposalId: p.id, result },
          reason: p.reason, ip: actor.ip, requestId: actor.requestId,
        });
      }, { userId: actor.userId });
    } catch (e) {
      // the write did not commit: the credential we just vaulted serves nothing — remove it, keep the old one in service
      await this.secrets.deleteTenantSecret(secretRef).catch(() => undefined);
      throw namedTriggerRefusal(e);
    }
    // after commit: retire the credential the new one replaced (zero-downtime rotation)
    if (oldRef) await this.secrets.deleteTenantSecret(oldRef).catch((err) => this.log.warn(`retire old credential for ${p.providerCode} failed: ${String((err as Error)?.message ?? err)}`));
    this.metrics.inc('tenant_integrations.applied', { provider: p.providerCode, kind: p.kind });
    return { proposalId: p.id, providerCode: p.providerCode, kind: p.kind, status: 'applied' as const, connectionStatus: 'verified' as const, integrationId, result };
  }

  async refuse(tenantId: string, actor: IntegrationsActor, idemKey: string, id: string, reason: string) {
    this.assert(actor);
    const rr = reasonRefusal(reason);
    if (rr) throw new IntegrationRefusedError([{ field: 'reason', code: rr }]);
    return this.idem.remember(idemKey, actor.userId, `integrations.refuse.${id}`, async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const p = await this.repo.proposalTx(tx, tenantId, id, true);
          if (!p) throw new IntegrationProposalNotFoundError();
          if (!(await this.repo.refuseTx(tx, tenantId, id, actor.userId, reason.trim()))) throw new IntegrationActRefusedError('PROPOSAL_CLOSED', 'This proposal is already closed.');
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: `integration.${p.kind}_refused`, entityType: 'integration_proposal', entityId: id,
            oldValue: { status: 'proposed' }, newValue: { status: 'refused' }, reason: reason.trim(), ip: actor.ip, requestId: actor.requestId,
          });
          return { proposalId: id, status: 'refused' as const };
        }, { userId: actor.userId });
      } catch (e) { throw namedTriggerRefusal(e); }
    });
  }

  /** The clock (job): an unconfirmed proposal expires after 7 days; a confirmation the process never finished (> 15 min) closes
   *  verify_failed ("interrupted") — either way the sealed credential is wiped and nothing was vaulted. */
  async closeDue(tenantId: string, id: string, status: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const ok = status === 'proposed'
        ? await this.repo.expireTx(tx, tenantId, id)
        : await this.repo.closeTx(tx, tenantId, id, 'verify_failed', { ok: false, errorClass: 'unknown', detail: 'interrupted before the verification finished', at: new Date().toISOString() });
      if (ok) await this.audit.write(tx, { tenantId, actorUserId: null, action: status === 'proposed' ? 'integration.proposal_expired' : 'integration.proposal_interrupted', entityType: 'integration_proposal', entityId: id, reason: status === 'proposed' ? 'unconfirmed after 7 days' : `confirmed and not applied within ${CONFIRMED_STUCK_MINUTES} minutes` });
      return ok;
    }, { userId: undefined });
  }

  /** The daily re-verification of ONE connection: read the vaulted credential (the only SECRET_READER consumer), verify, record. */
  async reverify(tenantId: string, row: { id: string; providerCode: string; secretRef: string }): Promise<boolean> {
    const provider = await this.uow.run(tenantId, (tx) => this.repo.providerTx(tx, row.providerCode), { userId: undefined });
    let v: VerifyResult;
    if (!provider) v = { ok: false, errorClass: 'unknown', detail: 'provider no longer in the catalogue', httpStatus: null, durationMs: 0 };
    else {
      let plain: string | null = null;
      try { plain = await this.reader.readTenantSecret(row.secretRef); } catch { plain = null; }
      let cred: Record<string, string> | null = null;
      try { cred = plain ? JSON.parse(plain) : null; } catch { cred = null; }
      v = cred ? await this.verifier.verify(provider, cred) : { ok: false, errorClass: 'unknown', detail: 'credential not readable from the vault', httpStatus: null, durationMs: 0 };
    }
    const result = storableResult(v, new Date().toISOString());
    await this.uow.run(tenantId, (tx) => this.repo.recordCheckTx(tx, { tenantId, integrationId: row.id, providerCode: row.providerCode, kind: 'daily', ok: v.ok, errorClass: v.errorClass, detail: v.detail, durationMs: v.durationMs, result }), { userId: undefined });
    this.metrics.inc('tenant_integrations.daily_check', { provider: row.providerCode, ok: String(v.ok) });
    return v.ok;
  }
}
