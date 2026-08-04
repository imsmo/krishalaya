// apps/mobile/src/features/content/content.ts · PURE tips + crop-hub + AI-assistant + voice-search logic for P-20.
// No React/native (SDK/ui types are `import type` → erased) → unit-tested. The SERVER is the authority on which
// resources exist (box=browse returns only APPROVED) and on AI answers; these helpers only drive the UI: local
// text search (ReDoS-safe plain includes), kind grouping/labels, saved-tips set math, and assistant input
// validation. Saved tips are DEVICE-LOCAL bookmarks (no server endpoint yet — flagged); we keep tiny snapshots.
import type { PillTone } from '@krishalaya/ui-native';
import type { LearningResource, ResourceKind, CropCalendar, CropCalendarStage } from '@krishalaya/sdk-js';

/** The resource kinds we surface, in display order (a "category" is a kind — there's no topic-name endpoint). */
export const RESOURCE_KINDS: ResourceKind[] = ['article', 'video', 'blog', 'post', 'audio'];

/** i18n key for a kind label (falls back to the raw kind if unknown). */
export function kindLabelKey(kind: string): string {
  return RESOURCE_KINDS.includes(kind as ResourceKind) ? `content.kind.${kind}` : 'content.kind.other';
}
/** A subtle tone per kind for the category chip / pill. */
export function kindTone(kind: string): PillTone {
  switch (kind) {
    case 'video': return 'info';
    case 'audio': return 'accent';
    case 'article': case 'blog': return 'success';
    default: return 'neutral';
  }
}

/** Legacy fixed vocab (kept for back-compat / tests). The live topic chips are now built dynamically from the
 * SERVER-resolved `topicName` on each resource (see distinctTopics) — no longer a §13 gap. Pure. */
export const TIP_CATEGORIES = ['all', 'crops', 'pest', 'soil', 'market'] as const;
export type TipCategory = (typeof TIP_CATEGORIES)[number];

/** A topic chip for the tips library (screen 55). `id` is null for the synthetic "All" chip. Pure. */
export interface TopicChip { id: string | null; name: string }
/** Build the topic-category chips from the page's REAL, server-resolved topic names (P1-5). Only topics that
 * actually resolved to a name appear (unknown/absent → not shown; never fabricated). "All" is prepended.
 * Deduped by topicId, ordered by first appearance so the chips are stable. Pure. */
export function distinctTopics<T extends Pick<LearningResource, 'topicId' | 'topicName'>>(items: T[], allLabel: string): TopicChip[] {
  const seen = new Set<string>();
  const chips: TopicChip[] = [{ id: null, name: allLabel }];
  for (const r of items) {
    const id = r.topicId; const name = r.topicName;
    if (id && name && !seen.has(id)) { seen.add(id); chips.push({ id, name }); }
  }
  return chips;
}
/** Filter tips by a selected topic id (null ⇒ all). Pure; stable order preserved. */
export function filterByTopic<T extends Pick<LearningResource, 'topicId'>>(items: T[], topicId: string | null): T[] {
  if (!topicId) return items;
  return items.filter((r) => r.topicId === topicId);
}

// --- crop-agronomy calendars (P1-5, screen 104) — editorial reference timelines, never personalised (§13) ---
/** The four agronomy seasons, in display order. */
export const CROP_SEASONS = ['kharif', 'rabi', 'zaid', 'perennial'] as const;
/** i18n key for a season label → `content.cropHub.season.<s>`. Unknown → the raw value's key ('other'). Pure. */
export function seasonLabelKey(season: string | null | undefined): string {
  const s = (season ?? '').toLowerCase();
  return (CROP_SEASONS as readonly string[]).includes(s) ? `content.cropHub.season.${s}` : 'content.cropHub.season.other';
}
/** Order a calendar's stages by their day window (dayFrom, then dayTo). Pure; does not mutate the input. */
export function sortStages(stages: CropCalendarStage[]): CropCalendarStage[] {
  return [...stages].sort((a, b) => (a.dayFrom - b.dayFrom) || (a.dayTo - b.dayTo));
}
/** A "day X–Y" window label for a stage (both days from the stored editorial content — not derived from a date). */
export function stageDayLabel(stage: Pick<CropCalendarStage, 'dayFrom' | 'dayTo'>): string {
  const from = Math.max(0, Math.round(stage.dayFrom));
  const to = Math.max(from, Math.round(stage.dayTo));
  return from === to ? `${from}` : `${from}–${to}`;
}
/** A "min–max days" duration label for a calendar (both from stored content). Collapses when equal. Pure. */
export function durationLabel(cal: Pick<CropCalendar, 'durationDaysMin' | 'durationDaysMax'>): string {
  const min = Math.max(0, Math.round(cal.durationDaysMin));
  const max = Math.max(min, Math.round(cal.durationDaysMax));
  return min === max ? `${min}` : `${min}–${max}`;
}
/** Distinct crop names present across a set of calendars, in first-appearance order (for a crop picker). Pure. */
export function cropNames<T extends Pick<CropCalendar, 'cropName'>>(cals: T[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const c of cals) { const n = (c.cropName ?? '').trim(); if (n && !seen.has(n)) { seen.add(n); out.push(n); } }
  return out;
}

/** Estimated read time (minutes, ≥1) from a tip body at `wpm` words/minute — DERIVED from the real body text, not
 * a fabricated field. Empty/whitespace body → 1. Pure. */
export function readTimeMinutes(body: string | null | undefined, wpm = 200): number {
  const words = (body ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / wpm));
}

/** i18n key suffix for a resource's languageCode → `content.lang.<key>`. Unknown/empty → 'other'. Pure. */
export function languageLabelKey(code: string | null | undefined): string {
  const c = (code ?? '').toLowerCase();
  return c === 'hi' || c === 'en' || c === 'gu' ? c : 'other';
}

/** Pick up to `max` "related" tips for the detail screen (screen 101). REAL resources from the cached catalogue —
 * never fabricated. Excludes the current tip; prefers the SAME kind first (closest match) then fills with others,
 * preserving catalogue order. There is no server "related" endpoint, so this is an honest local heuristic. Pure. */
export function relatedTips<T extends Pick<LearningResource, 'id' | 'kind'>>(all: T[], currentId: string, max = 3): T[] {
  const others = all.filter((r) => r.id !== currentId);
  const current = all.find((r) => r.id === currentId);
  const sameKind = current ? others.filter((r) => r.kind === current.kind) : [];
  const rest = others.filter((r) => !sameKind.includes(r));
  return [...sameKind, ...rest].slice(0, Math.max(0, max));
}

/** Normalize a free-text / spoken query: trim, collapse whitespace, lowercase, cap length (bounded; no ReDoS). */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
}

/** Does a resource match a query? Plain case-insensitive substring over title + body (no regex on user input).
 * An empty query matches everything (so the library shows all). Works on cached resources → offline search. */
export function matchesQuery(r: Pick<LearningResource, 'title' | 'body'>, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const hay = `${r.title ?? ''} ${r.body ?? ''}`.toLowerCase();
  return hay.includes(q);
}

/** Filter a resource list by a query (pure; stable order preserved). */
export function searchResources<T extends Pick<LearningResource, 'title' | 'body'>>(items: T[], query: string): T[] {
  const q = normalizeQuery(query);
  if (!q) return items;
  return items.filter((r) => matchesQuery(r, q));
}

export interface KindSection<T> { kind: ResourceKind; items: T[] }
/** Group resources into ordered sections by kind (crop-hub). Empty kinds are dropped. */
export function groupByKind<T extends Pick<LearningResource, 'kind'>>(items: T[]): KindSection<T>[] {
  return RESOURCE_KINDS
    .map((kind) => ({ kind, items: items.filter((r) => r.kind === kind) }))
    .filter((s) => s.items.length > 0);
}

// --- saved tips (server-persisted via buyer/saves entityType='tip'; AsyncStorage mirror for offline render) ---
export interface TipSnapshot { id: string; title: string; kind: ResourceKind; savedAt: number }
/** Build a minimal snapshot to persist (so the saved screen renders offline without a fetch). */
export function tipSnapshot(r: Pick<LearningResource, 'id' | 'title' | 'kind'>, now: number = Date.now()): TipSnapshot {
  return { id: r.id, title: r.title, kind: r.kind, savedAt: now };
}
export function isSaved(saved: Pick<TipSnapshot, 'id'>[], id: string): boolean {
  return saved.some((s) => s.id === id);
}
/** Toggle a snapshot in the saved list (dedupe by id; newest first; capped). Pure. */
export function toggleSaved(saved: TipSnapshot[], snap: TipSnapshot, max = 300): TipSnapshot[] {
  const exists = saved.some((s) => s.id === snap.id);
  if (exists) return saved.filter((s) => s.id !== snap.id);
  return [snap, ...saved.filter((s) => s.id !== snap.id)].slice(0, max);
}
/** Reconcile the local snapshot mirror against the SERVER's authoritative set of saved tip ids (P1-16).
 *  The server owns WHICH tips are saved; the local mirror carries title/kind so the saved screen renders offline.
 *  Drops local snapshots the server no longer has; keeps a minimal placeholder for any server id missing locally
 *  (title resolves when its detail loads). Order: newest-first by the local savedAt, server-only ids appended.
 *  Pure — no I/O. */
export function reconcileSavedTips(local: TipSnapshot[], serverIds: string[], now: number = Date.now(), max = 300): TipSnapshot[] {
  const ids = new Set(serverIds);
  const byId = new Map(local.map((s) => [s.id, s]));
  const kept = local.filter((s) => ids.has(s.id));                       // drop locals the server dropped
  const missing = serverIds.filter((id) => !byId.has(id)).map((id): TipSnapshot => ({ id, title: id, kind: 'article', savedAt: now }));
  return [...kept, ...missing].sort((a, b) => b.savedAt - a.savedAt).slice(0, max);
}

// --- AI assistant input ---
export type AssistantLang = 'hi' | 'en' | 'gu';
export interface AssistantDraft { ok: boolean; input?: { message: string; languageCode: AssistantLang; sessionId?: string }; reason?: 'empty' | 'lang' }
/** Validate + assemble an assistant message payload. Empty/whitespace is rejected; lang must be a launch language
 * (the server re-validates). Trims + caps the message length (bounded request). */
export function buildAssistantDraft(form: { text?: string; lang?: string; sessionId?: string | null }): AssistantDraft {
  const message = (form.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!message) return { ok: false, reason: 'empty' };
  if (form.lang !== 'hi' && form.lang !== 'en' && form.lang !== 'gu') return { ok: false, reason: 'lang' };
  return { ok: true, input: { message, languageCode: form.lang, sessionId: form.sessionId ?? undefined } };
}

// R2-03: gates the Farm Assistant's (screen 125) "Tap to speak" mic. The assistant's TEXT Q&A is a fully built,
// governed backend pipeline (P1-13) that already degrades honestly turn-by-turn without a model key — it is NOT
// gated here. Only the on-device-STT mic affordance is, behind its own `voice_assistant` flag (default OFF,
// mirrors `voice_listing` gating listing/new.tsx's mic) so ops can kill just the voice path independently. Pure —
// mirrors shouldShowVoiceComingSoon's shape (features/listings/create-listing.ts) for the same class of gate.
export function shouldShowAssistantMic(voiceAssistantEnabled: boolean): boolean {
  return voiceAssistantEnabled;
}

export type ChatRole = 'user' | 'assistant';
/** A transcript turn. `citations` are the SERVER's source links on an assistant turn (rendered verbatim — the app
 * never fabricates a source); absent on user turns. */
export interface ChatTurn { id: string; role: ChatRole; text: string; at: number; citations?: Array<{ title: string; url?: string }> }
/** Append a turn to a transcript (immutable). Bounds the in-memory transcript (perf §5). */
export function appendTurn(turns: ChatTurn[], turn: ChatTurn, max = 200): ChatTurn[] {
  return [...turns, turn].slice(-max);
}
