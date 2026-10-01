// modules/cms/services/banner.service.ts · PC-56 TENANT-8d · THE BANNERS — W173 (the list), W174 (the editor), the form
// chains (New banner · Add gu variant · Save changes), the mutate chains (activate · pause · resume · archive, and the
// reorder in a slot), the live box and the click. Money-free.
//
// What was here (PC-27) and what is now (migration 0178):
//   • a banner had NO WORDS (no text column — the canon's i18n law was unsatisfiable); its words are `banner_texts`, one
//     row per language, en · hi · gu required before it reaches anyone (the review, the act and 0178's trigger);
//   • it could not be EDITED after create (`update` wrote `is_active` only); `save` writes every field, keyed, audited,
//     against the review's content token (a colleague who saved first → typed 409);
//   • Pause (`deactivate`) took no reason and wrote no audit row (F-7); every act takes a reason and is audited with the
//     client IP (or NULL) and the request id in their own columns (8c's plumbing);
//   • the image was not checked (F-8): it must be the cooperative's own, an image, and clean — the review, a typed
//     refusal, and 0178's guard, at create, at every image change and at every activation;
//   • `placement` was a free string, `audience_rules` a free jsonb (F-16): a vocabulary and a declared rule validated
//     against `roles` / `admin_regions`, evaluated by a pure function (banner-audience.ts) for W174's reach and the live box;
//   • `runBannerExpiry` was registered nowhere (F-21): DELETED — the phase is the window at read time.
// THERE IS NO READER: no storefront or mobile code fetches `cms/banners` (grep in the 8d report). Every view carries that
// fact, so no screen can draw a member surface that does not exist.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { looksLikeId, submittedValues, writerIssuesOf } from '../../../shared/form-review';
import { Banner } from '../domain/banner.entity';
import { DomainEvent, CmsEventType } from '../domain/cms.events';
import { BannerActRefusedError, BannerChangedError, BannerFormRefusedError, BannerMediaRefusedError, BannerNotFoundError, BannerSlotRefusedError, CmsForbiddenError } from '../domain/cms.errors';
import { BannerRepository, MediaFact } from '../repositories/banner.repository';
import { BannerFormDto, BannerWriterSchema } from '../dto/create-banner.dto';
import { BANNER_ACTS, BannerAct, BannerState, isBannerAct, reachesMembers } from '../domain/banner.state';
import { BannerActVerdict, bannerActVerdict, ignoringReason, parseActivationRefusals } from '../domain/banner-acts';
import { BannerIntent, BannerReview, CurrentBanner, TEXT_FIELD_RE, enteredLanguages, reviewBanner } from '../domain/banner-review';
import { BannerText, REQUIRED_LANGUAGES, missingLanguages, orderedLanguages, parseList } from '../domain/banner-rules';
import { AudienceRule, Reach, isEveryone, matchesAudience, reachOf } from '../domain/banner-audience';
import { BannerPhase, wallClock } from '../domain/banner-window';
import { SlotDirection, orderedSlot, slotMoveVerdict, slotPosition } from '../domain/banner-slot';
import type { ActMeta } from './cms-page.service';

export interface BannerActor { userId: string; canManage: boolean }

/** THE READER THAT DOES NOT EXIST, as data. W173's *"What members see in their app"* prints this, by name. */
export const BANNER_READER = { surfaces: [] as string[], route: 'GET /v1/cms/banners/live', gap: ['mobile', 'web-storefront'] } as const;
/** W174's reach counts at most this many members (the tenant's active members, by id); the view says when it was cut. */
export const REACH_BOUND = 50_000;

/** The edit's concurrency token: what the banner IS (never its clicks or its place) — a colleague's save changes it. */
export function contentToken(b: { placement: string; mediaId: string; targetUrl: string | null; audience: AudienceRule; startsAt: Date; endsAt: Date; groupKey: string | null; state: BannerState }, texts: readonly BannerText[]): string {
  const words = orderedLanguages(texts.map((t) => t.languageCode)).map((l) => texts.find((t) => t.languageCode === l));
  return createHash('sha256').update(JSON.stringify([b.placement, b.mediaId, b.targetUrl, b.audience.roles, b.audience.regions, b.startsAt.toISOString(), b.endsAt.toISOString(), b.groupKey, b.state, words])).digest('hex').slice(0, 24);
}
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
/** The words as an audit row records them: per language, the headline itself (short, and what a member reads). */
const wordsOf = (texts: readonly BannerText[]) => texts.map((t) => ({ lang: t.languageCode, headline: t.headline, body: t.body, cta: t.ctaLabel, sha: sha(`${t.headline}|${t.body ?? ''}|${t.ctaLabel ?? ''}`) }));
const pgCode = (e: unknown) => (e as { code?: string })?.code;
const pgMessage = (e: unknown) => String((e as { message?: string })?.message ?? '');

@Injectable()
export class BannerService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: BannerRepository,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}

  private guardRead(actor: BannerActor) {
    // W173 "CMS restricted": the console's banners are for the people who manage them.
    if (!actor.canManage) throw new CmsForbiddenError('requires cms.banners.manage');
  }

  /** The languages the form offers: the required three, then the cooperative's own. */
  private async offeredLanguages(tenantId: string, tx?: TxContext): Promise<string[]> {
    return orderedLanguages([...REQUIRED_LANGUAGES, ...(await this.repo.tenantLanguages(tenantId, tx))]);
  }

  /** The form's choices — every one from a table, never a literal in a page. */
  async vocabulary(tenantId: string, actor: BannerActor) {
    this.guardRead(actor);
    const [placements, roles, regions, offered, names, images, timezone, required] = await Promise.all([
      this.repo.placements(tenantId), this.repo.tenantRoles(tenantId), this.repo.regionChoices(tenantId), this.offeredLanguages(tenantId),
      this.repo.languageNames(tenantId), this.repo.cleanImages(tenantId), this.repo.timezoneOf(tenantId), this.repo.requiredLanguages(tenantId),
    ]);
    return {
      placements, roles, regions, images, timezone, requiredLanguages: required,
      languages: offered.map((code) => ({ code, nameEnglish: names.find((n) => n.code === code)?.nameEnglish ?? code, nameNative: names.find((n) => n.code === code)?.nameNative ?? code, required: (REQUIRED_LANGUAGES as readonly string[]).includes(code) })),
      notDeclarable: ['min_orders', 'kyc', 'clusters'],
    };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W173                                                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  async index(tenantId: string, actor: BannerActor, q: { phase?: BannerPhase; placement?: string; languageCode?: string; cursor?: string; limit: number }) {
    this.guardRead(actor);
    const cursor = decodeCursor(q.cursor);
    const now = new Date();
    const [counts, rows, placements] = await Promise.all([
      this.repo.counts(tenantId), this.repo.list(tenantId, { phase: q.phase, placement: q.placement, languageCode: q.languageCode, cursor, limit: q.limit }), this.repo.placements(tenantId),
    ]);
    const media = await this.repo.mediaFacts(tenantId, rows.map((r) => r.banner.toProps().mediaId));
    const items = rows.map((r) => {
      const p = r.banner.toProps();
      const langs = r.texts.map((t) => t.languageCode);
      return {
        ...r.banner.toJSON(now, r.texts), timezone: r.timezone, startsLocal: r.startsLocal, endsLocal: r.endsLocal,
        languages: orderedLanguages(langs), missingLanguages: missingLanguages(langs), everyone: isEveryone(p.audience),
        image: mediaView(media.get(p.mediaId) ?? null),
      };
    });
    const last = rows[rows.length - 1] as (typeof rows)[number] & { cursorAt?: string } | undefined;
    const nextCursor = rows.length === q.limit && last ? Buffer.from(`${last.cursorAt}|${last.banner.id}`).toString('base64url') : null;
    return { items, nextCursor, counts, placements, canManage: actor.canManage, reader: BANNER_READER, requiredLanguages: [...REQUIRED_LANGUAGES] };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W174                                                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  private async current(tenantId: string, id: string, tx?: TxContext): Promise<(CurrentBanner & { banner: Banner; startsLocal: { date: string; time: string }; endsLocal: { date: string; time: string }; timezone: string }) | null> {
    const row = looksLikeId(id) ? await this.repo.getById(tenantId, id, tx) : null;
    if (!row) return null;
    const texts = await this.repo.textsOf(tenantId, id, tx);
    const p = row.banner.toProps();
    return {
      id: p.id, state: p.state, placement: p.placement, mediaId: p.mediaId, groupKey: p.groupKey, targetUrl: p.targetUrl, audience: p.audience,
      startsAt: p.startsAt, endsAt: p.endsAt, texts, slotOrder: p.slotOrder, version: contentToken(p, texts),
      banner: row.banner, startsLocal: row.startsLocal, endsLocal: row.endsLocal, timezone: row.timezone,
    };
  }

  /** W174's reach: the members the rule matches TODAY, by the language they read (banner-audience.ts — not an estimate). */
  async reach(tenantId: string, audience: AudienceRule, textLanguages: readonly string[]): Promise<Reach & { truncated: boolean }> {
    const [members, regions] = await Promise.all([this.repo.memberFacts(tenantId, REACH_BOUND), this.repo.regionsByIds(tenantId, audience.regions)]);
    const pathOf = new Map(regions.map((g) => [g.id, g.path]));
    return { ...reachOf(audience, members, pathOf, textLanguages), truncated: members.length >= REACH_BOUND };
  }

  async view(tenantId: string, actor: BannerActor, id: string) {
    this.guardRead(actor);
    const cur = await this.current(tenantId, id);
    if (!cur) throw new BannerNotFoundError(id);
    const p = cur.banner.toProps();
    const now = new Date();
    const [refusals, media, regions, slot, names, offered, siblings] = await Promise.all([
      this.repo.activationRefusals(tenantId, id), this.repo.mediaFacts(tenantId, [p.mediaId]), this.repo.regionsByIds(tenantId, p.audience.regions),
      this.repo.slotEntries(tenantId, p.placement), this.repo.userNames(tenantId, [p.createdBy, p.lastEditedBy, p.activatedBy, p.pausedBy, p.archivedBy]),
      this.offeredLanguages(tenantId), p.groupKey ? this.repo.groupSiblings(tenantId, p.groupKey, p.id) : Promise.resolve([]),
    ]);
    const langs = cur.texts.map((t) => t.languageCode);
    const acts = BANNER_ACTS.map((a) => ignoringReason(bannerActVerdict({ act: a, canManage: actor.canManage, state: p.state, reason: null, activationRefusals: refusals })))
      .filter((v) => v.to !== null);
    const name = (u: string | null) => (u ? names.get(u) ?? null : null);
    return {
      ...cur.banner.toJSON(now, cur.texts), timezone: cur.timezone, startsLocal: cur.startsLocal, endsLocal: cur.endsLocal,
      image: mediaView(media.get(p.mediaId) ?? null),
      languages: orderedLanguages(langs), missingLanguages: missingLanguages(langs),
      offeredLanguages: offered, hiddenLanguages: offered.filter((l) => !langs.includes(l)),
      activation: parseActivationRefusals(refusals),
      acts,
      audienceRegions: regions, everyone: isEveryone(p.audience),
      reach: await this.reach(tenantId, p.audience, langs),
      slot: { position: slotPosition(slot, p.id), of: slot.length, order: orderedSlot(slot).map((e) => e.id) },
      siblings,
      who: { author: name(p.createdBy), lastEditor: name(p.lastEditedBy), activatedBy: name(p.activatedBy), pausedBy: name(p.pausedBy), archivedBy: name(p.archivedBy) },
      expect: cur.version,
      canManage: actor.canManage, reader: BANNER_READER, requiredLanguages: [...REQUIRED_LANGUAGES],
    };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE FORM CHAIN                                                                                             */
  /* ---------------------------------------------------------------------------------------------------------- */

  private async reviewFacts(tenantId: string, actor: BannerActor, dto: BannerFormDto, id: string | null, tx?: TxContext): Promise<BannerReview> {
    const entered = dto as unknown as Record<string, string | undefined>;
    const intent: BannerIntent = id ? 'edit' : (dto.intent as BannerIntent) ?? 'new';
    // One after another: inside the writer's transaction these share ONE connection.
    const cur = id ? await this.current(tenantId, id, tx) : null;
    if (id && !cur) throw new BannerNotFoundError(id);
    const offered = await this.offeredLanguages(tenantId, tx);
    const stray = enteredLanguages(entered).filter((l) => !offered.includes(l));
    const placements = await this.repo.placements(tenantId, tx);
    const mediaId = (dto.mediaId ?? '').trim();
    const mediaIssue = looksLikeId(mediaId) ? await this.repo.mediaIssue(tenantId, mediaId, tx) : undefined;
    const roles = (await this.repo.tenantRoles(tenantId, tx)).map((r) => r.code);
    const regions = await this.repo.regionsByIds(tenantId, parseList(dto.regions), tx);
    const s = wallClock(dto.startsDate, dto.startsTime); const e = wallClock(dto.endsDate, dto.endsTime);
    const w = await this.repo.resolveWindow(tenantId, s ? `${s.date} ${s.time}` : null, e ? `${e.date} ${e.time}` : null, tx);
    const placement = (dto.placement ?? '').trim();
    const slot = placement ? (await this.repo.slotEntries(tenantId, placement, tx)).filter((x) => x.id !== id) : [];
    const writerFields: Record<string, unknown> = { placement: dto.placement, mediaId: dto.mediaId, groupKey: dto.groupKey, targetUrl: dto.targetUrl, reason: dto.reason };
    return reviewBanner({
      canManage: actor.canManage, intent, entered, languages: offered, strayLanguages: stray, placements, mediaIssue, knownRoles: roles, regions,
      startsAt: w.startsAt, endsAt: w.endsAt, timezone: w.timezone, now: new Date(), current: cur, slot,
      writerIssues: writerIssuesOf(BannerWriterSchema, submittedValues(writerFields)),
    });
  }

  /** The form's review (writes nothing — no key), with W174's reach for the audience as entered. */
  async preview(tenantId: string, actor: BannerActor, dto: BannerFormDto, id: string | null = null): Promise<BannerReview & { reach: (Reach & { truncated: boolean }) | null }> {
    const r = await this.reviewFacts(tenantId, actor, dto, id);
    const audienceOk = !r.refusals.some((x) => x.field === 'roles' || x.field === 'regions');
    return { ...r, reach: actor.canManage && audienceOk ? await this.reach(tenantId, r.preview.audience, r.preview.texts.map((t) => t.languageCode)) : null };
  }

  /**
   * "New banner" (W2510) / "Save changes · Add gu variant" (W2503): a create (born a DRAFT) or an edit of one banner —
   * keyed, audited in the transaction, the slot locked. An edit carries the review's content token (`expect`).
   */
  async save(tenantId: string, actor: BannerActor, idemKey: string, dto: BannerFormDto, meta: ActMeta, id: string | null = null) {
    return this.idem.remember(idemKey, actor.userId, id ? 'cms.banner.update' : 'cms.banner.create', () => this.guarded('write', () =>
      this.uow.run(tenantId, async (tx) => {
        let locked: Banner | null = null;
        if (id) {
          locked = looksLikeId(id) ? await this.repo.getForUpdate(tx, tenantId, id) : null;
          if (!locked) throw new BannerNotFoundError(id);
        }
        // The slots this write touches, locked in a fixed order (never two writers waiting on each other).
        const slots = [...new Set([locked?.placement, (dto.placement ?? '').trim()].filter((x): x is string => !!x))].sort();
        for (const s of slots) await this.repo.lockSlot(tx, tenantId, s);
        const review = await this.reviewFacts(tenantId, actor, dto, id, tx);
        const pv = review.preview;
        if (id && dto.expect && dto.expect !== pv.expect) throw new BannerChangedError(id, dto.expect, pv.expect);
        if (!review.ready) throw new BannerFormRefusedError(review.refusals);
        const reason = (dto.reason ?? '').trim();
        const slotPlace = pv.slotPlace as number;
        if (!id) {
          const b = Banner.create({
            id: uuidv7(), tenantId, placement: pv.placement as string, mediaId: (dto.mediaId as string).trim().toLowerCase(), targetUrl: pv.targetUrl, audience: pv.audience,
            startsAt: pv.startsAt as Date, endsAt: pv.endsAt as Date, groupKey: pv.groupKey, slotOrder: slotPlace, createdBy: actor.userId,
          });
          await this.repo.insert(tx, b, actor.userId);
          await this.repo.replaceTexts(tx, tenantId, b.id, pv.texts, actor.userId);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'cms.banner_created', entityType: 'banner', entityId: b.id, oldValue: null,
            newValue: { ...contentOf(b), words: wordsOf(pv.texts), missingLanguages: pv.missingLanguages, timezone: pv.timezone }, reason, ip: meta.ip, requestId: meta.requestId,
          });
          await this.flush(tx, tenantId, b.id, b.pullEvents());
          this.metrics.inc('cms.banner.write', { mode: 'create' });
          return { id: b.id, mode: 'create' as const, state: 'draft' as BannerState, missingLanguages: pv.missingLanguages, activatable: pv.activatable };
        }
        const was = locked!.toProps();
        const wasTexts = (await this.repo.textsOf(tenantId, was.id, tx));
        const next = Banner.rehydrate({
          ...was, placement: pv.placement as string, mediaId: (dto.mediaId as string).trim().toLowerCase(), targetUrl: pv.targetUrl, audience: pv.audience,
          startsAt: pv.startsAt as Date, endsAt: pv.endsAt as Date, groupKey: pv.groupKey, slotOrder: slotPlace,
        });
        if ((await this.repo.updateContent(tx, next, actor.userId)) !== 1) throw new BannerChangedError(was.id, dto.expect ?? '', null);
        await this.repo.replaceTexts(tx, tenantId, was.id, pv.texts, actor.userId);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'cms.banner_edited', entityType: 'banner', entityId: was.id,
          oldValue: { ...contentOf(locked!), words: wordsOf(wasTexts) },
          newValue: { ...contentOf(next), words: wordsOf(pv.texts), missingLanguages: pv.missingLanguages, liveNow: pv.liveNow, diff: review.diff?.map((d) => d.field) ?? [] },
          reason, ip: meta.ip, requestId: meta.requestId,
        });
        await this.outbox.write(tx, { tenantId, aggregateType: 'banner', aggregateId: was.id, eventType: CmsEventType.BannerEdited, payload: { v: 1, bannerId: was.id, placement: next.placement, liveNow: pv.liveNow } });
        this.metrics.inc('cms.banner.write', { mode: 'update' });
        return { id: was.id, mode: 'update' as const, state: was.state, missingLanguages: pv.missingLanguages, activatable: pv.activatable };
      }, { userId: actor.userId })));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE MUTATE CHAIN — activate · pause · resume · archive                                                     */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** The confirm step: the banner, every act's verdict (the reason as typed), and the activation law's refusals. */
  async acts(tenantId: string, actor: BannerActor, id: string, q: { reason?: string }) {
    this.guardRead(actor);
    const cur = await this.current(tenantId, id);
    if (!cur) throw new BannerNotFoundError(id);
    const p = cur.banner.toProps();
    const refusals = await this.repo.activationRefusals(tenantId, id);
    const verdicts = BANNER_ACTS.map((a) => bannerActVerdict({ act: a, canManage: actor.canManage, state: p.state, reason: q.reason ?? null, activationRefusals: refusals }));
    const now = new Date();
    return {
      banner: { ...cur.banner.toJSON(now, cur.texts), timezone: cur.timezone, startsLocal: cur.startsLocal, endsLocal: cur.endsLocal },
      verdicts, activation: parseActivationRefusals(refusals), reader: BANNER_READER,
    };
  }

  async act(tenantId: string, actor: BannerActor, idemKey: string, id: string, actName: string, body: { reason: string }, meta: ActMeta) {
    if (!isBannerAct(actName)) throw new BannerActRefusedError(actName, ['ILLEGAL_FROM_STATE']);
    const act: BannerAct = actName;
    return this.idem.remember(idemKey, actor.userId, `cms.banner.${act}`, () => this.guarded(act, () =>
      this.uow.run(tenantId, async (tx) => {
        const b = looksLikeId(id) ? await this.repo.getForUpdate(tx, tenantId, id) : null;
        if (!b) throw new BannerNotFoundError(id);
        const before = b.toProps();
        const refusals = reachesMembers(act) ? await this.repo.activationRefusals(tenantId, id, tx) : [];
        const v: BannerActVerdict = bannerActVerdict({ act, canManage: actor.canManage, state: before.state, reason: body.reason, activationRefusals: refusals });
        if (!v.allowed) throw new BannerActRefusedError(act, v.refusals, v.missingLanguages);
        const reason = body.reason.trim();
        const at = new Date();
        if (act === 'activate' || act === 'resume') b.activate(actor.userId, at);
        else if (act === 'pause') b.pause(actor.userId, at, reason);
        else b.archive(actor.userId, at, reason);
        if ((await this.repo.updateState(tx, b, actor.userId)) !== 1) throw new BannerNotFoundError(id);
        const after = b.toProps();
        const phaseBefore = Banner.rehydrate(before).phase(at); const phaseAfter = b.phase(at);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: `cms.banner_${act === 'activate' ? 'activated' : act === 'pause' ? 'paused' : act === 'resume' ? 'resumed' : 'archived'}`,
          entityType: 'banner', entityId: id,
          oldValue: { state: before.state, phase: phaseBefore, pausedReason: before.pausedReason },
          newValue: { state: after.state, phase: phaseAfter, placement: after.placement, window: { startsAt: after.startsAt, endsAt: after.endsAt } },
          reason, ip: meta.ip, requestId: meta.requestId,
        });
        await this.flush(tx, tenantId, id, b.pullEvents());
        this.metrics.inc('cms.banner.act', { act });
        return { id, act, state: after.state, phase: phaseAfter, before: { state: before.state, phase: phaseBefore } };
      }, { userId: actor.userId })));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE BANNERS-MUTATE CHAIN — the order inside a slot                                                         */
  /* ---------------------------------------------------------------------------------------------------------- */

  async slotPreview(tenantId: string, actor: BannerActor, id: string, direction: SlotDirection, reason: string | null) {
    this.guardRead(actor);
    const cur = await this.current(tenantId, id);
    if (!cur) throw new BannerNotFoundError(id);
    const entries = await this.repo.slotEntries(tenantId, cur.placement);
    const v = slotMoveVerdict({ canManage: actor.canManage, archived: cur.state === 'archived', entries, id, direction, reason });
    const order = orderedSlot(entries).map((e) => e.id);
    const texts = await this.repo.textsFor(tenantId, order);
    const headline = (bid: string) => (texts.get(bid) ?? []).find((t) => t.languageCode === 'en')?.headline ?? (texts.get(bid) ?? [])[0]?.headline ?? null;
    return {
      allowed: v.allowed, refusals: v.refusals, placement: cur.placement, id, direction,
      before: order.map((bid) => ({ id: bid, headline: headline(bid) })),
      after: v.plan && v.plan.ok ? v.plan.order.map((bid) => ({ id: bid, headline: headline(bid) })) : null,
      position: slotPosition(entries, id), reader: BANNER_READER,
    };
  }

  async slotMove(tenantId: string, actor: BannerActor, idemKey: string, dto: { id: string; direction: SlotDirection; reason: string }, meta: ActMeta) {
    return this.idem.remember(idemKey, actor.userId, 'cms.banner.slot', () => this.guarded('reorder', () =>
      this.uow.run(tenantId, async (tx) => {
        const b = looksLikeId(dto.id) ? await this.repo.getById(tenantId, dto.id, tx) : null;
        if (!b) throw new BannerNotFoundError(dto.id);
        const placement = b.banner.placement;
        await this.repo.lockSlot(tx, tenantId, placement);
        const entries = await this.repo.slotForUpdate(tx, tenantId, placement);
        const v = slotMoveVerdict({ canManage: actor.canManage, archived: b.banner.state === 'archived', entries, id: dto.id, direction: dto.direction, reason: dto.reason });
        if (!v.allowed || !v.plan || !v.plan.ok) throw new BannerSlotRefusedError(v.refusals);
        for (const st of v.plan.steps) await this.repo.setSlot(tx, tenantId, st.id, st.to, actor.userId);
        const beforeOrder = orderedSlot(entries).map((e) => e.id);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: `cms.banner_moved_${dto.direction}`, entityType: 'banner', entityId: dto.id,
          oldValue: { placement, order: beforeOrder, position: beforeOrder.indexOf(dto.id) + 1 },
          newValue: { placement, order: v.plan.order, position: v.plan.order.indexOf(dto.id) + 1, renumbered: v.plan.steps },
          reason: dto.reason.trim(), ip: meta.ip, requestId: meta.requestId,
        });
        this.metrics.inc('cms.banner.slot', { direction: dto.direction });
        return { id: dto.id, placement, order: v.plan.order, position: v.plan.order.indexOf(dto.id) + 1 };
      }, { userId: actor.userId })));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE LIVE BOX — what a member's app WOULD be offered (no app calls it yet)                                  */
  /* ---------------------------------------------------------------------------------------------------------- */

  /**
   * Any authenticated member: the banners live NOW for a placement, filtered by THEIR facts through the evaluator, in
   * THEIR language — a banner without words in that language is not offered (W173: *"no English fallback surprises"*).
   */
  async live(tenantId: string, userId: string, q: { placement?: string; languageCode?: string; limit: number }) {
    const [banners, me] = await Promise.all([this.repo.liveNow(tenantId, q.placement, 200), this.repo.memberFacts(tenantId, 1, userId)]);
    const member = me[0] ?? { userId, roles: [], regionPaths: [], languageCode: null };
    const lang = q.languageCode ?? member.languageCode;
    const regionIds = [...new Set(banners.flatMap((b) => b.toProps().audience.regions))];
    const pathOf = new Map((await this.repo.regionsByIds(tenantId, regionIds)).map((g) => [g.id, g.path]));
    const texts = await this.repo.textsFor(tenantId, banners.map((b) => b.id));
    const now = new Date();
    const items = banners
      .filter((b) => matchesAudience(b.toProps().audience, member, pathOf))
      .map((b) => ({ b, text: (texts.get(b.id) ?? []).find((t) => t.languageCode === lang) ?? null }))
      .filter((x) => x.text !== null)
      .slice(0, q.limit)
      .map(({ b, text }) => { const p = b.toProps(); return { id: p.id, placement: p.placement, slotOrder: p.slotOrder, mediaId: p.mediaId, targetUrl: p.targetUrl, endsAt: p.endsAt, phase: b.phase(now), text }; });
    return { items, languageCode: lang, reader: BANNER_READER };
  }

  /** Click tracking — atomic increment, only on a LIVE banner; 404 otherwise. No impression is counted (no reader). */
  async recordClick(tenantId: string, actor: { userId: string }, id: string) {
    return this.uow.run(tenantId, async (tx) => {
      const ok = looksLikeId(id) && (await this.repo.incrementClick(tx, tenantId, id));
      if (!ok) throw new BannerNotFoundError(id);
      return { ok: true };
    }, { userId: actor.userId });
  }

  /* ---------------------------------------------------------------------------------------------------------- */

  /** 0178's guard and deferred triggers refusing are sentences with codes, never a 500. */
  private async guarded<T>(act: string, fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e) {
      if (pgCode(e) !== '23514') throw e;
      const m = pgMessage(e);
      const media = /banner media refused: (MEDIA_[A-Z_]+)/.exec(m);
      if (media) throw new BannerMediaRefusedError(media[1]);
      const law = /cannot be active: (.+)$/.exec(m);
      if (law) { const p = parseActivationRefusals(law[1].split(', ')); throw new BannerActRefusedError(act, p.codes.length ? p.codes : ['REFUSED_BY_DATABASE'], p.missingLanguages); }
      const words = /would lose its ([a-z]+) words/.exec(m);
      if (words) throw new BannerActRefusedError(act, ['TEXT_MISSING'], [words[1]]);
      throw new BannerActRefusedError(act, ['REFUSED_BY_DATABASE']);
    }
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'banner', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}

/** The banner's content, as an audit row records it. */
function contentOf(b: Banner) {
  const p = b.toProps();
  return { placement: p.placement, mediaId: p.mediaId, targetUrl: p.targetUrl, audience: p.audience, startsAt: p.startsAt, endsAt: p.endsAt, groupKey: p.groupKey, slotOrder: p.slotOrder, state: p.state };
}
/** The image as the console prints it: its file name (the key's last segment) and its scan status. */
function mediaView(m: MediaFact | null) {
  if (!m) return null;
  return { id: m.id, fileName: m.s3Key.split('/').pop() ?? m.s3Key, mimeType: m.mimeType, scanStatus: m.scanStatus, clean: m.scanStatus === 'clean' && m.kind === 'image' };
}
/** The keyset cursor: `<created_at to the microsecond>|<id>`, base64url. Anything else is no cursor. */
export function decodeCursor(c?: string): { c: string; id: string } | undefined {
  if (!c) return undefined;
  const [at, id] = Buffer.from(c, 'base64url').toString().split('|');
  return at && id && looksLikeId(id) && /^\d{4}-\d{2}-\d{2}T[\d:.]+[+-]\d{2}/.test(at) ? { c: at, id } : undefined;
}
export { TEXT_FIELD_RE };
