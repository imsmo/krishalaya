// modules/communication/services/template-override.service.ts · PC-56 TENANT-8a · THE OVERRIDE — the tenant realm's
// notification templates: W180 (the list), W181 (the editor), and the form + mutate chains behind them.
//
// REPLACES `TemplateAdminService` (PC-27), whose `upsert` wrote the row's `body` in place and minted no version, so the
// words `resolve()` reads never changed: a tenant override NEVER SENT, and `list` printed the row's body as though it
// were live (F-1). What exists now:
//   • `preview` — the form's review, computed from the facts the writer uses (the catalogue, the event's declared
//     variables, this tenant's languages, what serves today) by `reviewOverride` — the same function `saveDraft` runs.
//   • `saveDraft` — the override row (born inactive, unserved) + a DRAFT version authored by the caller, keyed and
//     audited. Nothing is sent from a draft.
//   • `act` — submit · approve · reject · withdraw · retire, each a verdict first (`overrideActVerdict`), re-taken on
//     the locked row, with a reason, an audit row and an Idempotency-Key. `approve` is a SECOND person's
//     (`notification.templates.approve`, never the author — the verdict and 0175's trigger); on push / in-app / email
//     it makes the version SERVING and supersedes the one it replaces; on SMS / WhatsApp it moves the version to
//     `submitted_to_provider`, which never serves (ADMIN-11b-Q1 owns the provider).
//   • `index` / `view` — every figure from the serving VERSION (never `t.body`), every count a live query.
// Security copy stays platform-controlled (ADMIN-11b's rule, checked here and by 0122's trigger).
import { Inject, Injectable } from '@nestjs/common';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { looksLikeId, submittedValues, writerIssuesOf } from '../../../shared/form-review';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationTemplateRepository, OverrideIndexQuery, OverrideIndexRow, OverrideSummary, OverrideVersionRow } from '../repositories/notification-template.repository';
import { CommForbiddenError, TemplateActRefusedError, TemplateFormRefusedError, TemplateNotFoundError } from '../domain/communication.errors';
import {
  OPEN_LIFECYCLES, OverrideAct, OverrideActVerdict, ServingSource, allOverrideVerdicts, ignoringReason, isOverrideAct, isSecurityCopy, overrideActVerdict, servingSource, VERSION_ACTS,
} from '../domain/template-override';
import { EventFacts, OverrideReview, VariableDecl, providerOf, renderPreview, reviewOverride, storedOverride } from '../domain/template-override-review';
import { segmentsFor, SegmentCount } from '../domain/sms-segments';
import { OverrideFormDto, OverrideWriterSchema } from '../dto/create-notification-template.dto';

export interface TemplateActor { userId: string; canAuthor: boolean; canApprove: boolean }

export interface IndexRowView extends OverrideIndexRow { source: ServingSource; locked: boolean }
export interface OverrideIndex { summary: OverrideSummary; items: IndexRowView[]; nextCursor: string | null; canAuthor: boolean; canApprove: boolean }

export interface OverrideView {
  slot: IndexRowView;
  event: { code: string; defaultName: string; priority: string; userCanOptOut: boolean; defaultChannels: string[] };
  variables: VariableDecl[];
  platform: { templateId: string | null; words: { versionNo: number; subject: string | null; body: string } | null; rendered: string | null };
  override: { templateId: string; words: { versionNo: number; subject: string | null; body: string; approvedAt: Date | null } | null; rendered: string | null; segments: SegmentCount | null } | null;
  open: { id: string; versionNo: number; lifecycle: string; authoredByUserId: string | null; authoredByYou: boolean; rendered: string; segments: SegmentCount | null } | null;
  versions: Array<OverrideVersionRow & { authoredByYou: boolean }>;
  acts: OverrideActVerdict[];
  provider: 'none' | 'dlt' | 'whatsapp';
  canAuthor: boolean; canApprove: boolean;
}

const encodeCursor = (r: { eventCode: string; channel: string; languageCode: string }) => Buffer.from(`${r.eventCode}|${r.channel}|${r.languageCode}`).toString('base64');
export const decodeSlotCursor = (c?: string) => {
  if (!c) return undefined;
  const [e, ch, l] = Buffer.from(c, 'base64').toString().split('|');
  return e && ch && l ? { e, c: ch, l } : undefined;
};

@Injectable()
export class TemplateOverrideService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly events: NotificationEventRepository,
    private readonly templates: NotificationTemplateRepository,
  ) {}

  private guardRead(actor: TemplateActor) {
    // W180 "Templates restricted": the page is for the people who write or check the words.
    if (!actor.canAuthor && !actor.canApprove) throw new CommForbiddenError('requires notification.templates.manage or notification.templates.approve');
  }

  private rowView(r: OverrideIndexRow): IndexRowView {
    return { ...r, source: servingSource({ overrideServes: r.override.serves, platformServes: r.platform.serves }), locked: isSecurityCopy(r) };
  }

  /** The languages an override may be written in: this tenant's, or the platform's active registry when it declared none. */
  async languages(tenantId: string): Promise<Array<{ code: string; nameEnglish: string; nameNative: string; tenantDeclared: boolean }>> {
    const registry = await this.templates.activeLanguages();
    const own = await this.templates.tenantLanguageOrder(tenantId);
    if (own.length === 0) return registry.map((l) => ({ ...l, tenantDeclared: false }));
    return own.map((code) => registry.find((l) => l.code === code) ?? { code, nameEnglish: code, nameNative: code })
      .map((l) => ({ ...l, tenantDeclared: true }));
  }

  /** The event catalogue as the form's choices — every event, each marked locked or not, with its channels. */
  async catalogue(actor: TemplateActor) {
    this.guardRead(actor);
    return (await this.events.list()).map((e) => { const j = e.toJSON(); return { ...j, locked: isSecurityCopy(j) }; });
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W180                                                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  async index(tenantId: string, actor: TemplateActor, q: OverrideIndexQuery): Promise<OverrideIndex> {
    this.guardRead(actor);
    const [summary, rows] = await Promise.all([this.templates.summary(tenantId), this.templates.index(tenantId, q)]);
    const items = rows.map((r) => this.rowView(r));
    const last = items[items.length - 1];
    return { summary, items, nextCursor: items.length === q.limit && last ? encodeCursor(last) : null, canAuthor: actor.canAuthor, canApprove: actor.canApprove };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W181                                                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  async view(tenantId: string, actor: TemplateActor, templateId: string): Promise<OverrideView> {
    this.guardRead(actor);
    const slot = looksLikeId(templateId) ? await this.templates.slotOf(tenantId, templateId) : null;
    if (!slot) throw new TemplateNotFoundError(templateId);
    const event = await this.events.getByCode(slot.eventCode);
    if (!event) throw new TemplateNotFoundError(templateId);
    const variables = await this.templates.variablesFor(slot.eventCode);
    const platformWords = await this.templates.servingWords(tenantId, slot.platform.templateId);
    const overrideWords = slot.override.templateId ? await this.templates.servingWords(tenantId, slot.override.templateId) : null;
    const versions = slot.override.templateId ? await this.templates.versionsOf(tenantId, slot.override.templateId) : [];
    const openRow = versions.find((v) => OPEN_LIFECYCLES.has(v.lifecycle)) ?? null;
    const render = (w: { subject: string | null; body: string } | null) => (w ? renderPreview(slot.channel, slot.languageCode, w.subject, w.body, variables).body : null);
    const segs = (text: string | null) => (slot.channel === 'sms' && text !== null ? segmentsFor(text) : null);
    const overrideRendered = render(overrideWords);
    const openRendered = openRow ? render(openRow)! : null;
    const acts = allOverrideVerdicts({
      canAuthor: actor.canAuthor, canApprove: actor.canApprove, event: event.toJSON(), channelIsDefault: slot.channelIsDefault, channel: slot.channel,
      open: openRow ? { id: openRow.id, lifecycle: openRow.lifecycle, authoredByUserId: openRow.authoredByUserId } : null,
      actorUserId: actor.userId, serving: slot.override.serves, reason: null,
    }).map(ignoringReason);   // the buttons are drawn before a reason exists; its refusal belongs to the confirm step
    const e = event.toJSON();
    return {
      slot: this.rowView(slot),
      event: { code: e.code, defaultName: e.defaultName, priority: e.priority, userCanOptOut: e.userCanOptOut, defaultChannels: e.defaultChannels },
      variables,
      platform: { templateId: slot.platform.templateId, words: platformWords, rendered: render(platformWords) },
      override: slot.override.templateId ? { templateId: slot.override.templateId, words: overrideWords, rendered: overrideRendered, segments: segs(overrideRendered) } : null,
      open: openRow ? { id: openRow.id, versionNo: openRow.versionNo, lifecycle: openRow.lifecycle, authoredByUserId: openRow.authoredByUserId, authoredByYou: openRow.authoredByUserId === actor.userId, rendered: openRendered!, segments: segs(openRendered) } : null,
      versions: versions.map((v) => ({ ...v, authoredByYou: v.authoredByUserId === actor.userId })),
      acts: slot.override.templateId ? acts : [],
      provider: providerOf(slot.channel),
      canAuthor: actor.canAuthor, canApprove: actor.canApprove,
    };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE FORM CHAIN                                                                                             */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** Everything the review needs, read on the connection it is handed (the write re-reads inside its own tx). */
  private async reviewFacts(tenantId: string, actor: TemplateActor, dto: OverrideFormDto, tx?: TxContext): Promise<OverrideReview> {
    const s = storedOverride(dto);
    const ev = s.eventCode ? await this.events.getByCode(s.eventCode, tx) : null;
    const event: EventFacts | null = ev ? ev.toJSON() : null;
    const declared = event ? await this.templates.variablesFor(event.code, tx) : [];
    const langs = (await this.languages(tenantId)).map((l) => l.code);
    const slot = event && s.channel && s.languageCode ? await this.templates.slot(tenantId, event.code, s.channel, s.languageCode, tx) : null;
    let servingToday: OverrideReview['preview']['servingToday'] = { source: 'none', versionNo: null, subject: null, body: null };
    let override: Parameters<typeof reviewOverride>[0]['override'] = null;
    if (slot) {
      const src = servingSource({ overrideServes: slot.override.serves, platformServes: slot.platform.serves });
      const words = src === 'override' ? await this.templates.servingWords(tenantId, slot.override.templateId, tx)
        : src === 'platform' ? await this.templates.servingWords(tenantId, slot.platform.templateId, tx) : null;
      servingToday = { source: words ? src : 'none', versionNo: words?.versionNo ?? null, subject: words?.subject ?? null, body: words?.body ?? null };
      if (slot.override.templateId) {
        const own = src === 'override' ? words : null;
        override = {
          templateId: slot.override.templateId,
          nextVersionNo: (slot.override.latestVersionNo ?? 0) + 1,
          open: slot.override.latestLifecycle && OPEN_LIFECYCLES.has(slot.override.latestLifecycle) ? { versionNo: slot.override.latestVersionNo ?? 0, lifecycle: slot.override.latestLifecycle } : null,
          servingBody: own?.body ?? null, servingSubject: own?.subject ?? null,
        };
      }
    }
    const values = submittedValues(dto);
    return reviewOverride({
      canAuthor: actor.canAuthor, event, declared, tenantLanguages: langs, entered: dto, servingToday, override,
      writerIssues: writerIssuesOf(OverrideWriterSchema, values),
    });
  }

  async preview(tenantId: string, actor: TemplateActor, dto: OverrideFormDto): Promise<OverrideReview> {
    return this.reviewFacts(tenantId, actor, dto);
  }

  /** "Save" (W2779) / "New override" (W2786): a DRAFT version, never serving. Keyed; audited in the transaction. */
  async saveDraft(tenantId: string, actor: TemplateActor, idemKey: string, dto: OverrideFormDto, ip: string | null): Promise<{ templateId: string; versionId: string; versionNo: number; lifecycle: 'draft' }> {
    return this.idem.remember(idemKey, actor.userId, 'communication.template.draft', () =>
      this.uow.run(tenantId, async (tx) => {
        const review = await this.reviewFacts(tenantId, actor, dto, tx);
        if (!review.ready) throw new TemplateFormRefusedError(review.refusals);
        const s = storedOverride(dto);
        let row = await this.templates.lockOverride(tx, tenantId, s.eventCode, s.channel, s.languageCode);
        const created = row === null;
        if (!row) {
          const id = uuidv7();
          await this.templates.insertOverrideRow(tx, tenantId, id, s, actor.userId);
          row = { id, isActive: false, servingVersionId: null, currentVersionNo: 1 };
        }
        const versionNo = await this.templates.nextVersionNo(tx, row.id);
        const versionId = await this.templates.insertDraftVersion(tx, {
          templateId: row.id, tenantId, eventCode: s.eventCode, channel: s.channel, languageCode: s.languageCode, versionNo,
          subject: s.subject, body: s.body, authorUserId: actor.userId, reason: s.reason,
        });
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'communication.template.draft', entityType: 'notification_template', entityId: row.id,
          oldValue: created ? null : { servingVersionId: row.servingVersionId },
          newValue: { eventCode: s.eventCode, channel: s.channel, languageCode: s.languageCode, versionId, versionNo, lifecycle: 'draft', created },
          reason: s.reason, ip,
        });
        this.metrics.inc('communication.template_override.draft', { channel: s.channel });
        return { templateId: row.id, versionId, versionNo, lifecycle: 'draft' as const };
      }, { userId: actor.userId }));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE MUTATE CHAIN                                                                                           */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** The confirm step's object and verdicts (reason-less — the reason's refusal is printed by the chain as typed). */
  async acts(tenantId: string, actor: TemplateActor, templateId: string, reason: string | null): Promise<{ view: OverrideView; verdicts: OverrideActVerdict[] }> {
    const view = await this.view(tenantId, actor, templateId);
    if (!view.override) throw new TemplateNotFoundError(templateId);
    const verdicts = allOverrideVerdicts({
      canAuthor: actor.canAuthor, canApprove: actor.canApprove, event: view.event, channelIsDefault: view.slot.channelIsDefault, channel: view.slot.channel,
      open: view.open ? { id: view.open.id, lifecycle: view.open.lifecycle, authoredByUserId: view.open.authoredByUserId } : null,
      actorUserId: actor.userId, serving: view.slot.override.serves, reason,
    });
    return { view, verdicts };
  }

  async act(tenantId: string, actor: TemplateActor, idemKey: string, templateId: string, actName: string, body: { reason: string; versionId?: string }, ip: string | null) {
    if (!isOverrideAct(actName)) throw new TemplateActRefusedError(actName, ['ILLEGAL_FROM_STATUS']);
    const act: OverrideAct = actName;
    return this.idem.remember(idemKey, actor.userId, `communication.template.${act}`, () =>
      this.uow.run(tenantId, async (tx) => {
        const row = looksLikeId(templateId) ? await this.templates.lockOverrideById(tx, tenantId, templateId) : null;
        if (!row) throw new TemplateNotFoundError(templateId);
        const event = await this.events.getByCode(row.eventCode, tx);
        const open = VERSION_ACTS.has(act) ? await this.templates.openVersionForUpdate(tx, tenantId, row.id) : null;
        const slot = await this.templates.slot(tenantId, row.eventCode, row.channel, row.languageCode, tx);
        const v = overrideActVerdict({
          act, canAuthor: actor.canAuthor, canApprove: actor.canApprove, event: event ? event.toJSON() : null,
          channelIsDefault: slot?.channelIsDefault ?? false, channel: row.channel,
          open: open ? { id: open.id, lifecycle: open.lifecycle, authoredByUserId: open.authoredByUserId } : null,
          expectedVersionId: body.versionId ?? null, actorUserId: actor.userId, serving: slot?.override.serves ?? false, reason: body.reason,
        });
        if (!v.allowed) throw new TemplateActRefusedError(act, v.refusals);
        const reason = body.reason.trim();
        let before: Record<string, unknown>; let after: Record<string, unknown>;
        if (act === 'retire') {
          before = { servingVersionId: row.servingVersionId, isActive: row.isActive };
          await this.templates.retire(tx, tenantId, row.id, actor.userId);
          after = { servingVersionId: null, isActive: false, servesFrom: slot?.platform.serves ? 'platform' : 'none' };
        } else {
          const o = open!;
          const to = v.to as string;
          before = { versionId: o.id, versionNo: o.versionNo, lifecycle: o.lifecycle, servingVersionId: row.servingVersionId };
          await this.templates.decideVersion(tx, tenantId, o.id, to, actor.userId, act, reason);
          if (act === 'approve' && to === 'approved') await this.templates.promote(tx, tenantId, row.id, o.id, actor.userId);
          after = { versionId: o.id, versionNo: o.versionNo, lifecycle: to, servingVersionId: act === 'approve' && to === 'approved' ? o.id : row.servingVersionId };
        }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `communication.template.${act}`, entityType: 'notification_template', entityId: row.id, oldValue: before, newValue: after, reason, ip });
        this.metrics.inc('communication.template_override.act', { act, channel: row.channel });
        return { templateId: row.id, act, to: v.to, before, after };
      }, { userId: actor.userId }));
  }
}
