// modules/listings/read-models/listing-regulated.read-model.ts · PC-56 STORE-2a · B5 (survey B13, PUBLIC HALF only; F-9 stays named) — THE
// REGULATED MARKER A BUYER IS SHOWN.
//
// `regulated_product_rules` (0004: license_required · banned_state · safety_label · prescription_required) existed and nothing a buyer saw read
// it. This read answers, for a PUBLISHED, publicly visible lot of the context organisation (seller not suspended), the marker of its PRODUCT
// and of its category branch (the category and every ancestor — the same resolution as catalogue's RegulatedRuleRepository), in force on the
// UTC day (the same day that repository uses):
//   • `licenceRequired` — a NATIONAL `license_required` rule (region_id NULL) binds every buyer → the storefront shows the
//     "Licence required to buy" lock, on the card and the detail. The lot is NEVER hidden for it (canon W282: "the lock is shown, not hidden");
//   • `licenceRequiredIn` — the region NAMES of state-scoped `license_required` rules (a licence is needed there, not everywhere);
//   • `bannedRegions` — the region NAMES of `banned_state` rules;
//   • `safetyLabel` — the `safety_label` rule's text when one is recorded (payload `label`, else `text`), else null.
// ENFORCEMENT (who may add it to a cart, a licence upload, 18+) is STORE-2b — this read enforces nothing, and the storefront prints nothing
// about enforcement. Rules are GLOBAL master data (no tenant_id, no RLS — written by the admin realm, Law 11); the listing row is read through
// the RLS-forced `listings` table in the tenant's own context. Bounded: one row for the lot, at most 200 rules (the repository's cap).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { sellerNotSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { UUID_RE } from '../../../shared/pagination/us-keyset';

export interface RegulatedMarker {
  licenceRequired: boolean;
  licenceRequiredIn: string[];
  bannedRegions: string[];
  safetyLabel: string | null;
}
export const NO_MARKER: RegulatedMarker = Object.freeze({ licenceRequired: false, licenceRequiredIn: [], bannedRegions: [], safetyLabel: null }) as RegulatedMarker;

const MAX_RULES = 200;

/** PURE: the marker from the rules in force (each with its region's name, when it has one). */
export function markerFromRules(rules: ReadonlyArray<{ ruleType: string; regionName: string | null; regional: boolean; label: string | null }>): RegulatedMarker {
  const names = (pred: (r: { ruleType: string; regional: boolean }) => boolean) =>
    [...new Set(rules.filter((r) => pred(r) && r.regionName).map((r) => r.regionName as string))].sort((a, b) => a.localeCompare(b));
  const label = rules.find((r) => r.ruleType === 'safety_label' && r.label && r.label.trim().length > 0);
  return {
    licenceRequired: rules.some((r) => r.ruleType === 'license_required' && !r.regional),
    licenceRequiredIn: names((r) => r.ruleType === 'license_required' && r.regional),
    bannedRegions: names((r) => r.ruleType === 'banned_state' && r.regional),
    safetyLabel: label ? (label.label as string).trim() : null,
  };
}

@Injectable()
export class ListingRegulatedReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The marker of a public lot, or null when the lot is not public (404). */
  async forListing(tenantId: string, listingId: string): Promise<RegulatedMarker | null> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(listingId)) return null;
    const db = this.replica.forTenant(tenantId);
    const l = await db.query<{ product_id: string; category_id: string }>(
      `SELECT l.product_id, l.category_id FROM listings l
        WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL
          AND l.status = 'published' AND l.visibility IN ('public','cross_tenant')
          AND ${sellerNotSuspendedSql('l')}`, [listingId, tenantId]);
    const row = l.rows[0];
    if (!row) return null;
    const r = await db.query<{ rule_type: string; region_name: string | null; regional: boolean; label: string | null }>(
      `SELECT q.rule_type, rg.default_name AS region_name, (q.region_id IS NOT NULL) AS regional,
              COALESCE(q.payload->>'label', q.payload->>'text') AS label
         FROM regulated_product_rules q
         LEFT JOIN admin_regions rg ON rg.id = q.region_id
        WHERE q.deleted_at IS NULL
          AND q.rule_type IN ('license_required', 'banned_state', 'safety_label')
          AND q.effective_from <= CURRENT_DATE AND (q.effective_to IS NULL OR q.effective_to >= CURRENT_DATE)
          AND (q.product_id = $1
               OR q.category_id IN (SELECT anc.id FROM categories anc
                                     WHERE anc.path @> (SELECT c.path FROM categories c WHERE c.id = $2) AND anc.deleted_at IS NULL))
        ORDER BY q.rule_type, q.id
        LIMIT ${MAX_RULES}`, [row.product_id, row.category_id]);
    return markerFromRules(r.rows.map((x) => ({ ruleType: x.rule_type, regionName: x.region_name ?? null, regional: x.regional === true, label: x.label ?? null })));
  }
}
