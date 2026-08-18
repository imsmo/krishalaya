#!/usr/bin/env node
// db/scripts/archive-partitions.js
// Tiered data retention for partitioned tables, driven by data_retention_policies
// (active_months hot · archive_months cold · action). Past-window monthly partitions
// are archived (detached for the S3/parquet exporter) or dropped, keeping hot tables
// and their indexes small so scans stay fast at billions of rows — while honouring
// legal retention (GST 7yr · RBI 10yr · DPDP minimisation).
//
// SAFETY (production-grade):
//   • DRY-RUN by default; destructive actions require --apply.
//   • lock_timeout is short (set in lib/db) so a DETACH/DROP can NEVER block the
//     live writer — it fails fast and is retried next run instead.
//   • --batch caps how many partitions are touched per run (bounded blast radius).
//   • advisory-locked + recorded in ops_job_runs; structured logs + JSON.
//   • 'archive' DETACHes (leaving a standalone table for the exporter, see
//     ARCHIVE_S3_BUCKET) and never drops un-exported data; 'delete' drops; 'anonymise'
//     is delegated to a per-table PII job (logged, not performed here).
'use strict';
const { withClient } = require('./lib/db');
const { runJob } = require('./lib/job');
const { parse, helpAndExit } = require('./lib/args');
const { makeLogger } = require('./lib/log');
const { parsePartitionBound, isCold } = require('./lib/partitions');

const HELP = `
archive-partitions — retire cold partitions per data_retention_policies.

Usage: node db/scripts/archive-partitions.js [options]
  --apply         actually detach/drop (default: dry-run preview)
  --batch <n>     max partitions to act on this run (default 50)
  --json          emit JSON summary
  --help
Env: MIGRATION_DATABASE_URL | DATABASE_URL, ARCHIVE_S3_BUCKET (optional, for 'archive')`;

async function coldCandidates(client) {
  const policies = (await client.query(`
    SELECT table_name, active_months, archive_months, action
    FROM data_retention_policies WHERE is_active AND action <> 'keep_forever'`)).rows;
  const out = [];
  const unknownTables = [];
  for (const p of policies) {
    // **AN UNKNOWN TABLE IS SKIPPED AND REPORTED, NOT FATAL (PC-56 TENANT-4d-5 CHAIN REPAIR).**
    // `data_retention_policies.table_name` is free text and cannot be foreign-keyed to a catalogue, so a
    // typo is undetectable by the database. `$1::regclass` on a missing relation THROWS, and this loop had
    // no guard — so ONE bad row aborted the whole run and every other table's retention policy went
    // unenforced with it. 0107 seeded exactly such a row (`user_devices`; the real table is
    // `push_devices`), which is why this script has never completed. Law 12: degrade, never die — the
    // remaining policies are enforced and the bad row is named in the summary so it gets fixed.
    const exists = (await client.query(
      `SELECT 1 FROM pg_class WHERE oid = to_regclass($1)`, [p.table_name])).rowCount > 0;
    if (!exists) { unknownTables.push(p.table_name); continue; }
    const parts = (await client.query(`
      SELECT i.inhrelid::regclass::text AS child, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
      WHERE i.inhparent = $1::regclass`, [p.table_name])).rows;
    for (const part of parts) {
      const b = parsePartitionBound(part.bound);
      if (b.isDefault || !b.to) continue;
      if (!isCold(b.to, p.active_months)) continue;
      out.push({ parent: p.table_name, child: part.child, action: p.action, upperBound: b.to });
    }
  }
  // oldest first
  out.sort((a, b) => a.upperBound.localeCompare(b.upperBound));
  if (unknownTables.length) {
    // Surfaced on stderr as well as in the return value: a retention policy pointing at nothing means a
    // table's data is being kept for ever with a row that claims otherwise, and that must not be quiet.
    console.error(`[archive-partitions] WARNING: ${unknownTables.length} retention policy row(s) name a relation that does not exist and were skipped: ${unknownTables.join(', ')}`);
  }
  out.unknownTables = unknownTables;
  return out;
}

async function main() {
  const args = parse();
  if (args.has('help')) helpAndExit(HELP);
  const apply = args.bool('apply');
  const batch = args.int('batch', 50);
  const log = makeLogger('archive-partitions', { mode: apply ? 'apply' : 'dry-run' });
  const s3 = process.env.ARCHIVE_S3_BUCKET || null;

  const summary = await withClient({ appName: 'kv-archive-partitions', statementTimeoutMs: 120000, lockTimeoutMs: 3000, log }, (client) =>
    runJob(client, 'archive_partitions', { log }, async ({ recordDetail }) => {
      const all = await coldCandidates(client);
      const candidates = all.slice(0, batch);
      const done = [];
      for (const c of candidates) {
        if (!apply) { done.push({ ...c, performed: 'preview' }); continue; }
        try {
          if (c.action === 'delete') {
            await client.query(`DROP TABLE IF EXISTS ${c.child}`);
            done.push({ ...c, performed: 'dropped' });
          } else if (c.action === 'archive') {
            if (!s3) log.warn('ARCHIVE_S3_BUCKET unset — detaching only; export before dropping', { child: c.child });
            await client.query(`ALTER TABLE ${c.parent} DETACH PARTITION ${c.child}`);
            done.push({ ...c, performed: 'detached', export_target: s3 });
          } else { // anonymise → delegated
            log.warn('anonymise delegated to per-table PII job', { child: c.child });
            done.push({ ...c, performed: 'skipped_anonymise' });
          }
          log.info('partition processed', { child: c.child, action: c.action });
        } catch (err) {
          // lock_timeout or busy partition: skip, retry next run (do NOT fail the whole job)
          log.warn('partition skipped (will retry next run)', { child: c.child, error: err.message });
          done.push({ ...c, performed: 'skipped_error', error: err.message });
        }
      }
      recordDetail('total_cold', all.length);
      recordDetail('acted', done.length);
      recordDetail('applied', apply);
      return { totalCold: all.length, batch, acted: done, remaining: Math.max(0, all.length - candidates.length) };
    }),
  );

  const r = summary.result || {};
  if (args.has('json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return; }
  log.info(`${apply ? 'APPLIED' : 'DRY-RUN'} complete`, { cold: r.totalCold, acted: (r.acted || []).length, remaining: r.remaining });
  for (const a of r.acted || []) log.info(`  ${a.performed}`, { child: a.child, upper: a.upperBound, policy: a.action });
  if (!apply && (r.acted || []).length) log.info('re-run with --apply to execute');
}

main().catch((err) => { makeLogger('archive-partitions').error('FATAL', { error: err.message }); process.exit(1); });
