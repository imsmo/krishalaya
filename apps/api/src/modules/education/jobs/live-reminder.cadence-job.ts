// modules/education/jobs/live-reminder.cadence-job.ts · PC-56 TENANT-7c · the REGISTERED cadence job behind W414's
// *"Reminder cadence — 1 day, 1 hour, 10 min before"*. Registered in `EducationModule.onModuleInit` into
// `SCHEDULED_JOB_REGISTRY` (6c-1's pattern, 6e-2's shape): the runner takes the advisory lock per job name and hands us
// its kv_relay pool; this delegates to `LiveSessionService.remindTick`, which claims each (class, kind) through the UNIQUE
// row before it writes a single outbox event — so however many pods tick, a member is reminded once per offset.
//
// THE FLAG IS READ ONCE PER TICK, PLATFORM-WIDE (`education`): an OFF module schedules nothing, and must also not keep
// reminding about classes scheduled before it was switched off — the kill-switch stops the machine, not just the door.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { LiveSessionService } from '../services/live-session.service';

/** One minute: the smallest offset the canon names is ten minutes, and a reminder a minute late is still a reminder. */
export const LIVE_REMINDER_TICK_MS = 60_000;

@Injectable()
export class LiveReminderCadenceJob implements ScheduledJob {
  readonly name = 'education-live-reminders';
  private readonly log = new Logger(LiveReminderCadenceJob.name);
  constructor(readonly intervalMs: number, private readonly live: LiveSessionService, private readonly flags: FlagsService) {}

  async run(pool: Pool): Promise<void> {
    if (!(await this.flags.isEnabled('education').catch(() => false))) return;
    const r = await this.live.remindTick(pool);
    if (r.sent > 0) this.log.log(`education-live-reminders: ${r.sent} reminder(s) to ${r.recipients} member(s)`);
  }
}
