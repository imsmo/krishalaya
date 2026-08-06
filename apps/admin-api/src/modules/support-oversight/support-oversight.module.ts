// apps/admin-api/src/modules/support-oversight/support-oversight.module.ts · the god-mode cross-tenant SUPPORT
// OVERSIGHT plane (Law 11). Read surfaces over support_tickets (ticket queue, SLA-breach queue, per-tenant health)
// + the one consequential write (escalate a ticket). Cross-tenant by design — admin-api's kv_admin bypasses RLS;
// every read bounded, the escalation audited. Mounts under AdminCoreModule (auth/RBAC/FIDO2/step-up/audit @Global).
import { Module } from '@nestjs/common';
import { SupportOversightController } from './support-oversight.controller';
import { SupportOversightRepository } from './repositories/support-oversight.repository';
import { SlaBreachMonitorService } from './services/sla-breach-monitor.service';
import { TenantHealthAlertsService } from './services/tenant-health-alerts.service';
import { SupportMacrosService } from './services/support-macros.service';
import { SupportInsightsService } from './services/support-insights.service';
import { TicketEscalationsService } from './services/ticket-escalations.service';

@Module({
  controllers: [SupportOversightController],
  providers: [SupportOversightRepository, SlaBreachMonitorService, TenantHealthAlertsService, TicketEscalationsService,
    // PC-56 ADMIN-2: the desk's canned answers + the insight reads (agent performance, CSAT, the real SLA matrix)
    SupportMacrosService, SupportInsightsService],
})
export class SupportOversightModule {}
