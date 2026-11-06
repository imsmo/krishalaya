// modules/warehousing/policies/warehousing.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded in 0004).
//   warehouse.manage — held by tenant_admin (0004:231; survey C-6 — no operator role exists): list warehouses, confirm/store bookings, record
//                      assays and cancel receipts AS THE WAREHOUSE'S NAMED OPERATOR (PC-56 OPS-2b: strict on assay record and receipt cancel).
//                      Booking release is refused by name (OPS-1a); eNWR issue and standalone receipt release are refused by name (OPS-2b).
//   isWarehouseAdmin — the `booking.manage` escape (survey F-5) still applies to the other operator acts; OPS-2a removes it (founder Q11-A).
//   warehouse.store  — a depositor: request a storage booking + cancel their own.
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const WarehousingPermissions = { Manage: 'warehouse.manage', Store: 'warehouse.store' } as const;
export const canManageWarehouse = (ctx: RequestContext) => ctx.permissions.has('warehouse.manage') || ctx.permissions.has('*');
export const canStore = (ctx: RequestContext) => ctx.permissions.has('warehouse.store') || ctx.permissions.has('*');
export const isWarehouseAdmin = (ctx: RequestContext) => ctx.permissions.has('booking.manage') || ctx.permissions.has('*');
