#!/usr/bin/env node
/**
 * db/scripts/mint-partner-key.js · PC-55 A10. Mints a partner API key (partner_api_keys, migration 0090).
 *
 * WHY THIS IS A SCRIPT AND NOT AN ENDPOINT. Migration 0090 revoked INSERT on partner_api_keys from kv_app and
 * kv_relay: no request handler in this platform can create a credential. Onboarding a bank is a deliberate human act
 * with a contract behind it, so it runs as a named operator on an owner/admin connection, leaves an unambiguous
 * trail, and cannot be triggered by a bug in a controller. (When the admin console grows a partner-onboarding screen
 * it must go through kv_admin — the audited god-mode realm — not through kv_app.)
 *
 * THE SECRET IS PRINTED ONCE AND NEVER RECOVERABLE. We store only SHA-256(secret). If it is lost, mint a new key and
 * revoke the old one — that is the honest failure mode, and it is the one a partner's security team expects.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node db/scripts/mint-partner-key.js \
 *     --partner <financial_partners.id|code> --name "ICICI Lombard prod" \
 *     --scopes insurance:book:read[,lending:book:read] [--env live|test] [--rate 1000]
 *
 *   ... --revoke <key_prefix>        # permanent: sets revoked_at (is_active alone can never resurrect it)
 *   ... --list [--partner <id|code>] # prefixes, scopes, last_used_at — never any secret
 *
 * The key SHAPE here must stay byte-identical to apps/api/src/modules/partner-api/domain/partner-key.rules.ts
 * (`formatKey`/`parseKey`). partner-api.spec.ts pins that contract with a literal key built the way this script
 * builds one, so a divergence fails the suite rather than the integration.
 */
const { Client } = require('pg');
const { randomBytes, createHash } = require('node:crypto');

const ALLOWED_SCOPES = ['partner:identity:read', 'insurance:book:read', 'lending:book:read'];

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
function die(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) die('DATABASE_URL is required (owner/admin connection — kv_app cannot mint keys by design).');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (arg('list')) return await list(client, arg('partner'));
    const revoke = arg('revoke');
    if (typeof revoke === 'string') return await revokeKey(client, revoke);
    return await mint(client);
  } finally {
    await client.end();
  }
}

async function resolvePartner(client, ref) {
  if (!ref || ref === true) die('--partner <financial_partners.id|code> is required.');
  const r = await client.query(
    `SELECT id, default_name, partner_kind FROM financial_partners
      WHERE (id::text = $1 OR code = $1) AND deleted_at IS NULL`, [String(ref)]);
  if (!r.rows[0]) die(`No financial_partners row matches '${ref}'.`);
  return r.rows[0];
}

async function mint(client) {
  const partner = await resolvePartner(client, arg('partner'));
  const name = arg('name');
  if (typeof name !== 'string' || name.trim().length < 3) die('--name "<operator-facing label>" is required.');
  const env = arg('env', 'test');
  if (env !== 'live' && env !== 'test') die("--env must be 'live' or 'test'.");
  const rate = Number.parseInt(String(arg('rate', '1000')), 10);
  if (!Number.isFinite(rate) || rate <= 0) die('--rate must be a positive integer (requests per hour).');

  const requested = String(arg('scopes', '')).split(',').map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) die(`--scopes is required. Allowed: ${ALLOWED_SCOPES.join(', ')}`);
  const unknown = requested.filter((s) => !ALLOWED_SCOPES.includes(s));
  if (unknown.length) die(`Unknown scope(s): ${unknown.join(', ')}. Allowed: ${ALLOWED_SCOPES.join(', ')}`);
  // Every key can check itself; a book scope must be asked for explicitly.
  const scopes = [...new Set(['partner:identity:read', ...requested])];

  const handle = randomBytes(8).toString('hex');            // 16 lower-hex chars — matches PREFIX_RE
  const secret = randomBytes(32).toString('base64url');     // 256 bits of entropy; never stored
  const prefix = `kv_pk_${env}_${handle}`;
  const key = `${prefix}.${secret}`;
  const keyHash = createHash('sha256').update(secret, 'utf8').digest('hex');

  const r = await client.query(
    `INSERT INTO partner_api_keys (partner_id, name, key_prefix, key_hash, scopes, rate_limit_per_hour, is_active)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,true) RETURNING id, created_at`,
    [partner.id, String(name).trim(), prefix, keyHash, JSON.stringify(scopes), rate]);

  console.log(`
✔ Minted partner API key
  partner      ${partner.default_name} (${partner.partner_kind})  ${partner.id}
  key id       ${r.rows[0].id}
  prefix       ${prefix}
  scopes       ${scopes.join(', ')}
  quota        ${rate} requests/hour (per key)
  created      ${new Date(r.rows[0].created_at).toISOString()}

  KEY (shown ONCE — store it in the partner's secret manager now):

    ${key}

  Send it over a channel the partner's security team accepts. It is not recoverable: if it is lost,
  mint a new one and revoke this prefix. The realm also stays behind the 'partner_api' feature flag —
  until that flag is enabled, this key will correctly get 404s.
`);
}

async function revokeKey(client, prefix) {
  const r = await client.query(
    `UPDATE partner_api_keys SET revoked_at = now(), is_active = false, updated_at = now()
      WHERE key_prefix = $1 AND revoked_at IS NULL RETURNING id, partner_id`, [prefix]);
  if (!r.rows[0]) die(`No ACTIVE key with prefix '${prefix}' (already revoked, or never existed).`);
  console.log(`\n✔ Revoked ${prefix} (key ${r.rows[0].id}) — permanently. Re-enabling is_active cannot restore it.\n`);
}

async function list(client, ref) {
  const params = [];
  let where = 'WHERE k.deleted_at IS NULL';
  if (ref && ref !== true) { const p = await resolvePartner(client, ref); params.push(p.id); where += ` AND k.partner_id = $1`; }
  const r = await client.query(
    `SELECT k.key_prefix, k.name, k.scopes, k.rate_limit_per_hour, k.is_active, k.revoked_at, k.last_used_at,
            f.default_name AS partner
       FROM partner_api_keys k JOIN financial_partners f ON f.id = k.partner_id
      ${where} ORDER BY k.created_at DESC`, params);
  if (r.rows.length === 0) { console.log('\n(no partner API keys)\n'); return; }
  console.log('');
  for (const k of r.rows) {
    const state = k.revoked_at ? `REVOKED ${new Date(k.revoked_at).toISOString()}` : k.is_active ? 'active' : 'inactive';
    console.log(`  ${k.key_prefix}  ${state.padEnd(34)} ${k.partner} — ${k.name}`);
    console.log(`      scopes ${(k.scopes || []).join(', ')} | ${k.rate_limit_per_hour}/h | last used ${k.last_used_at ? new Date(k.last_used_at).toISOString() : 'never'}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
