// apps/mobile/src/features/labour/worker-help.ts · constants for the worker Help & Support screen (144). No React /
// no I/O. The FAQ + rights are STATIC program/legal help content (rendered via i18n) — not per-user data. A wage
// complaint filed from here is a high-priority SUPPORT TICKET (no labour-dispute endpoint yet — §13).
import type { TicketSeverity } from '@krishalaya/sdk-js';

/** Common-question keys, in design order. Each maps to `workerHelp.q.<key>.q` / `.a` in i18n. */
export const HELP_FAQS = ['payTiming', 'lessWage', 'cancelJob', 'pmsby', 'minWage', 'multipleFarmers'] as const;
export type HelpFaqKey = (typeof HELP_FAQS)[number];

/** Worker-rights checklist keys, in design order → `workerHelp.right.<key>`. */
export const HELP_RIGHTS = ['minWage', 'wages24h', 'refuseUnsafe', 'pmsby', 'noBonded'] as const;
export type HelpRightKey = (typeof HELP_RIGHTS)[number];

/** A wage/help issue raised from this hub is treated as high-priority support. */
export const WAGE_TICKET_SEVERITY: TicketSeverity = 'P1';
