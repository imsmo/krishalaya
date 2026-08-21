-- ==================================================================================================================
-- MIGRATION 0165 — THE CALL AND THE FIFTEEN MINUTES (PC-56 TENANT-6d-5 · W170, W2521–W2523)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
--
-- W170 makes four promises about reaching a human, and this migration is what three of them were missing.
--
--   • *"Warm milk is money evaporating — alerts fire to the operator's phone before the dairy loses a rupee."*
--   • *"14:12 operator alerted (SMS + call)"*
--   • *"Sensors buffer locally; a gap is a connectivity issue, not a temperature unknown — operator called
--     automatically after 15 min silence."*
--   • *"Call MCC-AND-03 operator"* — a button, and W2521–W2523's shared MUTATE pattern is its chain.
--
-- FOUR THINGS STOOD BETWEEN THOSE SENTENCES AND A PHONE RINGING. Every one of them was invisible: the code compiled,
-- the screens drew, the alerting reported itself as configured, and nobody was called.
--
-- 1. **FIFTEEN MINUTES WAS NOT A NUMBER THIS PLATFORM COULD HOLD.** `ops_alert_rules` kind `device_silent` validates
--    `{"silentHours": integer 1..720}` and its evidence query is `FLOOR(EXTRACT(EPOCH FROM (now() - MAX(recorded_at)))
--    / 3600)` — whole hours, floored. A fifteen-minute silence is `silent_hours = 0`, below every legal threshold, so
--    no rule could ever fire on it. TENANT-6d-1 named this and recorded the setting anyway
--    (`dairy.bmc_silence_minutes = 15`) so the SCREEN could say the gap out loud while the alerting could not act on
--    it. This migration makes the threshold a number of MINUTES and migrates the rows that exist.
--
-- 2. **THE ALERTING COULD NOT EVEN NAME THE VOICE CHANNEL.** `ops_alert_rules.channel_hint` is
--    `CHECK (channel_hint IN ('push','sms','whatsapp','email','inapp'))` — and `ivr` is missing from it, though the
--    notification spine has carried `ivr` since 0012 (`notification_templates.channel` documents it, the HTTP gateway
--    posts the channel verbatim, and `channel-resolution.ts` classes it as intrusive). The one channel W170's
--    *"operator called"* is actually about was the one an alert rule could not ask for.
--
-- 3. **A CRITICAL OPS ALERT AT TWO IN THE MORNING REACHED NOBODY.** `ops.alert_fired` is catalogued (0086) with
--    `priority = 'important'`, and `resolveChannels()` suppresses every INTRUSIVE channel — push, sms, whatsapp, ivr —
--    during a user's quiet hours unless the event is `critical`. `severityFor()` has always computed `critical` for a
--    tank breaching repeatedly or a sensor silent for two days, but severity lives on the FIRED ALERT and quiet hours
--    are decided by the CATALOGUE EVENT's priority, which is one constant for every ops alert ever raised. So the exact
--    alert W170 exists for — milk warming overnight — was suppressed on every phone channel until morning, while the
--    monitor reported the rule as active and the operator as a recipient. The fix is DATA, not a bypass: a second
--    catalogued event whose priority is `critical`, chosen by the severity the evidence produced. A maintenance
--    reminder still waits until morning; a warm tank does not.
--
-- 4. **A CALL ABOUT A TANK HAD NOWHERE TO BE FILED.** `masked_calls` (0012) is the privacy-proxy call log — caller,
--    callee, provider ref, and a `context_type`/`context_id` pair — and the platform's context vocabulary
--    (`CONTEXT_TYPES` in communication's domain) is `order · requirement · dispute · booking · direct ·
--    support_ticket · listing`. Nothing for a cooler. A call placed about MCC-AND-03 would have been logged with a NULL
--    context: a call nobody could trace back to the tank it was about, which is most of what a call log is for. The
--    vocabulary is a code-level constant (the column has no CHECK), so this migration does not widen a constraint — it
--    records the decision beside the others, and 165.6 says where the one-line change lives.
--
-- WHAT THIS MIGRATION DOES *NOT* DO — 165.7.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 165.1  THE VOICE CHANNEL BECOMES SAYABLE
-- ------------------------------------------------------------------------------------------------------------------
-- 0086's CHECK listed five of the spine's six channels. This adds the sixth rather than dropping the constraint: a
-- free-form channel hint would let a typo route an alert nowhere, which is 0086's own stated reason for having it.
ALTER TABLE ops_alert_rules DROP CONSTRAINT IF EXISTS ops_alert_rules_channel_hint_check;
ALTER TABLE ops_alert_rules
  ADD CONSTRAINT ops_alert_rules_channel_hint_check
  CHECK (channel_hint IN ('push','sms','whatsapp','email','inapp','ivr') OR channel_hint IS NULL);

COMMENT ON COLUMN ops_alert_rules.channel_hint IS
  'PC-56 TENANT-6d-5: a PREFERENCE passed in the outbox payload, never a bypass — the notification spine still '
  'resolves each recipient''s own channels, opt-outs and quiet hours. ivr added because W170''s promise ("operator '
  'called automatically after 15 min silence") is about the voice channel, and it was the one channel a rule could '
  'not name.';

-- ------------------------------------------------------------------------------------------------------------------
-- 165.2  FIFTEEN MINUTES BECOMES EXPRESSIBLE
-- ------------------------------------------------------------------------------------------------------------------
-- `threshold` is jsonb and validated in code (`validateThreshold`), so the change of unit is a code change plus THIS
-- backfill. `silentMinutes` is the canonical key from now on; `silentHours` stays ACCEPTED (and is converted on read)
-- because a tenant's integration or an admin console may already be sending it, and breaking a caller to rename a key
-- is a trust cost this platform does not need to pay. One helper (`silentMinutesOf`) is the only place that knows both.
--
-- Every existing row is converted here so no rule keeps a unit the screen no longer speaks: `{"silentHours": 12}`
-- becomes `{"silentMinutes": 720}` — the same twelve hours, said in the unit the evidence query now measures.
UPDATE ops_alert_rules
   SET threshold = jsonb_build_object('silentMinutes', ((threshold->>'silentHours')::int * 60)),
       updated_at = now()
 WHERE kind = 'device_silent'
   AND threshold ? 'silentHours'
   AND NOT (threshold ? 'silentMinutes')
   -- A malformed row (a non-integer sneaked in before validation existed) is LEFT ALONE rather than coerced: the
   -- reader falls back to the default and the rule stays visible as itself, instead of being silently rewritten.
   AND (threshold->>'silentHours') ~ '^[0-9]+$';

-- ------------------------------------------------------------------------------------------------------------------
-- 165.3  THE CRITICAL OPS ALERT — a catalogued event whose priority is the truth
-- ------------------------------------------------------------------------------------------------------------------
-- Same spine, same recipients, same rules; the ONLY difference is that this one is allowed to wake somebody. Chosen by
-- `severityFor()`'s verdict on the evidence, so a maintenance reminder can never reach it and a tank warming at 02:00
-- always does.
--
-- `user_can_opt_out = false`: an alert nobody may mute. TENANT-6d-1 declined to flip that flag on `ops.alert_fired`
-- because it governs every ops alert on the platform — fleet, warehouse and dairy — and belongs to whoever owns that
-- spine. This is a NEW event, so choosing it here changes nothing that already exists, and for a critical cold-chain
-- alert the choice is not close: a muted alarm is an alarm that lies.
--
-- `batchable = false`: a digest of critical alerts is a digest nobody reads in time.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable)
VALUES ('ops.alert_critical', 'Operations alert (critical)', 'critical', '["push","sms","ivr"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- The TEMPLATES for it are NOT inserted here, and that is deliberate. 0122 put a send-time gate on
-- `notification_template_versions.serving_version_id` and backfilled a version for every template that existed AT
-- MIGRATION TIME; anything inserted by a migration after 0122 would ship with `serving_version_id = NULL`, resolve to
-- nothing, and be recorded as `no_template` — silently. That is TENANT-6c-2's finding and TENANT-6d-1 hit its twin.
-- Platform copy lives in `db/seeds/core/0007_notification_events_templates.sql`, which owns the version rows, and this
-- event's nine templates (3 channels x 3 languages) are added there ABOVE the backfill block.

-- ------------------------------------------------------------------------------------------------------------------
-- 165.4  THE FLAG (Law 10)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_bmc_call',
   'PC-56 TENANT-6d-5 (W170, W2521-W2523): the monitor''s "Call MCC-AND-03 operator" act - a NUMBER-MASKED call '
   'bridged by the telephony provider between the dairy desk and whoever currently holds custody of that centre, '
   'recorded in masked_calls with the tank as its context and audited with the caller''s stated reason. OFF means the '
   'button is not offered and the route answers not-found; the monitor, the alerting and the automatic notification '
   'path are untouched by this flag, because a kill-switch on a human dialling a phone must not silence the machine '
   'that pages them.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 165.5  THE SETTING THE SCREEN AND THE ALERTING MUST AGREE ON
-- ------------------------------------------------------------------------------------------------------------------
-- 0162 recorded `dairy.bmc_silence_minutes` (15) as the age at which the MONITOR stops calling a reading a
-- temperature and starts calling it a gap. Now that an alert rule can hold minutes too, there are two numbers for one
-- promise — the screen's gap and the rule's threshold — and two numbers for one promise is how a cooperative comes to
-- believe somebody was called when the rule was set to twelve hours. Nothing here forces them equal: a tenant may
-- legitimately show a gap sooner than they page a human. The read-model REPORTS both and the monitor says when they
-- disagree, which is the honest version of the same care.
COMMENT ON TABLE ops_alert_rules IS
  'PC-55 A6 alert rules, per tenant. PC-56 TENANT-6d-5: device_silent thresholds are MINUTES (silentMinutes; the '
  'legacy silentHours key is still accepted and converted on read). The evaluator runs on a fixed cadence '
  '(ALERT_EVALUATION_INTERVAL_MS in modules/logistics/domain/ops-alert.rules.ts), so a threshold below that cadence '
  'is detected late rather than exactly - which the dairy BMC monitor prints rather than hides.';

-- ------------------------------------------------------------------------------------------------------------------
-- 165.6  WHERE THE CALL'S CONTEXT VOCABULARY LIVES
-- ------------------------------------------------------------------------------------------------------------------
-- `masked_calls.context_type` is `varchar(40)` with NO CHECK (0012), and the vocabulary is the `CONTEXT_TYPES` constant
-- in `modules/communication/domain/messaging.events.ts` — shared with `conversations`. TENANT-6d-5 adds `bmc_unit`
-- there, in the module that owns the vocabulary, rather than writing a string the platform does not recognise from a
-- dairy service. Recorded here because a reader of this migration will want to know why no DDL accompanies a new kind
-- of call, and because `MULTI_THREAD_CONTEXT_TYPES` deliberately does NOT gain it: a tank has one thread, not one per
-- caller.
COMMENT ON COLUMN masked_calls.context_type IS
  'Vocabulary: CONTEXT_TYPES in modules/communication/domain/messaging.events.ts (order, requirement, dispute, '
  'booking, direct, support_ticket, listing, bmc_unit). PC-56 TENANT-6d-5 added bmc_unit so a call placed about a warm '
  'cooler is filed against that cooler - a call log with a NULL context cannot answer the question it exists for.';

-- ------------------------------------------------------------------------------------------------------------------
-- 165.7  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • **It does not create an alert rule for anybody.** `ops_alert_rules` is TENANT data: a cooperative decides what
--     silence is worth a phone call and who answers it. Seeding "15 minutes, notify the dairy lead" would be this
--     platform inventing a cooperative's escalation policy — Law 6 with somebody's night at stake. What the monitor
--     does instead is SAY whether a silence rule exists, what its threshold is, and whether it matches the number the
--     screen uses for a gap.
--   • **It does not make the automatic call automatic on a deployment with no telephony.** `ops.alert_critical` asks
--     for `ivr` among its channels; whether a voice call is actually placed depends on the external notification
--     product this deployment is pointed at. The monitor reads whether the template exists (as TENANT-6d-1 taught it to
--     do for SMS) and says which legs will really reach the operator instead of promising all three.
--   • **It does not touch `ops.alert_fired`.** Its `user_can_opt_out = true` remains the carried escalation: an
--     operator who muted notifications is still not told about a WARNING-level tank. The critical path above is now
--     unmutable, which is the half of that problem a dairy wave may honestly fix.
--   • **It does not record a call attempt that failed.** `MaskedCallService` degrades rather than throws and records
--     nothing when the provider refuses, so a failed call leaves no row — the same gap TENANT-6d-4 named on the form
--     chain's failure screen, and for the same reason: the record is written inside the act that failed. W2523's
--     *"repeated failures page the on-call"* stays unbuildable and stays printed as such.
--   • **It does not give the caller the operator's number.** The masking provider owns the phone directory; this
--     platform passes two user ids and never stores a raw phone. TENANT-6d-2 masked that number on the centres board;
--     this wave never needs it at all.
