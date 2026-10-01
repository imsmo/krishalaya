// modules/cms/cms.module.ts
// CMS (PRD §50) — tenant content pages + promotional banners. Pages are VERSIONED (draft → published →
// archived; a published page is re-edited by minting a new version, so the live content is immutable); banners
// run in a scheduled [starts,ends) window at a placement, with atomic click tracking. Authoring needed cms.manage (PC-27)
// (audited); published pages + live banners are readable by any authenticated user. Money-free. Gated by the
// `cms` flag (default OFF).
//
// SCOPE: page authoring/versioning/publish + banner scheduling/serve/click. DEFERRED (PC-27, as written):
// per-language page translations (the translations table), banner audience-rule targeting eval, page preview
// tokens, scheduled page publish.
// PC-56 TENANT-8c · THE PAGES: pages are authored with `cms.pages.manage` and published with `cms.pages.publish` (a
// policy page by a second person — 0177's trigger too); every write is keyed and audited with the client's IP; the FAQ
// (`page_kind = faq`) has topics and a keyed reorder act (FaqController). STILL
// DEFERRED, and named in the 8c report: translations (no tenant path into `translations`), preview tokens / a member
// reader (no storefront or mobile code reads `cms/*`), views / deflection (no counter, no page ↔ ticket link).
// PC-56 TENANT-8d · THE BANNERS (migration 0178): a banner's words are `banner_texts` (en · hi · gu before activation),
// it is editable, its lifecycle is `state` (draft · active · paused · archived) with every act keyed, reasoned and
// audited, its image is the tenant's own clean image (F-8), its placement a vocabulary and its audience a declared rule
// validated against `roles` / `admin_regions` and evaluated by a pure function; `cms.banners.manage` is the verb
// (`cms.manage` retired). The expiry job (F-21) is DELETED: the phase is the window at read time. NOT BUILT, named in
// the 8d report: impressions (no reader, no counter), A/B allocation in a variant group, a member reader.
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
