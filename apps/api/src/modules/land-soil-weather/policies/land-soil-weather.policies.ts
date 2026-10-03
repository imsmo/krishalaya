// modules/land-soil-weather/policies/land-soil-weather.policies.ts · permission keys (DB-backed RBAC, Law 6; seeded 0004).
//   land.manage — a farmer manages their OWN parcels, crop seasons, and soil tests.
//   land.admin  — PC-56 TENANT-12 (0190, F-12): the land registry DESK (tenant_admin, fpo_coordinator) — every parcel of the
//                 tenant (box=all) and a correction to another member's parcel WITH a recorded reason. It replaces the
//                 `booking.manage` ride (a labour permission) the module used before; `land.manage` stays the farmer's own-land
//                 verb and cannot double as the desk's without making every farmer an administrator of every parcel.
// Browsing weather alerts (global region advisories) is any authenticated tenant user.
import { RequestContext } from '../../../core/tenancy-context/request-context';
export const LandPermissions = { Manage: 'land.manage', Admin: 'land.admin' } as const;
export const canManageLand = (ctx: RequestContext) => ctx.permissions.has('land.manage') || ctx.permissions.has('*');
export const isLandAdmin = (ctx: RequestContext) => ctx.permissions.has('land.admin') || ctx.permissions.has('*');
