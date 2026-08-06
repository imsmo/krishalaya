// apps/admin-api/src/modules/catalogue-depth/services/crop-lens.service.ts · the CROP LENS
// (PC-56 ADMIN-3c, canon W023 + W110 — closes DELTA-008 and ADMIN-3-Q4).
//
// TWO THINGS THIS SERVICE REFUSES TO INVENT, and they are the whole reason DELTA-008 needed a decision rather than a
// column:
//
//   1. A CROP'S SEASONS ARE DERIVED FROM ITS SOURCED CALENDARS, and come back NULL when it has none. `[]` would render
//      as "grows in no season"; NULL renders as "unknown". A season we have not sourced is not a season we have ruled
//      out, and the canon's own rule is that agronomy content is sourced, never fabricated.
//   2. THE MANDI MAPPING LANDS ON A PRODUCT. `mandi_prices.product_id` is what the price series keys on, so a
//      category-level mapping would look correct on this screen and resolve to no price on the farmer's Mandi Pulse. The
//      crop row shows a ROLLUP over its products, which is what an operator needs to see; the mapping itself is per
//      product.
//
// Neither `crop_profiles` nor `categories.meta` was created. Migration 0104's header records why.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { EavRepository } from '../repositories/eav.repository';
import {
  assertCalendar, assertMapping, seasonsForCrop, seasonsLabel, mappingRollup,
  isSeason, SEASONS, SYNC_STATES, AGMARKNET_PROVIDER,
} from '../domain/crop-lens';
import {
  InvalidCropCalendarError, InvalidMandiMappingError, CropCalendarNotFoundError, DuplicateCatalogueCodeError,
} from '../domain/catalogue-depth.errors';
import type {
  QueryCropsDto, CreateCalendarDto, UpdateCalendarDto, SetActiveDto, UpsertMappingDto, RemoveMappingDto,
} from '../dto/catalogue-depth.dto';

const CROP_LIMIT = 500;
const CALENDAR_LIMIT = 200;

@Injectable()
export class CropLensService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: EavRepository,
  ) {}

  /* ------------------------------------------------------------------ W023: the lens */

  /**
   * The crop list. Every column is a category column or a join — there is no crops table, and the payload says so, because
   * a consumer that believed otherwise would look for a crops endpoint that will never exist.
   */
  async crops(_q: QueryCropsDto) {
    const rows = await this.repo.cropLens(CROP_LIMIT);
    const items = rows.map((c) => {
      const seasons = seasonsForCrop(
        // the lens returns the distinct seasons directly; wrapped so the derivation lives in ONE place
        ((c.seasons as string[] | null) ?? []).map((season) => ({ season })),
      );
      const productCount = Number(c.productCount ?? 0);
      const mappedCount = Number(c.mappedCount ?? 0);
      const rollup = mappingRollup(
        Array.from({ length: productCount }, (_, i) => ({ productId: String(i), externalId: i < mappedCount ? 'x' : null })),
      );
      return {
        ...c,
        seasons,
        seasonsLabel: seasonsLabel(seasons),
        // stated per row: this crop has no sourced calendar, so we do not know its seasons
        seasonsUnknown: seasons === null,
        mandi: rollup,
      };
    });
    return {
      items,
      seasons: SEASONS,
      basis: 'There is no crops table — crops ARE the crops.* category branch, so this is a filtered lens over categories. '
        + 'Season(s) are DERIVED from each crop\'s sourced calendars and read "unknown" when it has none, because a season '
        + 'we have not sourced is not one we have ruled out. Mandi mapping is per PRODUCT (mandi_prices keys on product_id); '
        + 'the crop row shows a rollup.',
    };
  }

  /** A crop's products and their mapping state — the drill-in behind the rollup badge. */
  async cropMappings(categoryId: string) {
    const products = await this.repo.productsForCrop(categoryId);
    return {
      items: products,
      rollup: mappingRollup(products as Array<{ productId: string; externalId?: string | null }>),
      provider: AGMARKNET_PROVIDER,
      syncStates: SYNC_STATES,
      basis: 'A mapping attaches a PRODUCT to an Agmarknet COMMODITY code (AGM-1101), not a mandi (market) code. A fresh '
        + 'mapping is "pending" until the ingest confirms the code resolves upstream — never "synced" on insert, because '
        + 'nobody has checked it yet.',
      noProductsNote: products.length === 0
        ? 'This crop has no platform products, so there is nothing to map. That is not an unmapped crop — it is a crop nobody has created products for.'
        : null,
    };
  }

  /* ------------------------------------------------------------------ W110: the calendars */

  async calendars(q: { categoryId?: string; season?: string }) {
    if (q.season && !isSeason(q.season)) {
      throw new InvalidCropCalendarError(`season must be one of ${SEASONS.join('|')}`);
    }
    const items = await this.repo.listCalendars({ categoryId: q.categoryId, season: q.season, limit: CALENDAR_LIMIT });
    return {
      items, seasons: SEASONS,
      basis: 'Editorial agronomy reference. Day offsets are RELATIVE TO SOWING and the platform never computes a specific '
        + 'farm\'s current stage — no per-parcel sowing date exists that it would be honest to use, so that stays absent. '
        + 'Every calendar names its source; migration 0104 made that a constraint rather than a convention.',
      sourceRule: 'ICAR, a state agriculture department, or a named institute. Never fabricated.',
    };
  }

  async calendar(id: string) {
    const calendar = await this.repo.getCalendar(id);
    if (!calendar) throw new CropCalendarNotFoundError(id);
    return { calendar, history: await this.repo.listChanges('crop_calendar', id) };
  }

  /**
   * Author a platform-global calendar.
   *
   * THE SOURCE IS CHECKED FIRST — see the domain's own ordering. A perfectly-shaped timeline nobody can attribute is not
   * agronomy, and the schema permitted exactly that until 0104.
   */
  async createCalendar(actor: AdminRequestContext, dto: CreateCalendarDto) {
    const calendar = assertCalendar({
      cropName: dto.cropName, season: dto.season, source: dto.source,
      durationDaysMin: dto.durationDaysMin, durationDaysMax: dto.durationDaysMax,
      stages: dto.stages, categoryId: dto.categoryId, regionId: dto.regionId,
    });
    return this.pool.withTx(async (client) => {
      const created = await this.repo.insertCalendar(client, { ...calendar, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'crop_calendar', entityId: created.id, action: 'created',
        oldValue: null,
        newValue: {
          cropName: calendar.cropName, season: calendar.season, source: calendar.source,
          categoryId: calendar.categoryId, regionId: calendar.regionId,
          stageCount: calendar.stages.length,
          duration: `${calendar.durationDaysMin}-${calendar.durationDaysMax}d`,
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return {
        id: created.id, season: calendar.season, stageCount: calendar.stages.length,
        // said back, because linking is what makes the crop's season derivable
        linkedToCrop: calendar.categoryId !== null,
        linkNote: calendar.categoryId === null
          ? 'Not linked to a crop category, so it will not contribute to that crop\'s derived seasons on W023. Link it to make the season claim traceable.'
          : null,
      };
    });
  }

  async updateCalendar(actor: AdminRequestContext, id: string, dto: UpdateCalendarDto) {
    return this.pool.withTx(async (client) => {
      const before = await this.repo.getCalendar(id);
      if (!before) throw new CropCalendarNotFoundError(id);
      const calendar = assertCalendar({
        cropName: dto.cropName, season: dto.season, source: dto.source,
        durationDaysMin: dto.durationDaysMin, durationDaysMax: dto.durationDaysMax,
        stages: dto.stages, categoryId: dto.categoryId, regionId: dto.regionId,
      });
      const changed = await this.repo.updateCalendar(client, { id, ...calendar, actorUserId: actor.userId });
      if (changed === 0) {
        // a tenant's own calendar is not this console's to edit; the UPDATE is scoped to tenant_id IS NULL
        throw new InvalidCropCalendarError('this calendar is not a platform-global one, so the platform console cannot edit it');
      }
      await this.repo.insertChange(client, {
        entityType: 'crop_calendar', entityId: id, action: 'updated',
        oldValue: {
          season: before.season, source: before.source,
          duration: `${before.durationDaysMin}-${before.durationDaysMax}d`,
          stageCount: Array.isArray(before.stages) ? before.stages.length : 0,
        },
        newValue: {
          season: calendar.season, source: calendar.source,
          duration: `${calendar.durationDaysMin}-${calendar.durationDaysMax}d`,
          stageCount: calendar.stages.length,
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, stageCount: calendar.stages.length };
    });
  }

  /** Deactivate rather than delete: a calendar farmers have planted by must stay readable, and a deactivated one simply
   *  stops contributing to a crop's derived seasons. */
  async setCalendarActive(actor: AdminRequestContext, id: string, dto: SetActiveDto) {
    return this.pool.withTx(async (client) => {
      const before = await this.repo.getCalendar(id);
      if (!before) throw new CropCalendarNotFoundError(id);
      const changed = await this.repo.setCalendarActive(client, id, dto.isActive, actor.userId);
      if (changed === 0) return { id, isActive: dto.isActive, changed: false };
      await this.repo.insertChange(client, {
        entityType: 'crop_calendar', entityId: id,
        action: dto.isActive ? 'activated' : 'deactivated',
        oldValue: { isActive: before.isActive },
        newValue: {
          isActive: dto.isActive,
          effect: dto.isActive
            ? 'contributes to this crop\'s derived seasons again'
            : 'stops contributing to this crop\'s derived seasons; the farmer crop hub no longer serves it',
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, isActive: dto.isActive, changed: true };
    });
  }

  /* ------------------------------------------------------------------ the mandi mapping */

  /**
   * Map a product to an Agmarknet commodity code.
   *
   * THE COLLISION CHECK IS THE INTERESTING PART. `external_entity_refs` has a UNIQUE on
   * (provider, entity_type, external_id), so one commodity code cannot serve two products — and that constraint is
   * correct: two crops both claiming AGM-1101 would make one of them silently show the other's prices. Checked here so
   * the operator gets the name of the product already holding it rather than a constraint violation.
   */
  async upsertMapping(actor: AdminRequestContext, dto: UpsertMappingDto) {
    const mapping = assertMapping({ productId: dto.productId, externalId: dto.externalId });
    const owner = await this.repo.commodityCodeOwner(mapping.externalId);
    if (owner && owner.productId !== mapping.productId) {
      throw new DuplicateCatalogueCodeError('mandi mapping',
        `${mapping.externalId} (already mapped to "${owner.defaultName}" — one commodity code cannot serve two products, or one would silently show the other's prices)`);
    }
    return this.pool.withTx(async (client) => {
      await this.repo.upsertMapping(client, { ...mapping, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'mandi_mapping', entityId: mapping.productId, action: owner ? 'updated' : 'created',
        oldValue: owner ? { externalId: mapping.externalId } : null,
        newValue: {
          provider: AGMARKNET_PROVIDER, productId: mapping.productId, externalId: mapping.externalId,
          syncStatus: 'pending',
          effect: 'this product will resolve to that commodity\'s price series once the ingest confirms the code',
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return {
        productId: mapping.productId, externalId: mapping.externalId,
        syncStatus: 'pending' as const,
        // NOT "mapped and working" — nobody has checked that the code resolves upstream
        note: 'Recorded as pending. It becomes a working mapping when the price ingest confirms the commodity code resolves.',
      };
    });
  }

  async removeMapping(actor: AdminRequestContext, productId: string, dto: RemoveMappingDto) {
    return this.pool.withTx(async (client) => {
      const changed = await this.repo.deleteMapping(client, productId, actor.userId);
      if (changed === 0) throw new InvalidMandiMappingError('that product has no Agmarknet mapping to remove');
      await this.repo.insertChange(client, {
        entityType: 'mandi_mapping', entityId: productId, action: 'deactivated',
        oldValue: null,
        newValue: { effect: 'the product no longer resolves to any Agmarknet price series; Mandi Pulse will show nothing for it rather than a wrong price' },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { productId, removed: true };
    });
  }
}
