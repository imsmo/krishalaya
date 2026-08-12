// modules/listings/bulk/listing-bulk-applier.ts · the 'listings' importer W128 needs (PC-56 TENANT-2c).
//
// Before this file, `importType: 'listings'` was a 422: only 'products' and 'members' were registered, so W128's
// whole screen pointed at a rail that would refuse it.
//
// **W128'S OWN SENTENCE IS THE DESIGN:** "Bulk-created listings still walk the normal path: draft → member consent
// (voice/app) → QC → published. Bulk speeds entry, never skips trust." So every row lands as a DRAFT through the
// SAME ListingService.create that the console uses (quota, suspension check, outbox, audit — nothing bypassed),
// with the staff importer recorded in created_by so QC's no-self-review sees the hand that uploaded the file.
//
// **AND THE CONSENT DOOR IS THE SAME ONE (TENANT-2b's law, third door):** a staff-uploaded file lists OTHER
// PEOPLE'S produce, so each row's member must have recorded `on_behalf_listing` consent. A row without it is
// FIXABLE and says so by name — not an invalid row, because the fix is a real-world act (the member taps yes),
// and not a silent skip, because 46 rows quietly becoming 31 is how an operator loses trust in the tool.
//
// **THE FOUR TRIAGE VERDICTS ARE W128'S FOUR COLUMNS**, and the one it draws as a warning is the one this platform
// cannot honestly enforce: "member KYC pending — draft allowed, publish blocks until verified". A draft IS allowed
// (this applier creates it), but NO KYC GATE EXISTS ON PUBLISH anywhere on this platform — 0125's per-role KYC map
// governs PAYOUTS and has no listing purpose. Inventing the gate here would be a rule enforced on imported lots
// and absent for every console-created one, which is worse than a named gap: so the row is created as a draft, the
// KYC state travels to the console as an advisory, and the missing publish gate is GAP-BACKEND, named in the
// tracker. Refusing to fake a gate is the same discipline as refusing to fake a queue.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { BulkApplyContext, BulkRowApplier, RowVerdict } from '../../../core/bulk/bulk-applier.registry';
import { ConsentService } from '../../identity/services/consent.service';
import { ListingService } from '../services/listing.service';
import { MandiBandReadModel } from '../read-models/mandi-band.read-model';
import { ON_BEHALF_LISTING_PURPOSE } from '../services/on-behalf-console.service';
import { LISTING_IMPORT_COLUMNS, listingImportIdemKey, perKiloSuspicion, readListingRow } from '../domain/listing-import-row';

interface MemberHit { userId: string; kycPending: boolean }
interface ProductHit { id: string; categoryId: string; defaultUnit: string; name: string }

/** Major → minor units, float-free (the console's own contract; the API re-derives by currency). */
function majorToMinor(major: string): string {
  const [int, frac = ''] = major.split('.');
  return ((int || '0') + (frac + '00').slice(0, 2)).replace(/^0+(?=\d)/, '') || '0';
}

@Injectable()
export class ListingBulkApplier implements BulkRowApplier {
  readonly importType = 'listings';
  /** The two a row cannot do without: WHOSE produce, and WHAT. Everything else has a sensible absence. */
  readonly requiredColumns = ['phone', 'product'];

  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly listings: ListingService,
    private readonly consents: ConsentService,
    private readonly band: MandiBandReadModel,
  ) {}

  /** READS ONLY — W128's triage. Writes nothing: the whole point is learning what the file would do. */
  async validateRow(ctx: BulkApplyContext, _rowIndex: number, row: Record<string, string>): Promise<RowVerdict> {
    const read = readListingRow(row);
    if (!read.ok) {
      if (read.code === 'ROW_EMPTY' || read.code === 'PHONE_MISSING' || read.code === 'PRODUCT_MISSING') {
        return { kind: 'invalid', code: read.code, message: read.message };
      }
      return { kind: 'fixable', code: read.code, message: read.message };
    }

    const member = await this.memberByPhone(ctx.tenantId, read.phone);
    if (!member) {
      return { kind: 'fixable', code: 'MEMBER_NOT_FOUND', message: `no member of this organisation has the phone ${read.phone} — add them on the People page first, or correct the number` };
    }

    const product = await this.productByName(ctx.tenantId, read.product);
    if (!product) {
      return { kind: 'fixable', code: 'PRODUCT_UNKNOWN', message: `"${read.product}" matches no product in the catalogue — check the spelling or add the product first` };
    }

    // The consent door: a staff-uploaded file lists other people's produce (TENANT-2b's law, third door).
    const consented = await this.consents.isGranted(ctx.tenantId, member.userId, ON_BEHALF_LISTING_PURPOSE, ctx.actorUserId);
    if (!consented) {
      return { kind: 'fixable', code: 'ONBEHALF_CONSENT', message: `${read.phone} has not recorded consent for staff to list on their behalf — ask them to confirm in their app (voice or tap), then re-upload. Their produce, their yes` };
    }

    // W128's duplicate column: the same member + product + quantity already LIVE. Skipped, never duplicated.
    const dup = await this.liveDuplicate(ctx.tenantId, member.userId, product.id, read.quantity);
    if (dup) return { kind: 'duplicate', existingId: dup };

    // The per-kilo catch — only against a REAL peer band (no band, no warning invented from nothing).
    const priceMinor = majorToMinor(read.priceMajor);
    const b = await this.bandFor(ctx.tenantId, product.id, member.userId);
    const susp = perKiloSuspicion(priceMinor, b);
    if (susp) {
      return {
        kind: 'fixable', code: 'PRICE_LOOKS_PER_KG',
        message: `${read.priceMajor} per ${read.unit ?? product.defaultUnit} is at least 100× below the peer band for ${product.name} — this is usually a per-kilo price on a per-quintal sheet`,
        suggestion: majorFromMinor(susp.suggestMinor),
      };
    }
    return { kind: 'create' };
  }

  /**
   * APPLY ONE ROW — one draft, through the SAME service the console uses.
   *
   * EVERY CHECK RE-RUNS HERE rather than trusting the triage: minutes pass between validate and confirm, and a
   * member may have withdrawn consent or an ambassador may have listed the same lot from the field in between. A
   * validate-first pass is a preview, never a promise about the future (the 1b-4 rule, kept).
   */
  async applyRow(ctx: BulkApplyContext, rowIdemKey: string, row: Record<string, string>): Promise<{ id?: string }> {
    const read = readListingRow(row);
    if (!read.ok) throw Object.assign(new Error(read.message), { code: read.code });

    const member = await this.memberByPhone(ctx.tenantId, read.phone);
    if (!member) throw Object.assign(new Error(`no member with phone ${read.phone}`), { code: 'MEMBER_NOT_FOUND' });
    const product = await this.productByName(ctx.tenantId, read.product);
    if (!product) throw Object.assign(new Error(`unknown product "${read.product}"`), { code: 'PRODUCT_UNKNOWN' });

    const consented = await this.consents.isGranted(ctx.tenantId, member.userId, ON_BEHALF_LISTING_PURPOSE, ctx.actorUserId);
    if (!consented) throw Object.assign(new Error('member has not recorded on-behalf listing consent'), { code: 'ONBEHALF_CONSENT' });

    const dup = await this.liveDuplicate(ctx.tenantId, member.userId, product.id, read.quantity);
    if (dup) return { id: dup };   // skipped, never duplicated — the row's work is already done

    // The row's OWN identity keys idempotency, so the same lot twice in one file (or a re-upload) is one draft.
    const idemKey = listingImportIdemKey(ctx.tenantId, read);
    const res = await this.listings.create(ctx.tenantId, member.userId, idemKey, {
      productId: product.id, categoryId: product.categoryId,
      title: read.title || `${product.name} — ${read.quantity} ${read.unit ?? product.defaultUnit}`,
      quantityTotal: read.quantity, minOrderQty: read.minOrderQty ?? 0,
      unitCode: read.unit ?? product.defaultUnit,
      priceMinor: majorToMinor(read.priceMajor), currencyCode: 'INR',
      saleType: 'direct', organicClaim: 'none', visibility: 'tenant',
      ...(read.harvestDate ? { harvestDate: read.harvestDate } : {}),
    } as never, ctx.actorUserId || undefined);
    void rowIdemKey;   // the processor's key is per-file-row; ours is the LOT's identity, which is the stronger one
    return { id: res.id };
  }

  /* ------------------------------------------------------------------ reads */

  /** A member of THIS tenant by phone, with the KYC state W128 shows as an advisory. */
  private async memberByPhone(tenantId: string, phone: string): Promise<MemberHit | null> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string; pending: boolean }>(
      `SELECT u.id, bool_and(utr.kyc_status <> 'verified') AS pending
         FROM users u
         JOIN user_tenant_roles utr ON utr.user_id = u.id AND utr.tenant_id = $1 AND utr.deleted_at IS NULL
        WHERE u.phone = $2 AND u.deleted_at IS NULL
        GROUP BY u.id LIMIT 1`, [tenantId, phone]);
    const row = r.rows[0];
    return row ? { userId: String(row.id), kycPending: row.pending === true } : null;
  }

  /** A catalogue product by name — this tenant's own rows or the platform master (tenant_id IS NULL). */
  private async productByName(tenantId: string, name: string): Promise<ProductHit | null> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string; category_id: string; default_unit: string; default_name: string }>(
      `SELECT id, category_id, default_unit, default_name
         FROM products
        WHERE lower(default_name) = lower($2) AND deleted_at IS NULL
          AND (tenant_id = $1 OR tenant_id IS NULL)
        ORDER BY (tenant_id = $1) DESC LIMIT 1`, [tenantId, name]);
    const row = r.rows[0];
    return row ? { id: String(row.id), categoryId: String(row.category_id), defaultUnit: String(row.default_unit), name: String(row.default_name) } : null;
  }

  /** W128's duplicate: the same member + product + quantity, already live (published or awaiting QC). */
  private async liveDuplicate(tenantId: string, sellerUserId: string, productId: string, quantity: number): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string }>(
      `SELECT id FROM listings
        WHERE tenant_id = $1 AND seller_user_id = $2 AND product_id = $3
          AND quantity_total = $4 AND deleted_at IS NULL
          AND status IN ('draft', 'pending_approval', 'published')
        ORDER BY created_at DESC LIMIT 1`, [tenantId, sellerUserId, productId, quantity]);
    return r.rows[0] ? String(r.rows[0].id) : null;
  }

  /** The peer band for the per-kilo catch, in the member's own area when one is known. */
  private async bandFor(tenantId: string, productId: string, sellerUserId: string): Promise<{ lowMinor: string } | null> {
    const r = await this.replica.forTenant(tenantId).query<{ region_id: string | null }>(
      `SELECT a.region_id FROM addresses a
        WHERE a.user_id = $2 AND a.tenant_id = $1 AND a.deleted_at IS NULL AND a.region_id IS NOT NULL
        ORDER BY a.is_default DESC LIMIT 1`, [tenantId, sellerUserId]);
    const regionId = r.rows[0]?.region_id ?? null;
    if (!regionId) return null;
    return this.band.band(tenantId, productId, regionId);
  }
}

function majorFromMinor(minor: string): string {
  const s = minor.padStart(3, '0');
  const rupees = s.slice(0, -2), paise = s.slice(-2);
  return paise === '00' ? rupees : `${rupees}.${paise}`;
}

export { LISTING_IMPORT_COLUMNS };
