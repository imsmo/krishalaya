// modules/dairy/domain/dairy-diversion.flags.ts · PC-56 TENANT-6d-6.
//
// ONE STRING, in a file with no imports, read by the controller (to gate the routes), by the read-model (so the
// playbook says whether the step is built for THIS cooperative) and by the specs. A flag key duplicated across three
// files is a flag that switches off two of them — TENANT-6d-5's own lesson, applied on the way in this time.
export const DIVERSION_FLAG = 'dairy_shift_diversion';

/**
 * [PC-56 TENANT-6d-8] The MEMBER NOTICE's own flag (0167), separate from the act's.
 *
 * Two flags rather than one, and the reason is a cooperative that has no telephony contract yet: it can divert a shift
 * today and tell its 87 families the way it always has — by loudspeaker and phone tree — while the platform records
 * where the milk went. The screen then says `not_enabled` rather than showing a count that reached nobody, which is
 * the difference between a platform that is honest about what it did and one that looks busy.
 */
export const NOTICE_FLAG = 'dairy_shift_diversion_notice';
