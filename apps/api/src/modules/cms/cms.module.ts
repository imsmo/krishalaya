// modules/cms/cms.module.ts
// CMS (PRD §50) — tenant content pages + promotional banners. Pages are VERSIONED (draft → published →
// archived; a published page is re-edited by minting a new version, so the live content is immutable); banners
// run in a scheduled [starts,ends) window at a placement, with atomic click tracking. Authoring needs cms.manage
// (audited); published pages + live banners are readable by any authenticated user. Money-free. Gated by the
// `cms` flag (default OFF).
//
// SCOPE: page authoring/versioning/publish + banner scheduling/serve/click + banner-expiry job. DEFERRED:
// per-language page translations (the translations table), banner audience-rule targeting eval, page preview
// tokens, scheduled page publish.
// PC-56 TENANT-8c · THE PAGES: pages are authored with `cms.pages.manage` and published with `cms.pages.publish` (a
// policy page by a second person — 0177's trigger too); every write is keyed and audited with the client's IP; the FAQ
// (`page_kind = faq`) has topics and a keyed reorder act (FaqController). `cms.manage` is the banners' (8d). STILL
// DEFERRED, and named in the 8c report: translations (no tenant path into `translations`), preview tokens / a member
// reader (no storefront or mobile code reads `cms/*`), views / deflection (no counter, no page ↔ ticket link).
import { Module } from '@nestjs/common';
import { PagesController } from './controllers/v1/pages.controller';
import { BannersController } from './controllers/v1/banners.controller';
import { FaqController } from './controllers/v1/faq.controller';
import { CmsPageService } from './services/cms-page.service';
import { BannerService } from './services/banner.service';
import { CmsPageRepository } from './repositories/cms-page.repository';
import { BannerRepository } from './repositories/banner.repository';

@Module({
  controllers: [PagesController, FaqController, BannersController],
  providers: [CmsPageService, BannerService, CmsPageRepository, BannerRepository],
  exports: [CmsPageService, BannerService],
})
export class CmsModule {}
