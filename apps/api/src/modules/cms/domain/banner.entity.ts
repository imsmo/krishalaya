// modules/cms/domain/banner.entity.ts · the banners aggregate · PC-56 TENANT-8d (migration 0178).
//
// A banner is ONE image at ONE placement, run in a `[starts_at, ends_at)` window for a declared audience, with its words
// in `banner_texts` (one row per language — the image carries none). Its lifecycle is `state` (banner.state.ts, Law 5);
// whether an ACTIVE banner is scheduled · live · ended is its window at read time (banner-window.ts). `banner_group_key`
// groups variants of one campaign (a grouping fact — nothing allocates between them); `slot_order` is its place in the
// placement. Every move of state names who, when and (pause · archive) why — 0178's CHECKs and guard.
import { DomainEvent, CmsEventType } from './cms.events';
import { InvalidBannerError } from './cms.errors';
import { BannerState, assertTransition } from './banner.state';
import { AudienceRule } from './banner-audience';
import { BannerText } from './banner-rules';
import { BannerPhase, bannerPhase } from './banner-window';

export interface BannerProps {
  id: string; tenantId: string; placement: string; mediaId: string; targetUrl: string | null; audience: AudienceRule;
  startsAt: Date; endsAt: Date; groupKey: string | null; slotOrder: number; state: BannerState; clickCount: number;
  activatedAt: Date | null; activatedBy: string | null; pausedAt: Date | null; pausedBy: string | null; pausedReason: string | null;
  archivedAt: Date | null; archivedBy: string | null; archivedReason: string | null;
  createdBy: string | null; lastEditedBy: string | null; createdAt?: Date; updatedAt?: Date;
  /** The row's concurrency token (`updated_at` to the microsecond, as SQL prints it — never a JS Date, 8b's lesson). */
  version: string;
  /** Pre-0178 facts, read and printed, never written. */
  legacyLanguageCode: string | null;
}

export class Banner {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: BannerProps) {}

  static create(input: Pick<BannerProps, 'id' | 'tenantId' | 'placement' | 'mediaId' | 'targetUrl' | 'audience' | 'startsAt' | 'endsAt' | 'groupKey' | 'slotOrder' | 'createdBy'>): Banner {
    if (!input.placement) throw new InvalidBannerError('placement required');
    if (input.endsAt.getTime() <= input.startsAt.getTime()) throw new InvalidBannerError('ends_at must be after starts_at');
    const b = new Banner({
      ...input, state: 'draft', clickCount: 0, activatedAt: null, activatedBy: null, pausedAt: null, pausedBy: null, pausedReason: null,
      archivedAt: null, archivedBy: null, archivedReason: null, lastEditedBy: input.createdBy, version: '', legacyLanguageCode: null,
    });
    b.events.push({ type: CmsEventType.BannerCreated, payload: { bannerId: b.props.id, placement: b.props.placement } });
    return b;
  }
  static rehydrate(p: BannerProps): Banner { return new Banner(p); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get state() { return this.props.state; }
  get placement() { return this.props.placement; }
  toProps(): Readonly<BannerProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  phase(now: Date): BannerPhase { return bannerPhase(this.props.state, this.props.startsAt, this.props.endsAt, now); }
  isLive(now: Date): boolean { return this.phase(now) === 'live'; }

  activate(by: string, at: Date): void {
    assertTransition(this.props.state, 'active');
    const resumed = this.props.state === 'paused';
    this.props = { ...this.props, state: 'active', activatedAt: at, activatedBy: by };
    this.events.push({ type: resumed ? CmsEventType.BannerResumed : CmsEventType.BannerActivated, payload: { bannerId: this.props.id, placement: this.props.placement } });
  }
  pause(by: string, at: Date, reason: string): void {
    assertTransition(this.props.state, 'paused');
    this.props = { ...this.props, state: 'paused', pausedAt: at, pausedBy: by, pausedReason: reason };
    this.events.push({ type: CmsEventType.BannerPaused, payload: { bannerId: this.props.id, placement: this.props.placement } });
  }
  archive(by: string, at: Date, reason: string): void {
    assertTransition(this.props.state, 'archived');
    this.props = { ...this.props, state: 'archived', archivedAt: at, archivedBy: by, archivedReason: reason };
    this.events.push({ type: CmsEventType.BannerArchived, payload: { bannerId: this.props.id, placement: this.props.placement } });
  }

  toJSON(now: Date = new Date(), texts: BannerText[] = []) {
    const v = this.props;
    return {
      id: v.id, placement: v.placement, mediaId: v.mediaId, targetUrl: v.targetUrl, audience: v.audience, startsAt: v.startsAt, endsAt: v.endsAt,
      groupKey: v.groupKey, slotOrder: v.slotOrder, state: v.state, phase: this.phase(now), clickCount: v.clickCount,
      activatedAt: v.activatedAt, pausedAt: v.pausedAt, pausedReason: v.pausedReason, archivedAt: v.archivedAt, archivedReason: v.archivedReason,
      createdAt: v.createdAt, updatedAt: v.updatedAt, version: v.version, legacyLanguageCode: v.legacyLanguageCode, texts,
    };
  }
}
