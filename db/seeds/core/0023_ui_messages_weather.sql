-- ==================================================================================================================
-- db/seeds/core/0023_ui_messages_weather.sql
-- PC-56 TENANT-12 · WEATHER ADVISORIES — the name of each platform weather-alert type, in every language a member is told in.
-- ==================================================================================================================
-- `weather.alert` / `weather.alert_severe` (seed 0007) name the KIND of advisory. The kind is a platform code from the
-- `weather_alert` lookup (seed 0005, deduplicated by 0190); a Gujarati notice with an English code in it is TENANT-6d-7's
-- defect. The advisory push job reads these by prefix (`UiMessageRepository.mapsUnder('weather.alert_type.')`) and puts the
-- per-language map into the payload; a code with no English row is not sent (fails closed, counted).
INSERT INTO ui_messages (key, language_code, text) VALUES
  ('weather.alert_type.heavy_rain','en','Heavy rain'),
  ('weather.alert_type.heavy_rain','hi','भारी वर्षा'),
  ('weather.alert_type.heavy_rain','gu','ભારે વરસાદ'),
  ('weather.alert_type.drought','en','Drought'),
  ('weather.alert_type.drought','hi','सूखा'),
  ('weather.alert_type.drought','gu','દુષ્કાળ'),
  ('weather.alert_type.frost','en','Frost'),
  ('weather.alert_type.frost','hi','पाला'),
  ('weather.alert_type.frost','gu','હિમ'),
  ('weather.alert_type.hail','en','Hail'),
  ('weather.alert_type.hail','hi','ओलावृष्टि'),
  ('weather.alert_type.hail','gu','કરા'),
  ('weather.alert_type.heatwave','en','Heatwave'),
  ('weather.alert_type.heatwave','hi','लू'),
  ('weather.alert_type.heatwave','gu','લૂ'),
  ('weather.alert_type.cyclone','en','Cyclone'),
  ('weather.alert_type.cyclone','hi','चक्रवात'),
  ('weather.alert_type.cyclone','gu','વાવાઝોડું'),
  ('weather.alert_type.pest_risk','en','Pest risk'),
  ('weather.alert_type.pest_risk','hi','कीट जोखिम'),
  ('weather.alert_type.pest_risk','gu','જીવાત જોખમ')
ON CONFLICT DO NOTHING;
