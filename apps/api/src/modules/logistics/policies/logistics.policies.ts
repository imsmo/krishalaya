// modules/logistics/policies/logistics.policies.ts · permission keys (DB-backed RBAC, Law 6).
import { RequestContext } from '../../../core/tenancy-context/request-context';
// Tenant logistics operators (3PL desk / dispatch) hold logistics.manage. Riders need no permission —
// they act ONLY on shipments assigned to them (rider_user_id), enforced per-row in the service.
export const ShipmentPermissions = { Manage: 'logistics.manage' } as const;
export function canManageLogistics(ctx: RequestContext): boolean {
  return ctx.permissions.has('logistics.manage') || ctx.permissions.has('*');
}

/** PC-56 TENANT-SW-a · B2: proposing a zone create / fee re-point / (de)activation — tenant_admin or fpo_coordinator; the CONFIRMER must
 *  be a different active tenant_admin (0196 trg_dzp_moves). */
export const ZONES_MANAGE = 'logistics.zones.manage';
export function canManageZones(ctx: RequestContext): boolean {
  return ctx.permissions.has(ZONES_MANAGE) || ctx.permissions.has('*');
}

/** PC-56 TENANT-SW-e · cold-chain loggers: registering one and issuing / revoking its signing key (shown once) — tenant_admin (0201). */
export const DEVICES_MANAGE = 'logistics.devices.manage';
export function canManageColdChainDevices(ctx: RequestContext): boolean {
  return ctx.permissions.has(DEVICES_MANAGE) || ctx.permissions.has('*');
}
