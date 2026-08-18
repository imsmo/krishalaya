// PC-56 TENANT-4d-5 CHAIN REPAIR · the migration chain could not be applied to a fresh database, and the gate
// that exists to prove it could BUILDS has been red since migration 0057.
//
// Every assertion here is a guard against a defect that actually shipped, expressed so that a future migration
// reintroducing it fails a unit test instead of a production deploy. None of it needs a database: the failures
// were all decidable from the files, which is exactly why it is galling that they were not decided.
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.join(__dirname, '../../../../../..');
const MIG = path.join(REPO, 'db/migrations');
const SEEDS = path.join(REPO, 'db/seeds/core');

const files = () => fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => fs.readFileSync(path.join(MIG, f), 'utf8');
const seed = (f: string) => fs.readFileSync(path.join(SEEDS, f), 'utf8');
/** SQL with `--` comment lines stripped, so an assertion is about statements and not about prose. */
const sql = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const REPAIR = '0056a_reference_data_the_chain_depends_on.sql';

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · the chain applies in the order the runner actually applies it', () => {
  it('0056a sorts strictly between 0056 and 0057 — which is the whole reason it can fix them', () => {
    // `db/scripts/migrate.js` sorts by FILENAME and parses no numbers. A fix for 0057 has to sort before it,
    // and a migration numbered 0150 is unreachable behind a chain that halts at 0057.
    const all = files();
    const i = all.indexOf(REPAIR);
    expect(i).toBeGreaterThan(-1);
    expect(all[i - 1]).toMatch(/^0056_/);
    expect(all[i + 1]).toMatch(/^0057_/);
    // …and the runner really does sort this way, rather than by a parsed integer.
    const runner = fs.readFileSync(path.join(REPO, 'db/scripts/migrate.js'), 'utf8');
    expect(runner).toContain(".filter((f) => f.endsWith('.sql'))");
    expect(runner).toContain('.sort()');
  });

  it('the runner stops the CHAIN on a failure — so the first broken file hides every later one', () => {
    const runner = fs.readFileSync(path.join(REPO, 'db/scripts/migrate.js'), 'utf8');
    expect(runner).toContain("await client.query('BEGIN')");
    // ROLLBACK then `return` — not `continue`. This is why one bad file meant 0057–0149 had never applied.
    expect(runner).toMatch(/ROLLBACK[\s\S]{0,400}return;/);
  });

  it('0056a is idempotent — every insert is guarded, so a seeded database is untouched', () => {
    const s = sql(read(REPAIR));
    const inserts = s.match(/INSERT INTO/g) ?? [];
    const guards = s.match(/WHERE NOT EXISTS/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(5);
    expect(guards.length).toBe(inserts.length);
    // No ON CONFLICT shortcuts: several of these tables have no unique constraint on the column being matched,
    // and a guard that silently does nothing is what this whole wave is about.
    expect(s).not.toContain('ON CONFLICT');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · 0056a duplicates the seeds EXACTLY, or it is a second source of truth', () => {
  /** Pull the literal codes a VALUES/(…) block mentions for a given table in a file. */
  const codesIn = (text: string, table: string, re: RegExp) => {
    const i = text.indexOf(`INSERT INTO ${table} `);
    if (i < 0) return new Set<string>();
    const block = text.slice(i, text.indexOf(';', i));
    return new Set([...block.matchAll(re)].map((m) => m[1]));
  };

  it('every language, role, lookup type, provider, currency and country it guarantees is in a seed too', () => {
    const r = sql(read(REPAIR));
    const pairs: Array<[string, RegExp, string]> = [
      ['languages',             /\('([a-z]{2})',/g,        '0001_languages.sql'],
      ['lookup_types',          /\('([a-z_]+)',/g,         '0005_lookup_vocabularies.sql'],
      ['roles',                 /\('([a-z_]+)',/g,         '0004_roles_permissions.sql'],
      ['integration_providers', /\('([a-z0-9]+)',/g,       '0010_integration_providers.sql'],
    ];
    for (const [table, re, seedFile] of pairs) {
      const mine = codesIn(r, table, re);
      expect(mine.size).toBeGreaterThan(0);
      const theirs = codesIn(seed(seedFile), table, re);
      for (const c of mine) {
        // `msg91` is the one deliberate exception and it is the point of 0123's defect: the SMS/OTP provider
        // is registered NOWHERE in the repository, not even in a seed, so 0056a is its only home.
        if (c === 'msg91') continue;
        expect({ table, code: c, inSeed: theirs.has(c) }).toEqual({ table, code: c, inSeed: true });
      }
    }
    // The rupee and India, which 0140's tax rules need.
    expect(r).toContain("'INR', 'Indian Rupee', '₹', 2, true");
    expect(seed('0003_currencies_units.sql')).toContain("('INR','Indian Rupee','₹',2,true)");
    expect(r).toContain("'IN', 'India', 'INR', '+91', 'Asia/Kolkata', true");
    expect(seed('0002_countries_regions_gj_mh.sql')).toContain("('IN','India','INR','+91','Asia/Kolkata',true)");
  });

  it('and it stays MINIMAL — it must never become a second copy of a catalogue', () => {
    const r = sql(read(REPAIR));
    // Three launch languages out of eighteen; nine role codes out of twenty-seven. If a later wave starts
    // adding "just one more" here, this fails and sends them to the seed instead.
    expect((r.match(/'(hi|en|gu)',/g) ?? []).length).toBe(3);
    // The role ceiling is RELATIVE, not a magic number. A fixed cap would have to be bumped every time a
    // genuinely-needed role is added — which turns the guard into a chore and teaches people to raise it without
    // thinking. "Fewer than half the catalogue" keeps the actual meaning: this file is a minimal set the chain
    // depends on, and the day it holds most of the roles it has become the second copy it promises not to be.
    const roleBlock = r.slice(r.indexOf('INSERT INTO roles '), r.indexOf(';', r.indexOf('INSERT INTO roles ')));
    const mine = (roleBlock.match(/\('[a-z_]+',/g) ?? []).length;
    const seeded = sql(seed('0004_roles_permissions.sql')).match(/\('[a-z_]+','[^']+','(platform|tenant)'/g)!.length;
    expect(seeded).toBeGreaterThan(20);
    expect(mine).toBeGreaterThan(0);
    expect(mine * 2).toBeLessThan(seeded);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · no migration may depend on reference data that arrives after it', () => {
  /** Files at or after 0057 — everything the halt had hidden. */
  const later = () => files().filter((f) => f >= '0057');

  const guaranteed = (table: string, re: RegExp) => {
    const r = sql(read(REPAIR));
    const i = r.indexOf(`INSERT INTO ${table} `);
    const block = i < 0 ? '' : r.slice(i, r.indexOf(';', i));
    return new Set([...block.matchAll(re)].map((m) => m[1]));
  };

  it('every ROLE code a later migration binds to is guaranteed by 0056a', () => {
    // 0125 fails LOUDLY without them. 0128/0139/0142/0143/0144 do not — `SELECT r.id FROM roles WHERE code=…`
    // inserts ZERO ROWS and succeeds, so a permission grant silently grants nothing. That asymmetry is why
    // this must be checked statically and not left to a green migration log.
    const ok = guaranteed('roles', /\('([a-z_]+)',/g);
    const referenced = new Set<string>();
    for (const f of later()) {
      const s = sql(read(f));
      for (const m of s.matchAll(/INSERT INTO (?:role_permissions|payout_purpose_roles)[\s\S]{0,4000}?;/g)) {
        for (const c of m[0].matchAll(/r?\.?code\s*=\s*'([a-z_]+)'/g)) referenced.add(c[1]);
        for (const c of m[0].matchAll(/\(\s*'[a-z_]+'\s*,\s*'([a-z_]+)'\s*,/g)) referenced.add(c[1]);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    for (const c of referenced) expect({ role: c, guaranteed: ok.has(c) }).toEqual({ role: c, guaranteed: true });
  });

  it('every LOOKUP TYPE a later migration extends is guaranteed by 0056a or created by an earlier migration', () => {
    const ok = guaranteed('lookup_types', /\('([a-z_]+)',/g);
    for (const f of later()) {
      const s = sql(read(f));
      const selfCreated = new Set([...s.matchAll(/INSERT INTO lookup_types[\s\S]{0,2000}?;/g)]
        .flatMap((m) => [...m[0].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])));
      for (const m of s.matchAll(/INSERT INTO lookup_values[\s\S]{0,8000}?;/g)) {
        const used = new Set([
          ...[...m[0].matchAll(/'([a-z_]+)'\s*AS type_code/g)].map((x) => x[1]),
          ...[...m[0].matchAll(/SELECT\s+'([a-z_]+)'/g)].map((x) => x[1]),
          ...[...m[0].matchAll(/\(\s*'([a-z_]+)'\s*,\s*NULL/g)].map((x) => x[1]),
        ]);
        for (const t of used) {
          expect({ file: f, type: t, ok: ok.has(t) || selfCreated.has(t) })
            .toEqual({ file: f, type: t, ok: true });
        }
      }
    }
  });

  it('every migration seeding notification copy is covered for its LANGUAGE', () => {
    const langs = guaranteed('languages', /\('([a-z]{2})',/g);
    for (const f of later()) {
      const s = sql(read(f));
      for (const m of s.matchAll(/INSERT INTO notification_templates[\s\S]{0,20000}?;/g)) {
        for (const l of m[0].matchAll(/,\s*'([a-z]{2})'\s*,\s*NULL/g)) {
          expect({ file: f, lang: l[1], guaranteed: langs.has(l[1]) })
            .toEqual({ file: f, lang: l[1], guaranteed: true });
        }
      }
    }
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · the four defects that were decidable from a column list', () => {
  it('no migration foreign-keys a PARTITIONED table by id alone', () => {
    // 0082 wrote `REFERENCES shipments(id)`. `shipments` is PARTITIONED BY RANGE (created_at) with a composite
    // (id, created_at) primary key, so Postgres refused it — "there is no unique constraint matching given keys".
    // 0070 had already met and documented this twelve migrations earlier.
    const partitioned = ['shipments', 'notifications', 'ledger_entries', 'audit_log', 'outbox_events'];
    for (const f of files()) {
      const s = sql(read(f));
      for (const t of partitioned) {
        expect({ file: f, ref: `${t}(id)`, present: new RegExp(`REFERENCES\\s+${t}\\s*\\(\\s*id\\s*\\)`).test(s) })
          .toEqual({ file: f, ref: `${t}(id)`, present: false });
      }
    }
  });

  it("every setting_definitions risk_class is one of 0121's three", () => {
    // 0145 and 0148 both wrote 'operational', which 0121's CHECK forbids — so W118's usage-alert threshold and
    // W120's `billing.grace_days` were settings that could never be inserted into any database.
    const allowed = new Set(['ordinary', 'money_path', 'security']);
    const check = sql(read('0121_config_control_plane.sql'));
    for (const v of allowed) expect(check).toContain(`'${v}'`);
    for (const f of files()) {
      const s = sql(read(f));
      for (const m of s.matchAll(/INSERT INTO setting_definitions[\s\S]{0,3000}?;/g)) {
        for (const c of m[0].matchAll(/'[a-z_.]+',\s*'[a-z]+',\s*'[a-z]+',\s*'([a-z_]+)'/g)) {
          expect({ file: f, riskClass: c[1], allowed: allowed.has(c[1]) })
            .toEqual({ file: f, riskClass: c[1], allowed: true });
        }
      }
    }
  });

  it('0108 no longer reads columns `consent_purposes` does not have', () => {
    // It selected `p.created_at` twice and filtered on `p.deleted_at`; that table is one of the few with no
    // `add_std_columns` call, so it has exactly four columns. TypeScript never sees a column list — the fourth
    // time this programme has met that class (0140's varchar(10), 0139's NULL CHECK, 0142's r.tenant_id).
    const s = sql(read('0108_consent_notice_versions.sql'));
    expect(s).not.toContain('p.created_at');
    expect(s).not.toContain('p.deleted_at');
    // And the repair is more honest than the intent: an unknown publication date is NULL, not a borrowed one.
    expect(s).toContain('NULL, now(), NULL, true');
    const c0003 = sql(read('0003_identity_access.sql'));
    const decl = c0003.slice(c0003.indexOf('CREATE TABLE consent_purposes'));
    expect(decl.slice(0, decl.indexOf(');'))).not.toContain('created_at');
  });

  it('0123 registers the providers it names, msg91 included', () => {
    const r = sql(read(REPAIR));
    expect(r).toContain("'msg91'");
    // The SMS/OTP provider carrying every one-time password on the platform was in no seed and no migration.
    const anySeedHasIt = fs.readdirSync(SEEDS).some((f) => seed(f).includes("'msg91'"));
    expect(anySeedHasIt).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-5 · what the deployment gate found once it could run', () => {
  it('0150 closes the four tenant tables that had NO row-level security', () => {
    const s = sql(read('0150_chain_gate_completion.sql'));
    for (const t of ['correction_drafts', 'listing_moderation_orders', 'moderation_action_notices', 'support_coaching_records']) {
      expect(s).toContain(`'${t}'`);
    }
    expect(s).toContain('ENABLE ROW LEVEL SECURITY');
    expect(s).toContain('FORCE ROW LEVEL SECURITY');
    // Per-verb, and every write verb carries a WITH CHECK: a FOR ALL policy with only USING filters reads and
    // permits an INSERT into ANOTHER tenant, which is on this programme's own defect list.
    expect(s).toContain('FOR INSERT WITH CHECK (tenant_id = current_tenant_id())');
    expect(s).toContain('FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())');
    expect(s).not.toMatch(/FOR ALL[\s\S]{0,120}USING[^;]*;/);
  });

  it('and the seven that had RLS enabled but not FORCED — where the owner walked through', () => {
    const s = sql(read('0150_chain_gate_completion.sql'));
    for (const t of ['charge_change_proposals', 'credit_notes', 'notification_template_versions',
                     'refund_approvals', 'settlement_cycles', 'subscription_plan_changes',
                     'tenant_member_suspensions']) {
      expect(s).toContain(`'${t}'`);
    }
  });

  it('a retention policy naming a missing table is skipped and REPORTED, not fatal', () => {
    // 0107 seeded a policy for `user_devices`; the table is `push_devices`. `$1::regclass` throws on a missing
    // relation, so ONE bad row aborted the archive run and every other table's retention went unenforced.
    const s = sql(read('0150_chain_gate_completion.sql'));
    expect(s).toContain("SET table_name = 'push_devices'");
    const script = fs.readFileSync(path.join(REPO, 'db/scripts/archive-partitions.js'), 'utf8');
    expect(script).toContain('to_regclass($1)');
    expect(script).toContain('unknownTables.push(p.table_name); continue;');
    expect(script).toContain('WARNING');
  });

  it('every table 0107 writes a retention policy for actually exists in the schema', () => {
    // The generalised guard: `data_retention_policies.table_name` is free text and cannot be foreign-keyed, so
    // this is the only place a typo can be caught before an archive run.
    const s = sql(read('0107_dsr_erasure_evidence.sql'));
    const i = s.indexOf('INSERT INTO data_retention_policies');
    const block = s.slice(i, s.indexOf(';', i));
    const named = [...block.matchAll(/\('([a-z_]+)',/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(5);
    const created = new Set<string>();
    for (const f of files()) for (const m of sql(read(f)).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/g)) created.add(m[1]);
    const repaired = new Set(
      [...sql(read('0150_chain_gate_completion.sql')).matchAll(/table_name = '([a-z_]+)'/g)].map((m) => m[1]));
    for (const t of named) {
      // `user_devices` is the one 0150 corrects; anything else missing is a new defect.
      expect({ table: t, ok: created.has(t) || repaired.has(t) }).toEqual({ table: t, ok: true });
    }
  });
});
