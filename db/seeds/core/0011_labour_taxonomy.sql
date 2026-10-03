-- 0011 · labour taxonomy — skills catalogue + demand types (referenced by labour_bookings) · [P1]
-- Skills are platform master data (skills.code UNIQUE). labour_demand_type is a fixed (non-extendable)
-- vocabulary under lookup_values. Both back NOT NULL FKs on labour_bookings, so a booking is impossible
-- without them. tier 1=unskilled … higher=more specialised (marketing hint only; the statutory floor is
-- resolved per skill_level via minimum_wages, not per skill).
INSERT INTO skills (code, default_name, tier, is_hazardous) VALUES
 ('general_farm_labour','General farm labour',1,false),
 ('sowing','Sowing / transplanting',1,false),
 ('harvesting','Harvesting',1,false),
 ('weeding','Weeding',1,false),
 ('irrigation','Irrigation',2,false),
 ('pesticide_spraying','Pesticide spraying',3,true),
 ('tractor_operator','Tractor operator',4,false),
 ('grafting','Grafting / nursery',4,false)
ON CONFLICT (code) DO NOTHING;

-- [PC-56 TENANT-12 · F-16] NOT EXISTS + a target-less ON CONFLICT: `(type_code,tenant_id,code)` can never fire for a platform
-- row (NULLs are distinct), so every re-run used to DUPLICATE these values. Now a re-run inserts nothing.
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order)
SELECT v.type_code, v.tenant_id::uuid, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
 ('labour_demand_type',NULL,'daily_single','Daily — single worker','{}',1),
 ('labour_demand_type',NULL,'daily_multi','Daily — multiple workers','{}',2),
 ('labour_demand_type',NULL,'skilled','Skilled task','{}',3),
 ('labour_demand_type',NULL,'crew','Crew (sardar-led)','{}',4),
 ('labour_demand_type',NULL,'contract_task','Contract task (per-task)','{}',5),
 ('labour_demand_type',NULL,'seasonal','Seasonal','{}',6),
 ('labour_demand_type',NULL,'live_in','Live-in','{}',7),
 ('labour_demand_type',NULL,'sos','Urgent / SOS','{}',8)
  ) AS v(type_code, tenant_id, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NOT DISTINCT FROM v.tenant_id::uuid AND x.code = v.code)
ON CONFLICT DO NOTHING;
