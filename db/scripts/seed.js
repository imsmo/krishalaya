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
  'rules/0201_plans_limits_features.sql','rules/0202_commission_rules.sql','rules/0203_tax_rules_gst_tds.sql',
  'rules/0204_charge_definitions.sql','rules/0205_membership_tiers.sql','rules/0206_minimum_wages_gj_mh.sql',
  'rules/0207_ambassador_commission_plans.sql','rules/0208_schemes_starter_set.sql',
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
