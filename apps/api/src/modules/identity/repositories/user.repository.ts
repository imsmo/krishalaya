// modules/identity/repositories/user.repository.ts · ALL SQL for the user aggregate.
// users is a GLOBAL identity table (no tenant_id / no RLS) — access control is by
// user ownership + RBAC at the service layer. Parameterised queries only.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { User } from '../domain/user.entity';
import { UserStatus } from '../domain/user.state';

const COLS = `id, phone, phone_verified_at, full_name, gender, dob, language_code, country_code, email, email_verified_at, photo_media_id, status, aadhaar_last4, aadhaar_vault_ref, pan_vault_ref, is_test, last_active_at`;
interface Row {
  id: string; phone: string; phone_verified_at: Date | null; full_name: string | null; gender: string | null;
  dob: string | null; language_code: string; country_code: string; email: string | null; email_verified_at: Date | null;
  photo_media_id: string | null; status: string; aadhaar_last4: string | null; aadhaar_vault_ref: string | null;
  pan_vault_ref: string | null; is_test: boolean; last_active_at: Date | null;
}
const toDomain = (r: Row): User => User.rehydrate({
  id: r.id, phone: r.phone, phoneVerifiedAt: r.phone_verified_at, fullName: r.full_name, gender: r.gender,
  dob: r.dob, languageCode: r.language_code, countryCode: r.country_code, email: r.email, emailVerifiedAt: r.email_verified_at,
  photoMediaId: r.photo_media_id, status: r.status as UserStatus, aadhaarLast4: r.aadhaar_last4, aadhaarVaultRef: r.aadhaar_vault_ref,
  panVaultRef: r.pan_vault_ref, isTest: r.is_test, lastActiveAt: r.last_active_at,
});

@Injectable()
export class UserRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, u: User): Promise<void> {
    const p = u.toProps();
    await tx.query(
      `INSERT INTO users (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [p.id, p.phone, p.phoneVerifiedAt, p.fullName, p.gender, p.dob, p.languageCode, p.countryCode, p.email,
       p.emailVerifiedAt, p.photoMediaId, p.status, p.aadhaarLast4, p.aadhaarVaultRef, p.panVaultRef, p.isTest, p.lastActiveAt],
    );
  }

  async update(tx: TxContext, u: User): Promise<void> {
    const p = u.toProps();
    await tx.query(
      `UPDATE users SET full_name=$2, gender=$3, dob=$4, language_code=$5, email=$6, email_verified_at=$7,
         photo_media_id=$8, status=$9, aadhaar_last4=$10, aadhaar_vault_ref=$11, pan_vault_ref=$12,
         phone_verified_at=$13, last_active_at=$14
       WHERE id=$1 AND deleted_at IS NULL`,
      [p.id, p.fullName, p.gender, p.dob, p.languageCode, p.email, p.emailVerifiedAt, p.photoMediaId, p.status,
       p.aadhaarLast4, p.aadhaarVaultRef, p.panVaultRef, p.phoneVerifiedAt, p.lastActiveAt],
    );
  }

  /** Swap the identity phone (change-phone flow). Re-stamps phone_verified_at. UNIQUE(phone) guards collisions. */
  async updatePhone(tx: TxContext, id: string, phone: string, phoneVerifiedAt: Date | null): Promise<void> {
    await tx.query(`UPDATE users SET phone=$2, phone_verified_at=$3, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id, phone, phoneVerifiedAt]);
  }

  /** Persist verified eKYC tokens on the user row (P0-11). ONLY opaque vault refs + last-4 ever land here —
   *  never the raw Aadhaar/PAN. COALESCE keeps an existing value when a field isn't being set this call. */
  async setVaultRef(tx: TxContext, id: string, v: { aadhaarVaultRef?: string | null; aadhaarLast4?: string | null; panVaultRef?: string | null }): Promise<void> {
    await tx.query(
      `UPDATE users SET
         aadhaar_vault_ref = COALESCE($2, aadhaar_vault_ref),
         aadhaar_last4     = COALESCE($3, aadhaar_last4),
         pan_vault_ref     = COALESCE($4, pan_vault_ref),
         updated_at = now()
       WHERE id=$1 AND deleted_at IS NULL`,
      [id, v.aadhaarVaultRef ?? null, v.aadhaarLast4 ?? null, v.panVaultRef ?? null],
    );
  }

  async getForUpdate(tx: TxContext, id: string): Promise<User | null> {
    const r = await tx.query<Row>(`SELECT ${COLS} FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async findById(tenantId: string, id: string): Promise<User | null> {
    const r = await this.replica.forTenant(tenantId).query<Row>(`SELECT ${COLS} FROM users WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async findByPhone(tenantId: string, phone: string): Promise<User | null> {
    const r = await this.replica.forTenant(tenantId).query<Row>(`SELECT ${COLS} FROM users WHERE phone=$1 AND deleted_at IS NULL`, [phone]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getByPhoneForUpdate(tx: TxContext, phone: string): Promise<User | null> {
    const r = await tx.query<Row>(`SELECT ${COLS} FROM users WHERE phone=$1 AND deleted_at IS NULL FOR UPDATE`, [phone]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async softDelete(tx: TxContext, id: string): Promise<void> {
    await tx.query(`UPDATE users SET deleted_at=now(), status='soft_deleted' WHERE id=$1`, [id]);
  }
}
