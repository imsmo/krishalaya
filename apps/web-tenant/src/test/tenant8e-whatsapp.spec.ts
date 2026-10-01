// apps/web-tenant/src/test/tenant8e-whatsapp.spec.ts · PC-56 TENANT-8e · the broadcast plane and WhatsApp, in the console.
// The helpers; the pages' own promises read from their source (no client JS, the key in the FORM, no WhatsApp claim on
// /comms, every canon screen has a route); and every key a page can ask for exists ×3 — the literal ones, and every
// status / failure / refusal / refused-by-name entry read from the API's OWN lists (a second copy would agree exactly once).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  BROADCAST_ACT_KEYS, BROADCAST_FIELDS, BROADCAST_FORM_HREF, COMMS_HREF, HISTORY_STATUSES, MAX_CARRIED_BROADCAST, SCREEN_REFUSALS, WA_HUB_HREF, broadcastActHref,
  broadcastEditHref, broadcastHref, channelKey, exportDownloadHref, exportHref, failedByKey, failureKey, gapParts, historyHref, isBroadcastAct, isHistoryStatus, offeredActs,
  ownerKey, refusalsFor, refusedKey, resultParts, retryAsDraftHref, statusKey, statusTone, suppressedByKey, transportState,
} from '../features/comms/broadcasts';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/communication', rel), 'utf8');
function apiList(rel: string, constName: string): string[] {
  const s = api(rel);
  const i = s.indexOf(`${constName} = [`);
  if (i < 0) throw new Error(`${constName} not in ${rel}`);
  return [...s.slice(i, s.indexOf('] as const', i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}
const PAGES = [
  'app/comms/page.tsx', 'app/comms/new/page.tsx', 'app/comms/[id]/page.tsx', 'app/comms/[id]/act/page.tsx', 'app/comms/loading.tsx',
  'app/channels/whatsapp/page.tsx', 'app/channels/whatsapp/conversation/page.tsx', 'app/channels/whatsapp/templates/page.tsx',
  'app/channels/whatsapp/templates/editor/page.tsx', 'app/channels/whatsapp/broadcast/page.tsx', 'app/channels/whatsapp/settings/page.tsx',
  'app/channels/whatsapp/settings/edit/page.tsx', 'app/channels/whatsapp/exports/[id]/page.tsx', 'app/channels/whatsapp/loading.tsx',
  'components/WhatsAppRefusals.tsx', 'components/WhatsAppRefusalScreen.tsx',
];

describe('routes', () => {
  it('every canon screen has a route: W425 hub, W426, W427, W428, W429 (refusal + the plane), W430, W2839/W2840, the two chains', () => {
    for (const p of PAGES) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true);
    expect([COMMS_HREF, BROADCAST_FORM_HREF, WA_HUB_HREF]).toEqual(['/comms', '/comms/new', '/channels/whatsapp']);
    expect(broadcastHref('a b')).toBe('/comms/a%20b');
    expect(broadcastActHref('b1', 'send')).toBe('/comms/b1/act?step=confirm&act=send');
    expect(broadcastEditHref('b1')).toBe('/comms/new?id=b1');
    expect(exportHref('j1')).toBe('/channels/whatsapp/exports/j1');
    expect(exportDownloadHref('j1', 't/k')).toBe('/channels/whatsapp/exports/j1/download?token=t%2Fk');
  });
  it('the history chips are GET links; an unknown status is no filter; the cursor rides along', () => {
    expect(historyHref()).toBe('/comms'); expect(historyHref('sent')).toBe('/comms?status=sent'); expect(historyHref('delivered')).toBe('/comms');
    expect(historyHref('failed', 'c1')).toBe('/comms?status=failed&cursor=c1'); expect(historyHref(null, 'c1')).toBe('/comms?cursor=c1');
    expect(HISTORY_STATUSES).toEqual(apiList('domain/broadcast.state.ts', 'BROADCAST_STATUSES'));
    expect(isHistoryStatus('draft')).toBe(true); expect(isHistoryStatus('x')).toBe(false); expect(isHistoryStatus(1)).toBe(false);
  });
});

describe('the acts and the retry', () => {
  it('offered where the state allows — the API\'s own act table', () => {
    expect(BROADCAST_ACT_KEYS).toEqual(apiList('domain/broadcast.state.ts', 'BROADCAST_ACTS'));
    expect(offeredActs('draft')).toEqual(['send', 'cancel']); expect(offeredActs('scheduled')).toEqual(['cancel']);
    for (const s of ['queued', 'sending', 'sent', 'failed', 'cancelled']) expect(offeredActs(s)).toEqual([]);
    expect(isBroadcastAct('send')).toBe(true); expect(isBroadcastAct('assign')).toBe(false);
  });
  it('*Retry* of a failed or cancelled broadcast is a NEW draft from its words — never an automatic resend', () => {
    const b = { title: 'Mandi', body: 'Closed', audienceRoleCode: 'farmer' };
    expect(retryAsDraftHref({ ...b, status: 'failed' })).toBe('/comms/new?step=edit&title=Mandi&body=Closed&audienceRoleCode=farmer');
    expect(retryAsDraftHref({ ...b, status: 'cancelled', audienceRoleCode: null })).toBe('/comms/new?step=edit&title=Mandi&body=Closed');
    for (const s of ['draft', 'sent', 'queued']) expect(retryAsDraftHref({ ...b, status: s })).toBeNull();
    expect(MAX_CARRIED_BROADCAST).toBe(7000);
    expect(BROADCAST_FIELDS).toEqual(['title', 'body', 'audienceRoleCode', 'scheduledAt']);
  });
});

describe('what a broadcast says', () => {
  const counts = (o: Record<string, unknown> = {}) => ({ recipients: 4, sent: 5, delivered: 0, read: 0, failed: 1, held: 1, suppressed: 1, queued: 0, other: 0, inapp: 4,
    channels: [{ channel: 'inapp', total: 4, sent: 4, delivered: 0, read: 0, failed: 0, held: 0, suppressed: 0, queued: 0, released: 0, other: 0, failedBy: {}, suppressedBy: {} },
      { channel: 'push', total: 4, sent: 1, delivered: 0, read: 0, failed: 1, held: 1, suppressed: 1, queued: 0, released: 0, other: 0, failedBy: { no_device: 1 }, suppressedBy: { opted_out: 1 } }], ...o }) as any;
  it('the result line is the log\'s, in the canon\'s order — and a broadcast that never went out has NO result, not zero', () => {
    expect(resultParts(counts())).toEqual([{ key: 'bc.result.inapp', n: 4 }, { key: 'bc.result.pushSent', n: 1 }, { key: 'bc.result.pushHeld', n: 1 }, { key: 'bc.result.pushSuppressed', n: 1 }, { key: 'bc.result.pushFailed', n: 1 }]);
    expect(resultParts(null)).toBeNull(); expect(resultParts(undefined)).toBeNull();
    expect(resultParts(counts({ channels: [] }))).toEqual([{ key: 'bc.result.inapp', n: 4 }]);
    const quiet = counts(); quiet.channels[1] = { ...quiet.channels[1], sent: 0, delivered: 1, read: 1, failed: 0, held: 0, suppressed: 0 };
    expect(resultParts(quiet)).toEqual([{ key: 'bc.result.inapp', n: 4 }, { key: 'bc.result.pushSent', n: 2 }]);
  });
  it('keys and tones', () => {
    expect(statusKey('sent')).toBe('bc.status.sent'); expect(statusKey('bounced')).toBe('bc.status.other');
    expect(['sent', 'failed', 'queued', 'sending', 'scheduled', 'draft', 'cancelled'].map(statusTone)).toEqual(['success', 'danger', 'info', 'info', 'info', 'muted', 'muted']);
    expect(failureKey('no_template')).toBe('bc.failure.no_template'); expect(failureKey(null)).toBe('bc.failure.unrecorded'); expect(failureKey('x')).toBe('bc.failure.unrecorded');
    expect(channelKey('whatsapp')).toBe('bc.channel.whatsapp'); expect(channelKey('fax')).toBe('bc.channel.other');
    expect(failedByKey('no_device')).toBe('bc.failedBy.no_device'); expect(failedByKey('zzz')).toBe('bc.failedBy.other');
    expect(suppressedByKey('opted_out')).toBe('bc.suppressedBy.opted_out'); expect(suppressedByKey('zzz')).toBe('bc.suppressedBy.other');
    expect(gapParts('push:gu')).toEqual({ channel: 'push', language: 'gu' }); expect(gapParts('EVENT_MISSING')).toEqual({ channel: 'EVENT_MISSING', language: '' });
  });
  it('a switched-off module is "flagged off", not "couldn\'t load"; not-found and restricted are their own sentences', () => {
    expect(transportState('NOT_FOUND', 404)).toBe('notEnabled'); expect(transportState(null, 404)).toBe('notEnabled');
    expect(transportState('BROADCAST_NOT_FOUND', 404)).toBe('notFound'); expect(transportState('EXPORT_JOB_NOT_FOUND', 404)).toBe('notFound');
    expect(transportState('COMM_FORBIDDEN', 403)).toBe('restricted'); expect(transportState('COMM_FORBIDDEN')).toBe('restricted');
    expect(transportState('BOOM', 500)).toBe('error'); expect(transportState(undefined)).toBe('error');
  });
});

describe('WhatsApp, by name', () => {
  const register = () => {
    const s = api('domain/whatsapp-policy.ts');
    return [...s.matchAll(/\{ code: '([A-Za-z]+)', owner: '([a-z_0-9]+)', instead: (null|'[^']+') \}/g)].map((m) => ({ code: m[1], owner: m[2], instead: m[3] === 'null' ? null : m[3].slice(1, -1) }));
  };
  it('every screen prints only codes the API\'s register holds, and each "instead" is a console route that exists', () => {
    const reg = register();
    expect(reg.length).toBeGreaterThanOrEqual(17);
    for (const codes of Object.values(SCREEN_REFUSALS)) for (const c of codes) expect(reg.map((r) => r.code)).toContain(c);
    const routes: Record<string, string> = { '/inbox': 'app/inbox/page.tsx', '/comms': 'app/comms/page.tsx', '/content/templates': 'app/content/templates/page.tsx', '/channels/whatsapp/settings': 'app/channels/whatsapp/settings/page.tsx' };
    for (const r of reg) if (r.instead) expect(fs.existsSync(path.join(__dirname, '..', routes[r.instead] ?? 'missing'))).toBe(true);
    expect(refusalsFor(reg, ['conversation', 'nope', 'inbox']).map((r) => r.code)).toEqual(['conversation', 'inbox']);
    expect(refusedKey('inbox')).toBe('wa.refused.inbox'); expect(ownerKey('admin_11b_q1')).toBe('wa.owner.admin_11b_q1'); expect(ownerKey('x')).toBe('wa.owner.other');
  });
  it('there is no connect, disconnect, toggle, number, webhook or send route — in the console or the API', () => {
    expect(fs.readdirSync(path.join(__dirname, '../app/channels/whatsapp')).sort()).toEqual(['broadcast', 'conversation', 'exports', 'loading.tsx', 'page.tsx', 'settings', 'templates']);
    const ctl = api('controllers/v1/whatsapp.controller.ts');
    expect([...ctl.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)|@(Get|Post|Put|Patch|Delete)\(\)/g)].map((m) => `${m[1] ?? m[3]} ${m[2] ?? ''}`.trim())).toEqual(['Get', 'Get optin-policy', 'Post optin-policy/preview', 'Put optin-policy']);
  });
});

describe('the pages keep their promises', () => {
  it('no client JS anywhere in the wave; logical CSS only', () => {
    for (const p of PAGES) {
      const s = src(p);
      expect([p, /['"]use client['"]/.test(s)]).toEqual([p, false]);
      expect([p, /\son[A-Z][a-zA-Z]+=\{/.test(s)]).toEqual([p, false]);
      expect([p, /(margin|padding)-(left|right)|text-align:\s*(left|right)|\bfloat:/.test(s)]).toEqual([p, false]);
    }
  });
  it('F-17 · every write carries the key the review / confirm page minted, in a hidden input — never minted per click in a fresh action', () => {
    for (const p of ['app/comms/new/page.tsx', 'app/comms/[id]/act/page.tsx', 'app/comms/page.tsx', 'app/channels/whatsapp/page.tsx', 'app/channels/whatsapp/settings/edit/page.tsx']) {
      expect([p, src(p).includes('name="idempotencyKey" value={randomUUID()}')]).toEqual([p, true]);
    }
    for (const a of ['app/comms/new/actions.ts', 'app/comms/[id]/act/actions.ts', 'app/comms/actions.ts', 'app/channels/whatsapp/settings/edit/actions.ts']) {
      expect([a, src(a).includes("formData.get('idempotencyKey')")]).toEqual([a, true]);
    }
    expect(src('app/comms/actions.ts')).not.toMatch(/export async function sendBroadcastAction/);
    expect(fs.existsSync(path.join(__dirname, '../features/comms/hub.ts'))).toBe(false);
  });
  it('F-2 · /comms no longer claims a WhatsApp/SMS fan-out, and says what a broadcast is', () => {
    const s = src('app/comms/page.tsx');
    expect(s.split('\n')[0]).not.toMatch(/WhatsApp\/SMS\/push fan-out/);
    expect(s).toContain("t.t('bc.notWhatsApp')");
    expect(en['bc.notWhatsApp']).toMatch(/not WhatsApp/);
    for (const cat of [en, hi, gu]) expect(Object.keys(cat).filter((k) => k.startsWith('comms.'))).toEqual([]);
  });
  it('F-16 · the audience is a <select> over the registry, never a free text box', () => {
    const s = src('app/comms/new/page.tsx');
    expect(s).toContain('<select id="b-role" name="audienceRoleCode"');
    expect(s).not.toMatch(/<input[^>]*name="audienceRoleCode"/);
    expect(src('app/channels/whatsapp/settings/edit/page.tsx')).toContain('type="checkbox"');
  });
});

describe('every key exists ×3', () => {
  it('every literal key in the 8e pages and components', () => {
    const keys = new Set<string>();
    for (const p of PAGES) for (const m of src(p).matchAll(/'((?:bc|wa|nav|form|mutate|dairy|common|templates)\.[A-Za-z0-9_.]+)'/g)) if (!m[1].endsWith('.')) keys.add(m[1]);
    for (const m of src('features/comms/broadcasts.ts').matchAll(/'((?:bc|wa)\.[A-Za-z0-9_.]+)'/g)) if (!m[1].endsWith('.')) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(150);
    for (const k of keys) three(k);
  });
  it('every status, failure, channel, refusal and register entry the API can emit', () => {
    for (const s of [...apiList('domain/broadcast.state.ts', 'BROADCAST_STATUSES'), 'other']) three(statusKey(s));
    for (const f of apiList('domain/broadcast.state.ts', 'BROADCAST_FAILURE_REASONS')) three(failureKey(f));
    for (const c of ['inapp', 'push', 'sms', 'whatsapp', 'email', 'ivr', 'other']) three(channelKey(c));
    for (const r of [...apiList('domain/broadcast-review.ts', 'BROADCAST_FORM_REFUSALS'), 'TOO_LONG', 'VALUE_REJECTED']) three(`bc.form.refusal.${r}`);
    for (const f of apiList('domain/broadcast-review.ts', 'BROADCAST_FORM_FIELDS')) three(`bc.form.field.${f}`);
    for (const r of apiList('domain/broadcast-acts.ts', 'BROADCAST_ACT_REFUSALS')) three(`mutate.broadcast.refusal.${r}`);
    for (const r of [...apiList('domain/whatsapp-policy.ts', 'OPTIN_FORM_REFUSALS'), 'TOO_LONG', 'VALUE_REJECTED']) three(`wa.optin.refusal.${r}`);
    for (const f of apiList('domain/whatsapp-policy.ts', 'OPTIN_FORM_FIELDS')) three(`wa.optin.field.${f}`);
    for (const o of [...apiList('domain/whatsapp-policy.ts', 'GAP_OWNERS'), 'other']) three(ownerKey(o));
    for (const r of register()) { three(refusedKey(r.code)); if (r.instead) three(`wa.instead.${r.code}`); }
    for (const a of BROADCAST_ACT_KEYS) { three(`bc.act.title.${a}`); three(`bc.act.proceed.${a}`); three(`bc.act.done.${a}`); }
    three('bc.act.done.send.scheduled');
    for (const s of ['notEnabled', 'restricted', 'notFound', 'error']) { three(`bc.state.${s}`); three(`wa.state.${s}`); }
    for (const sc of ['conversation', 'editor', 'broadcast']) for (const p of ['title', 'refusal', 'why', 'decor']) three(`wa.${sc}.${p}`);
    for (const k of ['conversation', 'whatsappBroadcast', 'waTemplates', 'newOverride', 'newAnnouncement', 'marketingOptin']) three(`wa.instead.${k}.what`);
    for (const r of ['no_device', 'no_template', 'no_tokens', 'push_failed', 'push_unavailable', 'no_address', 'other']) three(failedByKey(r));
    for (const r of ['opted_out', 'routine_collapsed', 'channel_off', 'quiet_hours', 'other']) three(suppressedByKey(r));
  });
  function register() {
    const s = api('domain/whatsapp-policy.ts');
    return [...s.matchAll(/\{ code: '([A-Za-z]+)', owner: '([a-z_0-9]+)', instead: (null|'[^']+') \}/g)].map((m) => ({ code: m[1], instead: m[3] !== 'null' }));
  }
});
