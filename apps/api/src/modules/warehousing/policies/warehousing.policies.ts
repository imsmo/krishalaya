// modules/warehousing/policies/warehousing.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004).
//   warehouse.manage — held by tenant_admin (0004:231; survey C-6 — no operator role exists): list warehouses; and, AS THE WAREHOUSE'S NAMED
//                      OPERATOR ONLY (`warehouses.operator_user_id = the caller`, no administrator escape — PC-56 OPS-2a, founder Q11-A), confirm
//                      and store bookings, cancel a booking (with a reason), record assays, cancel receipts, and edit the warehouse (D1). Any
//                      holder may reassign a warehouse's operator, and only that field, recorded before/after (D2).
//                      Booking release is refused by name (OPS-1a); eNWR issue and standalone receipt release are refused by name (OPS-2b).
//   warehouse.store  — a depositor: request a storage booking + cancel her own.
// PC-56 OPS-2a (founder Q11-A): the labour permission is no longer read anywhere in warehousing — the former administrator escape is deleted.
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const WarehousingPermissions = { Manage: 'warehouse.manage', Store: 'warehouse.store' } as const;
export const canManageWarehouse = (ctx: RequestContext) => ctx.permissions.has('warehouse.manage') || ctx.permissions.has('*');
export const canStore = (ctx: RequestContext) => ctx.permissions.has('warehouse.store') || ctx.permissions.has('*');
