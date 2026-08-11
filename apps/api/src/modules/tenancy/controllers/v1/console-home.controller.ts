// modules/tenancy/controllers/v1/console-home.controller.ts · W117's dashboard and W116's go-live checklist (PC-56 TENANT-1c).
//
// Two reads, one grant. Both are the tenant's own facts about itself, always scoped to `ctx.tenantId` — a console home that
// could be asked about another tenant is a cross-tenant read on the least-guarded screen in the product.
//
// **`report.view` AND NOT `tenant.settings`, WHICH IS A DELIBERATE DEPARTURE FROM THE ANALYTICS CONTROLLER NEXT DOOR.**
// W117's restricted state says "Staff see only the desks their role grants — this complete view (GMV, plan health, revenue)
// is tenant_admin scope", and W116's says "Only the organisation owner and tenant_admin roles see setup". Both are true of
// the DEFAULT grant matrix, where `report.view` goes to tenant_admin, support_agent and auditor — and it is the right key
// here anyway: this is a REPORT about the tenant, not a settings change. A tenant that wants its coordinator to see the
// morning dashboard grants `report.view` to that person, which is a decision somebody makes rather than a capability that
// arrives with a settings permission they should not have.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { TenantDashboardReadModel } from '../../read-models/tenant-dashboard.read-model';
import { GoLiveReadModel } from '../../read-models/go-live.read-model';
import { goLiveSteps, goLiveProgress, isLive, blockedSteps } from '../../domain/go-live';

/** `report.view` — see the class note. Named here rather than reached for from the policies object so the choice is visible. */
const CONSOLE_HOME_PERMISSION = 'report.view';

@Controller({ path: 'tenancy/console', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class ConsoleHomeController {
  constructor(
    private readonly dashboard: TenantDashboardReadModel,
    private readonly goLive: GoLiveReadModel,
  ) {}

  /**
   * W117's dashboard.
   *
   * **NO FEATURE FLAG.** Every other controller in this module carries `@FeatureFlag('tenancy')`, and the dashboard must not:
   * it is the console's HOME, so flagging it off would leave a staff member landing on a "module disabled" page with no way
   * to reach the desks that ARE enabled. W117's own flagged-off state exists for the screen's *panels*, not for the door.
   */
  @Get('dashboard')
  @RequirePermissions(CONSOLE_HOME_PERMISSION)
  async home(@CurrentContext() ctx: RequestContext) {
    return { data: await this.dashboard.get(ctx.tenantId) };
  }

  /**
   * W116's checklist — six steps DERIVED from facts, with no checklist table anywhere.
   *
   * The domain turns facts into steps so the ordering rules are unit-tested rather than expressed in SQL, and the response
   * carries the progress, the live verdict and the blocked list so the console renders rather than reasons.
   */
  @Get('go-live')
  @RequirePermissions(CONSOLE_HOME_PERMISSION)
  async setup(@CurrentContext() ctx: RequestContext) {
    const facts = await this.goLive.facts(ctx.tenantId);
    if (!facts) throw new NotFoundError('organisation not found');
    const steps = goLiveSteps(facts);
    return {
      data: {
        steps,
        progress: goLiveProgress(steps),
        live: isLive(steps),
        blocked: blockedSteps(steps),
        // The counts the screen shows beside two of the steps ("2+ staff", "your first members"), so it can explain WHY a
        // step is not done rather than only that it is not.
        staffCount: facts.staffCount,
        memberCount: facts.memberCount,
      },
    };
  }
}
