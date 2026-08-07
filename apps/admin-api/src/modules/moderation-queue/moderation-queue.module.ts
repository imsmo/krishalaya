// apps/admin-api/src/modules/moderation-queue/moderation-queue.module.ts · W090–W092 (PC-56 ADMIN-5f).
//
// Separate from trust-safety (ADMIN-5d) because the security object differs. That plane reads and writes PLATFORM
// tables with no tenant_id — blocklists, risk rules, appeals. This one WRITES TENANT-OWNED ROWS: a farmer's listing
// status and a tenant's report. Sharing a module would mean sharing a permission surface, and `risk.act` — held by
// whoever is on the safety desk — would become the permission that can archive a farmer's ₹4,48,200 listing.
import { Module } from '@nestjs/common';
import { ModerationQueueController } from './moderation-queue.controller';
import { ModerationQueueRepository } from './repositories/moderation-queue.repository';
import { ListingModerationService } from './services/listing-moderation.service';
import { ReportQueueService } from './services/report-queue.service';

@Module({
  controllers: [ModerationQueueController],
  providers: [ModerationQueueRepository, ListingModerationService, ReportQueueService],
})
export class ModerationQueueModule {}
