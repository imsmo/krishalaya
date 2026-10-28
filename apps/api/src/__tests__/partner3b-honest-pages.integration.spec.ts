// apps/api/src/__tests__/partner3b-honest-pages.integration.spec.ts · PC-56 PARTNER-3b · WHAT THE INSURER DOES NOT HOLD — EVIDENCE, SURVEYORS,
// SURVEYS, FLAGS — LIVE proof that the six honest pages are composed from PARTNER-3a's THREE audited reads and nothing else (the real AppModule
// over HTTP, real Postgres + RLS; this wave adds NO migration, NO route, NO permission, NO flag and NO event — only this spec).
//
// Fixture (the 3a path): ONE insurer A with a product and policies across TWO tenants, and ONE rival insurer B with one claim. A's claims cover
// every survey stage — two `survey_scheduled` (to prove the order), two `intimated`, one `docs_pending`, one `surveyed` (its `survey_report`
// carrying a whole `damagePercent` AND free-text `notes`, with a real surveyor named) and one `approved` (past the stages). Every claim has a
// real claimant and a description the read must never return. `partner_console` ON, `insurance` ON.
//   (1) the SURVEYS page's read: `GET /v1/partner/insurance/claims?status=survey_scheduled` → only `survey_scheduled`, OLDEST first; each of the
//       four stages filters to its own rows; a status outside the machine is refused (422) — the page's own whitelist never sends one
//   (2) the SURVEY REPORT page's read: `?status=surveyed` and the detail → `damagePercent` a NUMBER, and NO `notes` / `surveyReport` /
//       `surveyorUserId` key anywhere (deep-key over every response), no claimant, no surveyor, no description, no tenant id
//   (3) the EVIDENCE and SURVEYS pages' counts: `/counts` → the four survey-stage counts equal the fixture (awaiting = intimated +
//       docs_pending), inside the FY window; no media count exists to ask for
//   (4) the TEN 3b act routes are ABSENT — 404, pinned: evidence re-shoot, evidence verify, surveyors, survey confirm / accept / query, claim
//       flag, and the three reads an evidence / surveyor / fraud page would need if it held anything
//   (5) ONE audit row `partner.claims.read` per list / counts / detail call — so the surveys page (two reads) writes exactly TWO rows per view,
//       and the evidence, surveyors and fraud pages write one, one and none
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
/** Nothing of the report but the one number, nothing of the person at all. */
const FORBIDDEN_KEY = /^(claimantUserId|claimant_user_id|claimant|description|surveyorUserId|surveyor_user_id|surveyor|surveyReport|survey_report|notes|note|payoutId|payout_id|tenantId|tenant_id|createdBy|created_by|updatedBy|updated_by|holderUserId|phone|name|media|mediaUrl|evidence|photos|videos|documents|attachments)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const NOTE = 'Surveyor note: the shed roof was torn open; the owner was in tears';
const DESC = 'The storm took the roof off and the crop with it, please help';

run('PC-56 PARTNER-3b · the honest pages read PARTNER-3a and nothing else — no evidence, no surveyor, no survey act, no flag (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const T2 = randomUUID();
  const IA = randomUUID(); const IB = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const pol: Record<string, string> = {};
  const clm: Record<string, string> = {};
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  const ev: Record<string, string> = {};

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone, name };
  };
  const membership = (userKey: string, partnerId: string, role: string) => admin.query(
    `INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`, [people[userKey].id, partnerId, role]);
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const signIn = async (key: string) => {
    await resetRates();
    const { code } = await otp.issue(people[key].phone);
    const r = await request(http).post('/v1/partner/auth/verify').send({ phone: people[key].phone, code });
    expect([key, r.status]).toEqual([key, 201]);
    tok[key] = r.body.data.accessToken;
  };
  const bearer = (key: string) => ({ authorization: `Bearer ${tok[key]}` });
  const get = async (key: string, path: string, query: Record<string, unknown> = {}) => {
    const r = await request(http).get(path).query(query).set(bearer(key));
    responses.push(r.body);
    return r;
  };
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const audits = async (partnerId: string) => (await admin.query(
    `SELECT entity_type, entity_id, new_value FROM audit_log WHERE action = 'partner.claims.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'insurance']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Surveys Fixture Growers Collective'); await makeTenant(admin, T2, 'Surveys Fixture Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Insurer A3b', 'insurer'), ($3, $4, 'Fixture Insurer B3b', 'insurer')`,
      [IA, `p3ba_${sfx}`, IB, `p3bb_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Insurer A3b admin'], ['aViewer', 'Insurer A3b viewer'], ['bViewer', 'Insurer B3b viewer'],
      ['h1', 'Claimant Sarla One'], ['h2', 'Claimant Mohan Two'], ['h3', 'Claimant Lata Three'], ['sv', 'Surveyor Nilesh']] as const) await user(k, n);
    await membership('aAdmin', IA, 'partner_admin'); await membership('aViewer', IA, 'partner_viewer'); await membership('bViewer', IB, 'partner_viewer');
    for (const r of (await admin.query(`SELECT id, code FROM lookup_values WHERE type_code = 'claim_event' AND tenant_id IS NULL`)).rows) ev[r.code] = r.id;
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code <> 'claim_event' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const product = async (key: string, partnerId: string, name: string) => {
      prod[key] = (await admin.query(
        `INSERT INTO insurance_products (partner_id, product_kind_id, default_name, premium_calc) VALUES ($1, $2, $3, '{"kind":"pct_of_sum_insured","bps":320}'::jsonb) RETURNING id`,
        [partnerId, kind, name])).rows[0].id;
    };
    await product('a1', IA, 'Fixture survey cover'); await product('b1', IB, 'Fixture rival cover');
    const policy = async (key: string, tenantId: string, holderKey: string, productKey: string, subject: string, sum: string) => {
      pol[key] = (await admin.query(
        `INSERT INTO insurance_policies (tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, 1000, 'active', current_date - 200, current_date + 165) RETURNING id`, [tenantId, people[holderKey].id, prod[productKey], subject, randomUUID(), sum])).rows[0].id;
    };
    await policy('p1', T1, 'h1', 'a1', 'animal', '11000000');
    await policy('p2', T2, 'h2', 'a1', 'crop_season', '8000000');
    await policy('q1', T2, 'h3', 'b1', 'animal', '9000000');
    const claim = async (key: string, tenantId: string, policyKey: string, claimantKey: string, status: string, eventId: string, at: string,
      extra: { surveyor?: boolean; report?: unknown; approved?: string } = {}) => {
      clm[key] = (await admin.query(
        `INSERT INTO insurance_claims (tenant_id, policy_id, claimant_user_id, event_date, event_type_id, description, status, intimated_within_72h, surveyor_user_id, survey_report,
                                       approved_minor, created_at, created_by)
         VALUES ($1, $2, $3, current_date - 20, $4, $5, $6::claim_status, true, $7, $8::jsonb, $9, $10::timestamptz, $3) RETURNING id`,
        [tenantId, pol[policyKey], people[claimantKey].id, eventId, DESC, status, extra.surveyor ? people.sv.id : null,
          extra.report ? JSON.stringify(extra.report) : null, extra.approved ?? null, at])).rows[0].id;
    };
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    // A's claims, oldest first in the order below — two in each of the first two stages matter for the ORDER assertion
    await claim('i1', T1, 'p1', 'h1', 'intimated', ev.death, ago(90));
    await claim('i2', T2, 'p2', 'h2', 'intimated', ev.hail, ago(80));
    await claim('d1', T1, 'p1', 'h1', 'docs_pending', ev.flood, ago(70));
    await claim('s1', T1, 'p1', 'h1', 'survey_scheduled', ev.death, ago(60), { surveyor: true });
    await claim('s2', T2, 'p2', 'h2', 'survey_scheduled', ev.hail, ago(50), { surveyor: true });
    await claim('v1', T1, 'p1', 'h1', 'surveyed', ev.fire, ago(40), { surveyor: true, report: { damagePercent: 62, notes: NOTE, surveyedAt: ago(41) } });
    await claim('ap', T2, 'p2', 'h2', 'approved', ev.pest, ago(30), { surveyor: true, approved: '2850000', report: { damagePercent: 80, notes: NOTE } });
    // B's one claim — A must never see it through any 3b page
    await claim('b1', T2, 'q1', 'h3', 'survey_scheduled', ev.theft, ago(20), { surveyor: true });

    await setFlag('partner_console', true); await setFlag('insurance', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('insurance')]) await cache.del(k);
    for (const k of ['aAdmin', 'aViewer', 'bViewer']) await signIn(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) the surveys page\'s read: each of the four survey stages filters to its own claims, OLDEST first; a status off the machine is refused', async () => {
    const sched = await get('aViewer', '/v1/partner/insurance/claims', { status: 'survey_scheduled' });
    expect([sched.status, sched.status === 200 ? null : sched.body]).toEqual([200, null]);
    expect(sched.body.data.map((x: { id: string }) => x.id)).toEqual([clm.s1, clm.s2]);                 // oldest first
    expect(sched.body.data.every((x: { status: string }) => x.status === 'survey_scheduled')).toBe(true);
    expect(JSON.stringify(sched.body)).not.toContain(clm.b1);                                           // never the rival insurer's claim
    expect((await get('aViewer', '/v1/partner/insurance/claims', { status: 'intimated' })).body.data.map((x: { id: string }) => x.id)).toEqual([clm.i1, clm.i2]);
    expect((await get('aViewer', '/v1/partner/insurance/claims', { status: 'docs_pending' })).body.data.map((x: { id: string }) => x.id)).toEqual([clm.d1]);
    expect((await get('aViewer', '/v1/partner/insurance/claims', { status: 'surveyed' })).body.data.map((x: { id: string }) => x.id)).toEqual([clm.v1]);
    // the keyset holds inside a stage
    const p1 = await get('aViewer', '/v1/partner/insurance/claims', { status: 'survey_scheduled', limit: 1 });
    const p2 = await get('aViewer', '/v1/partner/insurance/claims', { status: 'survey_scheduled', limit: 1, cursor: p1.body.meta.nextCursor });
    const p3 = await get('aViewer', '/v1/partner/insurance/claims', { status: 'survey_scheduled', limit: 1, cursor: p2.body.meta.nextCursor });
    expect([p1.body.data.map((x: { id: string }) => x.id), p2.body.data.map((x: { id: string }) => x.id), p3.body.data]).toEqual([[clm.s1], [clm.s2], []]);
    // the page's own whitelist can only send one of the four; anything else would be refused by the API, not silently widened
    for (const bad of ['paying', 'awaiting', 'scheduled']) expect([bad, (await get('aViewer', '/v1/partner/insurance/claims', { status: bad })).status]).toEqual([bad, 422]);
    // B sees only B's claim through the same read
    expect((await get('bViewer', '/v1/partner/insurance/claims', { status: 'survey_scheduled' })).body.data.map((x: { id: string }) => x.id)).toEqual([clm.b1]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) the survey report page\'s read: the recorded damage percentage is a NUMBER, and no note, report, surveyor, claimant or description key exists anywhere', async () => {
    const one = await get('aViewer', `/v1/partner/insurance/claims/${clm.v1}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: clm.v1, status: 'surveyed', damagePercent: 62, eventTypeCode: 'fire', computedAt: expect.any(String) });
    expect(typeof one.body.data.damagePercent).toBe('number');
    expect(Number.isInteger(one.body.data.damagePercent)).toBe(true);
    // a claim that has not been surveyed carries NULL — the page's "no survey recorded yet" branch
    const notYet = await get('aViewer', `/v1/partner/insurance/claims/${clm.s1}`);
    expect(notYet.body.data).toMatchObject({ status: 'survey_scheduled', damagePercent: null });
    await get('aViewer', '/v1/partner/insurance/claims/counts');
    await get('aViewer', '/v1/partner/insurance/claims');
    expect(responses.length).toBeGreaterThanOrEqual(10);
    for (const body of responses) {
      expect(deepKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(body);
      for (const p of ['h1', 'h2', 'h3', 'sv']) {
        expect([p, json.includes(people[p].id), json.includes(people[p].name), json.includes(people[p].phone)]).toEqual([p, false, false, false]);
      }
      expect([json.includes(NOTE), json.includes(DESC), json.includes('tears'), json.includes(T1), json.includes(T2)]).toEqual([false, false, false, false, false]);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) the evidence and surveys pages\' counts: the four survey-stage counts equal the fixture inside the FY window — claims only, never media', async () => {
    const r = await get('aViewer', '/v1/partner/insurance/claims/counts');
    expect(r.status).toBe(200);
    expect(r.body.data.byStatus).toMatchObject({ intimated: 2, docs_pending: 1, survey_scheduled: 2, surveyed: 1, approved: 1 });
    expect(r.body.data).toMatchObject({ total: 7, timeZone: 'Asia/Kolkata', from: expect.stringMatching(/^\d{4}-04-01$/), to: expect.stringMatching(/^\d{4}-04-01$/) });
    // what the evidence page prints: awaiting a survey = intimated + documents pending; scheduled; surveyed
    const b = r.body.data.byStatus as Record<string, number>;
    expect([b.intimated + b.docs_pending, b.survey_scheduled, b.surveyed]).toEqual([3, 2, 1]);
    // the counts are integers and carry no media figure, no amount and no ratio of any kind
    expect(Object.values(b).every((n) => Number.isInteger(n))).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/photo|video|media|document|attachment|Minor|ratio|rate|percent/i);
    // B's book is B's own
    expect((await get('bViewer', '/v1/partner/insurance/claims/counts')).body.data.byStatus).toMatchObject({ survey_scheduled: 1, surveyed: 0 });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) the TEN 3b act and read routes do not exist in the partner realm — 404, pinned: every 3b page is composed from the three 3a reads and nothing else', async () => {
    const posts = [
      `/v1/partner/insurance/claims/${clm.v1}/evidence/re-shoot`,
      `/v1/partner/insurance/claims/${clm.v1}/evidence/verify`,
      '/v1/partner/surveyors',
      `/v1/partner/insurance/surveys/${clm.s1}/confirm`,
      `/v1/partner/insurance/surveys/${clm.v1}/accept`,
      `/v1/partner/insurance/surveys/${clm.v1}/query`,
      `/v1/partner/insurance/claims/${clm.i1}/flag`,
    ];
    for (const p of posts) {
      const r = await request(http).post(p).set(bearer('aAdmin')).send({ reason: 'x', flag: 'duplicate_media', surveyorUserId: people.sv.id });
      expect([p, r.status]).toEqual([p, 404]);
    }
    const gets = ['/v1/partner/insurance/evidence', '/v1/partner/surveyors', '/v1/partner/insurance/fraud-flags'];
    for (const p of gets) {
      const r = await request(http).get(p).set(bearer('aAdmin'));
      expect([p, r.status]).toEqual([p, 404]);
    }
    expect(posts.length + gets.length).toBe(10);
    // and nothing in the database moved: no claim status changed, no survey report was written or touched
    const rows = (await admin.query(`SELECT status::text, survey_report FROM insurance_claims WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [[clm.s1, clm.v1]])).rows;
    expect(rows.map((x) => x.status)).toEqual(['survey_scheduled', 'surveyed']);
    expect([rows[0].survey_report, (rows[1].survey_report as { damagePercent: number }).damagePercent]).toEqual([null, 62]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) one audit row per read: the surveys page writes TWO (list + counts), the evidence page ONE, the report page ONE, surveyors and fraud NONE', async () => {
    const before = (await audits(IA)).length;
    // one view of /insurer/surveys: the stage list, then the counts for the tab labels
    await get('aViewer', '/v1/partner/insurance/claims', { status: 'survey_scheduled' });
    await get('aViewer', '/v1/partner/insurance/claims/counts');
    let rows = (await audits(IA)).slice(before);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['claims', 'claims_counts']);
    expect(rows[0].new_value).toMatchObject({ partnerId: IA, realm: 'partner', listed: 2, status: 'survey_scheduled', page: 'first' });
    expect(rows[1].new_value).toMatchObject({ claims: 7 });
    // one view of /insurer/claims/evidence: the counts only
    const n1 = (await audits(IA)).length;
    await get('aViewer', '/v1/partner/insurance/claims/counts');
    expect((await audits(IA)).slice(n1).map((r) => [r.new_value.surface, r.entity_type, r.entity_id])).toEqual([['claims_counts', 'financial_partner', IA]]);
    // one view of /insurer/surveys/:id/report (or /insurer/claims/evidence/:id): the detail only
    const n2 = (await audits(IA)).length;
    await get('aViewer', `/v1/partner/insurance/claims/${clm.v1}`);
    rows = (await audits(IA)).slice(n2);
    expect(rows.map((r) => [r.new_value.surface, r.entity_type, r.entity_id, r.new_value.found])).toEqual([['claim', 'insurance_claim', clm.v1, true]]);
    // /insurer/surveyors and /insurer/claims/fraud make NO read at all, so they add NO row
    const n3 = (await audits(IA)).length;
    await request(http).get('/v1/config/flags');
    expect((await audits(IA)).length).toBe(n3);
    // and no audit row of this wave carries a figure, a person or a note
    for (const r of (await audits(IA))) {
      const allowed = new Set(['partnerId', 'realm', 'surface', 'listed', 'status', 'page', 'found', 'from', 'to', 'claims']);
      expect(Object.keys(r.new_value).filter((k) => !allowed.has(k))).toEqual([]);
      const json = JSON.stringify(r);
      for (const p of ['h1', 'h2', 'sv']) expect(json.includes(people[p].id)).toBe(false);
      expect([json.includes(NOTE), json.includes(DESC), 'damagePercent' in r.new_value]).toEqual([false, false, false]);
    }
  });
});
