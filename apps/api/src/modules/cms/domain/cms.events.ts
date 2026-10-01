// modules/cms/domain/cms.events.ts · integration events (via outbox) + vocab.
export const CmsEventType = {
  PagePublished: 'cms.page_published',
  PageArchived:  'cms.page_archived',
  BannerCreated: 'cms.banner_created',
  // PC-56 TENANT-8d · every state move of a banner is an outbox event (Law 4); no consumer subscribes yet (no reader).
  BannerEdited: 'cms.banner_edited',
  BannerActivated: 'cms.banner_activated',
  BannerPaused: 'cms.banner_paused',
  BannerResumed: 'cms.banner_resumed',
  BannerArchived: 'cms.banner_archived',
} as const;
export type CmsEventType = (typeof CmsEventType)[keyof typeof CmsEventType];
export type DomainEvent = { type: string; payload: Record<string, unknown> };

export const PAGE_KINDS = ['static', 'policy', 'faq', 'help_article'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export const PAGE_STATUSES = ['draft', 'published', 'archived'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];
