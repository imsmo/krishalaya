// modules/requirements/repositories/response-group.repository.ts · PC-56 TENANT-11d · all SQL for the pooled quote (0189):
// `requirement_response_groups`, `requirement_group_lines` and the append-only `requirement_consents`. tenant_id in EVERY query
// (Law 1) + RLS (ENABLE + FORCE, the 0175 split). No version columns → the group row is locked FOR UPDATE for every edit, so a
// line edit, a consent and a send can never interleave. The DB triggers (trg_rrg_moves, trg_rgl_moves) hold the edges, freeze
// sent figures and clear a line's consent when its figures change.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { GroupStatus } from '../domain/response-group';

export interface GroupRow {
  id: string; tenantId: string; requirementId: string; createdBy: string; status: GroupStatus; lineCount: number; totalQuantity: string;
  totalValueMinor: bigint; blendedPriceMinor: bigint | null; blendedRemainderMinor: bigint; validUntil: Date | null; sentAt: Date | null;
  sentBy: string | null; decidedAt: Date | null; decidedBy: string | null; decisionConsentId: string | null; withdrawReason: string | null; createdAt: Date;
}
export interface LineRow {
  id: string; groupId: string; requirementId: string; sellerUserId: string; listingId: string; quantity: string; priceMinor: bigint;
  status: 'active' | 'removed' | 'sent'; consentId: string | null; responseId: string | null; createdBy: string; createdAt: Date;
  sellerName?: string | null; sellerPhone?: string | null; listingTitle?: string | null; consentChannel?: string | null; consentRecordedAt?: Date | null;
  consentRecordedBy?: string | null;
}
export interface ConsentInsert {
  id: string; tenantId: string; requirementId: string; act: 'post' | 'quote' | 'shortlist' | 'accept' | 'reject'; memberUserId: string;
  groupId?: string | null; lineId?: string | null; responseId?: string | null; listingId?: string | null; quantity?: string | null; priceMinor?: bigint | null;
  channel: 'otp' | 'voice' | 'written' | 'app'; mediaId?: string | null; note?: string | null; recordedBy: string;
}

const GCOLS = `id, tenant_id, requirement_id, created_by, status, line_count, total_quantity::text AS total_quantity, total_value_minor::text AS total_value_minor,
  blended_price_minor::text AS blended_price_minor, blended_remainder_minor::text AS blended_remainder_minor, valid_until, sent_at, sent_by, decided_at, decided_by,
  decision_consent_id, withdraw_reason, created_at`;
const toGroup = (r: any): GroupRow => ({
  id: r.id, tenantId: r.tenant_id, requirementId: r.requirement_id, createdBy: r.created_by, status: r.status, lineCount: Number(r.line_count),
  totalQuantity: r.total_quantity, totalValueMinor: BigInt(r.total_value_minor), blendedPriceMinor: r.blended_price_minor == null ? null : BigInt(r.blended_price_minor),
  blendedRemainderMinor: BigInt(r.blended_remainder_minor), validUntil: r.valid_until ?? null, sentAt: r.sent_at ?? null, sentBy: r.sent_by ?? null,
  decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null, decisionConsentId: r.decision_consent_id ?? null, withdrawReason: r.withdraw_reason ?? null, createdAt: r.created_at,
});
const LCOLS = `l.id, l.group_id, l.requirement_id, l.seller_user_id, l.listing_id, l.quantity::text AS quantity, l.price_minor::text AS price_minor, l.status,
  l.consent_id, l.response_id, l.created_by, l.created_at`;
const toLine = (r: any): LineRow => ({
  id: r.id, groupId: r.group_id, requirementId: r.requirement_id, sellerUserId: r.seller_user_id, listingId: r.listing_id, quantity: r.quantity,
  priceMinor: BigInt(r.price_minor), status: r.status, consentId: r.consent_id ?? null, responseId: r.response_id ?? null, createdBy: r.created_by, createdAt: r.created_at,
  sellerName: r.seller_name, sellerPhone: r.seller_phone, listingTitle: r.listing_title, consentChannel: r.consent_channel ?? null,
  consentRecordedAt: r.consent_recorded_at ?? null, consentRecordedBy: r.consent_recorded_by ?? null,
});
const LJOIN = `FROM requirement_group_lines l JOIN users u ON u.id = l.seller_user_id LEFT JOIN listings li ON li.id = l.listing_id
  LEFT JOIN requirement_consents c ON c.id = l.consent_id`;
const LEXTRA = `, u.full_name AS seller_name, u.phone AS seller_phone, li.title AS listing_title, c.channel AS consent_channel, c.recorded_at AS consent_recorded_at, c.recorded_by AS consent_recorded_by`;

@Injectable()
export class ResponseGroupRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertGroup(tx: TxContext, g: { id: string; tenantId: string; requirementId: string; createdBy: string }): Promise<void> {
    await tx.query(`INSERT INTO requirement_response_groups (id, tenant_id, requirement_id, created_by) VALUES ($1,$2,$3,$4)`, [g.id, g.tenantId, g.requirementId, g.createdBy]);
  }
  async groupForUpdate(tx: TxContext, tenantId: string, id: string): Promise<GroupRow | null> {
    const r = await tx.query(`SELECT ${GCOLS} FROM requirement_response_groups WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
    return r.rows[0] ? toGroup(r.rows[0]) : null;
  }
  async group(tenantId: string, id: string): Promise<GroupRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${GCOLS} FROM requirement_response_groups WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r.rows[0] ? toGroup(r.rows[0]) : null;
  }
  async groupsFor(tenantId: string, requirementId: string): Promise<GroupRow[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${GCOLS} FROM requirement_response_groups WHERE tenant_id=$1 AND requirement_id=$2 ORDER BY created_at DESC, id DESC LIMIT 50`, [tenantId, requirementId]);
    return r.rows.map(toGroup);
  }
  async saveFigures(tx: TxContext, tenantId: string, id: string, f: { status: GroupStatus; lineCount: number; totalQuantity: string; totalValueMinor: bigint; blendedPriceMinor: bigint | null; blendedRemainderMinor: bigint }): Promise<void> {
    await tx.query(
      `UPDATE requirement_response_groups SET status=$3, line_count=$4, total_quantity=$5, total_value_minor=$6, blended_price_minor=$7, blended_remainder_minor=$8
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id, f.status, f.lineCount, f.totalQuantity, f.totalValueMinor.toString(), f.blendedPriceMinor?.toString() ?? null, f.blendedRemainderMinor.toString()]);
  }
  async markSent(tx: TxContext, tenantId: string, id: string, by: string, at: Date, validUntil: Date): Promise<void> {
    await tx.query(`UPDATE requirement_response_groups SET status='submitted', sent_at=$3, sent_by=$4, valid_until=$5 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, at, by, validUntil]);
  }
  async markDecided(tx: TxContext, tenantId: string, id: string, status: 'accepted' | 'rejected', by: string, consentId: string | null): Promise<void> {
    await tx.query(`UPDATE requirement_response_groups SET status=$3, decided_at=now(), decided_by=$4, decision_consent_id=$5 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, status, by, consentId]);
  }
  async markWithdrawn(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE requirement_response_groups SET status='withdrawn', decided_at=now(), decided_by=$3, withdraw_reason=$4 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, by, reason]);
  }

  // ---- lines ----
  async insertLine(tx: TxContext, l: { id: string; tenantId: string; groupId: string; requirementId: string; sellerUserId: string; listingId: string; quantity: string; priceMinor: bigint; createdBy: string }): Promise<boolean> {
    const r = await tx.query(
      `INSERT INTO requirement_group_lines (id, tenant_id, group_id, requirement_id, seller_user_id, listing_id, quantity, price_minor, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (group_id, seller_user_id) WHERE status <> 'removed' DO NOTHING`,
      [l.id, l.tenantId, l.groupId, l.requirementId, l.sellerUserId, l.listingId, l.quantity, l.priceMinor.toString(), l.createdBy]);
    return (r.rowCount ?? 0) > 0;
  }
  async lineForUpdate(tx: TxContext, tenantId: string, groupId: string, id: string): Promise<LineRow | null> {
    const r = await tx.query(`SELECT ${LCOLS} FROM requirement_group_lines l WHERE l.tenant_id=$1 AND l.group_id=$2 AND l.id=$3 FOR UPDATE`, [tenantId, groupId, id]);
    return r.rows[0] ? toLine(r.rows[0]) : null;
  }
  async updateLine(tx: TxContext, tenantId: string, id: string, v: { quantity: string; priceMinor: bigint }): Promise<void> {
    await tx.query(`UPDATE requirement_group_lines SET quantity=$3, price_minor=$4 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, v.quantity, v.priceMinor.toString()]);
  }
  async setLineConsent(tx: TxContext, tenantId: string, id: string, consentId: string): Promise<void> {
    await tx.query(`UPDATE requirement_group_lines SET consent_id=$3 WHERE tenant_id=$1 AND id=$2 AND status='active'`, [tenantId, id, consentId]);
  }
  async removeLine(tx: TxContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE requirement_group_lines SET status='removed', removed_at=now() WHERE tenant_id=$1 AND id=$2 AND status='active'`, [tenantId, id]);
  }
  async markLineSent(tx: TxContext, tenantId: string, id: string, responseId: string): Promise<void> {
    await tx.query(`UPDATE requirement_group_lines SET status='sent', response_id=$3 WHERE tenant_id=$1 AND id=$2 AND status='active'`, [tenantId, id, responseId]);
  }
  /** The group's live lines (active, or sent), in the order added, with the member's name + phone and the consent on record. */
  async linesInTx(tx: TxContext, tenantId: string, groupId: string): Promise<LineRow[]> {
    const r = await tx.query(`SELECT ${LCOLS}${LEXTRA} ${LJOIN} WHERE l.tenant_id=$1 AND l.group_id=$2 AND l.status <> 'removed' ORDER BY l.created_at, l.id`, [tenantId, groupId]);
    return r.rows.map(toLine);
  }
  async lines(tenantId: string, groupId: string): Promise<LineRow[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${LCOLS}${LEXTRA} ${LJOIN} WHERE l.tenant_id=$1 AND l.group_id=$2 AND l.status <> 'removed' ORDER BY l.created_at, l.id`, [tenantId, groupId]);
    return r.rows.map(toLine);
  }

  // ---- consents (append-only) ----
  async insertConsent(tx: TxContext, c: ConsentInsert): Promise<void> {
    await tx.query(
      `INSERT INTO requirement_consents (id, tenant_id, requirement_id, act, member_user_id, group_id, line_id, response_id, listing_id, quantity, price_minor,
         channel, media_id, note, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [c.id, c.tenantId, c.requirementId, c.act, c.memberUserId, c.groupId ?? null, c.lineId ?? null, c.responseId ?? null, c.listingId ?? null,
       c.quantity ?? null, c.priceMinor?.toString() ?? null, c.channel, c.mediaId ?? null, c.note ?? null, c.recordedBy]);
  }
  /** The consent a line points at, as recorded — the send re-checks it names THIS member, listing, quantity and price. */
  async consent(tx: TxContext, tenantId: string, id: string): Promise<{ act: string; memberUserId: string; listingId: string | null; quantity: string | null; priceMinor: bigint | null; lineId: string | null } | null> {
    const r = await tx.query(`SELECT act, member_user_id, listing_id, quantity::text AS quantity, price_minor::text AS price_minor, line_id FROM requirement_consents WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    const x: any = r.rows[0];
    return x ? { act: x.act, memberUserId: x.member_user_id, listingId: x.listing_id, quantity: x.quantity, priceMinor: x.price_minor == null ? null : BigInt(x.price_minor), lineId: x.line_id } : null;
  }
}
