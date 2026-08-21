// db/scripts/seed.js · runs seed SQL in dependency order · [P1]
// Usage:
//   node db/scripts/seed.js                 # core + rules + catalogue (idempotent)
//   node db/scripts/seed.js --demo          # also load demo tenants/users (blocked in production)
//   node db/scripts/seed.js --reseed        # re-apply even if already recorded
//   node db/scripts/seed.js --plan          # list seed order, no DB
//
// Order: core (lang→geo→currency→roles→lookups→consent→notif→settings→integrations→labour/livestock
//        taxonomy→selfserve flag→payout failure reasons)
//        → rules (plans→commission→tax→charges→membership→minwage→ambassador→schemes)
//        → catalogue (categories→attributes→crops→templates→synonyms)
//        → demo (ONLY if --demo AND NODE_ENV != production)
// Seeds must run AFTER migrations. Tracked in `seed_history` (path + checksum) so
// re-running is safe; seed SQL itself should use ON CONFLICT for idempotency.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SEEDS_DIR = path.join(__dirname, '..', 'seeds');

const ORDER = [
  'core/0001_languages.sql','core/0002_countries_regions_gj_mh.sql','core/0003_currencies_units.sql',
  'core/0004_roles_permissions.sql','core/0005_lookup_vocabularies.sql','core/0006_consent_purposes.sql',
  'core/0007_notification_events_templates.sql','core/0008_setting_definitions.sql','core/0009_feature_flags.sql','core/0010_integration_providers.sql',
  'core/0011_labour_taxonomy.sql','core/0012_livestock_taxonomy.sql',
  'core/0013_selfserve_onboarding_flag.sql','core/0014_payout_failure_reasons.sql',
  'core/0015_dev07_routine_fanout_flag.sql',
  // [PC-56 TENANT-6d-7] The platform's first `ui_messages` rows — the words a dairy notice needs in three languages,
  // because a domain event is emitted once and rendered for every recipient. LISTED HERE AND CHECKED BY A SPEC:
  // TENANT-6c-4 found `rules/0208_fintech_products.sql` had never been listed and therefore never existed in any
  // database, and nothing would have said so. `db/scripts/__tests__` now asserts this list covers every seed file.
  'core/0016_ui_messages_dairy_notices.sql',
  'rules/0201_plans_limits_features.sql','rules/0202_commission_rules.sql','rules/0203_tax_rules_gst_tds.sql',
  'rules/0204_charge_definitions.sql','rules/0205_membership_tiers.sql','rules/0206_minimum_wages_gj_mh.sql',
  'rules/0207_ambassador_commission_plans.sql','rules/0208_schemes_starter_set.sql',
  // [PC-56 TENANT-6c-4] A SEED FILE THIS LIST HAS NEVER MENTIONED, AND THEREFORE NOTHING HAS EVER APPLIED.
  //
  // `rules/0208_fintech_products.sql` — the platform's seeded NBFC partner and its Kharif crop-loan product, with the
  // fixed id `22222222-0000-7000-8000-000000000101` — shares the number 0208 with the schemes starter set, and only
  // the schemes file was listed. So that product has never existed in any database, and
  // `modules/fintech/__tests__/fintech.integration.spec.ts` (which asks for it by that id, in its own header: *"the
  // seeded crop-loan product (0208)"*) has been RED since it was written. A seed file nothing applies is the same
  // defect class as a table with no writer, which this programme has now found five times. This runner does fail
  // loudly on a MISSING file — it is a file that was never LISTED that stayed invisible, and the integration
  // harness's `if (!fs.existsSync(full)) continue` is what kept it quiet there too.
  'rules/0208_fintech_products.sql',
  // NOT ADDED, AND NAMED INSTEAD: `rules/0209_scheme_catalogue.sql` is a SECOND seed for the `schemes` table and a
  // corrected rewrite of 0208_schemes_starter_set — it inserts the same `pm_kisan` code (so adding it alongside the
  // listed file fails on `schemes_code_key`), and, more seriously, the LISTED file stores a **`tenant_type` lookup id
  // in `schemes.category_id`** while 0209 uses the `scheme_category` one it should be. Wiring the correction means
  // deciding what happens to rows that already exist — an UPDATE and a migration in the schemes module, not an
  // INSERT in a dairy wave. ESCALATED with the lookup-duplication finding (migration 0160's header).
  'catalogue/0101_category_tree.sql','catalogue/0102_attributes_options.sql','catalogue/0103_launch_crops_30.sql',
  'catalogue/0104_attribute_templates.sql','catalogue/0105_search_synonyms.sql',
];
const DEMO = ['demo/0901_demo_tenants.sql','demo/0902_demo_users_listings.sql'];

function arg(name) { return process.argv.includes(name); }

// Belt-and-suspenders: even if NODE_ENV is mis-set, NEVER load demo data against a managed/cloud DB endpoint.
// Demo tenants/users are a dev affordance (P0-13) — they must be provably absent from any production database.
function looksLikeProdDb() {
  const url = process.env.DATABASE_URL || '';
  return /amazonaws\.com|rds\.|\.azure\.|cloudsql|neon\.tech|supabase\.co|render\.com/i.test(url);
}

function plan() {
  const includeDemo = arg('--demo') && process.env.NODE_ENV !== 'production' && !looksLikeProdDb();
  const files = includeDemo ? [...ORDER, ...DEMO] : ORDER;
  return files.map((rel) => {
    const full = path.join(SEEDS_DIR, rel);
    const sql = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    return { rel, full, sql, checksum: sql ? crypto.createHash('sha256').update(sql).digest('hex') : null };
  });
}

async function main() {
  const files = plan();

  if (arg('--plan')) {
    console.log(`Seed plan (${files.length} files):`);
    for (const f of files) console.log(`  ${f.rel}${f.sql ? '' : '   [MISSING]'}`);
    if (arg('--demo') && process.env.NODE_ENV === 'production') console.log('(demo seeds skipped: NODE_ENV=production)');
    else if (arg('--demo') && looksLikeProdDb()) console.log('(demo seeds skipped: DATABASE_URL looks like a managed/prod endpoint)');
    return;
  }

  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error('FATAL: set MIGRATION_DATABASE_URL or DATABASE_URL'); process.exit(1); }

  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS seed_history (
        path text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const applied = new Map(
      (await client.query('SELECT path, checksum FROM seed_history')).rows.map((r) => [r.path, r.checksum]),
    );

    let n = 0;
    for (const f of files) {
      if (!f.sql) { console.error(`MISSING seed file: ${f.rel}`); process.exitCode = 1; return; }
      if (!arg('--reseed') && applied.get(f.rel) === f.checksum) { console.log(`skip  ${f.rel} (already seeded)`); continue; }
      process.stdout.write(`seed  ${f.rel} … `);
      try {
        await client.query('BEGIN');
        await client.query(f.sql);
        await client.query(
          `INSERT INTO seed_history (path, checksum) VALUES ($1,$2)
           ON CONFLICT (path) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
          [f.rel, f.checksum],
        );
        await client.query('COMMIT');
        console.log('ok'); n++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        console.error(`\nSeed ${f.rel} failed and was rolled back:\n${err.message}\n`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`Done — applied ${n} seed file(s).`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) main().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
module.exports = { ORDER, DEMO };
