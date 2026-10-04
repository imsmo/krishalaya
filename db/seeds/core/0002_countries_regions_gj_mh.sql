-- 0002 · India + Phase-1 states (Gujarat, Maharashtra) with district samples · [P1]
INSERT INTO countries (code,default_name,currency_code,phone_prefix,timezone,is_active) VALUES
 ('IN','India','INR','+91','Asia/Kolkata',true),
 ('US','United States','USD','+1','America/New_York',true),
 ('AE','United Arab Emirates','AED','+971','Asia/Dubai',true),
 ('GB','United Kingdom','GBP','+44','Europe/London',true),
 ('SA','Saudi Arabia','SAR','+966','Asia/Riyadh',true),
 ('DE','Germany','EUR','+49','Europe/Berlin',true),
 ('JP','Japan','JPY','+81','Asia/Tokyo',true)
ON CONFLICT (code) DO NOTHING;

-- States
INSERT INTO admin_regions (id,country_code,parent_id,level,code,default_name,path,centroid_lat,centroid_lng,is_active) VALUES
 ('11111111-0000-7000-8000-000000000001','IN',NULL,1,'GJ','Gujarat','in.gj',22.2587,71.1924,true),
 ('11111111-0000-7000-8000-000000000002','IN',NULL,1,'MH','Maharashtra','in.mh',19.7515,75.7139,true)
ON CONFLICT (id) DO NOTHING;

-- [PC-56 TENANT-SW-d · found on the way] the GST state codes of the two seeded states. 0140 set them by UPDATE at migration time —
-- which on a database built FROM EMPTY runs before this seed has inserted the states, so a fresh build had NO state code and W114's
-- GSTIN state advisory could never compare. The codes are data (0140's column), written here for the states this file creates;
-- guarded, because the column is 0140's.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'admin_regions' AND column_name = 'gst_state_code') THEN
    EXECUTE $u$UPDATE admin_regions SET gst_state_code = '24' WHERE level = 1 AND country_code = 'IN' AND path::text = 'in.gj' AND gst_state_code IS NULL$u$;
    EXECUTE $u$UPDATE admin_regions SET gst_state_code = '27' WHERE level = 1 AND country_code = 'IN' AND path::text = 'in.mh' AND gst_state_code IS NULL$u$;
  END IF;
END $$;

-- Sample districts (Junagadh = founder's base; expand via admin UI later)
INSERT INTO admin_regions (id,country_code,parent_id,level,code,default_name,path,is_active) VALUES
 ('11111111-0000-7000-8000-000000000101','IN','11111111-0000-7000-8000-000000000001',2,'GJ-JUN','Junagadh','in.gj.junagadh',true),
 ('11111111-0000-7000-8000-000000000102','IN','11111111-0000-7000-8000-000000000001',2,'GJ-RAJ','Rajkot','in.gj.rajkot',true),
 ('11111111-0000-7000-8000-000000000201','IN','11111111-0000-7000-8000-000000000002',2,'MH-PUN','Pune','in.mh.pune',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pincodes (country_code,pincode,region_id,lat,lng) VALUES
 ('IN','362001','11111111-0000-7000-8000-000000000101',21.5222,70.4579),
 ('IN','360001','11111111-0000-7000-8000-000000000102',22.3039,70.8022)
ON CONFLICT (country_code,pincode) DO NOTHING;


-- Mandi Pulse: a few sample physical markets (global reference; region linked later via admin UI)
INSERT INTO mandis (default_name, region_id, mandi_code, is_active) VALUES
 ('Ahmedabad APMC', NULL, 'GJ-AHM-01', true),
 ('Rajkot APMC', NULL, 'GJ-RAJ-01', true),
 ('Pune Market Yard', NULL, 'MH-PUN-01', true)
ON CONFLICT (mandi_code) DO NOTHING;
