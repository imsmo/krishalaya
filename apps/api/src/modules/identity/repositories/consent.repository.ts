// modules/identity/repositories/consent.repository.ts · DPDP consent (append-only).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Consent } from '../domain/consent.entity';

@Injectable()
export class ConsentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async record(tx: TxContext, c: Consent): Promise<void> {
    const p = c.props;
    await tx.query(
      `INSERT INTO consents (id, user_id, purpose_code, version, granted, channel, assisted_by, consent_purpose_version_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.id, p.userId, p.purposeCode, p.version, p.granted, p.channel, p.assistedBy, p.consentPurposeVersionId]);
  }
  /**
   * The version a new consent must be stamped with — READ INSIDE THE WRITE TRANSACTION, on the primary.
   *
   * IT USED TO BE A REPLICA READ OUTSIDE THE TRANSACTION, and both halves of that were wrong:
   *   • OUTSIDE THE TX: a publish committing between the read and the insert stamped the consent with the version that
   *     was current a moment ago, so the person saw one notice in the app and the record named another.
   *   • ON THE REPLICA: replica lag between a publish and a grant does the same thing, silently, for as long as the lag
   *     lasts — and the version is the pointer to the legal text they agreed to.
   * Neither would ever have shown up as an error. Both are the difference between a consent record and a guess.
   *
   * Returns the version ROW (0108), not just its label, so the consent can point at words that can be produced.
   */
  async currentPublishedVersion(tx: TxContext, purposeCode: string): Promise<{ id: string; version: string } | null> {
    const r = await tx.query(
      `SELECT id, version FROM consent_purpose_versions
        WHERE purpose_code=$1 AND status='published' AND deleted_at IS NULL`, [purposeCode]);
    const x = r.rows[0];
    return x ? { id: x.id, version: x.version } : null;
  }

  /** The notice a person is about to consent to, in their own language — what apps/api renders above the toggle.
   *  Falls back to no row rather than to another language: showing an English notice to a Gujarati speaker and recording
   *  their agreement to it is worse than not asking. */
  async noticeFor(tenantId: string, versionId: string, languageCode: string): Promise<{ noticeText: string; toggleLabel: string } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT notice_text, toggle_label FROM consent_purpose_notices WHERE version_id=$1 AND language_code=$2`,
      [versionId, languageCode]);
    const x = r.rows[0];
    return x ? { noticeText: x.notice_text, toggleLabel: x.toggle_label } : null;
  }
  /** Latest consent decision per purpose for a user (DPDP "what am I consented to"). */
  async latestByUser(tenantId: string, userId: string): Promise<any[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT DISTINCT ON (purpose_code) purpose_code, granted, version, channel, created_at
         FROM consents WHERE user_id=$1 ORDER BY purpose_code, created_at DESC`, [userId]);
    return r.rows;
  }
  /** The user's LATEST decision for one purpose (granted + who assisted). Null if never recorded. */
  async latestForPurpose(tenantId: string, userId: string, purposeCode: string): Promise<{ granted: boolean; channel: string | null; assistedBy: string | null } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT granted, channel, assisted_by FROM consents
         WHERE user_id=$1 AND purpose_code=$2 ORDER BY created_at DESC LIMIT 1`, [userId, purposeCode]);
    const row = r.rows[0];
    return row ? { granted: !!row.granted, channel: row.channel ?? null, assistedBy: row.assisted_by ?? null } : null;
  }
}
