// modules/tenant-api-keys/services/api-key.service.ts · PC-56 TENANT-13c · W190 API KEYS + the W2488–W2494 chains (F-9).
//
//   • GET   /api-keys                       the list (Name · Key prefix · Scopes · Rate/hr · Last used · Status), the count, the plan
//                                           access (`api_access`, read for real), the scope catalogue, the waiting proposals, the real
//                                           revocation bound. `api.manage` on every read and write (F-12).
//   • POST  /api-keys/preview               W2489 — the review: every refusal against its field, the EXACT routes the scopes unlock,
//                                           whether a second administrator must confirm. Writes nothing.
//   • POST  /api-keys                       W2490 — issue. Plan gate first (PLAN_FEATURE_REQUIRED). The key is shown ONCE, in THIS
//                                           response body; stored as sha256(secret); the idempotency record remembers the answer
//                                           WITHOUT the key (a replay says `keyShown: false`). A checker-scope key is issued WAITING with a
//                                           proposal in the same transaction — it works only after a different tenant_admin confirms.
//   • POST  /api-keys/:id/revoke            W2492–W2494 — reason required; permanent; effective on the next call (the guard reads the row
//                                           every call; the console prints the 60 s ceiling).
//   • GET   /api-keys/proposals             waiting / closed proposals (µs keyset).
//   • POST  /api-keys/proposals/:id/confirm a DIFFERENT active tenant_admin (0193 `trg_akp_moves` is the wall — this service does NOT
//                                           duplicate the maker ≠ checker check, so removing the trigger turns a test red); the key is
//                                           activated in the confirming transaction (`trg_api_keys_rules` admits it only there).
//   • POST  /api-keys/proposals/:id/refuse  a tenant_admin, with a reason (20–500): the waiting key is revoked.
// Every act is audited with actor · reason · before / after · ip · request id.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { API_SCOPES, routesUnlocked } from '../domain/api-scopes';
import {
  KeyDraft, RATE_DEFAULT, RATE_MAX, RATE_MIN, REVOCATION_BOUND_SECONDS, generateKey, hashSecret, refuseReasonRefusal, reviewDraft, revokeReasonRefusal,
} from '../domain/api-key.rules';
import { KeyStatus, canRevoke, keyProposalVerdict, keyStatus } from '../domain/api-key.state';
import {
  ApiKeyActRefusedError, ApiKeyNotFoundError, ApiKeyProposalNotFoundError, ApiKeyRefusedError, ApiKeysForbiddenError, PlanFeatureRequiredError,
} from '../domain/tenant-api-keys.errors';
import { ApiKeyRepository, KeyProposalRow, KeyRow } from '../repositories/api-key.repository';

export interface ApiKeysActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
export const canManageApi = (a: Pick<ApiKeysActor, 'permissions'>) => a.permissions.has('api.manage') || a.permissions.has('*');

const TRIGGER_CODES: Record<string, { code: string; status: number; message: string }> = {
  API_KEY_CHECKER_IS_MAKER: { code: 'CHECKER_IS_MAKER', status: 409, message: 'The person who created this key cannot also confirm it — a second administrator must.' },
  API_KEY_CHECKER_NOT_ADMIN: { code: 'CHECKER_NOT_ADMIN', status: 403, message: 'Only an active tenant administrator may confirm or refuse a key.' },
  API_KEY_PROPOSAL_EXPIRED: { code: 'PROPOSAL_EXPIRED', status: 409, message: 'This proposal expired before it was confirmed.' },
  API_KEY_PROPOSAL_CLOSED: { code: 'PROPOSAL_CLOSED', status: 409, message: 'This proposal is already closed.' },
  API_KEY_PROPOSAL_NOT_YOURS: { code: 'PROPOSAL_NOT_YOURS', status: 403, message: 'A confirmation is made in your own session.' },
  API_KEY_CREATOR_NOT_ADMIN: { code: 'CREATOR_NOT_ADMIN', status: 403, message: 'Only an active tenant administrator creates API keys.' },
  API_KEY_NEEDS_CHECKER: { code: 'NEEDS_CHECKER', status: 409, message: 'A member-data key works only after a second administrator confirms it.' },
  API_KEY_CHECKER_REQUIRED: { code: 'NEEDS_CHECKER', status: 409, message: 'A member-data key works only after a second administrator confirms it.' },
  API_KEY_REVOKED_FINAL: { code: 'KEY_ALREADY_REVOKED', status: 409, message: 'This key is already revoked; revocation is permanent.' },
  API_KEY_SCOPES: { code: 'SCOPE_UNKNOWN', status: 422, message: 'A scope is not in the catalogue.' },
};
/** A trigger refusal by name (`[API_KEY_CHECKER_IS_MAKER] …` → CHECKER_IS_MAKER), or the original error. */
export function namedTriggerRefusal(e: unknown): unknown {
  const m = /\[([A-Z_]+)\]/.exec(String((e as Error)?.message ?? ''));
  const t = m ? TRIGGER_CODES[m[1]] : undefined;
  return t ? new ApiKeyActRefusedError(t.code, t.message, t.status) : e;
}

export function keyView(k: KeyRow, nowMs: number) {
  const status: KeyStatus = keyStatus(k, nowMs);
  return {
    id: k.id, name: k.name, keyPrefix: k.keyPrefix, scopes: k.scopes, ratePerHour: k.ratePerHour, lastUsedAt: k.lastUsedAt,
    status, createdAt: k.createdAt, createdBy: k.createdBy, createdByName: k.createdByName, expiresAt: k.expiresAt,
    activatedAt: k.activatedAt, checker: k.checkerUserId ? { userId: k.checkerUserId, name: k.checkerName } : null,
    revokedAt: k.revokedAt, revokedReason: k.revokedReason, revokedByPlatform: k.revokedByAdmin,
    proposal: k.proposalId ? { id: k.proposalId, status: k.proposalStatus } : null,
    canRevoke: canRevoke(k),
  };
}
export function proposalView(p: KeyProposalRow, viewer: string, nowMs: number) {
  return {
    id: p.id, apiKeyId: p.apiKeyId, keyPrefix: p.keyPrefix, keyName: p.keyName, scopes: p.scopes, reason: p.reason,
    proposedBy: p.proposedBy, proposedByName: p.proposedByName, proposedAt: p.proposedAt, expiresAt: p.expiresAt, status: p.status,
    confirmedBy: p.confirmedBy, confirmedAt: p.confirmedAt, refusedBy: p.refusedBy, refuseReason: p.refuseReason,
    canConfirm: keyProposalVerdict(p, 'confirm', viewer, nowMs).ok, canRefuse: keyProposalVerdict(p, 'refuse', viewer, nowMs).ok,
    youProposed: p.proposedBy === viewer,
  };
}

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: ApiKeyRepository,
  ) {}

  private assert(a: ApiKeysActor) { if (!canManageApi(a)) throw new ApiKeysForbiddenError(); }

  /** The issuing contract exactly as built — the console prints these, never its own copy of them. */
  contract() {
    return {
      keyFormat: 'kv_live_<8>_<32>', sandbox: false as const, storedAs: 'sha256' as const, shownOnce: true as const,
      rate: { default: RATE_DEFAULT, min: RATE_MIN, max: RATE_MAX }, revocationBoundSeconds: REVOCATION_BOUND_SECONDS,
      idempotencyRequiredOnWrites: true as const, proposalTtlDays: 7,
    };
  }
  catalogue() {
    return API_SCOPES.map((s) => ({ code: s.code, kind: s.kind, checker: s.checker, description: s.description, routes: s.routes.map((r) => `${r.method} ${r.path}`) }));
  }

  scopes(actor: ApiKeysActor) {
    this.assert(actor);
    return { scopes: this.catalogue(), contract: this.contract() };
  }

  async list(tenantId: string, actor: ApiKeysActor, q: { cursor?: string; limit?: number } = {}) {
    this.assert(actor);
    return timed(this.metrics, 'tenant_api_keys.list', { tenant: tenantId }, async () => {
      const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 100);
      const now = Date.now();
      const [page, access, waiting] = await Promise.all([
        this.repo.list(tenantId, decodeKeyset(q.cursor, UUID_RE), limit),
        this.repo.apiAccessRead(tenantId),
        this.repo.proposals(tenantId, { status: 'proposed', limit: 50 }),
      ]);
      const last = page.rows[page.rows.length - 1];
      return {
        items: page.rows.map((k) => keyView(k, now)), total: page.total, active: page.active,
        nextCursor: page.rows.length === limit && last ? encodeKeyset(last.cursorTs, last.id) : null,
        access, catalogue: this.catalogue(), contract: this.contract(),
        proposals: waiting.map((p) => proposalView(p, actor.userId, now)),
      };
    });
  }

  /** W2489 — the review. Writes nothing. */
  async preview(tenantId: string, actor: ApiKeysActor, draft: Partial<KeyDraft>) {
    this.assert(actor);
    const access = await this.repo.apiAccessRead(tenantId);
    const review = reviewDraft(draft, Date.now());
    const refusals: { field: string | null; code: string; detail?: string }[] = [...review.refusals];
    if (!access.enabled) refusals.unshift({ field: null, code: 'PLAN_FEATURE_REQUIRED' });
    return {
      ready: refusals.length === 0, refusals, checker: review.checker, draft: review.draft, access,
      routes: routesUnlocked(review.draft.scopes).map((r) => `${r.method} ${r.path}`),
      scopes: API_SCOPES.filter((s) => review.draft.scopes.includes(s.code)).map((s) => ({ code: s.code, kind: s.kind, checker: s.checker })),
    };
  }

  /** W2490 — issue. The full key is in THIS return value once; never stored, never in the idempotency record. */
  async create(tenantId: string, actor: ApiKeysActor, idemKey: string, draft: Partial<KeyDraft>) {
    this.assert(actor);
    let shown: string | null = null;
    const stored = await this.idem.remember(idemKey, actor.userId, 'api-keys.create', async () => {
      const access = await this.uow.run(tenantId, (tx) => this.repo.apiAccess(tx, tenantId), { userId: actor.userId });
      if (!access.enabled) throw new PlanFeatureRequiredError();
      const review = reviewDraft(draft, Date.now());
      if (review.refusals.length) throw new ApiKeyRefusedError(review.refusals);
      const d = review.draft;
      const id = uuidv7();
      const proposalId = review.checker ? uuidv7() : null;
      const material = generateKey();
      try {
        await this.uow.run(tenantId, async (tx) => {
          await this.repo.insertTx(tx, { id, tenantId, name: d.name, prefix: material.prefix, hash: hashSecret(material.secret), scopes: d.scopes,
            ratePerHour: d.ratePerHour, expiresAt: d.expiresAt, activate: !review.checker, createdBy: actor.userId });
          if (proposalId) await this.repo.insertProposalTx(tx, { id: proposalId, tenantId, apiKeyId: id, reason: d.reason, proposedBy: actor.userId });
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: review.checker ? 'api_key.proposed' : 'api_key.created', entityType: 'api_key', entityId: id,
            oldValue: null,
            newValue: { name: d.name, keyPrefix: material.prefix, scopes: d.scopes, ratePerHour: d.ratePerHour, expiresAt: d.expiresAt,
              status: review.checker ? 'waiting_checker' : 'active', proposalId, routes: routesUnlocked(d.scopes).map((r) => `${r.method} ${r.path}`) },
            reason: d.reason || null, ip: actor.ip, requestId: actor.requestId,
          });
        }, { userId: actor.userId });
      } catch (e) { throw namedTriggerRefusal(e); }
      shown = material.key;
      this.metrics.inc('tenant_api_keys.created', { tenant: tenantId, checker: String(review.checker) });
      return { id, name: d.name, keyPrefix: material.prefix, scopes: d.scopes, ratePerHour: d.ratePerHour, expiresAt: d.expiresAt,
        status: (review.checker ? 'waiting_checker' : 'active') as KeyStatus, proposalId };
    });
    const once = shown as string | null;
    return once ? { ...stored, key: once, keyShown: true as const } : { ...stored, key: null, keyShown: false as const };
  }

  /** W2493 — revoke (reason required, permanent). */
  async revoke(tenantId: string, actor: ApiKeysActor, idemKey: string, id: string, reason: string) {
    this.assert(actor);
    const bad = revokeReasonRefusal(reason);
    if (bad) throw new ApiKeyRefusedError([{ field: 'reason', code: bad }]);
    return this.idem.remember(idemKey, actor.userId, `api-keys.revoke.${id}`, async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const before = await this.repo.getTx(tx, tenantId, id, true);
          if (!before) throw new ApiKeyNotFoundError();
          if (before.revokedAt) throw new ApiKeyActRefusedError('KEY_ALREADY_REVOKED', 'This key is already revoked; revocation is permanent.');
          // a waiting key's open proposal closes with it (refused by the revoker, with the revocation's reason)
          if (before.proposalId && before.proposalStatus === 'proposed') {
            await this.repo.refuseProposalTx(tx, tenantId, before.proposalId, actor.userId, `Withdrawn: the key was revoked — ${reason.trim()}`.slice(0, 500));
          }
          await this.repo.revokeTx(tx, tenantId, id, actor.userId, reason.trim());
          const after = await this.repo.getTx(tx, tenantId, id);
          const now = Date.now();
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'api_key.revoked', entityType: 'api_key', entityId: id,
            oldValue: { status: keyStatus(before, now), keyPrefix: before.keyPrefix, scopes: before.scopes },
            newValue: { status: 'revoked', revokedAt: after?.revokedAt ?? null }, reason: reason.trim(), ip: actor.ip, requestId: actor.requestId,
          });
          this.metrics.inc('tenant_api_keys.revoked', { tenant: tenantId });
          return { id, keyPrefix: before.keyPrefix, status: 'revoked' as const, revokedAt: after?.revokedAt ?? null, effectiveWithinSeconds: REVOCATION_BOUND_SECONDS };
        }, { userId: actor.userId });
      } catch (e) { throw namedTriggerRefusal(e); }
    });
  }

  async proposals(tenantId: string, actor: ApiKeysActor, q: { status?: string; cursor?: string; limit?: number } = {}) {
    this.assert(actor);
    const limit = Math.min(Math.max(Number(q.limit ?? 25) || 25, 1), 100);
    const status = q.status && ['proposed', 'confirmed', 'refused', 'expired'].includes(q.status) ? q.status : undefined;
    const rows = await this.repo.proposals(tenantId, { status, cursor: decodeKeyset(q.cursor, UUID_RE), limit });
    const last = rows[rows.length - 1];
    const now = Date.now();
    return { items: rows.map((p) => proposalView(p, actor.userId, now)), nextCursor: rows.length === limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }

  async proposal(tenantId: string, actor: ApiKeysActor, id: string) {
    this.assert(actor);
    const p = await this.uow.run(tenantId, (tx) => this.repo.proposalTx(tx, tenantId, id), { userId: actor.userId });
    if (!p) throw new ApiKeyProposalNotFoundError();
    return { ...proposalView(p, actor.userId, Date.now()), routes: routesUnlocked(p.scopes).map((r) => `${r.method} ${r.path}`) };
  }

  /** Confirm: the trigger is the maker ≠ checker wall; the key is activated in THIS transaction. */
  async confirm(tenantId: string, actor: ApiKeysActor, idemKey: string, id: string) {
    this.assert(actor);
    return this.idem.remember(idemKey, actor.userId, `api-keys.confirm.${id}`, async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const p = await this.repo.proposalTx(tx, tenantId, id, true);
          if (!p) throw new ApiKeyProposalNotFoundError();
          if (!(await this.repo.confirmProposalTx(tx, tenantId, id, actor.userId))) throw new ApiKeyActRefusedError('PROPOSAL_CLOSED', 'This proposal is already closed.');
          if (!(await this.repo.activateTx(tx, tenantId, p.apiKeyId, actor.userId))) throw new ApiKeyActRefusedError('KEY_ALREADY_REVOKED', 'This key is no longer waiting.');
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'api_key.confirmed', entityType: 'api_key', entityId: p.apiKeyId,
            oldValue: { status: 'waiting_checker', proposedBy: p.proposedBy }, newValue: { status: 'active', checker: actor.userId, proposalId: id, scopes: p.scopes },
            reason: p.reason, ip: actor.ip, requestId: actor.requestId,
          });
          return { proposalId: id, apiKeyId: p.apiKeyId, keyPrefix: p.keyPrefix, status: 'active' as const };
        }, { userId: actor.userId });
      } catch (e) { throw namedTriggerRefusal(e); }
    });
  }

  async refuse(tenantId: string, actor: ApiKeysActor, idemKey: string, id: string, reason: string) {
    this.assert(actor);
    const bad = refuseReasonRefusal(reason);
    if (bad) throw new ApiKeyRefusedError([{ field: 'reason', code: bad }]);
    return this.idem.remember(idemKey, actor.userId, `api-keys.refuse.${id}`, async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const p = await this.repo.proposalTx(tx, tenantId, id, true);
          if (!p) throw new ApiKeyProposalNotFoundError();
          if (!(await this.repo.refuseProposalTx(tx, tenantId, id, actor.userId, reason.trim()))) throw new ApiKeyActRefusedError('PROPOSAL_CLOSED', 'This proposal is already closed.');
          await this.repo.revokeTx(tx, tenantId, p.apiKeyId, actor.userId, `Refused by a second administrator: ${reason.trim()}`.slice(0, 300));
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'api_key.refused', entityType: 'api_key', entityId: p.apiKeyId,
            oldValue: { status: 'waiting_checker' }, newValue: { status: 'revoked', proposalId: id }, reason: reason.trim(), ip: actor.ip, requestId: actor.requestId,
          });
          return { proposalId: id, apiKeyId: p.apiKeyId, status: 'refused' as const };
        }, { userId: actor.userId });
      } catch (e) { throw namedTriggerRefusal(e); }
    });
  }

  /** The 7-day clock (job): an unconfirmed proposal expires and its waiting key is revoked — it never worked. */
  async expireDue(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx: TxContext) => {
      const p = await this.repo.proposalTx(tx, tenantId, id, true);
      if (!p || !(await this.repo.expireProposalTx(tx, tenantId, id))) return false;
      await this.repo.revokeTx(tx, tenantId, p.apiKeyId, null, 'No second administrator confirmed this key within 7 days.');
      await this.audit.write(tx, {
        tenantId, actorUserId: null, action: 'api_key.proposal_expired', entityType: 'api_key', entityId: p.apiKeyId,
        oldValue: { status: 'waiting_checker' }, newValue: { status: 'revoked', proposalId: id }, reason: 'unconfirmed after 7 days',
      });
      return true;
    }, { userId: undefined });
  }
}
