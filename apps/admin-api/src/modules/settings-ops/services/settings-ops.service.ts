// apps/admin-api/src/modules/settings-ops/services/settings-ops.service.ts · W103 (PC-56 ADMIN-11).
//
// The plane that did not exist. Every write: one ACID transaction, the audit row and the config-history row inside it
// (Law 4), a reason of real length, and a second administrator on money-path and security keys.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { SettingsRepository } from '../repositories/settings.repository';
import {
  DRY_RUN_IS_COMPUTED_NOT_STORED, IMPACT_SIMULATION_OWNER, RiskClass, ValueType,
  assertValue, blastRadius, isTenantOverridable, requiresChecker,
} from '../domain/setting-value';
import {
  DuplicateSettingError, SettingCheckerRequiredError, SettingNotFoundError, SettingRetypeUnsafeError,
} from '../domain/settings-ops.errors';

@Injectable()
export class SettingsOpsService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: SettingsRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  async list(q: { prefix?: string; riskClass?: string; cursor?: string; limit: number }) {
    const rows = await this.repo.list(q);
    return {
      data: rows.map((r) => ({
        ...r,
        // **THE TWO FIELDS THIS PLANE EXISTS TO SEPARATE.** Before 0121 there was one column, so "what did we ship" and
        // "what did somebody set on 9 July" were the same value and only the second survived.
        onShippedDefault: r.platformValue === null,
        tenantOverridable: isTenantOverridable(r.scope),
        needsChecker: requiresChecker(r.riskClass),
      })),
      meta: {
        nextCursor: rows.length === q.limit && rows.length > 0 ? rows[rows.length - 1].key : null,
        dryRunNote: DRY_RUN_IS_COMPUTED_NOT_STORED,
        impactSimulationOwner: IMPACT_SIMULATION_OWNER,
      },
    };
  }

  async get(key: string) {
    const row = await this.repo.get(key);
    if (!row) throw new SettingNotFoundError(key);
    const [radius, history] = await Promise.all([this.repo.radius(key), this.repo.history(key)]);
    return {
      ...row,
      onShippedDefault: row.platformValue === null,
      tenantOverridable: isTenantOverridable(row.scope),
      needsChecker: requiresChecker(row.riskClass),
      // Computed on read, never stored: a dry run approved on Thursday from Monday's numbers describes a world that has
      // moved.
      dryRun: blastRadius(radius.tenantsTotal, radius.overridesShadowing),
      history,
    };
  }

  /** **A NEW SETTING IS AN INSERT, NEVER A MIGRATION** — W103's own sentence, and the reason this route exists. */
  async define(actor: AdminRequestContext, dto: {
    key: string; valueType: ValueType; scope: string; riskClass: RiskClass;
    defaultValue?: unknown; description?: string; lockNote?: string; reason: string;
  }) {
    assertValue(dto.valueType, dto.defaultValue);
    if (await this.repo.get(dto.key)) throw new DuplicateSettingError(dto.key);
    return this.pool.withTx(async (c) => {
      await this.repo.define(c, {
        key: dto.key, valueType: dto.valueType, scope: dto.scope, riskClass: dto.riskClass,
        defaultValue: dto.defaultValue, description: dto.description?.trim() || null,
        lockNote: dto.lockNote?.trim() || null,
      });
      await this.repo.recordChange(c, {
        key: dto.key, action: 'defined', oldValue: null, newValue: dto.defaultValue, reason: dto.reason,
        actorAdminId: actor.userId, checkerAdminId: null, tenantsAffected: null, overridesShadowing: null,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'settings.defined', entityType: 'setting_definition', entityId: null,
        newValue: { key: dto.key, valueType: dto.valueType, scope: dto.scope, riskClass: dto.riskClass },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { key: dto.key, defined: true };
    });
  }

  /**
   * Set the platform's value.
   *
   * **THE CHECKER IS A SEPARATE ADMINISTRATOR ON MONEY-PATH AND SECURITY KEYS**, and the request must name them. A
   * single-call write with both names would be one person typing two ids, so `approvedByAdminId` is the CALLER and
   * `proposedByAdminId` comes from the pending proposal — the same shape the other fourteen sites use.
   */
  async setValue(actor: AdminRequestContext, key: string, dto: {
    // Optional in the type because zod infers `z.unknown()` that way; `assertValue` refuses undefined for all five
    // value types, so a call with nothing to set is rejected with the message that names the expected type.
    value?: unknown; reason: string; proposedByAdminId?: string;
  }) {
    return this.pool.withTx(async (c) => {
      const row = await this.repo.getForUpdate(c, key);
      if (!row) throw new SettingNotFoundError(key);
      assertValue(row.valueType as ValueType, dto.value);
      const needsChecker = requiresChecker(row.riskClass);

      if (needsChecker) {
        if (!dto.proposedByAdminId) {
          throw new SettingCheckerRequiredError(key,
            `'${key}' is a ${row.riskClass.replace('_', '-')} setting: it takes two administrators. One proposes with a `
            + 'reason, a different one approves — and the approver is whoever calls this route.');
        }
        // FIFTEENTH site's shared helper, so the rule reads identically to the other fourteen.
        assertSecondPerson(`setting ${key}`, dto.proposedByAdminId, actor.userId,
          `'${key}' is a ${row.riskClass.replace('_', '-')} setting: the proposer cannot be the approver.`);
      }

      const radius = await this.repo.radius(key);
      const blast = blastRadius(radius.tenantsTotal, radius.overridesShadowing);

      await this.repo.setPlatformValue(c, {
        key, value: dto.value, setByAdminId: actor.userId, reason: dto.reason,
        requiresChecker: needsChecker,
        proposedByAdminId: needsChecker ? dto.proposedByAdminId ?? null : null,
        approvedByAdminId: needsChecker ? actor.userId : null,
      });
      await this.repo.recordChange(c, {
        key, action: 'value_set',
        // The value that was SERVING, which is the platform value if one was set and the shipped default otherwise. A
        // history row reading `null → 12` would leave a reader unable to tell 12-from-default from 12-from-24.
        oldValue: row.platformValue ?? row.defaultValue,
        newValue: dto.value, reason: dto.reason,
        actorAdminId: actor.userId, checkerAdminId: needsChecker ? (dto.proposedByAdminId ?? null) : null,
        tenantsAffected: blast.tenantsAffected, overridesShadowing: blast.overridesShadowing,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'settings.value_set', entityType: 'setting_definition', entityId: null,
        oldValue: { key, value: row.platformValue ?? row.defaultValue },
        newValue: { key, value: dto.value, tenantsAffected: blast.tenantsAffected },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { key, value: dto.value, dryRun: blast, checkerRequired: needsChecker };
    });
  }

  /** Back to the shipped default. Same checker rule — reverting a money-path key is as consequential as setting it, and
   *  a revert that needed one person would be the way round a two-person rule. */
  async revert(actor: AdminRequestContext, key: string, dto: { reason: string; proposedByAdminId?: string }) {
    return this.pool.withTx(async (c) => {
      const row = await this.repo.getForUpdate(c, key);
      if (!row) throw new SettingNotFoundError(key);
      const needsChecker = requiresChecker(row.riskClass);
      if (needsChecker) {
        if (!dto.proposedByAdminId) {
          throw new SettingCheckerRequiredError(key,
            `reverting '${key}' takes two administrators for the same reason setting it does — a revert that needed one `
            + 'person would be the way around the rule.');
        }
        assertSecondPerson(`reverting ${key}`, dto.proposedByAdminId, actor.userId,
          'the operator who proposed the revert cannot approve it.');
      }
      const reverted = await this.repo.revertPlatformValue(c, key, actor.userId);
      const radius = await this.repo.radius(key);
      const blast = blastRadius(radius.tenantsTotal, radius.overridesShadowing);
      await this.repo.recordChange(c, {
        key, action: 'value_reverted', oldValue: row.platformValue, newValue: row.defaultValue, reason: dto.reason,
        actorAdminId: actor.userId, checkerAdminId: needsChecker ? (dto.proposedByAdminId ?? null) : null,
        tenantsAffected: blast.tenantsAffected, overridesShadowing: blast.overridesShadowing,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'settings.value_reverted', entityType: 'setting_definition', entityId: null,
        oldValue: { key, value: row.platformValue }, newValue: { key, value: row.defaultValue },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      // `reverted:false` when there was no platform value — an honest no-op rather than a 404, because the caller's
      // intent ("serve the shipped default") is already satisfied.
      return { key, reverted, value: row.defaultValue };
    });
  }

  /** **A RETYPE THAT WOULD ORPHAN LIVE TENANT VALUES IS REFUSED.** `tenant_settings.value` is jsonb, so the database
   *  will not catch `int → bool` on a key 312 tenants have set — every one of them would read a value their own code
   *  cannot parse, and nothing would surface it until something broke in their console. */
  async retype(actor: AdminRequestContext, key: string, dto: { valueType: ValueType; reason: string }) {
    const row = await this.repo.get(key);
    if (!row) throw new SettingNotFoundError(key);
    const casualties = await this.repo.retypeCasualties(key, dto.valueType);
    if (casualties > 0) throw new SettingRetypeUnsafeError(key, casualties);
    return this.pool.withTx(async (c) => {
      await this.repo.retype(c, key, dto.valueType);
      await this.repo.recordChange(c, {
        key, action: 'retyped', oldValue: { valueType: row.valueType }, newValue: { valueType: dto.valueType },
        reason: dto.reason, actorAdminId: actor.userId, checkerAdminId: null,
        tenantsAffected: null, overridesShadowing: row.overrideCount,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'settings.retyped', entityType: 'setting_definition', entityId: null,
        oldValue: { valueType: row.valueType }, newValue: { valueType: dto.valueType },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      // The SHIPPED DEFAULT is deliberately not re-validated or rewritten: it is a historical fact, and if it no longer
      // satisfies the new type the console shows that rather than this silently editing it.
      return { key, valueType: dto.valueType, shippedDefaultStillValid: this.stillValid(dto.valueType, row.defaultValue) };
    });
  }

  private stillValid(type: ValueType, value: unknown): boolean {
    try { assertValue(type, value); return true; } catch { return false; }
  }

  /** Re-classify a key's risk. **Raising it needs no checker; LOWERING it does** — moving a key out of `money_path`
   *  removes the two-person rule from every future change to it, so a single operator could de-classify a key and then
   *  change it alone. That is the one edit on this plane that can disable a control. */
  async reclassify(actor: AdminRequestContext, key: string, dto: {
    riskClass: RiskClass; lockNote?: string; reason: string; proposedByAdminId?: string;
  }) {
    const row = await this.repo.get(key);
    if (!row) throw new SettingNotFoundError(key);
    const lowering = requiresChecker(row.riskClass) && !requiresChecker(dto.riskClass);
    if (lowering) {
      if (!dto.proposedByAdminId) {
        throw new SettingCheckerRequiredError(key,
          `moving '${key}' out of ${row.riskClass.replace('_', '-')} removes the two-person rule from every future `
          + 'change to it, so it takes two people itself. Raising a risk class does not.');
      }
      assertSecondPerson(`de-classifying ${key}`, dto.proposedByAdminId, actor.userId,
        'lowering a risk class disables a control, so it takes the same two people the control protects.');
    }
    return this.pool.withTx(async (c) => {
      await this.repo.setRiskClass(c, key, dto.riskClass, dto.lockNote?.trim() || row.lockNote);
      await this.repo.recordChange(c, {
        key, action: requiresChecker(dto.riskClass) ? 'locked' : 'unlocked',
        oldValue: { riskClass: row.riskClass }, newValue: { riskClass: dto.riskClass },
        reason: dto.reason, actorAdminId: actor.userId,
        checkerAdminId: lowering ? (dto.proposedByAdminId ?? null) : null,
        tenantsAffected: null, overridesShadowing: null,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'settings.reclassified', entityType: 'setting_definition', entityId: null,
        oldValue: { riskClass: row.riskClass }, newValue: { riskClass: dto.riskClass },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { key, riskClass: dto.riskClass, secondPersonRequired: lowering };
    });
  }
}
