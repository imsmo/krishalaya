// apps/admin-api/src/modules/translations/translations.module.ts · PC-56 ADMIN-3b.
// The first module in the platform that writes to `translations` — a table that has existed since 0001 and never been
// written to, which is why Golden Law 6 has been half-wired since the platform was built.
import { Module } from '@nestjs/common';
import { TranslationsController } from './translations.controller';
import { TranslationsService } from './services/translations.service';
import { TaxonomyExportService } from './services/taxonomy-export.service';
import { TranslationsRepository } from './repositories/translations.repository';

@Module({
  controllers: [TranslationsController],
  providers: [TranslationsRepository, TranslationsService, TaxonomyExportService],
})
export class TranslationsModule {}
