-- 0137_demand_read_paths.sql · W108 demand map — read paths only (PC-56 ADMIN-SWEEP-c3).
--
-- NO DEMAND AGGREGATES MATERIALIZED VIEW, AND THAT IS THE WAVE'S FIRST DECISION, NOT AN OMISSION. DELTA-027's MV
-- belongs to DEV-38 with the refresh job that keeps it honest; an MV created here with nothing scheduled to
-- REFRESH it would go stale the hour it was built and read as current forever — the same defect class as a table
-- with no writers (0132's lesson). The demand map is therefore computed LIVE at query time from the base tables,
-- like Farmer 360 (0135): requirements and listings are point-in-time reads, orders prune by partition over the
-- requested week. These two partial indexes are the whole schema cost of that decision.
--
-- NO SEARCH-INTEREST COLUMN OR TABLE EITHER: no code path on this platform persists a search query (the search
-- service emits a metrics counter and nothing else — verified across apps/api, apps/worker and every migration).
-- DELTA-027's own warning is "search ≠ requirement"; until queries are recorded, the screen SAYS "never recorded"
-- rather than inventing interest from nothing. Recording queries is GAP-BACKEND, named in the tracker.
--
-- NO RUN/REBUILD TABLE: W2138–W2140 draw a "Retry" mutate chain around building the map. There is no build — the
-- read recomputes on every request — so a rebuild row would be a status recording an act nobody performs
-- (ADMIN-10-Q1's shape, refused for the third time).

-- The open-demand scan: 0005's idx_requirements_open is tenant-scoped and 'open'-only; the demand map reads
-- cross-tenant and counts 'partially_matched' too (a partially matched requirement is still unmet demand).
CREATE INDEX idx_requirements_demand ON requirements (delivery_pincode, product_id)
  WHERE status IN ('open', 'partially_matched') AND deleted_at IS NULL;

-- The listed-supply scan: published listings grouped by district × product. 0005's idx_listings_product has no
-- region; browse has no product-by-region path.
CREATE INDEX idx_listings_supply ON listings (region_id, product_id)
  WHERE status = 'published' AND deleted_at IS NULL;

-- Orders need nothing: the table is partitioned by created_at (0005), and the demand map's order-flow read is a
-- single-week window — partition pruning IS the index.
