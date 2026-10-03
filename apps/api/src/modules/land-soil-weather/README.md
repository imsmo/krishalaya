# Land, Soil & Weather (M24) — farm registry + agronomy data

The farm-data backbone: farmers register their **land parcels** (survey/khasra + Bhulekh linkage, area,
irrigation, boundary), track **crop seasons** (plan → sow → harvest), and record **Soil Health Card**
results; everyone can browse regional **weather advisories**. Built to the platform laws. Gated by the
**`land_soil_weather`** flag (default OFF).

## No in-platform money path (by design)
This is an agronomy **data + advisory** module — no wallet movement (like offers/requirements/reviews/exports).

## Money correctness — float-free measures (Law: never float)
Even without money, all decimal measures are stored as **scaled integers** and never touched as IEEE float:
parcel area ×10000 (4 dp), crop yields ×1000 (3 dp); the JSON views format from the scaled integer.

## Lifecycle (Law 5 — `domain/crop-season.state.ts`)
- **Crop season**: `planned → sown → harvested` (+ `abandoned` from planned/sown).
- **Land parcel**: no lifecycle state machine; `verification_status` (kyc_status) is set by the KYC/admin
  flow (deferred) and registers as `none`.
- No version columns → mutations lock **FOR UPDATE**.

## Endpoints
- `POST /v1/land/parcels` (idempotent, `land.manage`) · `GET` (?box=mine|all, µs keyset) · `GET /:id` · `PATCH /:id` (owner, or the
  land desk `land.admin` with a `reason`). The boundary is a GeoJSON Polygon / MultiPolygon (`domain/geojson.ts`) — `{}` is refused.
- `POST /v1/land/crop-seasons` (plan, idempotent; a yield needs `yieldUnitCode`) · `GET ?parcelId=` · `POST /:id/{sow,harvest,abandon}`
  (abandon: `{ reason }` in the .strict() contract).
- `POST /v1/land/soil-tests` (record, Idempotency-Key) · `GET /soil-tests?parcelId=`.
- PC-56 TENANT-12: every write above is audited (actor · reason · before/after · ip); the advisory push job is a registered
  `ScheduledJob` (per tenant as kv_app, recipients resolved from parcel regions + weather_prefs).
- `GET /v1/land/weather-alerts?regionId=&activeOnly=` — read-only regional advisories.

## Threats considered
- **No cross-owner IDOR**: parcels read 404 for non-owners; crop-season and soil-test writes/reads resolve
  the parent parcel and verify ownership (`assertOwner`, admin-override only); `box=all` requires `land.admin` (PC-56 TENANT-12 — it rode `booking.manage`, a labour permission, before).
- **Weather alerts are read-only**: `weather_alerts` is GLOBAL, region-scoped reference data ingested by the
  IMD/Skymet pipeline on the platform surface (Law 11). The tenant API only browses it (active + region +
  a bounded `created_at` window that prunes the partitioned scan).
- **Anti-mass-assignment**: zod `.strict()` DTOs; `irrigation_type_id` resolved from the platform
  `irrigation` lookup (`tenant_id IS NULL`), never client-supplied.
- **AuthZ throws**: `land.manage` (farmer/admin) on all writes; tenant_id + RLS everywhere (integration proves
  cross-tenant denial); keyset pagination with max `LIMIT`.

## Events (outbox, Law 4)
`land.parcel_registered/updated`, `land.crop_season_planned/sown/harvested/abandoned`, `land.soil_test_recorded`.

## Scope & deferrals
**In scope:** land parcels (farm registry), crop seasons (lifecycle), soil tests, read-only regional weather browse.
**Deferred (schema in 0010 / platform surface):** weather-alert INGESTION (IMD/Skymet pipeline, Law 11 — refused by name;
`weather_alerts` is read-only to kv_app since 0190), bhulekh-verify job, parcel `verification_status` workflow (KYC/admin), PostGIS boundary
geometry + auto-area, soil-test recommendation engine. (`land_parcels.id` is the FK target for
`contract_growers.land_parcel_id` — cross-module reference only.)

## Tests
- `__tests__/land-domain.spec.ts` — crop-season state machine, parcel/crop/soil aggregate invariants, float-free area/yield.
- `__tests__/land-parcel.service.spec.ts` — register quota+outbox; owner-only edit.
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id, FOR UPDATE, keyset, platform-scoped irrigation lookup, partition-pruned weather read).
- `__tests__/land-soil-weather.integration.spec.ts` — real Postgres: parcel → crop season (plan/sow/harvest) → soil test → weather browse → cross-owner 404 + RLS.

> No Postgres in the sandbox, so the live RLS / partitioned weather-read assertions run on the first CI run with a service container.
