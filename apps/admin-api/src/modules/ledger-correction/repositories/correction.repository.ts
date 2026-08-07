// apps/admin-api/src/modules/ledger-correction/repositories/correction.repository.ts · ALL SQL for W068.
//
// **THIS FILE NEVER WRITES A LEDGER ROW.** admin-api is not a money writer — the wallet-service is the only one
// (Law 2/9), reached through `WalletAdminPort`. What is written here is a DRAFT: an intention, with its legs and its
// approval, which becomes money only when the port returns a transaction id. The distinction matters most in the
// failure case: if the post fails, this table still holds a correct, reviewed, unposted draft rather than a
// half-written ledger.
//
// Amounts cross this boundary as `bigint`. `pg` returns `bigint` columns as STRINGS by default, which is the right
// default and is why every read below goes through `BigInt(...)` explicitly rather than `Number(...)`.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import type { CorrectionDraft, DraftLeg, DraftStatus } from '../domain/correction';

const D_COLS = `id, investigation_id, tenant_id, status, currency_code, reason, source_document, idempotency_key,
  maker_id, submitted_at, checker_id, checked_at, checker_note, posted_txn_id, posted_at, gross_minor, created_at`;

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function toLeg(r: any): DraftLeg {
  return {
    ownerKind: r.owner_kind, ownerId: r.owner_id ?? null, accountCode: r.account_code,
    // NEVER Number(). A bigint column arrives as a string and coercing it is the one line that would silently
    // truncate a large correction.
    amountMinor: BigInt(r.amount_minor),
    legNote: r.leg_note ?? null,
  };
}

function toDraft(r: any, legs: DraftLeg[]): CorrectionDraft {
  return {
    id: r.id, investigationId: r.investigation_id, tenantId: r.tenant_id ?? null,
    status: r.status as DraftStatus, currencyCode: r.currency_code, reason: r.reason,
    sourceDocument: r.source_document ?? null, idempotencyKey: r.idempotency_key,
    makerId: r.maker_id, submittedAt: iso(r.submitted_at),
    checkerId: r.checker_id ?? null, checkedAt: iso(r.checked_at), checkerNote: r.checker_note ?? null,
    postedTxnId: r.posted_txn_id ?? null, postedAt: iso(r.posted_at),
    grossMinor: r.gross_minor === null || r.gross_minor === undefined ? null : BigInt(r.gross_minor),
    legs,
  };
}

@Injectable()
export class CorrectionRepository {
  constructor(private readonly pool: AdminPool) {}

  async list(q: { status?: DraftStatus; cursor?: { c: string; id: string }; limit: number }): Promise<CorrectionDraft[]> {
    const w: string[] = ['deleted_at IS NULL'];
    const p: unknown[] = [];
    if (q.status) { p.push(q.status); w.push(`status = $${p.length}`); }
    if (q.cursor) { p.push(q.cursor.c, q.cursor.id); w.push(`(created_at < $${p.length - 1} OR (created_at = $${p.length - 1} AND id < $${p.length}))`); }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT ${D_COLS} FROM correction_drafts WHERE ${w.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${p.length}`, p);
    if (r.rows.length === 0) return [];
    // One query for every leg on the page rather than one per draft. A correction queue is short, but an N+1 on the
    // money console is the kind of thing that only hurts on the day the queue is long, which is the worst day.
    const ids = r.rows.map((x: any) => x.id);
    const lr = await this.pool.query(
      `SELECT id, draft_id, owner_kind, owner_id, account_code, amount_minor, leg_note
         FROM correction_draft_legs WHERE draft_id = ANY($1::uuid[]) ORDER BY created_at ASC, id ASC`, [ids]);
    const byDraft = new Map<string, DraftLeg[]>();
    for (const l of lr.rows) {
      const arr = byDraft.get(l.draft_id) ?? [];
      arr.push(toLeg(l));
      byDraft.set(l.draft_id, arr);
    }
    return r.rows.map((x: any) => toDraft(x, byDraft.get(x.id) ?? []));
  }

  async get(id: string): Promise<CorrectionDraft | null> {
    const r = await this.pool.query(`SELECT ${D_COLS} FROM correction_drafts WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!r.rows[0]) return null;
    return toDraft(r.rows[0], await this.legs(id));
  }

  /** FOR UPDATE on the draft. The legs are read afterwards inside the same transaction and are protected by that
   *  lock — nothing may add a leg to a draft somebody is approving, which is the race that would let an approved
   *  balance and a posted balance differ. */
  async getForUpdate(c: PoolClient, id: string): Promise<CorrectionDraft | null> {
    const r = await c.query(`SELECT ${D_COLS} FROM correction_drafts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    if (!r.rows[0]) return null;
    const lr = await c.query(
      `SELECT id, draft_id, owner_kind, owner_id, account_code, amount_minor, leg_note
         FROM correction_draft_legs WHERE draft_id = $1 ORDER BY created_at ASC, id ASC`, [id]);
    return toDraft(r.rows[0], lr.rows.map(toLeg));
  }

  private async legs(draftId: string): Promise<DraftLeg[]> {
    const r = await this.pool.query(
      `SELECT id, draft_id, owner_kind, owner_id, account_code, amount_minor, leg_note
         FROM correction_draft_legs WHERE draft_id = $1 ORDER BY created_at ASC, id ASC`, [draftId]);
    return r.rows.map(toLeg);
  }

  async openDraft(c: PoolClient, v: {
    investigationId: string; tenantId: string | null; reason: string; sourceDocument: string | null;
    idempotencyKey: string; makerId: string; currencyCode: string;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO correction_drafts (investigation_id, tenant_id, reason, source_document, idempotency_key, maker_id, currency_code, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$6,$6) RETURNING id`,
      [v.investigationId, v.tenantId, v.reason, v.sourceDocument, v.idempotencyKey, v.makerId, v.currencyCode]);
    return r.rows[0].id;
  }

  /** Replace the whole leg set. A correction's legs are one object, not a collection somebody edits row by row:
   *  a partial update is how a draft ends up balanced in the operator's head and unbalanced in the table. */
  async replaceLegs(c: PoolClient, draftId: string, legs: readonly DraftLeg[]): Promise<void> {
    await c.query(`DELETE FROM correction_draft_legs WHERE draft_id = $1`, [draftId]);
    for (const l of legs) {
      await c.query(
        `INSERT INTO correction_draft_legs (draft_id, owner_kind, owner_id, account_code, amount_minor, leg_note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        // The bigint goes over as a STRING. node-postgres would stringify it anyway; doing it here means the value
        // is never handed to something that might coerce it first.
        [draftId, l.ownerKind, l.ownerId, l.accountCode, l.amountMinor.toString(), l.legNote]);
    }
  }

  async submit(c: PoolClient, id: string, actor: string): Promise<void> {
    // The deferred constraint trigger (0111) fires at COMMIT on this UPDATE and refuses an unbalanced draft. That is
    // the check the ledger itself does not have, on the one money table a human types into.
    await c.query(
      `UPDATE correction_drafts SET status = 'awaiting_checker', submitted_at = now(), updated_by = $2
         WHERE id = $1 AND status = 'drafting' AND deleted_at IS NULL`, [id, actor]);
  }

  async recordDecision(c: PoolClient, id: string, v: { checkerId: string; note: string; status: 'posted' | 'rejected'; txnId?: string }): Promise<void> {
    await c.query(
      `UPDATE correction_drafts
          SET checker_id = $2, checked_at = now(), checker_note = $3, status = $4,
              posted_txn_id = $5, posted_at = CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END, updated_by = $2
        WHERE id = $1 AND status = 'awaiting_checker' AND deleted_at IS NULL`,
      [id, v.checkerId, v.note, v.status, v.txnId ?? null]);
  }

  async withdraw(c: PoolClient, id: string, actor: string): Promise<void> {
    await c.query(
      `UPDATE correction_drafts SET status = 'withdrawn', updated_by = $2
         WHERE id = $1 AND status IN ('drafting','awaiting_checker') AND checker_id IS NULL AND deleted_at IS NULL`,
      [id, actor]);
  }

  /** The case a correction hangs off. Read to confirm it is real and open — W068: "corrections start from an
   *  investigation case, never from a blank ledger write". */
  async investigation(id: string): Promise<{ id: string; status: string; summary: string; severity: string } | null> {
    const r = await this.pool.query(
      `SELECT id, status, summary, severity FROM recon_investigations WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ?? null;
  }

  /** Close the case in the SAME transaction as the post — W068: "approval posts txn type `correction` and closes
   *  the case atomically". Atomically is the word the screen uses and it is achievable, so it is honoured. */
  async resolveInvestigation(c: PoolClient, id: string, actor: string, note: string): Promise<void> {
    await c.query(
      `UPDATE recon_investigations SET status = 'resolved', resolved_at = now(), resolution_note = $3, updated_by = $2
         WHERE id = $1 AND status IN ('open','investigating') AND deleted_at IS NULL`, [id, actor, note]);
  }
}
