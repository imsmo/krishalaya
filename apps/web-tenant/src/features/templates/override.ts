// apps/web-tenant/src/features/templates/override.ts · PC-56 TENANT-8a · THE OVERRIDE — the console's pure helpers for
// W180 (`/content/templates`), W181 (`/content/templates/[id]`), W182 (`/content/templates/experiments`, refused by name)
// and the four chains: the templates-form chain W2786–W2789 (*New override*) and the template-form chain W2779–W2782
// (*Save*) are ONE page, `/content/templates/new` (with `?from=<id>` it is the template chain — an edit of an override
// that exists); the template-mutate chain W2783–W2785 is `/content/templates/[id]/act` (submit · approve · reject ·
// withdraw · retire; *Send test to my phone* and *Retry* refused by name). The templates-mutate chain W2790–W2792 hosts
// only *Retry* — a page load, not a mutation — and has no route (PARITY-DECOR, the 6a ruling).
//
// No React, no SDK runtime (type-only imports), so every rule a page draws is reachable by a spec.
import type { TemplateActVerdict, TemplateCatalogueEvent, TemplateOverrideAct, TemplateOverrideLifecycle, TemplateServingSource, TemplateSlot, TemplateView } from '@krishalaya/sdk-js';

export const TEMPLATES_HREF = '/content/templates';
export const NEW_OVERRIDE_HREF = '/content/templates/new';
export const EXPERIMENTS_HREF = '/content/templates/experiments';
export const OVERRIDE_FORM = 'override';
export const MUTATE_MODULE = 'template';
export const OVERRIDE_FIELDS = ['eventCode', 'channel', 'languageCode', 'subject', 'body', 'reason'] as const;
export const OVERRIDE_ACT_VALUES = ['submit', 'approve', 'reject', 'withdraw', 'retire'] as const;
export const MUTATE_FIELDS = ['act', 'reason', 'versionId'] as const;
export const LIFECYCLE_VALUES = ['draft', 'submitted', 'approved', 'submitted_to_provider', 'rejected', 'superseded'] as const;
export const SOURCE_VALUES = ['override', 'platform', 'none'] as const;
export const CHANNEL_VALUES = ['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr'] as const;
/** The canon's clickables this platform has no backend for, each printed by name with its reason. */
export const REFUSED_BY_NAME = ['sendTest', 'experiment', 'dltReverify', 'deliveryStats', 'draftHistoryCanon', 'compiledCache', 'retryPageLoad'] as const;
export type RefusedByName = (typeof REFUSED_BY_NAME)[number];
export function refusedKey(r: RefusedByName): string { return `templates.refused.${r}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export interface IndexFilters { eventCode?: string | null; channel?: string | null; languageCode?: string | null; only?: string | null }

/** W180 with its GET-form filters; a filter change resets the cursor (a cursor belongs to one filter set). */
export function templatesHref(f: IndexFilters = {}, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.eventCode) q.set('eventCode', f.eventCode);
  if (f.channel) q.set('channel', f.channel);
  if (f.languageCode) q.set('languageCode', f.languageCode);
  if (f.only === 'overrides') q.set('only', 'overrides');
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${TEMPLATES_HREF}?${s}` : TEMPLATES_HREF;
}
export function templateHref(templateId: string): string { return `${TEMPLATES_HREF}/${encodeURIComponent(templateId)}`; }

/** The templates-form chain (W2786): a NEW override, optionally pre-aimed at one slot. */
export function newOverrideHref(slot?: { eventCode: string; channel: string; languageCode: string } | null): string {
  if (!slot) return NEW_OVERRIDE_HREF;
  const q = new URLSearchParams({ eventCode: slot.eventCode, channel: slot.channel, languageCode: slot.languageCode });
  return `${NEW_OVERRIDE_HREF}?${q.toString()}`;
}
/** The template-form chain (W2779): the next version of an override that exists — `from` names it. */
export function editOverrideHref(templateId: string): string {
  return `${NEW_OVERRIDE_HREF}?from=${encodeURIComponent(templateId)}`;
}
export function templateActHref(templateId: string, act: TemplateOverrideAct, versionId?: string | null): string {
  const q = new URLSearchParams({ step: 'confirm', act });
  if (versionId) q.set('versionId', versionId);
  return `${templateHref(templateId)}/act?${q.toString()}`;
}

/** Which of the canon's two form chains a URL is: `template` (W2779–W2782, an edit) or `templates` (W2786–W2789, new). */
export function chainKind(from: string | null | undefined): 'template' | 'templates' {
  return typeof from === 'string' && from.trim().length > 0 ? 'template' : 'templates';
}

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export type TemplatesPageState = 'notEnabled' | 'restricted' | 'notFound' | 'error';

/**
 * A transport failure → one of W180/W181's own states. The module guard answers a bare 404 when `communication` is OFF
 * (W180's *"Flagged off"*); `TEMPLATE_NOT_FOUND` is an id that is not this tenant's or does not exist — different
 * sentences (the 6e-1 lesson: a flagged-off module is not a load error).
 */
export function templatesTransportState(code: string | null | undefined, status?: number): TemplatesPageState {
  if (code === 'COMM_FORBIDDEN' || code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'TEMPLATE_NOT_FOUND') return 'notFound';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function pageStateKey(s: TemplatesPageState): string { return `templates.state.${s}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* W180 · WHAT EACH ROW SAYS                                                                                  */
/* ---------------------------------------------------------------------------------------------------------- */

export function sourceKey(s: TemplateServingSource): string { return `templates.source.${s}`; }
export function lifecycleKey(l: TemplateOverrideLifecycle | string): string { return `templates.lifecycle.${l}`; }
export function channelKey(c: string): string { return `templates.channel.${c}`; }
export function providerKey(p: 'none' | 'dlt' | 'whatsapp'): string { return `templates.provider.${p}`; }

export type SlotStatus = 'locked' | 'serving' | 'awaiting' | 'atProvider' | 'rejected' | 'retired' | 'platformDefault' | 'silent';

/**
 * The Status column, from the facts — never from `is_active` (F-1: an unserved tenant row is not an active override).
 * Order matters: a locked event is locked whatever its rows say; a serving override is serving even while its next
 * version waits; an override that serves nothing says why (waiting · at the provider · rejected · retired) before the
 * platform default underneath it is mentioned.
 */
export function slotStatus(s: Pick<TemplateSlot, 'locked' | 'source' | 'override'>): SlotStatus {
  if (s.locked) return 'locked';
  if (s.source === 'override') return 'serving';
  const l = s.override.templateId ? s.override.latestLifecycle : null;
  if (l === 'draft' || l === 'submitted') return 'awaiting';
  if (l === 'submitted_to_provider') return 'atProvider';
  if (l === 'rejected') return 'rejected';
  if (l === 'superseded') return 'retired';
  return s.source === 'platform' ? 'platformDefault' : 'silent';
}
export function slotStatusKey(s: SlotStatus): string { return `templates.status.${s}`; }

/** The row's link: the override when there is one (W181 of your words), else the platform default (the reference). */
export function slotHref(s: Pick<TemplateSlot, 'override' | 'platform'>): string | null {
  const id = s.override.templateId ?? s.platform.templateId;
  return id ? templateHref(id) : null;
}

/** Whether the "New override" link belongs on this row: not for security copy, not for a channel the event is not sent on. */
export function canStartOverride(s: Pick<TemplateSlot, 'locked' | 'channelIsDefault' | 'override'>): boolean {
  return !s.locked && s.channelIsDefault && s.override.templateId === null;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORM                                                                                                   */
/* ---------------------------------------------------------------------------------------------------------- */

/**
 * F-22: the channel the form proposes is the EVENT's first default channel — never a literal (`/comms` proposed
 * `whatsapp`, the one channel with zero templates and no provider).
 */
export function defaultChannelFor(e: Pick<TemplateCatalogueEvent, 'defaultChannels'> | null | undefined): string | null {
  return e && e.defaultChannels.length > 0 ? e.defaultChannels[0] : null;
}

/** The events a form may offer: not security copy (it would be refused; the list says so separately). */
export function overridableEvents(events: readonly TemplateCatalogueEvent[]): TemplateCatalogueEvent[] {
  return events.filter((e) => !e.locked);
}

/**
 * The edit chain's first values: the slot of the override, and the words of its OPEN version if one waits, else the
 * serving version — you edit a copy, never the original (W181). The reason is never pre-filled (6d-5's rule).
 */
export function editValues(v: Pick<TemplateView, 'slot' | 'override' | 'open' | 'versions'>): Record<string, string> {
  const open = v.open ? v.versions.find((x) => x.id === v.open!.id) ?? null : null;
  const words = open ? { subject: open.subject, body: open.body } : v.override?.words ?? null;
  const out: Record<string, string> = { eventCode: v.slot.eventCode, channel: v.slot.channel, languageCode: v.slot.languageCode };
  if (words?.subject) out.subject = words.subject;
  if (words?.body) out.body = words.body;
  return out;
}

/** The body travels in the query string (the house pattern). 7b's ceiling for long text: a two-segment Gujarati SMS is
 *  ~1,200 encoded characters; a body past 7,000 is refused as "values not preserved" rather than truncated silently. */
export const MAX_CARRIED_LENGTH_OVERRIDE = 7_000;

export function formTitleKey(kind: 'template' | 'templates'): string { return kind === 'template' ? 'form.override.editTitle' : 'form.override.title'; }

/* ---------------------------------------------------------------------------------------------------------- */
/* THE ACTS                                                                                                   */
/* ---------------------------------------------------------------------------------------------------------- */

export function actLabelKey(act: TemplateOverrideAct | string): string { return `templates.act.${act}`; }
export function actDoneKey(act: TemplateOverrideAct | string, to?: string | null): string {
  return act === 'approve' && to === 'submitted_to_provider' ? 'templates.actDone.approveToProvider' : `templates.actDone.${act}`;
}
export function isOverrideAct(s: string | null | undefined): s is TemplateOverrideAct {
  return (OVERRIDE_ACT_VALUES as readonly string[]).includes(s ?? '');
}
export function verdictFor(verdicts: readonly TemplateActVerdict[], act: TemplateOverrideAct): TemplateActVerdict | null {
  return verdicts.find((v) => v.act === act) ?? null;
}
/** Offered acts are buttons; refused acts are printed with their first reason — never a 403 button. */
export function offeredActs(v: readonly TemplateActVerdict[]): TemplateActVerdict[] { return v.filter((x) => x.allowed); }
export function refusedActs(v: readonly TemplateActVerdict[]): TemplateActVerdict[] { return v.filter((x) => !x.allowed); }

/** An approval on SMS / WhatsApp never serves; the confirm screen says so before the checker presses. */
export function approvalServes(channel: string): boolean { return channel !== 'sms' && channel !== 'whatsapp'; }

/** The reason's label: on a rejection it is the note the author reads on W181. */
export function reasonLabelKey(act: TemplateOverrideAct | null): string {
  return act === 'reject' ? 'mutate.template.noteLabel' : 'mutate.template.reasonLabel';
}

/** The SMS cost sentence's parts, as numbers the page formats — `null` off SMS. */
export function segmentFacts(seg: { encoding: 'gsm7' | 'ucs2'; characters: number; segments: number; perSegment: number } | null, budget = 2):
  { characters: number; segments: number; perSegment: number; encodingKey: string; withinBudget: boolean } | null {
  if (!seg) return null;
  return { characters: seg.characters, segments: seg.segments, perSegment: seg.perSegment, encodingKey: `templates.encoding.${seg.encoding}`, withinBudget: seg.segments <= budget };
}
