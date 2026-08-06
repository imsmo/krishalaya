// apps/admin-api/src/modules/catalogue-depth/services/eav-admin.service.ts · the EAV definition plane's writes
// (PC-56 ADMIN-3, canon W020's bindings tab, W024, W025, W026, W027).
//
// EVERY MUTATION IN THIS FILE: ONE TRANSACTION, ONE AUDIT ROW, ONE MANDATORY REASON. That sentence is the wave.
//
// Before this, `catalogue-depth.service.ts` could create a unit and deactivate one with no transaction, no reason
// parameter and no `catalogue_changes` row — while its sibling module `global-catalogue-ops` required a mandatory audit
// reason on every single mutation of the same domain. Two modules, one taxonomy, opposite standards. And the unaudited
// one was the module that touches UNIT CONVERSION FACTORS: a bigha is 2.5 acres in Gujarat and about 1.6 in UP, the
// factor multiplies every quoted quantity on the platform, and somebody could change it leaving no trace of who or why.
// Migration 0102 widened `catalogue_changes` so the trail is now possible; this file makes it mandatory.
//
// THE CHECKER GATE IS REPORTED, NOT HIDDEN. The canon says data_type and validation changes on a bound attribute are
// checker-gated. Rather than silently refusing, `updateAttribute` computes the CONSEQUENCES (what re-interpretation the
// change performs, how many categories it touches) and refuses with them named — so the operator learns what they were
// about to do. A confirmed request carries `acknowledgeConsequences` and is then permitted and audited WITH the
// consequence list, which is what makes the record defensible six months later.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { EavRepository } from '../repositories/eav.repository';
import {
  assertAttribute, assertAttributeEdit, assertOption, assertBinding, assertUnit, assertConversion,
  inconsistentPairs, isDataType, usesOptions, DATA_TYPES, UNIT_CLASSES,
  type DataType,
} from '../domain/eav';
import {
  InvalidAttributeError, InvalidUnitError, AttributeNotFoundError, UnitNotFoundError,
  DuplicateCatalogueCodeError, CheckerRequiredError,
} from '../domain/catalogue-depth.errors';
import type {
  CreateAttributeDto, UpdateAttributeDto, SetActiveDto, CreateOptionDto, UpdateOptionDto,
  CreateBindingDto, UpdateBindingDto, UnbindDto, CreateUnitDto, UpsertConversionDto,
  QueryAttributesDto,
} from '../dto/catalogue-depth.dto';

const LIST_LIMIT = 200;
const OPTION_LIMIT = 500;

@Injectable()
export class EavAdminService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: EavRepository,
  ) {}

  /* ------------------------------------------------------------------ reads */

  /** W026's list. The vocabularies travel with it so a console never hard-codes a type list that could drift from 0004's
   *  CHECK. */
  async attributes(q: QueryAttributesDto) {
    if (q.dataType && !isDataType(q.dataType)) {
      throw new InvalidAttributeError(`dataType must be one of ${DATA_TYPES.join('|')}`);
    }
    const items = await this.repo.listAttributes({
      search: q.q, dataType: q.dataType, withUnit: q.withUnit === 'true',
      limit: Math.min(q.limit ?? 50, LIST_LIMIT),
    });
    return {
      items, dataTypes: DATA_TYPES, unitClasses: UNIT_CLASSES,
      // stated on the payload, because Golden Law 9 is the one rule about this table a consumer cannot infer from it
      basis: 'Attributes are DESCRIPTIVE ONLY — they describe produce and power search facets, and never set a price, a fee or a state (Golden Law 9). validation may not contain money or state keys, and the API refuses them by name.',
    };
  }

  /** W027's editor. Carries the binding count because that is what decides whether an edit needs a checker. */
  async attribute(id: string) {
    const attribute = await this.repo.getAttribute(id);
    if (!attribute) throw new AttributeNotFoundError(id);
    const type = attribute.dataType as DataType;
    const [options, history] = await Promise.all([
      usesOptions(type) ? this.repo.listOptions({ attributeId: id, limit: OPTION_LIMIT }) : Promise.resolve([]),
      this.repo.listChanges('attribute', id),
    ]);
    return {
      attribute, options, history,
      dataTypes: DATA_TYPES,
      // the canon's "immutable after first binding" helper, as a fact rather than a hint
      codeEditable: false,
      // so the console can show the warning BEFORE the operator types, not after they submit
      boundCount: Number(attribute.boundTo ?? 0),
      checkerNote: Number(attribute.boundTo ?? 0) > 0
        ? 'This attribute is bound. Changing its type, unit, or tightening its validation re-interprets values already stored against it, so those edits need a second pair of eyes.'
        : null,
      optionsApplicable: usesOptions(type),
    };
  }

  async options(attributeId: string, categoryId?: string) {
    const attribute = await this.repo.getAttribute(attributeId);
    if (!attribute) throw new AttributeNotFoundError(attributeId);
    const items = await this.repo.listOptions({ attributeId, categoryId, limit: OPTION_LIMIT });
    return {
      items,
      attribute: { id: attribute.id, code: attribute.code, dataType: attribute.dataType },
      applicable: usesOptions(attribute.dataType as DataType),
      // W024's own note, served rather than hard-coded in the console
      scopeNote: 'An option with no category is offered for this attribute everywhere (the shared set, e.g. grade). One with a category is offered only under that branch, which is how a wheat variety stays out of a groundnut listing.',
    };
  }

  /** W020's bindings tab, inherited rows included. */
  async bindings(categoryId: string) {
    const items = await this.repo.listBindings(categoryId);
    const inherited = items.filter((b) => b.isLocal !== true).length;
    return {
      items,
      localCount: items.length - inherited,
      inheritedCount: inherited,
      // the canon shows "(2 inherited)" in its table footer; the count is served so the wording cannot drift
      note: inherited > 0
        ? `${inherited} of these are inherited from an ancestor category and are edited where they are bound, not here — a listing form applies them all the same.`
        : null,
    };
  }

  /** W025. The inconsistency report is the interesting part: two conversions can each be plausible and disagree. */
  async units(q: { activeOnly?: boolean; unitClass?: string }) {
    const [items, conversions] = await Promise.all([
      this.repo.listUnits({ activeOnly: q.activeOnly, unitClass: q.unitClass, limit: LIST_LIMIT }),
      this.repo.listConversions(q.unitClass),
    ]);
    const inconsistent = inconsistentPairs(conversions as Array<{ fromUnit: string; toUnit: string; factor: string }>);
    return {
      items, conversions, unitClasses: UNIT_CLASSES,
      // reported, not refused: an inverse may legitimately be absent, and exact reciprocity is impossible at 10 dp
      inconsistentPairs: inconsistent,
      inconsistentNote: inconsistent.length > 0
        ? 'These pairs disagree with their own inverses. Both cannot be right, and every quantity converted through them is wrong in one direction.'
        : null,
      regionalNote: 'Regional truth matters: a bigha is about 2.5 to the acre in Gujarat and about 1.6 in Uttar Pradesh. A factor edit changes quoted quantities platform-wide, so it is audited with a mandatory reason.',
    };
  }

  async unitHistory(code: string) {
    const unit = await this.repo.getUnit(code);
    if (!unit) throw new UnitNotFoundError(code);
    return { unit, history: await this.repo.listChanges('unit', code) };
  }

  /* ------------------------------------------------------------------ attribute writes (W026/W027) */

  async createAttribute(actor: AdminRequestContext, dto: CreateAttributeDto) {
    const attribute = assertAttribute({
      code: dto.code, defaultName: dto.defaultName, dataType: dto.dataType,
      unitCode: dto.unitCode ?? null, validation: dto.validation ?? null,
    });
    if (attribute.unitCode) {
      const unit = await this.repo.getUnit(attribute.unitCode);
      // a dangling unit_code would pass the FK only if the unit exists; naming it here gives a readable 422 instead
      if (!unit) throw new UnitNotFoundError(attribute.unitCode);
    }
    if (await this.repo.attributeCodeExists(attribute.code)) {
      throw new DuplicateCatalogueCodeError('attribute', attribute.code);
    }
    return this.pool.withTx(async (client) => {
      const created = await this.repo.insertAttribute(client, { ...attribute, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'attribute', entityId: created.id, action: 'created',
        oldValue: null,
        newValue: { code: attribute.code, dataType: attribute.dataType, unitCode: attribute.unitCode, validation: attribute.validation },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id: created.id, code: attribute.code, dataType: attribute.dataType };
    });
  }

  /**
   * Edit an attribute. THE CHECKER GATE LIVES HERE.
   *
   * The binding count is read INSIDE the transaction, under the row lock, because it decides whether the edit needs a
   * checker — reading it outside would let a binding land between the decision and the write, which is the one race that
   * matters: an attribute that was safe to retype a moment ago now describes real listings.
   */
  async updateAttribute(actor: AdminRequestContext, id: string, dto: UpdateAttributeDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getAttributeForUpdate(client, id);
      if (!current) throw new AttributeNotFoundError(id);

      const edit = assertAttributeEdit(
        { defaultName: dto.defaultName, dataType: dto.dataType, unitCode: dto.unitCode, validation: dto.validation },
        {
          code: String(current.code), dataType: current.dataType as DataType,
          unitCode: (current.unitCode as string | null) ?? null,
          validation: (current.validation as Record<string, unknown>) ?? {},
        },
        Number(current.boundTo ?? 0),
      );

      if (edit.needsChecker && dto.acknowledgeConsequences !== true) {
        // refused WITH the reasons, so the operator learns what the change does rather than being told "no"
        throw new CheckerRequiredError(edit.consequences);
      }
      if (edit.unitCode) {
        const unit = await this.repo.getUnit(edit.unitCode);
        if (!unit) throw new UnitNotFoundError(edit.unitCode);
      }

      await this.repo.updateAttribute(client, {
        id, defaultName: edit.defaultName, dataType: edit.dataType,
        unitCode: 'unitCode' in edit ? edit.unitCode : undefined,
        validation: edit.validation, actorUserId: actor.userId,
      });
      await this.repo.insertChange(client, {
        entityType: 'attribute', entityId: id,
        action: edit.dataType || edit.validation || 'unitCode' in edit ? 'updated' : 'renamed',
        oldValue: { dataType: current.dataType, unitCode: current.unitCode, validation: current.validation, defaultName: current.defaultName },
        newValue: {
          dataType: edit.dataType ?? current.dataType,
          unitCode: 'unitCode' in edit ? edit.unitCode : current.unitCode,
          validation: edit.validation ?? current.validation,
          defaultName: edit.defaultName ?? current.defaultName,
          // the consequences go in the RECORD, not just in the refusal — this is what makes the change defensible later
          consequences: edit.consequences.length > 0 ? edit.consequences : undefined,
          boundCategoriesAtEdit: Number(current.boundTo ?? 0),
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, consequences: edit.consequences, checkerAcknowledged: edit.needsChecker };
    });
  }

  async setAttributeActive(actor: AdminRequestContext, id: string, dto: SetActiveDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getAttributeForUpdate(client, id);
      if (!current) throw new AttributeNotFoundError(id);
      const changed = await this.repo.setAttributeActive(client, id, dto.isActive, actor.userId);
      if (changed === 0) {
        // not an error: the request was legal and the state already matched. Reported so a caller does not double-count.
        return { id, isActive: dto.isActive, changed: false };
      }
      await this.repo.insertChange(client, {
        entityType: 'attribute', entityId: id,
        action: dto.isActive ? 'activated' : 'deactivated',
        oldValue: { isActive: current.isActive }, newValue: { isActive: dto.isActive, boundCategories: Number(current.boundTo ?? 0) },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, isActive: dto.isActive, changed: true };
    });
  }

  /* ------------------------------------------------------------------ option writes (W024) */

  async createOption(actor: AdminRequestContext, attributeId: string, dto: CreateOptionDto) {
    const attribute = await this.repo.getAttribute(attributeId);
    if (!attribute) throw new AttributeNotFoundError(attributeId);
    const option = assertOption(
      { code: dto.code, defaultName: dto.defaultName, sortOrder: dto.sortOrder, categoryId: dto.categoryId },
      attribute.dataType as DataType,
    );
    if (await this.repo.optionCodeExists(attributeId, option.code, option.categoryId)) {
      throw new DuplicateCatalogueCodeError('option', option.code);
    }
    return this.pool.withTx(async (client) => {
      const created = await this.repo.insertOption(client, { attributeId, ...option, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'attribute_option', entityId: created.id, action: 'created',
        oldValue: null,
        newValue: { attributeId, attributeCode: attribute.code, code: option.code, categoryId: option.categoryId, scope: option.categoryId ? 'category' : 'global' },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id: created.id, code: option.code, scope: option.categoryId ? 'category' : 'global' };
    });
  }

  async updateOption(actor: AdminRequestContext, id: string, dto: UpdateOptionDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getOptionForUpdate(client, id);
      if (!current) throw new InvalidAttributeError(`option ${id} not found`);
      const defaultName = dto.defaultName !== undefined ? String(dto.defaultName).trim() : undefined;
      if (defaultName !== undefined && (defaultName.length < 1 || defaultName.length > 150)) {
        throw new InvalidAttributeError('option name must be 1–150 characters');
      }
      const sortOrder = dto.sortOrder !== undefined ? Number(dto.sortOrder) : undefined;
      await this.repo.updateOption(client, { id, defaultName, sortOrder, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'attribute_option', entityId: id, action: 'updated',
        oldValue: { defaultName: current.defaultName, sortOrder: current.sortOrder },
        newValue: { defaultName: defaultName ?? current.defaultName, sortOrder: sortOrder ?? current.sortOrder },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, changed: true };
    });
  }

  async setOptionActive(actor: AdminRequestContext, id: string, dto: SetActiveDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getOptionForUpdate(client, id);
      if (!current) throw new InvalidAttributeError(`option ${id} not found`);
      const changed = await this.repo.setOptionActive(client, id, dto.isActive, actor.userId);
      if (changed === 0) return { id, isActive: dto.isActive, changed: false };
      await this.repo.insertChange(client, {
        entityType: 'attribute_option', entityId: id,
        action: dto.isActive ? 'activated' : 'deactivated',
        oldValue: { isActive: current.isActive },
        // stated in the record: deactivating hides an option from NEW listings and rewrites no history
        newValue: { isActive: dto.isActive, effect: 'hidden from new listings only; existing listings keep the value' },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, isActive: dto.isActive, changed: true };
    });
  }

  /* ------------------------------------------------------------------ binding writes (W020's tab) */

  async bind(actor: AdminRequestContext, categoryId: string, dto: CreateBindingDto) {
    const binding = assertBinding({
      attributeId: dto.attributeId, isRequired: dto.isRequired, showInFilters: dto.showInFilters,
      showOnCard: dto.showOnCard, condition: dto.condition, sortOrder: dto.sortOrder,
    });
    const attribute = await this.repo.getAttribute(binding.attributeId);
    if (!attribute) throw new AttributeNotFoundError(binding.attributeId);
    if (attribute.isActive !== true) {
      throw new InvalidAttributeError(`attribute ${attribute.code} is inactive — reactivate it before binding it to a category`);
    }
    // A REQUIRED OPTION ATTRIBUTE WITH NO OPTIONS IS AN UNFILLABLE FORM. The canon says it on W024: "add at least one
    // variety before enabling the required binding". Refused here rather than discovered by the first farmer to try.
    if (binding.isRequired && usesOptions(attribute.dataType as DataType) && Number(attribute.optionCount ?? 0) === 0) {
      throw new InvalidAttributeError(
        `${attribute.code} is a required ${attribute.dataType} attribute with no options — a farmer could never satisfy it. Add at least one option first.`);
    }
    if (await this.repo.bindingExists(categoryId, binding.attributeId)) {
      throw new DuplicateCatalogueCodeError('binding', String(attribute.code));
    }
    return this.pool.withTx(async (client) => {
      const created = await this.repo.insertBinding(client, { categoryId, ...binding, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'category_attribute', entityId: created.id,
        // 'bound', not 'created' — 0102 added the verb precisely so this row reads correctly
        action: 'bound',
        oldValue: null,
        newValue: {
          categoryId, attributeId: binding.attributeId, attributeCode: attribute.code,
          isRequired: binding.isRequired, showInFilters: binding.showInFilters, showOnCard: binding.showOnCard,
          condition: binding.condition,
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id: created.id, attributeCode: attribute.code, isRequired: binding.isRequired };
    });
  }

  async updateBinding(actor: AdminRequestContext, id: string, dto: UpdateBindingDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getBindingForUpdate(client, id);
      if (!current) throw new InvalidAttributeError(`binding ${id} not found`);
      const binding = assertBinding({
        attributeId: String(current.attributeId), isRequired: dto.isRequired, showInFilters: dto.showInFilters,
        showOnCard: dto.showOnCard, condition: dto.condition, sortOrder: dto.sortOrder,
      });
      await this.repo.updateBinding(client, { id, ...binding, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'category_attribute', entityId: id, action: 'updated',
        oldValue: {
          isRequired: current.isRequired, showInFilters: current.showInFilters,
          showOnCard: current.showOnCard, condition: current.condition,
        },
        newValue: {
          isRequired: binding.isRequired, showInFilters: binding.showInFilters,
          showOnCard: binding.showOnCard, condition: binding.condition,
          attributeCode: current.attributeCode, categoryCode: current.categoryCode,
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, isRequired: binding.isRequired };
    });
  }

  /** Unbind. A SOFT delete, and audited as `unbound` rather than `deactivated` — the attribute is untouched, only its
   *  relationship to this category ends. */
  async unbind(actor: AdminRequestContext, id: string, dto: UnbindDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getBindingForUpdate(client, id);
      if (!current) throw new InvalidAttributeError(`binding ${id} not found`);
      const changed = await this.repo.softDeleteBinding(client, id, actor.userId);
      if (changed === 0) return { id, changed: false };
      await this.repo.insertChange(client, {
        entityType: 'category_attribute', entityId: id, action: 'unbound',
        oldValue: {
          attributeCode: current.attributeCode, categoryCode: current.categoryCode,
          isRequired: current.isRequired, condition: current.condition,
        },
        newValue: { effect: 'new listings in this category are no longer asked for this attribute; existing values are kept and stay readable' },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { id, changed: true, attributeCode: current.attributeCode };
    });
  }

  /* ------------------------------------------------------------------ unit writes (W025) */

  /** The write that previously had no transaction, no reason and no audit row. */
  async createUnit(actor: AdminRequestContext, dto: CreateUnitDto) {
    const unit = assertUnit({ code: dto.code, defaultName: dto.defaultName, unitClass: dto.unitClass });
    if (await this.repo.getUnit(unit.code)) throw new DuplicateCatalogueCodeError('unit', unit.code);
    return this.pool.withTx(async (client) => {
      await this.repo.insertUnit(client, { ...unit, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'unit', entityId: unit.code, action: 'created',
        oldValue: null, newValue: { code: unit.code, unitClass: unit.unitClass, defaultName: unit.defaultName },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { code: unit.code, unitClass: unit.unitClass };
    });
  }

  async setUnitActive(actor: AdminRequestContext, code: string, dto: SetActiveDto) {
    return this.pool.withTx(async (client) => {
      const current = await this.repo.getUnit(code);
      if (!current) throw new UnitNotFoundError(code);
      const changed = await this.repo.setUnitActive(client, code, dto.isActive, actor.userId);
      if (changed === 0) return { code, isActive: dto.isActive, changed: false };
      await this.repo.insertChange(client, {
        entityType: 'unit', entityId: code,
        action: dto.isActive ? 'activated' : 'deactivated',
        oldValue: { isActive: current.isActive }, newValue: { isActive: dto.isActive },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return { code, isActive: dto.isActive, changed: true };
    });
  }

  /**
   * Set a conversion factor — the most consequential number in this domain.
   *
   * The factor stays a STRING the whole way down (see the domain's `assertConversion`). The cross-class refusal and the
   * positive/reflexive checks are 0102's own constraints; they are ALSO checked here so the operator gets a sentence
   * rather than a Postgres exception, and the trigger remains as the thing no code path can bypass.
   */
  async upsertConversion(actor: AdminRequestContext, dto: UpsertConversionDto) {
    const conversion = assertConversion({ fromUnit: dto.fromUnit, toUnit: dto.toUnit, factor: dto.factor });
    const [from, to] = await Promise.all([this.repo.getUnit(conversion.fromUnit), this.repo.getUnit(conversion.toUnit)]);
    if (!from) throw new UnitNotFoundError(conversion.fromUnit);
    if (!to) throw new UnitNotFoundError(conversion.toUnit);
    if (from.unitClass !== to.unitClass) {
      throw new InvalidUnitError(
        `cannot convert ${conversion.fromUnit} (${from.unitClass}) to ${conversion.toUnit} (${to.unitClass}) — a conversion only exists within one unit class`);
    }
    return this.pool.withTx(async (client) => {
      const previous = await this.repo.getConversionForUpdate(client, conversion.fromUnit, conversion.toUnit);
      await this.repo.upsertConversion(client, { ...conversion, actorUserId: actor.userId });
      await this.repo.insertChange(client, {
        entityType: 'unit_conversion',
        entityId: `${conversion.fromUnit}->${conversion.toUnit}`,
        action: previous ? 'updated' : 'created',
        oldValue: previous ? { factor: previous.factor } : null,
        newValue: {
          factor: conversion.factor, unitClass: from.unitClass,
          // recorded because it is what makes the edit consequential rather than clerical
          effect: 'every quantity quoted through this pair changes from the moment this commits',
        },
        reason: dto.reason, actorUserId: actor.userId,
      });
      return {
        fromUnit: conversion.fromUnit, toUnit: conversion.toUnit,
        factor: conversion.factor, previousFactor: previous?.factor ?? null,
      };
    });
  }
}
