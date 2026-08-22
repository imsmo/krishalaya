-- 0003 · currencies + units of measure with conversions · [P1]
--
-- ------------------------------------------------------------------------------------------------------------------
-- [PC-56 TENANT-6e-1] **FIVE OF THE SEVEN SEEDED COUNTRIES NAMED A CURRENCY THAT DID NOT EXIST.**
-- ------------------------------------------------------------------------------------------------------------------
-- `core/0002_countries_regions_gj_mh.sql` activates seven countries — IN, US, AE, GB, SA, DE, JP — and this file
-- created three currencies. So `SELECT c.code FROM countries c LEFT JOIN currencies u ON u.code = c.currency_code
-- WHERE u.code IS NULL` returned FIVE ROWS on every database this platform has ever built: **AED, GBP, SAR, EUR, JPY.**
--
-- `countries.currency_code` is `NOT NULL` and has **no foreign key** to `currencies.code` (nothing references it; the
-- table has no outgoing FK at all), and this file runs AFTER 0002 in `db/scripts/seed.js`, so nothing could have
-- caught it. The consequence is not cosmetic: every money render on this platform resolves a tenant's currency through
-- `countries` and then needs `currencies.minor_units` to turn minor units into money. For a tenant in Dubai, London,
-- Riyadh, Berlin or Tokyo that row was ABSENT — so every such figure was either a guess at two decimals or a failure.
--
-- **JPY IS THE ONE THAT MATTERS MOST.** The yen has NO minor unit. Every hardcoded `?? 'INR'` and every assumed "two
-- decimals" on this platform renders ¥5,160 as ¥51.60 — wrong by a factor of a hundred, in the direction that
-- understates what somebody is owed. Rule Zero: a shortcut that blocks a country is not a shortcut.
--
-- WHAT IS FIXED HERE AND WHAT IS NOT:
--   • FIXED — the five rows exist, with the SCALE each currency actually has. `minor_units` is a fact about the
--     currency, true whether or not this platform ever transacts in it.
--   • NOT FIXED — `is_active` stays FALSE on all five, matching BDT and USD. Whether Krishalaya transacts in a currency
--     is a business decision and not a seed's to make. The residual is named: five countries are `is_active = true`
--     whose currencies are not, which is a real inconsistency and a founder decision either way.
--   • NOT FIXED — the missing FOREIGN KEY. `countries.currency_code -> currencies.code` would have made this
--     unrepresentable, and adding it belongs with whoever owns country onboarding in `apps/admin-api`: the seed order
--     here inserts countries first, so the constraint changes what that flow may do. **Escalated, not smuggled into a
--     read wave.**
INSERT INTO currencies (code,default_name,symbol,minor_units,is_active) VALUES
 ('INR','Indian Rupee','₹',2,true),
 ('BDT','Bangladeshi Taka','৳',2,false),
 ('USD','US Dollar','$',2,false),
 -- The five that `countries` has always named and this file never created (PC-56 TENANT-6e-1).
 ('AED','UAE Dirham','د.إ',2,false),
 ('GBP','Pound Sterling','£',2,false),
 ('SAR','Saudi Riyal','﷼',2,false),
 ('EUR','Euro','€',2,false),
 -- ZERO. The yen has no minor unit, and this row is the reason a Japanese tenant's money can be rendered at all.
 ('JPY','Japanese Yen','¥',0,false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO units (code,default_name,unit_class,is_active) VALUES
 ('kg','Kilogram','mass',true),('quintal','Quintal','mass',true),('ton','Tonne','mass',true),
 ('gram','Gram','mass',true),('litre','Litre','volume',true),('ml','Millilitre','volume',true),
 ('piece','Piece','count',true),('dozen','Dozen','count',true),('bag','Bag','count',true),
 ('crate','Crate','count',true),('acre','Acre','area',true),('hectare','Hectare','area',true),
 ('hour','Hour','time',true),('day','Day','time',true),('km','Kilometre','length',true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO unit_conversions (from_unit,to_unit,factor) VALUES
 ('quintal','kg',100),('ton','kg',1000),('kg','gram',1000),('dozen','piece',12),('hectare','acre',2.47105)
ON CONFLICT (from_unit,to_unit) DO NOTHING;
