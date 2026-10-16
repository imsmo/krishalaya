// modules/identity/repositories/address.repository.ts · user/tenant address book.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Address, AddressProps } from '../domain/address.entity';

/** PC-56 HOTFIX-6 · B4: the address book's bound (Law 11). */
export const ADDRESS_LIST_CAP = 50;
const COLS = `id, user_id, tenant_id, label_id, line1, line2, village, region_id, pincode, country_code, lat, lng, contact_name, contact_phone, is_default`;
const toDomain = (r: any): Address => Address.rehydrate({ id: r.id, userId: r.user_id, tenantId: r.tenant_id, labelId: r.label_id, line1: r.line1, line2: r.line2, village: r.village, regionId: r.region_id, pincode: r.pincode, countryCode: r.country_code, lat: r.lat != null ? Number(r.lat) : null, lng: r.lng != null ? Number(r.lng) : null, contactName: r.contact_name, contactPhone: r.contact_phone, isDefault: r.is_default });

@Injectable()
export class AddressRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, a: Address): Promise<void> {
    const p: AddressProps = a.toProps();
    await tx.query(
      `INSERT INTO addresses (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [p.id, p.userId, p.tenantId, p.labelId, p.line1, p.line2, p.village, p.regionId, p.pincode, p.countryCode, p.lat, p.lng, p.contactName, p.contactPhone, p.isDefault]);
  }
  /** In place — ONLY for an address nobody else is delivering to (AddressService decides with `isInUse`). PC-56 HOTFIX-6 · B4: `country_code`
   *  is written too (it was omitted, so a country could never be corrected). */
  async update(tx: TxContext, a: Address): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `UPDATE addresses SET label_id=$2, line1=$3, line2=$4, village=$5, region_id=$6, pincode=$7, lat=$8, lng=$9, contact_name=$10, contact_phone=$11, is_default=$12, country_code=$13, updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL`,
      [p.id, p.labelId, p.line1, p.line2, p.village, p.regionId, p.pincode, p.lat, p.lng, p.contactName, p.contactPhone, p.isDefault, p.countryCode]);
  }
  /** PC-56 HOTFIX-6 · B3: is this address (owned by `userId`) the destination or origin of any order, shipment, labour booking or d2c
   *  subscription — in ANY organisation? Migration 0213's SECURITY DEFINER boolean (RLS hides other organisations' orders from kv_app, and a
   *  person's address book is platform-level). Asked inside the edit's transaction with the row locked. */
  async isInUse(tx: TxContext, id: string, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT kv_address_in_use($1, $2) AS in_use`, [id, userId]);
    return r.rows[0]?.in_use === true;
  }
  /** PC-56 HOTFIX-6 · B3: retire the OLD row of a copy-on-write edit — soft-deleted, its values untouched, so every reference keeps them. */
  async retire(tx: TxContext, id: string, userId: string): Promise<void> {
    await tx.query(`UPDATE addresses SET deleted_at=now(), is_default=false, updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, userId]);
  }
  async getForUpdate(tx: TxContext, id: string, userId: string): Promise<Address | null> {
    const r = await tx.query(`SELECT ${COLS} FROM addresses WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, userId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async unsetDefaults(tx: TxContext, userId: string): Promise<void> {
    await tx.query(`UPDATE addresses SET is_default=false WHERE user_id=$1 AND is_default AND deleted_at IS NULL`, [userId]);
  }
  /** The caller's live addresses (retired copies excluded), BOUNDED — PC-56 HOTFIX-6 · B4 (Law 11): a hard cap of `ADDRESS_LIST_CAP` rows,
   *  the default first, then newest. No keyset: an address book is a short list; the cap is the guard. */
  async listByUser(tenantId: string, userId: string, cap: number = ADDRESS_LIST_CAP): Promise<Address[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM addresses WHERE user_id=$1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC, id DESC LIMIT $2`, [userId, cap]);
    return r.rows.map(toDomain);
  }
  /** PC-56 HOTFIX-6 · B4: remove the caller's OWN address. `missing` = no such row of theirs at all (→ 404, never 403 — the orders
   *  precedent); `already` = theirs and already retired (an idempotent repeat). Locks the row. */
  async softDelete(tx: TxContext, id: string, userId: string): Promise<{ outcome: 'removed' | 'already' | 'missing'; wasDefault: boolean }> {
    const r = await tx.query(`SELECT deleted_at, is_default FROM addresses WHERE id=$1 AND user_id=$2 FOR UPDATE`, [id, userId]);
    const row = r.rows[0];
    if (!row) return { outcome: 'missing', wasDefault: false };
    if (row.deleted_at) return { outcome: 'already', wasDefault: false };
    await tx.query(`UPDATE addresses SET deleted_at=now(), is_default=false, updated_at=now() WHERE id=$1 AND user_id=$2`, [id, userId]);
    return { outcome: 'removed', wasDefault: row.is_default === true };
  }
  /** PC-56 HOTFIX-6 · B4: after the default is removed, the NEWEST remaining address becomes the default (none left → no default). */
  async promoteNewestDefault(tx: TxContext, userId: string): Promise<string | null> {
    const r = await tx.query(
      `UPDATE addresses SET is_default=true, updated_at=now() WHERE id = (SELECT id FROM addresses WHERE user_id=$1 AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM addresses WHERE user_id=$1 AND deleted_at IS NULL AND is_default)
       RETURNING id`, [userId]);
    return r.rows[0]?.id ?? null;
  }
}
