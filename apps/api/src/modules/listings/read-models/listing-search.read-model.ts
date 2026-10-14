// modules/listings/read-models/listing-search.read-model.ts
// CQRS READ PATH. Browse/search NEVER touches the write primary (Law 12): it runs
// on the tenant's read REPLICA, with RLS re-asserting tenant isolation at the DB.
// Phase 1 uses a parameterised, keyset-paginated SQL query (stable, index-friendly
// at scale). Phase 2 swaps in an OpenSearch projection (relevance, synonyms,
// geo) fed by the outbox — same method signature, no controller change.
//
// PC-56 STORE-2a · B1 — THE FEED TELLS THE TRUTH (survey F-17 / B17 / B18 / B19, founder D2 / D3, HOTFIX-4 Q3):
//   • KEYSET PER SORT KEY. The cursor was always (created_at, id) while a price sort ordered by price_minor — page two skipped or repeated
//     lots. A cursor now names its sort and carries THAT sort's key: newest → (created_at in µs as the DB printed it, id); price → (price_minor,
//     id). A cursor minted under another sort is refused, 400 CURSOR_SORT_MISMATCH — never silently read as something else.
//   • REFUSED BY NAME, not silently ignored: `sort=distance` (DISTANCE_SORT_REFUSED), `sort=relevance` (RELEVANCE_SORT_REFUSED) and the
//     location inputs `lat` / `lng` / `pincode` (LOCATION_FILTER_REFUSED) — 2a asks no buyer for a location (founder D3).
//   • NEW FILTERS: `grade` (a CONFIRMED grade option, or `none`), the organic SPLIT (`certified` | `natural` | `any`), `category` (a whole
//     subtree of the public category tree), `district` (an admin-region subtree).
//   • THE PUBLIC ROW names the ORGANISATION (slug + display name), the CONFIRMED grade name, the district NAME and the regulated lock — and
//     carries NO `sellerUserId` and NO `regionId` uuid (HOTFIX-4 Q3, decided as engineering). The OWNER view (`mine=true`) is unchanged.
//   • A CAPPED FILTERED COUNT that is TRUE under every filter (it used to be null whenever a filter narrowed) and FACET COUNTS for grade, the
//     organic split, district and sale type — ONE bounded statement (Law 11, the cost): a CTE that reads at most cap + 1 = 1,001 rows of ONE tenant's
//     published public listings under the active filters (the cursor and sort do not narrow), each row with its district resolved through
//     one gist-indexed admin_regions probe; the count and the three GROUP BYs are computed over that materialised CTE. When the filtered set is
//     within the cap every figure is exact; above it the total reads "1,000+" and the facet counts are WITHHELD (null) — a count of a
//     1,001-row sample would be a false number, and an uncapped GROUP BY over a 5-year catalogue is the scan Law 11 forbids.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { SqlExecutor } from '../../../core/database/unit-of-work';
import { sellerNotSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { QueryListingDto, ListingSort } from '../dto/query-listing.dto';
import { DomainError } from '../../../shared/errors/app-error';
import { US_SQL, UUID_RE } from '../../../shared/pagination/us-keyset';
import { confirmedGradeIdSql, districtIdSql, districtNameSql, licenceRequiredSql, todayUtc } from './public-listing.sql';

// Browse/search is tenant-scoped (a storefront belongs to a tenant). A blank/invalid tenant is a CLIENT error,
// not a server fault: reject it with a clean 400 before it reaches the DB (where binding '' as a uuid would 500).
function requireTenant(tenantId: string): void {
  if (!UUID_RE.test(tenantId)) {
    throw new DomainError('TENANT_REQUIRED', 'A tenant context (X-Tenant-Id) is required for this request.', 400);
  }
}

/** The OWNER view's row ("my listings") — the seller's own records, so their own id and region uuid are theirs to see. Unchanged. */
export interface ListingCard {
  id: string; title: string; priceMinor: string; currencyCode: string;
  unitCode: string; quantityAvailable: number; organicClaim: boolean;
  saleType: string; regionId: string | null; sellerUserId: string; boosted: boolean;
  /** The listing's real lifecycle status (draft/published/paused/sold_out/expired/…). Always populated (the
   *  column is selected unconditionally) — the mobile owner view (badgeFor/countByStatus in
   *  features/listings/my-listings.ts) needs the true status to render draft/paused/sold/expired badges
   *  instead of defaulting every row to "live". */
  status: string;
}

/** PC-56 STORE-2a — the PUBLIC feed's row: who sells (the organisation), what grade a person confirmed, where (district name), whether a
 *  licence is required to buy. No seller user id, no region uuid, no coordinates. Money = a bigint minor-unit STRING + its currency. */
export interface PublicListingCard {
  id: string; title: string; priceMinor: string; currencyCode: string; unitCode: string; quantityAvailable: number;
  /** legacy boolean (either claim) — kept for existing readers; `organic` is the split */
  organicClaim: boolean;
  organic: 'certified' | 'natural' | null;
  saleType: string; status: string; boosted: boolean;
  grade: string | null; district: string | null;
  organisation: { slug: string; name: string } | null;
  licenceRequired: boolean;
}

/** One facet value: the id to filter by, its display name (master data), its count under the active filters. */
export interface FacetValue { id: string; name: string; count: number }
export interface ListingFacets {
  grade: FacetValue[]; ungraded: number;
  organic: { certified: number; natural: number; none: number };
  district: FacetValue[];
  /** the sale types present under the filters (`id` = the sale type; the storefront names it) */
  saleType: Array<{ id: string; count: number }>;
}

export interface SearchResult {
  items: Array<ListingCard | PublicListingCard>;
  /** PC-56 STORE-2a: the PUBLIC feed's count UNDER THE ACTIVE FILTERS, CAPPED — exact up to `totalCap`, `totalCap + 1` = "more than
   *  totalCap". Null on the owner view. (STORE-1b printed it only when nothing narrowed; it is now true under every filter.) */
  total: number | null;
  nextCursor: string | null;
  /** PC-56 STORE-1b: the cap behind `total`. */
  totalCap?: number;
  /** PC-56 STORE-1b: how many of the tenant's published listings are MEMBERS-ONLY (visibility tenant) — the storefront says "some lots
   *  are members-only" only when this is > 0. Null on the owner view. Capped at 1001. */
  membersOnlyCount?: number | null;
  /** PC-56 STORE-2a: facet counts under the active filters — null on the owner view AND whenever `total` exceeds the cap (withheld, not
   *  sampled). */
  facets?: ListingFacets | null;
}

/** PC-56 STORE-1b: the storefront's "N published" cap ("1,000+"). */
export const PUBLIC_LISTING_COUNT_CAP = 1000;

/** True when the query narrows the public feed. The cursor and sort do not narrow. (Kept: the storefront words a filtered count differently.) */
export function narrowsFeed(q: QueryListingDto): boolean {
  return Boolean(q.q || q.categoryId || q.category || q.regionId || q.district || q.grade || q.saleType || q.organic
    || q.priceMinMinor || q.priceMaxMinor || q.pincode);
}

/** The refusals of inputs the SQL path cannot honour (founder D3): named, never silently ignored. */
export function refuseUnsupported(q: QueryListingDto): void {
  if (q.sort === 'distance') {
    throw new DomainError('DISTANCE_SORT_REFUSED', '"Nearest first" is not offered: no buyer location is asked for, and no distance is computed', 400);
  }
  if (q.sort === 'relevance') {
    throw new DomainError('RELEVANCE_SORT_REFUSED', 'No relevance ranking exists on this feed: sort by newest or by price', 400);
  }
  if (q.lat !== undefined || q.lng !== undefined || q.pincode !== undefined) {
    throw new DomainError('LOCATION_FILTER_REFUSED', 'Location filters (lat, lng, pincode) are not offered: browse by district instead', 400);
  }
}

// ---- the keyset cursor: { s: sort, v: that sort's key as a string, id } -------------------------------------------------------------------
export interface FeedCursor { s: ListingSort; v: string; id: string }
const US_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MINOR = /^\d{1,19}$/;

export function encodeFeedCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}
/** The cursor for `sort`, or undefined (page one) for a malformed / legacy one. A WELL-FORMED cursor of ANOTHER sort is refused by name. */
export function decodeFeedCursor(raw: string | undefined, sort: ListingSort): FeedCursor | undefined {
  if (!raw) return undefined;
  let c: Partial<FeedCursor>;
  try { c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FeedCursor>; } catch { return undefined; }
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !UUID_RE.test(c.id) || typeof c.v !== 'string') return undefined;
  if (c.s !== 'newest' && c.s !== 'price_asc' && c.s !== 'price_desc') return undefined;
  if (c.s !== sort) {
    throw new DomainError('CURSOR_SORT_MISMATCH', `this cursor pages the "${c.s}" order; the request asks for "${sort}" — start from page one`, 400);
  }
  if (c.s === 'newest' ? !US_INSTANT.test(c.v) : !MINOR.test(c.v)) return undefined;
  return { s: c.s, v: c.v, id: c.id };
}

/** ORDER BY and the keyset predicate for one sort, over alias `l`. Each sort's predicate pages exactly its own ORDER BY. */
function orderAndAfter(sort: ListingSort, c: FeedCursor | undefined, p: (v: unknown) => string): { order: string; after: string | null } {
  if (sort === 'price_asc') {
    return { order: 'l.price_minor ASC, l.id ASC', after: c ? `(l.price_minor, l.id) > (${p(c.v)}::bigint, ${p(c.id)}::uuid)` : null };
  }
  if (sort === 'price_desc') {
    return { order: 'l.price_minor DESC, l.id DESC', after: c ? `(l.price_minor, l.id) < (${p(c.v)}::bigint, ${p(c.id)}::uuid)` : null };
  }
  return { order: 'l.created_at DESC, l.id DESC', after: c ? `(l.created_at, l.id) < (${p(c.v)}::timestamptz, ${p(c.id)}::uuid)` : null };
}

type Row = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any -- a pg row; every field is narrowed below

@Injectable()
export class ListingSearchReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** `ownerUserId` set ⇒ OWNER VIEW ("my listings"): the caller sees ALL of their own rows regardless of
   *  status/visibility (drafts, pending_approval, paused, rejected, hidden, sold_out, expired, archived — every
   *  status a seller needs to manage their own catalogue), scoped by `seller_user_id`. Unset ⇒ the public storefront
   *  feed (published + public/cross_tenant only). Either way tenant_id/deleted_at stay enforced. */
  async query(tenantId: string, q: QueryListingDto, opts: { ownerUserId?: string } = {}): Promise<SearchResult> {
    requireTenant(tenantId);
    refuseUnsupported(q);
    const sort: ListingSort = q.sort === 'price_asc' || q.sort === 'price_desc' ? q.sort : 'newest';
    const cursor = decodeFeedCursor(q.cursor, sort);
    return timed(this.metrics, 'listing.search', { tenant: tenantId }, async () => {
      const owner = Boolean(opts.ownerUserId);
      const params: unknown[] = [tenantId];
      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
      // the filter clauses (shared by the page and the count) — the cursor is NOT among them
      const where: string[] = [`l.tenant_id = $1`, `l.deleted_at IS NULL`];
      if (opts.ownerUserId) {
        where.push(`l.seller_user_id = ${p(opts.ownerUserId)}`);
      } else {
        where.push(`l.status = 'published'`, `l.visibility IN ('public','cross_tenant')`);
        // **A SUSPENDED SELLER'S LISTINGS LEAVE THE FEED (PC-56 TENANT-1b-2, W154's "pauses listings").** Only on the
        // PUBLIC branch: the owner view above deliberately still shows a suspended member their own catalogue, because
        // hiding it from them as well makes the platform look broken rather than strict.
        where.push(sellerNotSuspendedSql('l'));
      }
      if (q.categoryId) where.push(`l.category_id = ${p(q.categoryId)}`);
      if (q.category) where.push(`l.category_id IN (SELECT kvc.id FROM categories kvc WHERE kvc.path <@ (SELECT kvp.path FROM categories kvp WHERE kvp.id = ${p(q.category)}))`);
      if (q.regionId) where.push(`l.region_id = ${p(q.regionId)}`);
      if (q.district) where.push(`l.region_id IN (SELECT kvr.id FROM admin_regions kvr WHERE kvr.path <@ (SELECT kvp.path FROM admin_regions kvp WHERE kvp.id = ${p(q.district)}))`);
      if (q.grade === 'none') where.push(`${confirmedGradeIdSql('l')} IS NULL`);
      else if (q.grade) where.push(`${confirmedGradeIdSql('l')} = ${p(q.grade)}::uuid`);
      if (q.saleType) where.push(`l.sale_type = ${p(q.saleType)}`);
      if (q.organic === 'any') where.push(`l.organic_claim IN ('certified','natural')`);
      else if (q.organic) where.push(`l.organic_claim = ${p(q.organic)}`);
      if (q.priceMinMinor) where.push(`l.price_minor >= ${p(q.priceMinMinor)}`);
      if (q.priceMaxMinor) where.push(`l.price_minor <= ${p(q.priceMaxMinor)}`);
      if (q.q) where.push(`l.title ILIKE '%' || ${p(q.q)} || '%'`);
      const filterParams = [...params];   // what the count needs (the cursor, the limit and the day come after)
      const filterWhere = [...where];

      const { order, after } = orderAndAfter(sort, cursor, p);
      const pageWhere = after ? [...where, after] : where;
      const limit = q.limit;
      const limitParam = p(limit + 1); // fetch one extra to detect next page

      const publicCols = owner ? '' : `,
               t.slug AS org_slug, t.display_name AS org_name,
               (SELECT kvo.default_name FROM attribute_options kvo WHERE kvo.id = ${confirmedGradeIdSql('l')}) AS grade_name,
               ${districtNameSql('l')} AS district_name,
               ${licenceRequiredSql('l', p(todayUtc()))} AS licence_required`;
      const sql = `
        SELECT l.id, l.title, l.price_minor, l.currency_code, l.unit_code, l.quantity_available,
               l.organic_claim, l.sale_type, l.region_id, l.seller_user_id, ${US_SQL('l.created_at')} AS created_us, l.status${publicCols}
          FROM listings l${owner ? '' : `
          LEFT JOIN tenants t ON t.id = l.tenant_id`}
         WHERE ${pageWhere.join(' AND ')}
         ORDER BY ${order}
         LIMIT ${limitParam}`;

      const exec = this.replica.forTenant(tenantId);
      const r = await exec.query<Row>(sql, params);
      const rows = r.rows;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const last = page[page.length - 1];
      const nextCursor = hasMore && last
        ? encodeFeedCursor({ s: sort, v: sort === 'newest' ? String(last.created_us) : String(last.price_minor), id: String(last.id) })
        : null;

      // `status` is selected so the OWNER VIEW ("my listings") can render the true lifecycle badge
      // (draft/paused/sold_out/expired/etc) instead of defaulting every row to "live".
      if (owner) {
        const items: ListingCard[] = page.map((row) => ({
          id: row.id, title: row.title, priceMinor: String(row.price_minor),
          currencyCode: row.currency_code, unitCode: row.unit_code,
          quantityAvailable: Number(row.quantity_available),
          organicClaim: row.organic_claim != null && row.organic_claim !== 'none',
          saleType: row.sale_type, regionId: row.region_id ?? null,
          sellerUserId: row.seller_user_id, boosted: false, status: row.status,
        }));
        return { items, total: null, nextCursor };
      }

      // THE PUBLIC ROW — an allow-list: a key reaches a buyer only because it is written here.
      const items: PublicListingCard[] = page.map((row) => {
        const claim = row.organic_claim === 'certified' || row.organic_claim === 'natural' ? row.organic_claim as 'certified' | 'natural' : null;
        return {
          id: String(row.id), title: row.title, priceMinor: String(row.price_minor), currencyCode: String(row.currency_code).trim(),
          unitCode: row.unit_code, quantityAvailable: Number(row.quantity_available),
          organicClaim: claim !== null, organic: claim, saleType: row.sale_type, status: row.status, boosted: false,
          grade: row.grade_name ?? null, district: row.district_name ?? null,
          organisation: row.org_slug && row.org_name ? { slug: row.org_slug, name: row.org_name } : null,
          licenceRequired: row.licence_required === true,
        };
      });

      const counted = await this.countAndFacets(exec, filterWhere, filterParams);
      return { items, nextCursor, totalCap: PUBLIC_LISTING_COUNT_CAP, ...counted };
    });
  }

  /** ONE bounded statement: the capped filtered count, the three facets (withheld above the cap) and 0204's members-only count. */
  private async countAndFacets(
    exec: SqlExecutor, where: string[], params: unknown[],
  ): Promise<{ total: number | null; membersOnlyCount: number | null; facets: ListingFacets | null }> {
    const cp = [...params];
    const capParam = `$${cp.push(PUBLIC_LISTING_COUNT_CAP)}`;
    const sql = `
      WITH f AS MATERIALIZED (
        SELECT ${confirmedGradeIdSql('l')} AS g, l.organic_claim AS o, ${districtIdSql('l')} AS d, l.sale_type::text AS s
          FROM listings l
         WHERE ${where.join(' AND ')}
         LIMIT ${capParam}::int + 1),
      n AS (SELECT count(*)::int AS total FROM f)
      SELECT n.total,
             public_tenant_members_only_count($1::uuid) AS members_only,
             CASE WHEN n.total <= ${capParam}::int THEN (
               SELECT COALESCE(json_agg(json_build_object('id', x.g, 'name', ao.default_name, 'count', x.c) ORDER BY ao.sort_order, ao.default_name), '[]'::json)
                 FROM (SELECT g, count(*)::int AS c FROM f WHERE g IS NOT NULL GROUP BY g) x JOIN attribute_options ao ON ao.id = x.g) END AS grades,
             CASE WHEN n.total <= ${capParam}::int THEN (SELECT count(*)::int FROM f WHERE g IS NULL) END AS ungraded,
             CASE WHEN n.total <= ${capParam}::int THEN (
               SELECT json_build_object('certified', count(*) FILTER (WHERE o = 'certified'), 'natural', count(*) FILTER (WHERE o = 'natural'),
                                        'none', count(*) FILTER (WHERE o IS NULL OR o NOT IN ('certified','natural'))) FROM f) END AS organic,
             CASE WHEN n.total <= ${capParam}::int THEN (
               SELECT COALESCE(json_agg(json_build_object('id', x.d, 'name', ar.default_name, 'count', x.c) ORDER BY x.c DESC, ar.default_name), '[]'::json)
                 FROM (SELECT d, count(*)::int AS c FROM f WHERE d IS NOT NULL GROUP BY d) x JOIN admin_regions ar ON ar.id = x.d) END AS districts,
             CASE WHEN n.total <= ${capParam}::int THEN (
               SELECT COALESCE(json_agg(json_build_object('id', x.s, 'count', x.c) ORDER BY x.c DESC, x.s), '[]'::json)
                 FROM (SELECT s, count(*)::int AS c FROM f GROUP BY s) x) END AS sale_types
        FROM n`;
    const r = await exec.query<Row>(sql, cp);
    const c = r.rows[0];
    if (!c) return { total: null, membersOnlyCount: null, facets: null };
    const total = c.total === null || c.total === undefined ? null : Number(c.total);
    const facetList = (v: unknown): FacetValue[] => (Array.isArray(v) ? v : []).map((x: Row) => ({ id: String(x.id), name: String(x.name), count: Number(x.count) }));
    const facets: ListingFacets | null = c.grades === null || c.grades === undefined ? null : {
      grade: facetList(c.grades), ungraded: Number(c.ungraded ?? 0),
      organic: { certified: Number(c.organic?.certified ?? 0), natural: Number(c.organic?.natural ?? 0), none: Number(c.organic?.none ?? 0) },
      district: facetList(c.districts),
      saleType: (Array.isArray(c.sale_types) ? c.sale_types : []).map((x: Row) => ({ id: String(x.id), count: Number(x.count) })),
    };
    return {
      total,
      membersOnlyCount: c.members_only !== null && c.members_only !== undefined ? Number(c.members_only) : null,
      facets,
    };
  }
}
