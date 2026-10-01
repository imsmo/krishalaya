// modules/cms/domain/cms-page.entity.ts · the cms_pages aggregate (one row = one VERSION of a slug).
// A page is created as a draft (version N for its slug); editing is allowed only while draft; publishing stamps
// published_at + published_by; a published page is re-edited by minting a NEW version (a fresh draft) — the live row is
// never mutated (0177's `cms_pages_guard` says the same in the database). Platform pages have tenant_id NULL.
// PC-56 TENANT-8c: the row carries what 0177 added — the language its body is written in, an FAQ topic and place, who
// published and who archived it and why (a vocabulary code), and the last editor of a draft (the checker rule's second
// maker).
import { PageKind, PageStatus, DomainEvent, CmsEventType } from './cms.events';
import { assertTransition } from './cms-page.state';
import { InvalidPageError } from './cms.errors';
import { SLUG_RE } from './page-rules';

export interface CmsPageProps {
  id: string; tenantId: string | null; slug: string; pageKind: PageKind; defaultTitle: string; body: string;
  version: number; status: PageStatus; publishedAt: Date | null;
  languageCode?: string | null; topic?: string | null; sortOrder?: number;
  publishedBy?: string | null; archivedAt?: Date | null; archivedBy?: string | null; archivedReason?: string | null;
  createdBy?: string | null; lastEditedBy?: string | null; createdAt?: Date; updatedAt?: Date;
}
export class CmsPage {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: CmsPageProps) {}

  static create(input: Omit<CmsPageProps, 'status' | 'publishedAt'>): CmsPage {
    if (!SLUG_RE.test(input.slug)) throw new InvalidPageError('slug must be kebab-case (a-z0-9, hyphens)');
    if (!input.defaultTitle) throw new InvalidPageError('title required');
    if (!input.body) throw new InvalidPageError('body required');
    if (input.version < 1) throw new InvalidPageError('version starts at 1');
    return new CmsPage({ sortOrder: 0, languageCode: null, topic: null, ...input, status: 'draft', publishedAt: null });
  }
  static rehydrate(p: CmsPageProps): CmsPage { return new CmsPage(p); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get slug() { return this.props.slug; }
  get version() { return this.props.version; }
  get status() { return this.props.status; }
  get pageKind() { return this.props.pageKind; }
  toProps(): Readonly<CmsPageProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  edit(patch: { defaultTitle?: string; body?: string; pageKind?: PageKind; languageCode?: string | null; topic?: string | null }, editor?: string): void {
    if (this.props.status !== 'draft') throw new InvalidPageError('only a draft version can be edited; publish creates a new version');
    if (patch.defaultTitle !== undefined) { if (!patch.defaultTitle) throw new InvalidPageError('title required'); this.props.defaultTitle = patch.defaultTitle; }
    if (patch.body !== undefined) { if (!patch.body) throw new InvalidPageError('body required'); this.props.body = patch.body; }
    if (patch.pageKind !== undefined) this.props.pageKind = patch.pageKind;
    if (patch.languageCode !== undefined) this.props.languageCode = patch.languageCode;
    if (patch.topic !== undefined) this.props.topic = patch.topic;
    if (editor) this.props.lastEditedBy = editor;
  }
  publish(by?: string, at: Date = new Date()): void {
    assertTransition(this.props.status, 'published');
    this.props.status = 'published'; this.props.publishedAt = at; this.props.publishedBy = by ?? null;
    this.events.push({ type: CmsEventType.PagePublished, payload: { pageId: this.props.id, slug: this.props.slug, version: this.props.version } });
  }
  archive(by?: string, reason = 'unrecorded', at: Date = new Date()): void {
    assertTransition(this.props.status, 'archived');
    this.props.status = 'archived'; this.props.archivedAt = at; this.props.archivedBy = by ?? null; this.props.archivedReason = reason;
    this.events.push({ type: CmsEventType.PageArchived, payload: { pageId: this.props.id, slug: this.props.slug, version: this.props.version, reason } });
  }
  toJSON() {
    const v = this.props;
    return {
      id: v.id, slug: v.slug, pageKind: v.pageKind, defaultTitle: v.defaultTitle, body: v.body, version: v.version, status: v.status,
      publishedAt: v.publishedAt, createdAt: v.createdAt,
      platform: v.tenantId === null, languageCode: v.languageCode ?? null, topic: v.topic ?? null, sortOrder: v.sortOrder ?? 0,
      publishedBy: v.publishedBy ?? null, archivedAt: v.archivedAt ?? null, archivedBy: v.archivedBy ?? null, archivedReason: v.archivedReason ?? null,
      createdBy: v.createdBy ?? null, lastEditedBy: v.lastEditedBy ?? null, updatedAt: v.updatedAt,
    };
  }
}
