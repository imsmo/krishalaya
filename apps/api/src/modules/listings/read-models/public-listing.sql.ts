// modules/listings/read-models/public-listing.sql.ts · PC-56 STORE-2a — THE SQL FRAGMENTS EVERY PUBLIC LISTING READ SHARES, WRITTEN ONCE.
//
// The feed, the detail's facts, the tombstone and the facets all have to agree on three facts a buyer is shown. Written at four sites they
// would drift (the suspension rule taught that lesson — shared/sql/member-suspension.sql.ts), so each is ONE exported string here.
//
//   • THE CONFIRMED GRADE (founder D2, "confirmed grade only, source named"). `listings.grade_option_id` is printed ONLY when a person of the
//     selling organisation confirmed it: the listing passed QC review (`qc_reviewed_by`, a staff member who is never the seller nor the
//     draft's creator — 0138's CHECK) AND that review is what published the CURRENT window (`qc_reviewed_at >= published_at`: approveQc
//     stamps both with the same instant). A rejection that was later re-drafted and published without review, or a lot re-published after
//     its review, does NOT carry the grade — the review no longer speaks for what is on sale. `ai_grade_option_id` (the AI photo-grade
//     suggestion) is NEVER read by any public path: an unconfirmed AI value is not shown (D2), so no Law 7 banner is owed.
//   • THE DISTRICT (founder D3 / HOTFIX-4): the listing's region as a DISTRICT-level name (level 2; the state's when only a state is
//     recorded) — never finer, never a uuid, never coordinates.
//   • THE REGULATED LOCK (B13, public half): a NATIONAL `license_required` rule in force today on the product, or on the listing's category
//     or any ancestor of it (regulated_product_rules, global master data). The lock is SHOWN, never used to hide a lot; enforcement is STORE-2b.
//     (`categories.requires_license` is the SELLER-side listing-approval rule of PRD §9.2, not a buyer licence — it is deliberately not read.)

/** admin_regions.level of a district (0002 seed: 1 = state, 2 = district) — the finest place a buyer is shown. */
export const DISTRICT_LEVEL = 2;

/** The confirmed grade option id of listing alias `l`, else NULL. */
export const confirmedGradeIdSql = (l: string): string =>
  `(CASE WHEN ${l}.qc_reviewed_by IS NOT NULL AND ${l}.qc_reviewed_at IS NOT NULL AND ${l}.published_at IS NOT NULL
              AND ${l}.qc_reviewed_at >= ${l}.published_at THEN ${l}.grade_option_id END)`;

/** The district-level admin region id of listing alias `l` (its own region when that is a district or a state), else NULL. */
export const districtIdSql = (l: string): string =>
  `(SELECT kvd.id FROM admin_regions kvr JOIN admin_regions kvd ON kvd.path @> kvr.path AND kvd.level = LEAST(kvr.level, ${DISTRICT_LEVEL})
     WHERE kvr.id = ${l}.region_id ORDER BY kvd.level DESC LIMIT 1)`;

/** The district NAME of listing alias `l`, else NULL. */
export const districtNameSql = (l: string): string =>
  `(SELECT kvd.default_name FROM admin_regions kvr JOIN admin_regions kvd ON kvd.path @> kvr.path AND kvd.level = LEAST(kvr.level, ${DISTRICT_LEVEL})
     WHERE kvr.id = ${l}.region_id ORDER BY kvd.level DESC LIMIT 1)`;

/** Is a NATIONAL `license_required` rule (region_id NULL — it binds every buyer) in force on `todayParam` (a bound date) for listing alias
 *  `l`'s product or category branch? A state-scoped licence rule binds buyers in that state only, so it is not a lock for everyone: the
 *  marker read names those states instead (listing-regulated.read-model.ts). */
export const licenceRequiredSql = (l: string, todayParam: string): string =>
  `EXISTS (SELECT 1 FROM regulated_product_rules kvq
            WHERE kvq.rule_type = 'license_required' AND kvq.deleted_at IS NULL AND kvq.region_id IS NULL
              AND kvq.effective_from <= ${todayParam}::date AND (kvq.effective_to IS NULL OR kvq.effective_to >= ${todayParam}::date)
              AND (kvq.product_id = ${l}.product_id
                   OR kvq.category_id IN (SELECT kva.id FROM categories kva
                                           WHERE kva.path @> (SELECT kvc.path FROM categories kvc WHERE kvc.id = ${l}.category_id)
                                             AND kva.deleted_at IS NULL)))`;

/** The day a rule's effective window is checked on: the UTC calendar day — the SAME day catalogue's RegulatedRuleRepository uses, so the
 *  marker and the (2b) enforcement can never disagree about whether a rule is in force. */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);
