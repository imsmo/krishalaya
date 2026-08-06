// modules/schemes/repositories/scheme-version.repository.ts · READ-ONLY access to `scheme_versions` (0105).
//
// WHY apps/api CAN READ THIS AT ALL, AND WHY IT CAN DO NOTHING ELSE. The whole point of migration 0105 is that the
// rules an application was judged under must be retrievable by the application that judges it. Authoring a version is
// a platform act — checker-gated, in the admin realm — so 0105 grants `kv_app` SELECT and explicitly REVOKEs
// everything else. There is deliberately no insert/update method in this file: not as a convention, but because the
// role this code connects as would be refused by the database if one existed.
//
// NO tenant_id AND NO RLS on this table (a government scheme is global platform data, exactly like `schemes` and
// `scheme_authorities`), so these queries carry no tenant predicate. That is the one place in this module where Law 1
// does not apply, and it is stated here so its absence reads as a decision rather than an omission.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import type { VersionFee } from '../domain/snapshot-fee';

/** The rule set as of one version. `processing_fee_minor` is cast to TEXT in SQL and parsed with BigInt — a bigint
 *  that passes through a JS number loses its last digits without complaining (Law 2). */
export interface SchemeVersionRules extends VersionFee {
  schemeId: string;
  benefitSummary: Record<string, unknown>;
  eligibilityRules: Record<string, unknown>;
  requiredDocTypeIds: string[];
  applicationWindow: Record<string, unknown> | null;
  applicableRegionIds: string[];
  status: string;
  isBackfilled: boolean;
}

const COLS = `id, scheme_id, version, status, benefit_summary, eligibility_rules, required_doc_type_ids,
  application_window, applicable_region_ids, processing_fee_minor::text AS processing_fee_minor, is_backfilled`;

function toRules(r: any): SchemeVersionRules {
  return {
    id: r.id, schemeId: r.scheme_id, version: r.version, status: r.status,
    benefitSummary: r.benefit_summary ?? {}, eligibilityRules: r.eligibility_rules ?? {},
    requiredDocTypeIds: r.required_doc_type_ids ?? [], applicationWindow: r.application_window ?? null,
    applicableRegionIds: r.applicable_region_ids ?? [],
    processingFeeMinor: BigInt(r.processing_fee_minor ?? '0'),
    isBackfilled: r.is_backfilled === true,
  };
}

@Injectable()
export class SchemeVersionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The version a new application should be stamped with — the one the live `schemes` row is a projection of.
   *
   *  Read INSIDE the apply transaction, on the same client that inserts the application, so a publish committing
   *  between "which version is current" and "write the application" cannot stamp a version that was superseded a
   *  moment earlier.
   */
  async currentPublished(tx: TxContext, schemeId: string): Promise<SchemeVersionRules | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM scheme_versions WHERE scheme_id=$1 AND status='published' AND deleted_at IS NULL`, [schemeId]);
    return r.rows[0] ? toRules(r.rows[0]) : null;
  }

  /** The rule set an application was actually filed under. Returns null for a pre-0105 application whose pointer was
   *  never resolvable — the caller must treat that as "unknown", never as "the current version". */
  async byId(tx: TxContext, versionId: string): Promise<SchemeVersionRules | null> {
    const r = await tx.query(`SELECT ${COLS} FROM scheme_versions WHERE id=$1 AND deleted_at IS NULL`, [versionId]);
    return r.rows[0] ? toRules(r.rows[0]) : null;
  }

  /** Off-transaction read for the application-detail view: "what did I agree to?" is a question an applicant is
   *  entitled to an answer to, and it is a read of global data. */
  async byIdForTenant(tenantId: string, versionId: string): Promise<SchemeVersionRules | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM scheme_versions WHERE id=$1 AND deleted_at IS NULL`, [versionId]);
    return r.rows[0] ? toRules(r.rows[0]) : null;
  }
}
