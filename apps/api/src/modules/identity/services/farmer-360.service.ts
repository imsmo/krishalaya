// modules/identity/services/farmer-360.service.ts · "Viewing is logged" (PC-56 TENANT-1b-3).
//
// W155 says it three times, which is how you can tell it is the point: "Viewing is logged", "This view is recorded ·
// Farmer-360 access · usr/…7741", and — at the foot of the screen — "This page exists to serve Ramesh P., not to surveil
// him."
//
// **SO THE RECORD IS WRITTEN BEFORE THE DATA IS RETURNED, AND A FAILURE TO RECORD REFUSES THE VIEW.** Same rule as the PII
// reveal, for the same reason and with the same deliberate contrast to ADMIN-SWEEP's never-throwing circuit recorder: there
// the breaker was the control and the row was the report, here the row IS the control. A page that assembles everything an
// organisation knows about one person — twelve months of income, their land, their scheme benefits, every season they have
// planted — is the single most sensitive read in the tenant console. If nobody can prove who opened it, it is surveillance
// with better manners.
//
// **AND THE VALUES ARE NOT IN THE AUDIT ROW.** Only that the view happened, and of whom. Logging the figures would make the
// audit log — retained for years, read by more people than the console — a second copy of the record it exists to police.
import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { NotFoundError } from '../../../shared/errors/app-error';
import { Farmer360, Farmer360ReadModel } from '../read-models/farmer-360.read-model';

export interface Farmer360Actor { userId: string; ip: string | null; requestId: string | null }

@Injectable()
export class Farmer360Service {
  constructor(
    private readonly readModel: Farmer360ReadModel,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
  ) {}

  /**
   * Assemble and record.
   *
   * **THE ORDER IS: FIND → RECORD → RETURN.** Reading first is deliberate — a 404 for somebody who is not a member of this
   * tenant must NOT leave an audit row saying a staff member viewed their 360, because they did not, and a trail full of
   * views that never happened is worse than no trail. But once there is something to show, the row is written before it is
   * shown, with no try/catch.
   *
   * **NO REASON IS REQUIRED, AND THAT IS A DELIBERATE DIFFERENCE FROM THE PII REVEAL.** Opening a member's 360 is the
   * ordinary work of a member desk — a field officer does it before every advisory call — and demanding twenty characters
   * of justification each time would train staff to type "checking" and would teach them that reasons are noise. The
   * narrow GRANT (`member.view360`, tenant_admin only by default, 0128) is what bounds this act; the record is what makes
   * it reviewable. Unmasking a phone number is different: it is rare, and the reason is the only thing that distinguishes
   * a legitimate callback from a curious browse.
   */
  async view(tenantId: string, actor: Farmer360Actor, userId: string): Promise<Farmer360> {
    const data = await this.readModel.get(tenantId, userId);
    // 404 and not 403, matching every other member route: "exists but is not yours" is a cross-tenant enumeration oracle.
    if (!data) throw new NotFoundError('member not found in this organisation');

    await this.audit.log({
      tenantId,
      actorUserId: actor.userId,
      action: 'member.view360_opened',
      entityType: 'user',
      entityId: userId,
      // WHAT was opened, never WHAT IT SAID. The counts below are shape, not content — they let a reviewer see that a
      // 360 was assembled without putting the member's income in a second place.
      newValue: {
        seasons: data.seasons.length,
        schemes: data.schemesYtd.length,
        landUnits: data.land.byUnit.length,
      },
      ip: actor.ip,
      requestId: actor.requestId,
    });

    return data;
  }
}
