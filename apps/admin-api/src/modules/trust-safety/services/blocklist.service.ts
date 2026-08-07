// apps/admin-api/src/modules/trust-safety/services/blocklist.service.ts · W096 (PC-56 ADMIN-5d).
//
// Every write is ONE transaction with its audit row inside it (Law 4). The audit row records the HASH and never the
// raw identifier — the whole point of hashing is defeated if the plaintext lands in the audit ledger, which is the
// longest-lived and most widely readable table on the platform.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { assertSecondPerson, isSecondPerson } from '../../../core/approval/two-person-rule';
import { TrustSafetyRepository } from '../repositories/trust-safety.repository';
import {
  assertRawIdentifier, hashIdentifier, assertExpiryOrReview, assertReason, assertLiftable,
  displayIdentifier, blockState, attemptsBlocked, typeCounts, reviewDue, isIdentifierType,
  type BlocklistRow, type IdentifierType,
} from '../domain/blocklist';
import { InvalidBlocklistEntryError, TrustSubjectNotFoundError } from '../domain/trust-safety.errors';
import type { AddBlockDto, LiftBlockDto, CountersignBlockDto, QueryBlocksDto } from '../dto/trust-safety.dto';

/** What leaves the service. NOTE WHAT IS ABSENT: `identifierHash` never appears. The console has no use for the raw
 *  hash and every use for the display form, and a hash on screen is the value an operator pastes back into the Add
 *  form — the mistake `assertRawIdentifier` exists to catch. Not sending it removes the temptation entirely. */
export interface BlockView {
  id: string; identifierType: IdentifierType; identifier: string;
  originRef: string | null; reason: string;
  expiresAt: string | null; reviewAt: string | null;
  state: ReturnType<typeof blockState>;
  attempts: ReturnType<typeof attemptsBlocked>;
  createdAt: string; createdBy: string | null;
  checkedBy: string | null; checkedAt: string | null;
  liftedAt: string | null; liftReason: string | null;
  reviewDue: boolean;
}

@Injectable()
export class BlocklistService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: TrustSafetyRepository,
  ) {}

  private view(r: BlocklistRow, now: Date): BlockView {
    return {
      id: r.id, identifierType: r.identifierType, identifier: displayIdentifier(r.identifierType, r.identifierHash),
      originRef: r.originRef, reason: r.reason,
      expiresAt: r.expiresAt, reviewAt: r.reviewAt,
      state: blockState(r, now), attempts: attemptsBlocked(r),
      createdAt: r.createdAt, createdBy: r.createdBy,
      checkedBy: r.checkedBy, checkedAt: r.checkedAt,
      liftedAt: r.liftedAt, liftReason: r.liftReason,
      reviewDue: reviewDue([r], now).length > 0,
    };
  }

  async list(q: Omit<QueryBlocksDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const now = new Date();
    const rows = await this.repo.listBlocks({ type: q.type, status: q.status, cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const counts = typeCounts(await this.repo.blockTypeCounts());
    return {
      items: page.map((r) => this.view(r, now)),
      counts,
      // W096's fourth tab. A count only, never the pairs — see the repository's note.
      userBlockCount: await this.repo.userBlockCount(),
      nextCursor: rows.length > q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
    };
  }

  async get(id: string): Promise<BlockView> {
    const r = await this.repo.getBlock(id);
    if (!r) throw new TrustSubjectNotFoundError('no such blocklist entry');
    return this.view(r, new Date());
  }

  /** Add a block.
   *
   *  The order of operations matters and is deliberate: validate, THEN hash. Hashing first would mean a rejected
   *  entry has already been through the one-way function, and the error message could no longer quote what was wrong
   *  with the input.
   */
  async add(actor: AdminRequestContext, dto: AddBlockDto): Promise<{ id: string; identifier: string; alreadyBlocked: boolean }> {
    const now = new Date();
    if (!isIdentifierType(dto.identifierType)) throw new InvalidBlocklistEntryError('unknown identifier type');
    const raw = assertRawIdentifier(dto.identifierType, dto.identifier);
    const reason = assertReason(dto.reason);
    const auditNote = assertReason(dto.auditNote, 'audit note');
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const reviewAt = dto.reviewAt ? new Date(dto.reviewAt) : null;
    assertExpiryOrReview(expiresAt, reviewAt, now);

    const hash = hashIdentifier(dto.identifierType, raw);

    // Reported, not silently merged. An operator adding a block that already exists needs to know it was already
    // there — with a different expiry, possibly set by somebody else for a different reason — rather than believing
    // their dates are the ones in force.
    const existing = await this.repo.findActiveByHash(dto.identifierType, hash);
    if (existing) {
      return { id: existing.id, identifier: displayIdentifier(dto.identifierType, hash), alreadyBlocked: true };
    }

    return this.pool.withTx(async (c) => {
      const id = await this.repo.insertBlock(c, {
        identifierType: dto.identifierType, identifierHash: hash, originRef: dto.originRef ?? null,
        reason, expiresAt, reviewAt, auditNote, createdBy: actor.userId,
      });
      // A race with a concurrent insert loses the partial unique index and returns no id. That is the same outcome as
      // `alreadyBlocked` and is reported as such rather than as a failure.
      if (!id) return { id: '', identifier: displayIdentifier(dto.identifierType, hash), alreadyBlocked: true };
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'trust.blocklist_added', entityType: 'platform_blocklist', entityId: id,
        // THE HASH, NEVER THE RAW VALUE.
        newValue: {
          identifierType: dto.identifierType, identifierHash: hash, originRef: dto.originRef ?? null,
          expiresAt: expiresAt?.toISOString() ?? null, reviewAt: reviewAt?.toISOString() ?? null,
        },
        reason: auditNote, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, identifier: displayIdentifier(dto.identifierType, hash), alreadyBlocked: false };
    });
  }

  /** THE SIXTH MAKER-CHECKER SITE. W096: "Add block (checker)".
   *
   *  A block is added by one operator and countersigned by another. It is NOT held inactive until countersigned, and
   *  that is a deliberate trade the canon supports: W096's blocks come from live fraud rings, and a credential-stuffing
   *  source that waits for a second signature is a source that keeps stuffing. The block bites immediately and the
   *  second pair of eyes follows — which is why the console lists uncountersigned blocks as needing attention rather
   *  than as pending.
   */
  async countersign(actor: AdminRequestContext, id: string, dto: CountersignBlockDto) {
    return this.pool.withTx(async (c) => {
      const r = await this.repo.getBlockForUpdate(c, id);
      if (!r) throw new TrustSubjectNotFoundError('no such blocklist entry');
      if (r.checkedBy) throw new InvalidBlocklistEntryError('this block has already been countersigned');
      assertSecondPerson(
        'countersigning a platform block', r.createdBy, actor.userId,
        'The operator who added a block cannot be the one who countersigns it.');
      await this.repo.countersignBlock(c, id, actor.userId);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'trust.blocklist_countersigned', entityType: 'platform_blocklist', entityId: id,
        newValue: { checkedBy: actor.userId }, reason: dto.note, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true };
    });
  }

  async lift(actor: AdminRequestContext, id: string, dto: LiftBlockDto) {
    return this.pool.withTx(async (c) => {
      const r = await this.repo.getBlockForUpdate(c, id);
      if (!r) throw new TrustSubjectNotFoundError('no such blocklist entry');
      const reason = assertLiftable(r, dto.reason);
      await this.repo.liftBlock(c, id, actor.userId, reason);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'trust.blocklist_lifted', entityType: 'platform_blocklist', entityId: id,
        oldValue: { status: r.status }, newValue: { status: 'lifted' },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true };
    });
  }

  /** Read-side: may THIS viewer countersign THIS block? Drives whether the control is drawn at all — the standing
   *  maker-checker-by-absence doctrine. */
  countersignOfferable(r: Pick<BlocklistRow, 'createdBy' | 'checkedBy'>, viewer: string | null): boolean {
    if (r.checkedBy) return false;
    return isSecondPerson(r.createdBy, viewer);
  }
}
