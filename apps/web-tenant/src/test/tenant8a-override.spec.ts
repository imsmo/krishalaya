// apps/web-tenant/src/test/tenant8a-override.spec.ts · PC-56 TENANT-8a · the override console's helpers, and the
// catalogue promise that every key its pages can ask for exists ×3 — every state, source, lifecycle, channel, provider,
// status, act, act refusal (read from the API's own verdict), form field and every refusal the API's review can emit
// (read from the API's own list — a second copy would agree exactly once).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TemplateActVerdict, TemplateSlot, TemplateView } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  CHANNEL_VALUES, EXPERIMENTS_HREF, LIFECYCLE_VALUES, MAX_CARRIED_LENGTH_OVERRIDE, MUTATE_FIELDS, MUTATE_MODULE, NEW_OVERRIDE_HREF, OVERRIDE_ACT_VALUES, OVERRIDE_FIELDS, OVERRIDE_FORM,
  REFUSED_BY_NAME, SOURCE_VALUES, TEMPLATES_HREF, actDoneKey, actLabelKey, approvalServes, canStartOverride, chainKind, channelKey, defaultChannelFor, editOverrideHref, editValues,
  formTitleKey, isOverrideAct, lifecycleKey, newOverrideHref, offeredActs, overridableEvents, pageStateKey, providerKey, reasonLabelKey, refusedActs, refusedKey, segmentFacts, slotHref,
  slotStatus, slotStatusKey, sourceKey, templateActHref, templateHref, templatesHref, templatesTransportState, verdictFor,
} from '../features/templates/override';
import { fieldLabelKey, refusalKey, carryValues } from '../features/forms/chain';
import { mutateRefusalKey } from '../features/mutate/chain';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const apiDomain = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/communication/domain', rel), 'utf8');
function apiList(file: string, constName: string): string[] {
  const src = apiDomain(file);
  const i = src.indexOf(`${constName} = [`);
  if (i < 0) throw new Error(`${constName} not in ${file}`);
  return [...src.slice(i, src.indexOf('] as const', i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}
function apiUnion(file: string, typeName: string): string[] {
  const src = apiDomain(file);
  const i = src.indexOf(`export type ${typeName} =`);
  if (i < 0) throw new Error(`${typeName} not in ${file}`);
  return [...src.slice(i, src.indexOf(';', i)).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

const slot = (o: Partial<TemplateSlot> = {}): TemplateSlot => ({
  eventCode: 'order.confirmed', channel: 'push', languageCode: 'gu', priority: 'important', userCanOptOut: true, channelIsDefault: true, defaultChannels: ['push', 'sms', 'inapp'],
  platform: { templateId: 'p1', servingVersionNo: 1, serves: true },
  override: { templateId: null, servingVersionNo: null, serves: false, servingSince: null, latestVersionNo: null, latestLifecycle: null, latestAt: null },
  source: 'platform', locked: false, ...o,
});
const ov = (o: Partial<TemplateSlot['override']>): TemplateSlot['override'] => ({ templateId: 't1', servingVersionNo: null, serves: false, servingSince: null, latestVersionNo: 1, latestLifecycle: 'draft', latestAt: null, ...o });

describe('PC-56 TENANT-8a · routes', () => {
  it('every canon clickable has an href; filters are a GET URL; a filter change drops the cursor', () => {
    expect(TEMPLATES_HREF).toBe('/content/templates'); expect(NEW_OVERRIDE_HREF).toBe('/content/templates/new'); expect(EXPERIMENTS_HREF).toBe('/content/templates/experiments');
    expect(templatesHref()).toBe('/content/templates');
    expect(templatesHref({ eventCode: 'order.', channel: 'sms', languageCode: 'gu', only: 'overrides' }, 'c1')).toBe('/content/templates?eventCode=order.&channel=sms&languageCode=gu&only=overrides&cursor=c1');
    expect(templatesHref({ only: 'all' })).toBe('/content/templates');
    expect(templateHref('a b')).toBe('/content/templates/a%20b');
    expect(newOverrideHref()).toBe('/content/templates/new');
    expect(newOverrideHref({ eventCode: 'order.confirmed', channel: 'push', languageCode: 'gu' })).toBe('/content/templates/new?eventCode=order.confirmed&channel=push&languageCode=gu');
    expect(editOverrideHref('t 1')).toBe('/content/templates/new?from=t%201');
    expect(templateActHref('t1', 'approve', 'v2')).toBe('/content/templates/t1/act?step=confirm&act=approve&versionId=v2');
    expect(templateActHref('t1', 'retire')).toBe('/content/templates/t1/act?step=confirm&act=retire');
  });
  it('one page hosts the two canon form chains: `from` makes it the template (edit) chain', () => {
    expect(chainKind('t1')).toBe('template'); expect(chainKind(null)).toBe('templates'); expect(chainKind('  ')).toBe('templates'); expect(chainKind(undefined)).toBe('templates');
    expect(formTitleKey('template')).toBe('form.override.editTitle'); expect(formTitleKey('templates')).toBe('form.override.title');
  });
  it('a transport failure is one of W180\'s states — flagged off is not a load error', () => {
    expect(templatesTransportState('COMM_FORBIDDEN', 403)).toBe('restricted');
    expect(templatesTransportState('X', 403)).toBe('restricted');
    expect(templatesTransportState('FORBIDDEN')).toBe('restricted');
    expect(templatesTransportState('TEMPLATE_NOT_FOUND', 404)).toBe('notFound');
    expect(templatesTransportState('NOT_FOUND', 404)).toBe('notEnabled');
    expect(templatesTransportState('FEATURE_DISABLED')).toBe('notEnabled');
    expect(templatesTransportState('X', 404)).toBe('notEnabled');
    expect(templatesTransportState('BOOM', 500)).toBe('error');
    expect(templatesTransportState(null)).toBe('error');
  });
});

describe('PC-56 TENANT-8a · W180 rows say what serves (F-1)', () => {
  it('status from the facts, in order: locked · serving · why not · platform · silent', () => {
    expect(slotStatus(slot({ locked: true, source: 'override', override: ov({ serves: true }) }))).toBe('locked');
    expect(slotStatus(slot({ source: 'override', override: ov({ serves: true, latestLifecycle: 'submitted' }) }))).toBe('serving');
    expect(slotStatus(slot({ override: ov({ latestLifecycle: 'draft' }) }))).toBe('awaiting');
    expect(slotStatus(slot({ override: ov({ latestLifecycle: 'submitted' }) }))).toBe('awaiting');
    expect(slotStatus(slot({ override: ov({ latestLifecycle: 'submitted_to_provider' }) }))).toBe('atProvider');
    expect(slotStatus(slot({ override: ov({ latestLifecycle: 'rejected' }) }))).toBe('rejected');
    expect(slotStatus(slot({ override: ov({ latestLifecycle: 'superseded' }) }))).toBe('retired');
    expect(slotStatus(slot({ override: ov({ latestLifecycle: 'approved' }) }))).toBe('platformDefault');
    expect(slotStatus(slot())).toBe('platformDefault');
    expect(slotStatus(slot({ source: 'none' }))).toBe('silent');
    // a lifecycle on a slot with NO override row is not the override's
    expect(slotStatus(slot({ override: { ...ov({ latestLifecycle: 'draft' }), templateId: null } }))).toBe('platformDefault');
  });
  it('the row links to your override when there is one, else to the platform default; nothing when neither', () => {
    expect(slotHref(slot())).toBe('/content/templates/p1');
    expect(slotHref(slot({ override: ov({}) }))).toBe('/content/templates/t1');
    expect(slotHref(slot({ platform: { templateId: null, servingVersionNo: null, serves: false } }))).toBeNull();
  });
  it('"Override this" only on a slot that can take one', () => {
    expect(canStartOverride(slot())).toBe(true);
    expect(canStartOverride(slot({ locked: true }))).toBe(false);
    expect(canStartOverride(slot({ channelIsDefault: false }))).toBe(false);
    expect(canStartOverride(slot({ override: ov({}) }))).toBe(false);
  });
});

describe('PC-56 TENANT-8a · the form', () => {
  const ev = (code: string, chans: string[], locked = false) => ({ code, defaultName: code, priority: 'important', defaultChannels: chans, userCanOptOut: !locked, batchable: false, locked });
  it('F-22: the proposed channel is the event\'s first default channel, never a literal whatsapp', () => {
    expect(defaultChannelFor(ev('order.confirmed', ['push', 'sms', 'inapp']))).toBe('push');
    expect(defaultChannelFor(ev('x', []))).toBeNull();
    expect(defaultChannelFor(null)).toBeNull();
  });
  it('security copy is not offered', () => {
    expect(overridableEvents([ev('auth.otp', ['sms'], true), ev('order.confirmed', ['push'])]).map((e) => e.code)).toEqual(['order.confirmed']);
  });
  const view = (o: Partial<TemplateView> = {}): TemplateView => ({
    slot: slot({ override: ov({}) }), event: { code: 'order.confirmed', defaultName: 'x', priority: 'important', userCanOptOut: true, defaultChannels: ['push'] }, variables: [],
    platform: { templateId: 'p1', words: null, rendered: null },
    override: { templateId: 't1', words: { versionNo: 1, subject: 'S1', body: 'serving words', approvedAt: null }, rendered: null, segments: null },
    open: null, versions: [], acts: [], provider: 'none', canAuthor: true, canApprove: false, ...o,
  });
  it('the edit chain starts from the OPEN version\'s words, else the serving version\'s — never the reason', () => {
    expect(editValues(view())).toEqual({ eventCode: 'order.confirmed', channel: 'push', languageCode: 'gu', subject: 'S1', body: 'serving words' });
    const open = view({ open: { id: 'v2', versionNo: 2, lifecycle: 'draft', authoredByUserId: 'u', authoredByYou: true, rendered: 'r', segments: null },
      versions: [{ id: 'v2', versionNo: 2, lifecycle: 'draft', subject: null, body: 'waiting words', reason: 'r', rejectionReason: null, createdAt: '', authoredByUserId: 'u', authorName: null, authoredByYou: true, submittedAt: null, approvedByUserId: null, approverName: null, approvedByAdmin: false, approvedAt: null, rejectedByUserId: null, rejecterName: null, rejectedAt: null }] });
    expect(editValues(open)).toEqual({ eventCode: 'order.confirmed', channel: 'push', languageCode: 'gu', body: 'waiting words' });
    expect(editValues(view({ override: null }))).toEqual({ eventCode: 'order.confirmed', channel: 'push', languageCode: 'gu' });
    expect(editValues(view())).not.toHaveProperty('reason');
  });
  it('a two-segment Gujarati SMS survives the URL; a too-long body says so rather than truncating', () => {
    const gu = 'તમારો ઓર્ડર {{order_id}} પહોંચી ગયો છે. '.repeat(3);
    expect(carryValues('review', { eventCode: 'order.delivered', channel: 'sms', languageCode: 'gu', body: gu, reason: 'r' }, MAX_CARRIED_LENGTH_OVERRIDE).preserved).toBe(true);
    expect(carryValues('review', { body: 'ક'.repeat(1000) }, MAX_CARRIED_LENGTH_OVERRIDE).preserved).toBe(false);
  });
  it('the segment facts: null off SMS; the budget is two', () => {
    expect(segmentFacts(null)).toBeNull();
    expect(segmentFacts({ encoding: 'ucs2', characters: 109, segments: 2, perSegment: 67 })).toEqual({ characters: 109, segments: 2, perSegment: 67, encodingKey: 'templates.encoding.ucs2', withinBudget: true });
    expect(segmentFacts({ encoding: 'gsm7', characters: 400, segments: 3, perSegment: 153 })?.withinBudget).toBe(false);
    expect(segmentFacts({ encoding: 'gsm7', characters: 400, segments: 3, perSegment: 153 }, 3)?.withinBudget).toBe(true);
  });
});

describe('PC-56 TENANT-8a · the acts', () => {
  const vv = (act: TemplateActVerdict['act'], refusals: TemplateActVerdict['refusals'] = []): TemplateActVerdict => ({ act, allowed: refusals.length === 0, refusals, to: null });
  it('offered acts are buttons, refused acts carry their reasons; verdictFor finds one', () => {
    const all = [vv('submit'), vv('approve', ['MAKER_IS_CHECKER']), vv('retire', ['NOTHING_SERVING'])];
    expect(offeredActs(all).map((a) => a.act)).toEqual(['submit']);
    expect(refusedActs(all).map((a) => a.act)).toEqual(['approve', 'retire']);
    expect(verdictFor(all, 'approve')?.refusals).toEqual(['MAKER_IS_CHECKER']);
    expect(verdictFor(all, 'withdraw')).toBeNull();
  });
  it('an SMS / WhatsApp approval never serves, and its success says so', () => {
    expect(approvalServes('sms')).toBe(false); expect(approvalServes('whatsapp')).toBe(false); expect(approvalServes('push')).toBe(true); expect(approvalServes('email')).toBe(true);
    expect(actDoneKey('approve', 'submitted_to_provider')).toBe('templates.actDone.approveToProvider');
    expect(actDoneKey('approve', 'approved')).toBe('templates.actDone.approve');
    expect(actDoneKey('retire', 'submitted_to_provider')).toBe('templates.actDone.retire');
  });
  it('acts are the five, validated on the way in; the reject reason is the author\'s note', () => {
    expect(OVERRIDE_ACT_VALUES).toEqual(['submit', 'approve', 'reject', 'withdraw', 'retire']);
    expect(isOverrideAct('approve')).toBe(true); expect(isOverrideAct('send_test')).toBe(false); expect(isOverrideAct(null)).toBe(false);
    expect(reasonLabelKey('reject')).toBe('mutate.template.noteLabel'); expect(reasonLabelKey('approve')).toBe('mutate.template.reasonLabel'); expect(reasonLabelKey(null)).toBe('mutate.template.reasonLabel');
    expect(MUTATE_FIELDS).toEqual(['act', 'reason', 'versionId']);
  });
});

describe('PC-56 TENANT-8a · every key a page can ask for exists ×3', () => {
  it('the API\'s own lists match the console\'s', () => {
    expect(apiList('template-override.ts', 'OVERRIDE_ACTS')).toEqual([...OVERRIDE_ACT_VALUES]);
    expect(apiList('template-override.ts', 'OVERRIDE_LIFECYCLES')).toEqual([...LIFECYCLE_VALUES]);
    expect(apiList('template-override-review.ts', 'OVERRIDE_FORM_FIELDS')).toEqual([...OVERRIDE_FIELDS]);
  });
  it('every review refusal the API can emit has a sentence, and every form field (incl. the derived rows) a label', () => {
    const codes = [...apiList('template-override-review.ts', 'OVERRIDE_REVIEW_REFUSALS'), 'TOO_LONG', 'VALUE_REJECTED'];
    expect(codes.length).toBeGreaterThan(15);
    for (const c of codes) three(refusalKey(OVERRIDE_FORM, c));
    for (const f of [...OVERRIDE_FIELDS, ...apiList('template-override-review.ts', 'OVERRIDE_DERIVED_ROWS')]) three(fieldLabelKey(OVERRIDE_FORM, f));
  });
  it('every act refusal the verdict can emit has a sentence', () => {
    const codes = apiUnion('template-override.ts', 'OverrideActRefusal');
    expect(codes).toEqual(expect.arrayContaining(['MAKER_IS_CHECKER', 'NO_PERMISSION', 'NOTHING_SERVING', 'REASON_TOO_LONG']));
    for (const c of codes) three(mutateRefusalKey(MUTATE_MODULE, c));
  });
  it('every state, source, lifecycle, channel, provider, status, act, done-sentence and refused-by-name sentence', () => {
    for (const s of ['notEnabled', 'restricted', 'notFound', 'error'] as const) three(pageStateKey(s));
    for (const s of SOURCE_VALUES) three(sourceKey(s));
    for (const l of LIFECYCLE_VALUES) three(lifecycleKey(l));
    for (const c of CHANNEL_VALUES) three(channelKey(c));
    for (const p of ['none', 'dlt', 'whatsapp'] as const) three(providerKey(p));
    for (const s of ['locked', 'serving', 'awaiting', 'atProvider', 'rejected', 'retired', 'platformDefault', 'silent'] as const) three(slotStatusKey(s));
    for (const a of OVERRIDE_ACT_VALUES) { three(actLabelKey(a)); three(actDoneKey(a)); }
    three(actDoneKey('approve', 'submitted_to_provider'));
    for (const r of REFUSED_BY_NAME) three(refusedKey(r));
    for (const e of ['gsm7', 'ucs2']) three(`templates.encoding.${e}`);
    for (const m of ['allocation', 'bucket', 'exposures', 'statistics', 'promotion', 'eligibleList']) three(`experiments.missing.${m}`);
  });
  it('every literal key in the 8a pages exists ×3', () => {
    const root = path.join(__dirname, '../app/content/templates');
    const files: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } };
    walk(root);
    files.push(path.join(__dirname, '../app/comms/page.tsx'));
    const keys = new Set<string>();
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/t\.t\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(80);
    for (const k of keys) three(k);
  });
  it('the dead PC-27 template keys are gone from all three catalogues', () => {
    for (const k of ['comms.addTemplate', 'comms.saveTemplate', 'comms.templateHint', 'comms.error.tpl_event', 'comms.ok.template', 'comms.colEvent']) {
      for (const cat of [en, hi, gu]) expect(cat[k as keyof typeof cat]).toBeUndefined();
    }
  });
});
