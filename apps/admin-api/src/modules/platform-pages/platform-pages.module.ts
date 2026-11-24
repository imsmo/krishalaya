// apps/admin-api/src/modules/platform-pages/platform-pages.module.ts · PC-56 LEGAL-1 — the four platform POLICY pages (migration 0242).
// Every provider is listed (ADMIN-10's lesson: an unlisted service compiles clean and 500s at the first request).
import { Module } from '@nestjs/common';
import { PlatformPagesController } from './platform-pages.controller';
import { PlatformPagesService } from './services/platform-pages.service';
import { PlatformPagesRepository } from './repositories/platform-pages.repository';

@Module({
  controllers: [PlatformPagesController],
  providers: [PlatformPagesService, PlatformPagesRepository],
})
export class PlatformPagesModule {}
