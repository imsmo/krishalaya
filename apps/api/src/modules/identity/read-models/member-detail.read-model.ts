// modules/identity/read-models/member-detail.read-model.ts · W154's member detail (PC-56 TENANT-1b).
//
// The page a field officer opens when a farmer rings. W153's roster answers "who is in this organisation"; this answers
// "what does this organisation know about this one person", and W154 lays out four at-a-glance tiles, a per-role KYC
// table, the member's own contact choices, and a recent-activity strip.
//
// **THREE OF W154's NUMBERS HAVE NO SOURCE ON THIS PLATFORM, AND THIS FILE RETURNS null FOR EACH RATHER THAN A
// SUBSTITUTE.** Ninth, tenth and eleventh time this programme has refused the substitution:
//
//   • **"Trust · trusted · 81"** — there is no trust score. `grep -rl "trust_score\|trustScore"` returns nothing across
//     the migrations and the whole api. What IS real is the dispute record underneath the badge ("4/4 disputes clean"),
//     so the counts are returned and the SCORE is null. A number invented here would be read by staff as a reason to
//     extend or withhold credit to a farmer, which is the worst possible place for a made-up integer.
//   • **"Active days (30d) · 28"** — and this one is refused for a REASON THAT IS ITSELF THE FINDING. The only per-day
//     record of a person using the platform is `login_events` (0003), which has NO tenant_id: it is a platform security
//     trail. Counting it here would tell Anand FPO how often Kanji Bhai opened the app for a DIFFERENT FPO, or for the
//     consumer storefront. That is the realm-identity problem for the twelfth time, and the answer is the same as the
//     other eleven: a tenant console does not get to read a platform-wide fact about a person. `users.last_active_at` is
//     one timestamp, not a count of days, and the roster already shows it.
//   • **"voice-first (71% of sessions)"** — nothing records input modality (TENANT-1b-Q2, already named on the roster).
//
// **EVERY OTHER FIGURE ON THE SCREEN IS REAL AND TENANT-SCOPED**, which is why the page is worth building: the money is
// this tenant's payouts, the orders are this tenant's orders, the dairy is this tenant's collections, the roles and their
// KYC are `user_tenant_roles` rows for THIS tenant, and the preferences are the member's own.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { maskPhone } from './member-roster.read-model';

export interface MemberRoleDetail {
  roleCode: string;
  kycStatus: string;
  isActive: boolean;
  /** When this ROLE was granted — not when the person joined. W154 shows "farmer · Nov 2024 / dairy_farmer · Jan 2025". */
  since: string | null;
  /** The documents filed against this role, by type name + status. W154's "Aadhaar ✓ · land_record ✓ (7/12 extract)". */
  documents: { docType: string; status: string; validUntil: string | null }[];
}

export interface MemberGlance {
  /** Money this tenant has actually PAID this member (settled payouts). Minor units, string (Law 2). */
  lifetimeReceivedMinor: string;
  paidPayoutCount: number;
  /** Orders where the member is the SELLER, in this tenant. */
  sellerOrderCount: number;
  firstSellerOrderAt: string | null;
  /** Dairy, last 30 days. null when the member has no dairy membership at all — which is not zero (unknown ≠ zero). */
  dairy: { litres: string; amountMinor: string; avgFatPct: string; avgSnfPct: string; animalCount: number } | null;
  /** Disputes RAISED AGAINST this member in this tenant, and how many ended without a finding against them. */
  disputesAgainst: number;
  disputesAgainstUpheld: number;
  disputesOpen: number;
  /** **ALWAYS null.** See the file header: there is no trust score anywhere on this platform. */
  trustScore: null;
  /** **ALWAYS null.** `login_events` is a platform trail with no tenant_id; see the file header. */
  activeDays30d: null;
}

export interface MemberPreferences {
  languageCode: string;
  quietHours: { starts: string; ends: string; timezone: string } | null;
  priceAlerts: { productName: string | null; direction: string; thresholdMinor: string; isActive: boolean }[];
  /** Only the channels the member has switched OFF. W154 frames these as "his choices, not ours", and a list of
   *  everything ON would bury the two lines that matter. */
  mutedEvents: { eventCode: string; channel: string }[];
}

export interface MemberActivityItem {
  kind: 'payout' | 'listing';
  at: string;
  /** Minor units where the item carries money; null where it does not. */
  amountMinor: string | null;
  label: string;
  status: string;
}

export interface MemberDetail {
  userId: string;
  fullName: string | null;
  /** The PLATFORM status (`users.status`). Shown, never editable from here — see MemberDetailReadModel's note. */
  platformStatus: string;
  phoneMasked: string;
  villageName: string | null;
  languageCode: string;
  /** The earliest role grant in THIS tenant. W154's "member since Nov 2024". */
  memberSince: string | null;
  lastActiveAt: string | null;
  aadhaarLast4: string | null;
  hasAadhaarVault: boolean;
  hasPanVault: boolean;
  /** True when this member has no ACTIVE role in this tenant — the console must say so rather than render an
   *  ordinary-looking page for somebody who has left. */
  membershipInactive: boolean;
  roles: MemberRoleDetail[];
  glance: MemberGlance;
  preferences: MemberPreferences;
  activity: MemberActivityItem[];
}

@Injectable()
export class MemberDetailReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * One member, assembled at query time.
   *
   * **THE MEMBERSHIP EXISTS-JOIN IS THE TENANT BOUNDARY AND IT IS THE FIRST THING IN THE QUERY.** Without it this route
   * is a platform-wide profile reader keyed on a uuid. It matches `MemberPiiService` deliberately: the same boundary,
   * expressed the same way, so a reader comparing the two files sees one rule rather than two.
   *
   * **AND IT DOES NOT REQUIRE THE MEMBERSHIP TO BE ACTIVE.** A member whose roles were deactivated last season still has
   * payouts, orders and a KYC history this tenant is accountable for, and W154's own copy is explicit that "membership
   * history stays with the member". So a lapsed member renders, flagged (`membershipInactive`), rather than 404-ing —
   * which would make a tenant's own records unreachable the moment somebody flipped a switch.
   */
  async get(tenantId: string, userId: string): Promise<MemberDetail | null> {
    const db = this.replica.forTenant(tenantId);

    const head = await db.query<{
      user_id: string; full_name: string | null; status: string; phone: string; village_name: string | null;
      language_code: string; member_since: string | null; last_active_at: string | null;
      aadhaar_last4: string | null; has_aadhaar: boolean; has_pan: boolean; active_roles: number;
    }>(
      `SELECT u.id AS user_id, u.full_name, u.status::text AS status, u.phone, u.language_code,
              u.last_active_at, u.aadhaar_last4,
              -- The VAULT REFS are never selected, only their presence. W154: "only vault references and last-4".
              (u.aadhaar_vault_ref IS NOT NULL) AS has_aadhaar,
              (u.pan_vault_ref IS NOT NULL) AS has_pan,
              ad.village AS village_name,
              -- The earliest ROLE GRANT in this tenant is what "member since" means here. users.created_at would be
              -- the day they first touched the PLATFORM, which for a farmer onboarded by another FPO is a different
              -- date and none of this tenant's business.
              (SELECT MIN(m.created_at) FROM user_tenant_roles m
                WHERE m.user_id = u.id AND m.tenant_id = $2 AND m.deleted_at IS NULL) AS member_since,
              (SELECT COUNT(*)::int FROM user_tenant_roles m2
                WHERE m2.user_id = u.id AND m2.tenant_id = $2 AND m2.is_active = true AND m2.deleted_at IS NULL) AS active_roles
         FROM users u
         LEFT JOIN addresses ad ON ad.user_id = u.id AND ad.is_default = true AND ad.deleted_at IS NULL
        WHERE u.id = $1 AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                       WHERE utr.user_id = u.id AND utr.tenant_id = $2 AND utr.deleted_at IS NULL)`,
      [userId, tenantId]);

    const h = head.rows[0];
    if (!h) return null;

    const [roles, glance, preferences, activity] = await Promise.all([
      this.roles(tenantId, userId),
      this.glance(tenantId, userId),
      this.preferences(tenantId, userId, String(h.language_code)),
      this.activity(tenantId, userId),
    ]);

    return {
      userId: String(h.user_id),
      fullName: h.full_name ?? null,
      platformStatus: String(h.status),
      phoneMasked: maskPhone(String(h.phone)),
      villageName: h.village_name ?? null,
      languageCode: String(h.language_code),
      memberSince: h.member_since ? new Date(String(h.member_since)).toISOString() : null,
      lastActiveAt: h.last_active_at ? new Date(String(h.last_active_at)).toISOString() : null,
      aadhaarLast4: h.aadhaar_last4 ?? null,
      hasAadhaarVault: Boolean(h.has_aadhaar),
      hasPanVault: Boolean(h.has_pan),
      membershipInactive: Number(h.active_roles) === 0,
      roles, glance, preferences, activity,
    };
  }

  /**
   * Roles, their own KYC, and the documents filed for each.
   *
   * **THE DOCUMENTS ARE ATTACHED PER ROLE, WHICH IS THE WHOLE POINT OF THE TABLE.** `kyc_documents.role_id` (0003)
   * records which capacity a document was filed for, and W154 renders exactly that ("dairy_farmer · inherits Aadhaar").
   * A document with a NULL role_id is filed against the person rather than a role — an Aadhaar is an Aadhaar — so it is
   * listed under every role rather than dropped, which is what "inherits" means on the screen.
   */
  private async roles(tenantId: string, userId: string): Promise<MemberRoleDetail[]> {
    const r = await this.replica.forTenant(tenantId).query<{
      role_code: string; kyc_status: string; is_active: boolean; since: string | null;
      documents: { docType: string; status: string; validUntil: string | null }[] | null;
    }>(
      `SELECT r.code AS role_code, utr.kyc_status::text AS kyc_status, utr.is_active, utr.created_at AS since,
              (SELECT json_agg(json_build_object('docType', lv.code, 'status', k.status::text,
                                                 'validUntil', k.valid_until) ORDER BY lv.code)
                 FROM kyc_documents k
                 JOIN lookup_values lv ON lv.id = k.doc_type_id
                WHERE k.user_id = utr.user_id AND k.deleted_at IS NULL
                  -- Tenant-filed documents plus platform-level ones (tenant_id IS NULL): a KYC document submitted
                  -- through another tenant is NOT shown here, for the same reason the login trail is not.
                  AND (k.tenant_id = $1 OR k.tenant_id IS NULL)
                  -- role_id IS NULL = filed against the person, so it belongs under every role ("inherits Aadhaar").
                  AND (k.role_id = utr.role_id OR k.role_id IS NULL)) AS documents
         FROM user_tenant_roles utr
         JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.deleted_at IS NULL
        ORDER BY utr.is_active DESC, r.code`,
      [tenantId, userId]);

    return r.rows.map((x) => ({
      roleCode: String(x.role_code),
      kycStatus: String(x.kyc_status),
      isActive: Boolean(x.is_active),
      since: x.since ? new Date(String(x.since)).toISOString() : null,
      documents: Array.isArray(x.documents) ? x.documents : [],
    }));
  }

  /** W154's four tiles — the two that are real, the money and the dairy, and the dispute record under the trust badge. */
  private async glance(tenantId: string, userId: string): Promise<MemberGlance> {
    const db = this.replica.forTenant(tenantId);
    const [money, dairy, animals, disputes] = await Promise.all([
      db.query<{ received_minor: string; paid_count: number; order_count: number; first_order_at: string | null }>(
        `SELECT COALESCE((SELECT SUM(p.amount_minor) FROM payouts p
                           WHERE p.tenant_id = $1 AND p.user_id = $2 AND p.status = 'paid'), 0)::text AS received_minor,
                (SELECT COUNT(*)::int FROM payouts p2
                  WHERE p2.tenant_id = $1 AND p2.user_id = $2 AND p2.status = 'paid') AS paid_count,
                -- W154 says "42 orders since Nov 2024". Orders the member SOLD, in this tenant. Cancelled orders are
                -- excluded: a cancelled order is not a sale, and counting it would flatter the number the console
                -- prints next to a money figure.
                (SELECT COUNT(*)::int FROM orders o
                  WHERE o.tenant_id = $1 AND o.seller_user_id = $2 AND o.deleted_at IS NULL
                    AND o.status NOT IN ('cancelled', 'created', 'payment_pending')) AS order_count,
                (SELECT MIN(o2.created_at) FROM orders o2
                  WHERE o2.tenant_id = $1 AND o2.seller_user_id = $2 AND o2.deleted_at IS NULL
                    AND o2.status NOT IN ('cancelled', 'created', 'payment_pending')) AS first_order_at`,
        [tenantId, userId]),
      // **THE DAIRY TILE GOES THROUGH dairy_memberships, BECAUSE milk_collections IS KEYED ON membership_id.** A join
      // on user_id would not compile against the real schema (0009) — the collections table never carries a user.
      // `collected_on >= …` is the partition key, so this is a bounded scan of at most 30 daily partitions rather than
      // a sweep of a table that grows by two rows per farmer per day.
      db.query<{ litres: string | null; amount_minor: string | null; fat: string | null; snf: string | null; rows: number }>(
        `SELECT SUM(mc.weight_kg)::text AS litres,
                SUM(mc.amount_minor)::text AS amount_minor,
                -- Fat is averaged by WEIGHT, not by row: a 2 kg evening can cannot count as much as a 12 kg morning
                -- one, and a plain AVG would print a number no dairy manager recognises.
                (SUM(mc.fat_pct * mc.weight_kg) / NULLIF(SUM(mc.weight_kg), 0))::numeric(4,2)::text AS fat,
                (SUM(mc.snf_pct * mc.weight_kg) / NULLIF(SUM(mc.weight_kg), 0))::numeric(4,2)::text AS snf,
                COUNT(*)::int AS rows
           FROM milk_collections mc
           JOIN dairy_memberships dm ON dm.id = mc.membership_id AND dm.deleted_at IS NULL
          WHERE mc.tenant_id = $1 AND dm.farmer_user_id = $2
            AND mc.collected_on >= (CURRENT_DATE - 30)`,
        [tenantId, userId]),
      db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM animals a
          WHERE a.tenant_id = $1 AND a.owner_user_id = $2 AND a.status = 'active' AND a.deleted_at IS NULL`,
        [tenantId, userId]),
      // **THE DISPUTE COUNTS ARE THE HONEST PART OF W154's TRUST TILE.** "Upheld" means resolved WITH a remedy against
      // the member (a refund or a replacement); 'rejected' and 'withdrawn' are not findings against them, and lumping
      // those in would let a buyer damage a farmer's record simply by complaining.
      db.query<{ total: number; upheld: number; open: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE d.status = 'resolved'
                                   AND d.resolution_type IN ('refund_full','refund_partial','replacement'))::int AS upheld,
                COUNT(*) FILTER (WHERE d.status NOT IN ('resolved','rejected','withdrawn'))::int AS open
           FROM disputes d
          WHERE d.tenant_id = $1 AND d.against_user = $2 AND d.deleted_at IS NULL`,
        [tenantId, userId]),
    ]);

    const m = money.rows[0];
    const d = dairy.rows[0];
    const disp = disputes.rows[0];
    return {
      lifetimeReceivedMinor: String(m?.received_minor ?? '0'),
      paidPayoutCount: Number(m?.paid_count ?? 0),
      sellerOrderCount: Number(m?.order_count ?? 0),
      firstSellerOrderAt: m?.first_order_at ? new Date(String(m.first_order_at)).toISOString() : null,
      // **NO COLLECTIONS IN 30 DAYS IS null, NOT ZERO.** A farmer who pours no milk and a farmer this tenant runs no
      // dairy for are different facts, and a "₹0" tile against a groundnut grower is a question staff waste time on.
      dairy: Number(d?.rows ?? 0) > 0
        ? {
            litres: String(d!.litres ?? '0'),
            amountMinor: String(d!.amount_minor ?? '0'),
            avgFatPct: String(d!.fat ?? '0'),
            avgSnfPct: String(d!.snf ?? '0'),
            animalCount: Number(animals.rows[0]?.n ?? 0),
          }
        : null,
      disputesAgainst: Number(disp?.total ?? 0),
      disputesAgainstUpheld: Number(disp?.upheld ?? 0),
      disputesOpen: Number(disp?.open ?? 0),
      trustScore: null,
      activeDays30d: null,
    };
  }

  /** W154's "Contact preferences (his choices, not ours)". */
  private async preferences(tenantId: string, userId: string, languageCode: string): Promise<MemberPreferences> {
    const db = this.replica.forTenant(tenantId);
    const [quiet, alerts, muted] = await Promise.all([
      db.query<{ starts: string; ends: string; timezone: string }>(
        `SELECT starts::text, ends::text, timezone FROM user_quiet_hours WHERE user_id = $1`, [userId]),
      db.query<{ product_name: string | null; direction: string; threshold_minor: string; is_active: boolean }>(
        // `products.default_name` — the column is NOT called `name` (0004). The localised name lives in the
        // translations plane (ADMIN-3b); the console renders the default and the member's own language is shown
        // beside it, rather than this read model guessing at a translation the reviewer may not have approved.
        `SELECT p.default_name AS product_name, pa.direction, pa.threshold_minor::text AS threshold_minor, pa.is_active
           FROM price_alerts pa
           LEFT JOIN products p ON p.id = pa.product_id AND p.deleted_at IS NULL
          WHERE pa.tenant_id = $1 AND pa.user_id = $2 AND pa.deleted_at IS NULL
          ORDER BY pa.is_active DESC, p.default_name NULLS LAST
          LIMIT 20`, [tenantId, userId]),
      // notification_preferences is USER-scoped (0012) and carries no tenant_id — but unlike the login trail this is
      // the member's own instruction about being contacted, and a tenant about to telephone them at 22:00 needs it.
      // Only the OFF rows are read: an exhaustive dump would be the member's whole notification surface.
      db.query<{ event_code: string; channel: string }>(
        `SELECT event_code, channel FROM notification_preferences
          WHERE user_id = $1 AND is_enabled = false ORDER BY event_code, channel LIMIT 50`, [userId]),
    ]);
    const q = quiet.rows[0];
    return {
      languageCode,
      quietHours: q ? { starts: String(q.starts), ends: String(q.ends), timezone: String(q.timezone) } : null,
      priceAlerts: alerts.rows.map((x) => ({
        productName: x.product_name ?? null,
        direction: String(x.direction),
        thresholdMinor: String(x.threshold_minor),
        isActive: Boolean(x.is_active),
      })),
      mutedEvents: muted.rows.map((x) => ({ eventCode: String(x.event_code), channel: String(x.channel) })),
    };
  }

  /**
   * W154's recent-activity strip: money out and listings, newest first.
   *
   * **TWO BOUNDED QUERIES MERGED IN TYPESCRIPT, NOT A SQL UNION OVER UNBOUNDED TABLES.** Each side takes its own
   * indexed top-N and the merge happens on eight rows. A UNION ALL with a shared ORDER BY would make the planner sort
   * the union of two full result sets before applying the limit.
   */
  private async activity(tenantId: string, userId: string, limit = 8): Promise<MemberActivityItem[]> {
    const db = this.replica.forTenant(tenantId);
    const [payouts, listings] = await Promise.all([
      db.query<{ at: string; amount_minor: string; status: string; purpose: string | null }>(
        `SELECT p.created_at AS at, p.amount_minor::text AS amount_minor, p.status::text AS status, lv.code AS purpose
           FROM payouts p
           LEFT JOIN lookup_values lv ON lv.id = p.purpose_id
          WHERE p.tenant_id = $1 AND p.user_id = $2 AND p.deleted_at IS NULL
          ORDER BY p.created_at DESC LIMIT $3`, [tenantId, userId, limit]),
      db.query<{ at: string; status: string; title: string | null; price_minor: string | null }>(
        `SELECT l.created_at AS at, l.status::text AS status, l.title, l.price_minor::text AS price_minor
           FROM listings l
          WHERE l.tenant_id = $1 AND l.seller_user_id = $2 AND l.deleted_at IS NULL
          ORDER BY l.created_at DESC LIMIT $3`, [tenantId, userId, limit]),
    ]);

    const items: MemberActivityItem[] = [
      ...payouts.rows.map((x) => ({
        kind: 'payout' as const,
        at: new Date(String(x.at)).toISOString(),
        amountMinor: String(x.amount_minor),
        // The purpose is the label, because "₹44,660 · wage" and "₹44,660 · settlement" are different events to a
        // member desk. A purpose the lookup cannot name renders as the empty string rather than as "settlement".
        label: x.purpose ? String(x.purpose) : '',
        status: String(x.status),
      })),
      ...listings.rows.map((x) => ({
        kind: 'listing' as const,
        at: new Date(String(x.at)).toISOString(),
        amountMinor: x.price_minor ? String(x.price_minor) : null,
        label: x.title ?? '',
        status: String(x.status),
      })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  }
}
