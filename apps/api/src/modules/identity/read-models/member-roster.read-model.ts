// modules/identity/read-models/member-roster.read-model.ts · W153's roster (PC-56 TENANT-1b).
//
// The most-used screen in an FPO console, and it did not exist: `/members` in web-tenant is PC-28's paid
// membership-TIER manager (tiers, fees, subscribe), a different object that happens to share a word. W153 is the PEOPLE
// roster — 1,284 members, each with one or more roles, each role with its own KYC.
//
// **THE COLUMN THIS READ MODEL EXISTS FOR IS THE ONE TENANT-1 FOUND A MONEY DEFECT BEHIND.** "KYC is per role, not per
// person", and the payout gate used to accept a verified status on any role — so a member verified as a worker could
// draw a farmer settlement. That is fixed (0125); this is the surface that lets a tenant SEE it, which is the other half
// of the same control: a rule enforced in the money path and invisible in the console is a rule staff cannot work.
//
// **SCALE IS THE DESIGN CONSTRAINT, NOT AN AFTERTHOUGHT.** A tenant at Y10 scale has hundreds of thousands of members
// and the platform has 75M households. So: keyset pagination (never OFFSET), the roles collapsed in ONE round trip
// rather than N+1 per row, the trigram index (`idx_users_name_trgm`, 0003) doing the name search, and every aggregate
// bounded to the page's own rows.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

export interface RosterRole { roleCode: string; kycStatus: string; isActive: boolean }

export interface RosterRow {
  userId: string;
  fullName: string | null;
  /** ALWAYS masked. The unmasked value is a separate, recorded, reasoned act — never a column on a list. */
  phoneMasked: string;
  villageName: string | null;
  languageCode: string;
  roles: RosterRole[];
  lastActiveAt: string | null;
  /** Lifetime money RECEIVED through this tenant, in minor units as a string (Law 2). See the note on `lifetimeReceived`. */
  lifetimeReceivedMinor: string;
}

export interface RosterQuery {
  /** Name or phone. The trigram index makes a Gujarati spelling variant findable — W153's own claim. */
  q?: string;
  roleCode?: string;
  kycStatus?: string;
  dormantDays?: number;
  cursor?: { name: string; id: string };
  limit: number;
}

/**
 * **THE PHONE IS MASKED HERE, IN THE READ MODEL, NOT IN THE COMPONENT.** W153: "PII stays masked — full reveal is
 * per-field, recorded, and reasoned." Masking in the template would mean the full number crossed the wire and sat in a
 * server-rendered payload, a browser cache and a log; masking here means the console literally cannot leak what it never
 * received. The reveal is a separate route with its own audit row.
 *
 * **THE FORMAT IS THE CANON'S, EXACTLY: `+91 96••• ••114`.** Country code, the first two digits of the subscriber
 * number, then the last three. That is not my instinct — my first version hid those two leading digits — and a mutation
 * run caught the disagreement between the code and its own doc comment. The canon's choice is the right one and it is
 * deliberate: every screen on this platform uses it (W109 shows `+91 98••• ••210`), and a field officer confirming a
 * member over a crackly line needs a couple of leading digits to disambiguate two Bhais in the same village. Five of ten
 * digits shown is the same policy a bank statement uses on a card.
 *
 * A number too short to mask this way reveals NOTHING rather than falling through to printing itself.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  // A subscriber number needs at least 2 leading + 3 trailing digits with something hidden between them, or the mask
  // reveals more than it hides.
  if (digits.length < 8) return '•••';
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const local = digits.slice(cc.length);
  const head = local.slice(0, 2);
  const tail = local.slice(-3);
  return `${cc ? `+${cc} ` : ''}${head}••• ••${tail}`;
}

@Injectable()
export class MemberRosterReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * One page of members with every role and per-role KYC.
   *
   * **THE ROLES ARE AGGREGATED IN THE SAME QUERY**, as a json array, because the alternative is one query per row —
   * which at 25 rows is 25 round trips and at any real scale is the thing that takes the page down. The aggregate is
   * bounded by the page: the CTE picks the page's user ids FIRST, and only then joins their roles.
   */
  async list(tenantId: string, q: RosterQuery): Promise<RosterRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

    // $1 is the tenant id, bound once at the top and reused: binding it twice would leave two parameters that must
    // agree for the query to be correct, which is a needless way to be wrong later.
    let where = 'utr.tenant_id = $1 AND utr.deleted_at IS NULL AND u.deleted_at IS NULL';
    // Trigram on the name, prefix on the phone. Both indexed (0003): `idx_users_name_trgm` and the unique on phone.
    if (q.q) {
      const term = p(`%${q.q}%`);
      where += ` AND (u.full_name ILIKE ${term} OR u.phone LIKE ${term})`;
    }
    if (q.roleCode) where += ` AND EXISTS (SELECT 1 FROM user_tenant_roles x JOIN roles xr ON xr.id = x.role_id
                                            WHERE x.user_id = u.id AND x.tenant_id = utr.tenant_id
                                              AND xr.code = ${p(q.roleCode)} AND x.is_active AND x.deleted_at IS NULL)`;
    // A KYC filter means "has at least one active role in this status" — the roster's own reading, and the reason the
    // console labels the filter "kyc: pending" rather than "member: pending".
    if (q.kycStatus) where += ` AND EXISTS (SELECT 1 FROM user_tenant_roles y
                                             WHERE y.user_id = u.id AND y.tenant_id = utr.tenant_id
                                               AND y.kyc_status = ${p(q.kycStatus)}::kyc_status AND y.is_active AND y.deleted_at IS NULL)`;
    if (q.dormantDays) where += ` AND (u.last_active_at IS NULL OR u.last_active_at < now() - (${p(q.dormantDays)} || ' days')::interval)`;
    // Keyset on (full_name, id) — the order the roster is read in, and stable because id breaks the tie. Never OFFSET:
    // page 40 of a 300,000-member roster with OFFSET is a scan of 1,000 rows to throw 975 away.
    if (q.cursor) where += ` AND (u.full_name, u.id) > (${p(q.cursor.name)}, ${p(q.cursor.id)})`;

    const limit = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query<{
      user_id: string; full_name: string | null; phone: string; village_name: string | null;
      language_code: string; last_active_at: string | null; roles: RosterRole[]; received_minor: string | null;
    }>(
      `WITH page AS (
         SELECT DISTINCT u.id, u.full_name
           FROM users u
           JOIN user_tenant_roles utr ON utr.user_id = u.id
          WHERE ${where}
          ORDER BY u.full_name NULLS LAST, u.id
          LIMIT ${limit}
       )
       SELECT u.id AS user_id, u.full_name, u.phone, u.language_code, u.last_active_at,
              -- THE VILLAGE COMES FROM THE ADDRESS'S OWN village COLUMN, NOT FROM A REGION JOIN. admin_regions is the
              -- administrative hierarchy (state, district, taluka); a village is free text on the address because most
              -- Indian villages are not rows in any authority's region table. Reading a district name into a column
              -- labelled Village would put the wrong place-name in front of a field officer.
              ad.village AS village_name,
              COALESCE((SELECT json_agg(json_build_object('roleCode', r2.code, 'kycStatus', utr2.kyc_status, 'isActive', utr2.is_active)
                                        ORDER BY r2.code)
                          FROM user_tenant_roles utr2 JOIN roles r2 ON r2.id = utr2.role_id
                         WHERE utr2.user_id = u.id AND utr2.tenant_id = $1 AND utr2.deleted_at IS NULL), '[]'::json) AS roles,
              -- MONEY RECEIVED, FROM PAYOUTS, BOUNDED TO THIS PAGE'S ROWS. W153 shows a Lifetime sales column; the honest
              -- source for money a member has actually RECEIVED is their settled payouts rather than an orders sum -- an
              -- order that never settled is not income, and W155 says exactly that: unsold stock counts when paid, never
              -- before. Bounded by the page CTE, so this is 25 indexed lookups and not an aggregate over the whole table;
              -- the unbounded lifetime figure still wants a rollup at scale (TENANT-1b-Q1).
              COALESCE((SELECT SUM(po.amount_minor) FROM payouts po
                         WHERE po.user_id = u.id AND po.tenant_id = $1 AND po.status = 'paid'), 0)::text AS received_minor
         FROM page
         JOIN users u ON u.id = page.id
         -- is_default, which is what the column is actually called (0003) -- and LEFT, because a member with no address
         -- on file is a real member rather than a broken row: paper-first onboarding is the norm in an SHG federation.
         LEFT JOIN addresses ad ON ad.user_id = u.id AND ad.is_default = true AND ad.deleted_at IS NULL
        ORDER BY u.full_name NULLS LAST, u.id`,
      params);

    return r.rows.map((x) => ({
      userId: String(x.user_id),
      fullName: x.full_name ?? null,
      phoneMasked: maskPhone(String(x.phone)),
      villageName: x.village_name ?? null,
      languageCode: String(x.language_code),
      roles: Array.isArray(x.roles) ? x.roles : [],
      lastActiveAt: x.last_active_at ? new Date(String(x.last_active_at)).toISOString() : null,
      lifetimeReceivedMinor: String(x.received_minor ?? '0'),
    }));
  }

  /**
   * W153's four tiles.
   *
   * **"FULLY VERIFIED" IS COMPUTED THE WORST-STATUS WAY IN SQL**, matching the domain's `isFullyVerified` exactly: a
   * member counts only when EVERY active role is verified. Counting people with any verified role would produce the
   * flattering number the old money gate implied — and would have told a tenant that Kanji Bhai was compliant while his
   * farmer verification sat pending.
   */
  async census(tenantId: string, dormantDays = 60): Promise<{
    activeMembers: number; fullyVerified: number; activeLast30d: number; dormant: number; voiceFirstShare: number | null;
  }> {
    const r = await this.replica.forTenant(tenantId).query(`
      WITH m AS (
        SELECT u.id,
               u.last_active_at,
               COUNT(*) FILTER (WHERE utr.is_active) AS active_roles,
               COUNT(*) FILTER (WHERE utr.is_active AND utr.kyc_status = 'verified') AS verified_roles
          FROM users u
          JOIN user_tenant_roles utr ON utr.user_id = u.id AND utr.tenant_id = $1 AND utr.deleted_at IS NULL
         WHERE u.deleted_at IS NULL
         GROUP BY u.id, u.last_active_at
      )
      SELECT COUNT(*) FILTER (WHERE active_roles > 0)::int AS active_members,
             -- every active role verified, not merely one
             COUNT(*) FILTER (WHERE active_roles > 0 AND active_roles = verified_roles)::int AS fully_verified,
             COUNT(*) FILTER (WHERE last_active_at > now() - interval '30 days')::int AS active_30d,
             COUNT(*) FILTER (WHERE last_active_at IS NULL OR last_active_at < now() - ($2 || ' days')::interval)::int AS dormant
        FROM m`, [tenantId, dormantDays]);
    const x = r.rows[0];
    return {
      activeMembers: Number(x.active_members), fullyVerified: Number(x.fully_verified),
      activeLast30d: Number(x.active_30d), dormant: Number(x.dormant),
      // **W153's "Voice-first users · 64%" HAS NO SOURCE AND IS RETURNED AS NULL.** Nothing on this platform records
      // whether a session used voice input: `users.language_code` says which language, not which modality. A share
      // derived from language would be a different quantity wearing this one's label — the substitution this programme
      // has refused eight times. TENANT-1b-Q2.
      voiceFirstShare: null,
    };
  }

  /** One member's roles, for the detail view and for the reveal audit's before/after. */
  async rolesOf(tenantId: string, userId: string): Promise<RosterRole[]> {
    const r = await this.replica.forTenant(tenantId).query<{ role_code: string; kyc_status: string; is_active: boolean }>(
      `SELECT r.code AS role_code, utr.kyc_status, utr.is_active
         FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.deleted_at IS NULL ORDER BY r.code`,
      [tenantId, userId]);
    return r.rows.map((x) => ({ roleCode: String(x.role_code), kycStatus: String(x.kyc_status), isActive: Boolean(x.is_active) }));
  }
}
