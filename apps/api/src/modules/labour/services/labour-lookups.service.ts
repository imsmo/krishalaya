// modules/labour/services/labour-lookups.service.ts · the labour TAXONOMY catalogue (read-only).
// Mobile/web pickers (work-type, skill tree, region, skill-level) must NOT be hard-coded to opaque UUIDs;
// this endpoint hands clients the human-labelled, server-canonical option sets so a booking can be posted
// with real ids. All sources are GLOBAL/master reference tables (no tenant_id → outside RLS): platform
// lookup_values, the skills tree, admin_regions (states), and the statutory minimum_wages skill levels.
// Every list is BOUNDED (no client can ask for an unbounded scan) and ordered for stable rendering.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SKILL_LEVELS, SkillLevel, WageKind } from '../domain/labour.events';
import { MinimumWageService } from './minimum-wage.service';
import { NoMinimumWageFloorError } from '../domain/labour.errors';

const REGION_LIMIT = 100;   // state-level only — a small, fixed set
const SKILL_LIMIT = 500;    // the whole active skill tree is bounded and small

@Injectable()
export class LabourLookupsService {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider, private readonly minWage: MinimumWageService) {}

  /** All taxonomy a client needs to render the booking/worker forms with real ids + labels. */
  async getAll(tenantId: string) {
    const db = this.replica.forTenant(tenantId);
    const [demandTypes, skills, regions, cancelReasons, fee] = await Promise.all([
      db.query<{ id: string; code: string; default_name: string }>(
        `SELECT id, code, default_name FROM lookup_values
          WHERE type_code='labour_demand_type' AND tenant_id IS NULL AND is_active=true
          ORDER BY sort_order, default_name`),
      db.query<{ id: string; code: string; default_name: string; tier: number; parent_id: string | null; is_hazardous: boolean }>(
        `SELECT id, code, default_name, tier, parent_id, is_hazardous FROM skills
          WHERE is_active=true ORDER BY tier, default_name LIMIT ${SKILL_LIMIT}`),
      db.query<{ id: string; code: string | null; default_name: string }>(
        `SELECT id, code, default_name FROM admin_regions
          WHERE level=1 AND is_active=true ORDER BY default_name LIMIT ${REGION_LIMIT}`),
      // PC-56 TENANT-11b · A7 — the cancel reasons (canon W164's three + other) and the fee rule in effect today.
      db.query<{ code: string; default_name: string; text_required: boolean }>(
        `SELECT code, default_name, COALESCE((meta->>'textRequired')::boolean, false) AS text_required FROM lookup_values
          WHERE type_code='labour_cancel_reason' AND tenant_id IS NULL AND is_active=true ORDER BY sort_order`),
      db.query<{ kind: string; amount_minor: string; cap_minor: string | null; cap_rule_note: string }>(
        `SELECT kind, amount_minor::text, cap_minor::text, cap_rule_note FROM labour_fee_rules
          WHERE is_active AND effective_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND (tenant_id = current_tenant_id() OR tenant_id IS NULL)
          ORDER BY (tenant_id IS NULL), effective_from DESC LIMIT 1`),
    ]);
    return {
      workTypes: demandTypes.rows.map((r) => ({ id: r.id, code: r.code, name: r.default_name })),
      skills: skills.rows.map((r) => ({ id: r.id, code: r.code, name: r.default_name, tier: r.tier, parentId: r.parent_id, hazardous: r.is_hazardous })),
      regions: regions.rows.map((r) => ({ id: r.id, code: r.code, name: r.default_name })),
      skillLevels: [...SKILL_LEVELS],   // statutory floor tiers (minimum_wages.skill_level)
      cancelReasons: cancelReasons.rows.map((r) => ({ code: r.code, name: r.default_name, textRequired: r.text_required === true })),
      feeRule: fee.rows[0] ? { kind: fee.rows[0].kind, amountMinor: fee.rows[0].amount_minor, capMinor: fee.rows[0].cap_minor, capRuleNote: fee.rows[0].cap_rule_note } : null,
    };
  }

  /** The statutory floor (W2657 live "offered vs floor"); `null` + the reason when no row is configured (fail-closed at create). */
  async floor(tenantId: string, regionId: string, skillLevel: string, wageKind: string, onDate: string): Promise<{ minWageMinor: string | null; reason: string | null }> {
    try { return { minWageMinor: (await this.minWage.resolveFloor(tenantId, regionId, skillLevel as SkillLevel, wageKind as WageKind, onDate)).toString(), reason: null }; }
    catch (e) { if (e instanceof NoMinimumWageFloorError) return { minWageMinor: null, reason: 'NO_MIN_WAGE_FLOOR' }; throw e; }
  }
}
