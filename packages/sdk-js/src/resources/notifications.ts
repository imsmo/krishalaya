// @krishalaya/sdk-js · notifications resource (communication module). The caller's OWN inbox + preferences +
// quiet hours (server enforces ownership — a non-owner read is 404, no IDOR). Inbox is keyset-paginated. mark-read
// is idempotent server-side. Gated server-side by the `communication` flag.
import { HttpClient } from '../http';
import {
  NotificationItem, NotificationPreference, QuietHours, QuietHoursInput, Page, InboxPage, InboxFilters, InboxQuery, NotificationBell, NotificationLadder, DeliveryHealth,
  NotificationMatrix, QuietWindowReview, PreferenceReview, LanguageReview, TemplateActs, TemplateCatalogueEvent, TemplateIndex, TemplateLanguage, TemplateOverrideAct,
  TemplateOverrideFormInput, TemplateOverrideReview, TemplateSummary, TemplateView, TemplateSlot,
} from '../types';

export class NotificationsResource {
  constructor(private readonly http: HttpClient) {}

  /** The caller's notification inbox (keyset) — [PC-56 TENANT-8b] IN-APP items only (F-9). Kept for the storefront,
   *  partner and mobile inboxes; `inboxPage` returns the cooperative's zone and today beside the items. */
  async inbox(opts: InboxQuery = {}, signal?: AbortSignal): Promise<Page<NotificationItem>> {
    const p = await this.inboxPage(opts, signal);
    return { items: p.items, nextCursor: p.nextCursor };
  }
  /** W204 / W431 · your in-app items with the GET-form filters (state · tier · module · channel), keyset. */
  async inboxPage(opts: InboxQuery = {}, signal?: AbortSignal): Promise<InboxPage> {
    const r = await this.http.request<NotificationItem[]>('GET', 'notifications', {
      query: { status: opts.status, unreadOnly: opts.unreadOnly, state: opts.state, tier: opts.tier, module: opts.module, channel: opts.channel, cursor: opts.cursor, limit: opts.limit ?? 50 }, signal,
    });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; zone?: string | null; today?: string | null };
    return { items: r.data, nextCursor: m.nextCursor ?? null, zone: m.zone ?? null, today: m.today ?? null };
  }
  /** The filter vocabularies — tiers and modules from the catalogue. */
  async inboxFilters(signal?: AbortSignal): Promise<InboxFilters> {
    return (await this.http.request<InboxFilters>('GET', 'notifications/filters', { signal })).data;
  }
  /** W432 · the bell: unread (capped), the latest eight, what is held for you tonight. */
  async bell(signal?: AbortSignal): Promise<NotificationBell> {
    return (await this.http.request<NotificationBell>('GET', 'notifications/bell', { signal })).data;
  }
  /** W434 · one of your notifications, every channel of its delivery instance as a ladder. `at` = the item's `at`. */
  async ladder(id: string, at: string, signal?: AbortSignal): Promise<NotificationLadder> {
    return (await this.http.request<NotificationLadder>('GET', `notifications/${encodeURIComponent(id)}/ladder`, { query: { at }, signal })).data;
  }
  /** W204 · tenant-wide delivery health (24h) — notification.manage; anyone else gets COMM_FORBIDDEN (a sentence). */
  async deliveryHealth(signal?: AbortSignal): Promise<DeliveryHealth> {
    return (await this.http.request<DeliveryHealth>('GET', 'notifications/delivery-health', { signal })).data;
  }
  /** The mark-all-read confirm step's object. */
  async readAllPreview(signal?: AbortSignal): Promise<{ unread: number }> {
    return (await this.http.request<{ unread: number }>('GET', 'notifications/read-all', { signal })).data;
  }
  /** MARK ALL READ — the form's Idempotency-Key (required), audited server-side. */
  async markAllRead(idempotencyKey: string): Promise<{ marked: number }> {
    return (await this.http.request<{ marked: number }>('POST', 'notifications/read-all', { idempotencyKey })).data;
  }
  /** Mark one notification read (idempotent). `at` (the item's own instant) prunes to one partition; the key is the form's. */
  async markRead(id: string, opts: { at?: string; idempotencyKey?: string } = {}): Promise<NotificationItem> {
    return (await this.http.request<NotificationItem>('POST', `notifications/${encodeURIComponent(id)}/read`, {
      idempotencyKey: opts.idempotencyKey, body: opts.at ? { at: opts.at } : {},
    })).data;
  }

  /** W433 · YOUR matrix (authentication only — F-13): every event, its tier and channels, locks, your overrides, the
   *  window that applies to you, your language, the routine rule as decided. */
  async matrix(signal?: AbortSignal): Promise<NotificationMatrix> {
    return (await this.http.request<NotificationMatrix>('GET', 'notifications/matrix', { signal })).data;
  }
  async getPreferences(signal?: AbortSignal): Promise<NotificationPreference[]> {
    return (await this.http.request<NotificationPreference[]>('GET', 'notifications/preferences', { signal })).data;
  }
  /** The Save-preferences review (writes nothing — no key). */
  async previewPreferences(preferences: NotificationPreference[]): Promise<PreferenceReview> {
    return (await this.http.request<PreferenceReview>('POST', 'notifications/preferences/preview', { body: { preferences } })).data;
  }
  /** Bulk set per event×channel opt-in/out (a mandatory event can't be disabled — server throws). Keyed when given. */
  async setPreferences(preferences: NotificationPreference[], idempotencyKey?: string): Promise<{ updated: number }> {
    return (await this.http.request<{ updated: number }>('PUT', 'notifications/preferences', { idempotencyKey, body: { preferences } })).data;
  }

  async getQuietHours(signal?: AbortSignal): Promise<QuietHours | null> {
    return (await this.http.request<QuietHours | null>('GET', 'notifications/quiet-hours', { signal })).data;
  }
  /** The Change-window review: the zone against the registry, the window maths, the diff (writes nothing). */
  async previewQuietHours(input: { starts?: string; ends?: string; timezone?: string }): Promise<QuietWindowReview> {
    return (await this.http.request<QuietWindowReview>('POST', 'notifications/quiet-hours/preview', { body: input })).data;
  }
  async setQuietHours(input: QuietHoursInput, idempotencyKey?: string): Promise<QuietHours> {
    return (await this.http.request<QuietHours>('PUT', 'notifications/quiet-hours', { idempotencyKey, body: input })).data;
  }
  /** The Change-language review (the platform's ACTIVE registry). The write is `users.updateMe({ languageCode })`. */
  async previewLanguage(languageCode: string | undefined): Promise<LanguageReview> {
    return (await this.http.request<LanguageReview>('POST', 'notifications/language/preview', { body: languageCode ? { languageCode } : {} })).data;
  }

  /** Register this device's push token so the server can target it (call after login). Idempotent: the
   *  token is unique server-side, so re-registering the same token is a no-op re-stamp. Never log the token. */
  async registerDevice(platform: 'ios' | 'android' | 'web', token: string): Promise<{ ok: boolean; platform: string }> {
    return (await this.http.request<{ ok: boolean; platform: string }>('POST', 'notifications/devices', { body: { platform, token } })).data;
  }
  /** Revoke this device's push token (call on logout). Idempotent — ok whether or not a row existed. */
  async revokeDevice(token: string): Promise<{ ok: boolean; revoked: boolean }> {
    return (await this.http.request<{ ok: boolean; revoked: boolean }>('DELETE', 'notifications/devices', { body: { token } })).data;
  }

  // --- PC-27: tenant comms hub (comm.manage, server-gated) — broadcasts + notification templates ---
  /** Operator: send a broadcast to tenant members (all, or one role). Idempotency-Key required (Law 3). */
  async sendBroadcast(input: { title: string; body: string; audienceRoleCode?: string }, idempotencyKey: string): Promise<{ id: string; recipients?: number }> {
    return (await this.http.request<{ id: string; recipients?: number }>('POST', 'communication/broadcasts', { idempotencyKey, body: input })).data;
  }
  async listBroadcasts(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: Array<{ id: string; title: string; body: string; audienceRoleCode?: string | null; createdAt?: string; recipients?: number }>; nextCursor: string | null }> {
    const r = await this.http.request<Array<{ id: string; title: string; body: string; audienceRoleCode?: string | null; createdAt?: string; recipients?: number }>>('GET', 'communication/broadcasts', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** The platform event catalogue templates can bind to (real codes, never guessed). */
  async templateEvents(signal?: AbortSignal): Promise<Array<{ code: string; description?: string | null }>> {
    return (await this.http.request<Array<{ code: string; description?: string | null }>>('GET', 'notifications/events', { signal })).data;
  }
  // --- PC-56 TENANT-8a · THE OVERRIDE (notification.templates.manage / .approve, server-judged) ---
  // PC-27's `listTemplates` (it printed the row's `body`, not the serving version's) and `upsertTemplate` (an in-place
  // upsert that minted no version, so a tenant override never sent — F-1) are GONE; these replace them.

  /** W180 — one row per event × channel × language, keyset, with the live summary. */
  async templateIndex(params: { eventCode?: string; channel?: string; languageCode?: string; only?: 'all' | 'overrides'; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<TemplateIndex> {
    const r = await this.http.request<TemplateSlot[]>('GET', 'notifications/templates', {
      query: { eventCode: params.eventCode, channel: params.channel, languageCode: params.languageCode, only: params.only, cursor: params.cursor, limit: params.limit ?? 50 }, signal,
    });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; summary: TemplateSummary; canAuthor?: boolean; canApprove?: boolean };
    return { items: r.data, nextCursor: m.nextCursor ?? null, summary: m.summary, canAuthor: Boolean(m.canAuthor), canApprove: Boolean(m.canApprove) };
  }
  /** The form's event choices — every catalogued event, each marked locked (security copy) or not. */
  async templateCatalogue(signal?: AbortSignal): Promise<TemplateCatalogueEvent[]> {
    return (await this.http.request<TemplateCatalogueEvent[]>('GET', 'notifications/templates/catalogue', { signal })).data;
  }
  /** The languages an override may be written in: the tenant's own, or the platform registry's active ones. */
  async templateLanguages(signal?: AbortSignal): Promise<TemplateLanguage[]> {
    return (await this.http.request<TemplateLanguage[]>('GET', 'notifications/templates/languages', { signal })).data;
  }
  /** The form chain's review (writes nothing). */
  async previewTemplate(input: TemplateOverrideFormInput): Promise<TemplateOverrideReview> {
    return (await this.http.request<TemplateOverrideReview>('POST', 'notifications/templates/preview', { body: input })).data;
  }
  /** "Save" / "New override": a DRAFT version — never serving until a second person approves it. Idempotency-Key required. */
  async saveTemplateDraft(input: TemplateOverrideFormInput, idempotencyKey: string): Promise<{ templateId: string; versionId: string; versionNo: number; lifecycle: 'draft' }> {
    return (await this.http.request<{ templateId: string; versionId: string; versionNo: number; lifecycle: 'draft' }>('POST', 'notifications/templates', { idempotencyKey, body: input })).data;
  }
  /** W181 — the slot by any template id this tenant can see (its override or the platform default). */
  async templateView(templateId: string, signal?: AbortSignal): Promise<TemplateView> {
    return (await this.http.request<TemplateView>('GET', `notifications/templates/${encodeURIComponent(templateId)}`, { signal })).data;
  }
  /** The mutate chain's confirm step: the object and every act's verdict (pass the typed reason to judge it). */
  async templateActs(templateId: string, reason?: string, signal?: AbortSignal): Promise<TemplateActs> {
    return (await this.http.request<TemplateActs>('GET', `notifications/templates/${encodeURIComponent(templateId)}/acts`, { query: { reason }, signal })).data;
  }
  /** submit · approve · reject · withdraw · retire — with a reason, keyed; the server re-takes the verdict. */
  async templateAct(templateId: string, act: TemplateOverrideAct, body: { reason: string; versionId?: string }, idempotencyKey: string): Promise<{ templateId: string; act: TemplateOverrideAct; to: string | null }> {
    return (await this.http.request<{ templateId: string; act: TemplateOverrideAct; to: string | null }>('POST', `notifications/templates/${encodeURIComponent(templateId)}/acts/${encodeURIComponent(act)}`, { idempotencyKey, body })).data;
  }
}
