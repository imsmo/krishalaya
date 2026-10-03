-- 0012 · livestock taxonomy — species + breeds + vet service types (referenced by livestock FKs) · [P1]
-- animal_species/animal_breeds are platform master data; vet_service is a fixed lookup vocabulary. All back
-- NOT NULL FKs in the livestock module, so the module is unusable without them.
INSERT INTO animal_species (code, default_name) VALUES
 ('cattle','Cattle'),('buffalo','Buffalo'),('goat','Goat'),('sheep','Sheep'),
 ('poultry','Poultry'),('pig','Pig'),('camel','Camel'),('fish','Fish'),('bee','Honey Bee')
ON CONFLICT (code) DO NOTHING;

INSERT INTO animal_breeds (species_id, code, default_name, is_indigenous)
SELECT s.id, b.code, b.name, b.indigenous FROM animal_species s
JOIN (VALUES
  ('cattle','gir','Gir',true),('cattle','sahiwal','Sahiwal',true),('cattle','hf_cross','HF Cross',false),
  ('buffalo','murrah','Murrah',true),('buffalo','jaffarabadi','Jaffarabadi',true),
  ('goat','sirohi','Sirohi',true),('goat','jamunapari','Jamunapari',true),
  ('poultry','kadaknath','Kadaknath',true),('poultry','broiler','Broiler',false)
) AS b(species_code, code, name, indigenous) ON b.species_code = s.code
ON CONFLICT (species_id, code) DO NOTHING;

-- [PC-56 TENANT-12 · F-16] NOT EXISTS + a target-less ON CONFLICT: `(type_code,tenant_id,code)` can never fire for a platform
-- row (NULLs are distinct), so every re-run used to DUPLICATE these values. Now a re-run inserts nothing.
INSERT INTO lookup_values (type_code,tenant_id,code,default_name,meta,sort_order)
SELECT v.type_code, v.tenant_id::uuid, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
 ('vet_service',NULL,'consult','General consultation','{}',1),
 ('vet_service',NULL,'vaccination','Vaccination','{}',2),
 ('vet_service',NULL,'ai_insemination','Artificial insemination','{}',3),
 ('vet_service',NULL,'pd_check','Pregnancy diagnosis','{}',4),
 ('vet_service',NULL,'deworming','Deworming','{}',5),
 ('vet_service',NULL,'surgery','Surgery','{}',6),
 ('vet_service',NULL,'emergency','Emergency call-out','{}',7)
  ) AS v(type_code, tenant_id, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NOT DISTINCT FROM v.tenant_id::uuid AND x.code = v.code)
ON CONFLICT DO NOTHING;
