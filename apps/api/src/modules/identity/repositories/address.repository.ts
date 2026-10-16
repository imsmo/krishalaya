// modules/identity/repositories/address.repository.ts · user/tenant address book.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Address, AddressProps } from '../domain/address.entity';

/** PC-56 HOTFIX-6 · B4: the address book's bound (Law 11). */
export const ADDRESS_LIST_CAP = 50;
// PC-56 STORE-4a (0214): + `delivery_note`.
const COLS = `id, user_id, tenant_id, label_id, line1, line2, village, region_id, pincode, country_code, lat, lng, contact_name, contact_phone, is_default, delivery_note`;
const toDomain = (r: any): Address => Address.rehydrate({ id: r.id, userId: r.user_id, tenantId: r.tenant_id, labelId: r.label_id, line1: r.line1, line2: r.line2, village: r.village, regionId: r.region_id, pincode: r.pincode, countryCode: r.country_code, lat: r.lat != null ? Number(r.lat) : null, lng: r.lng != null ? Number(r.lng) : null, contactName: r.contact_name, contactPhone: r.contact_phone, isDefault: r.is_default, deliveryNote: r.delivery_note ?? null });
/** PC-56 STORE-4a · B3: what the list and the detail answer — every value + the label's CODE (the storefront words it in en/hi/gu by code). */
export type AddressView = AddressProps & { labelCode: string | null };
const AL = COLS.split(',').map((c) => `a.${c.trim()}`).join(', ');

@Injectable()
export class AddressRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, a: Address): Promise<void> {
    const p: AddressProps = a.toProps();
    await tx.query(
      `INSERT INTO addresses (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [p.id, p.userId, p.tenantId, p.labelId, p.line1, p.line2, p.village, p.regionId, p.pincode, p.countryCode, p.lat, p.lng, p.contactName, p.contactPhone, p.isDefault, p.deliveryNote]);
  }
  /** In place — ONLY for an address nobody else is delivering to (AddressService decides with `isInUse`). PC-56 HOTFIX-6 · B4: `country_code`
   *  is written too (it was omitted, so a country could never be corrected). */
  async update(tx: TxContext, a: Address): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `UPDATE addresses SET label_id=$2, line1=$3, line2=$4, village=$5, region_id=$6, pincode=$7, lat=$8, lng=$9, contact_name=$10, contact_phone=$11, is_default=$12, country_code=$13, delivery_note=$14, updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL`,
      [p.id, p.labelId, p.line1, p.line2, p.village, p.regionId, p.pincode, p.lat, p.lng, p.contactName, p.contactPhone, p.isDefault, p.countryCode, p.deliveryNote]);
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
  /** PC-56 STORE-4a · B3: the list as the person reads it — the same bound and order, each row with its label's CODE. */
  async listViewByUser(tenantId: string, userId: string, cap: number = ADDRESS_LIST_CAP): Promise<AddressView[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${AL}, lv.code AS label_code FROM addresses a LEFT JOIN lookup_values lv ON lv.id = a.label_id
        WHERE a.user_id=$1 AND a.deleted_at IS NULL ORDER BY a.is_default DESC, a.created_at DESC, a.id DESC LIMIT $2`, [userId, cap]);
    return r.rows.map((x: any) => ({ ...toDomain(x).toProps(), labelCode: x.label_code ?? null }));
  }
  /** PC-56 STORE-4a · B3: ONE of the caller's live addresses (the edit form's current values); null for anybody else's or a retired one. */
  async getViewForUser(tenantId: string, id: string, userId: string): Promise<AddressView | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${AL}, lv.code AS label_code FROM addresses a LEFT JOIN lookup_values lv ON lv.id = a.label_id
        WHERE a.id=$1 AND a.user_id=$2 AND a.deleted_at IS NULL`, [id, userId]);
    const x = r.rows[0];
    return x ? { ...toDomain(x).toProps(), labelCode: x.label_code ?? null } : null;
  }
  /** PC-56 STORE-4a · B3 (founder D4): the label, read IN the write's transaction — an ACTIVE `address_label` value visible to this organisation
   *  (a platform value it has not shadowed with its own of the same code, or its own value — the lookups read's rule, the 3a `cancel_reason`
   *  shape). null = unknown. */
  async labelCodeTx(tx: TxContext, tenantId: string, labelId: string): Promise<string | null> {
    const r = await tx.query<{ code: string }>(
      `SELECT lv.code FROM lookup_values lv
        WHERE lv.id = $1 AND lv.type_code = 'address_label' AND lv.is_active = true AND lv.deleted_at IS NULL AND (lv.tenant_id IS NULL OR lv.tenant_id = $2::uuid)
          AND NOT (lv.tenant_id IS NULL AND EXISTS (SELECT 1 FROM lookup_values t WHERE t.type_code = 'address_label' AND t.tenant_id = $2::uuid
                                                     AND t.code = lv.code AND t.is_active = true AND t.deleted_at IS NULL))`, [labelId, tenantId || null]);
    return r.rows[0]?.code ?? null;
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
