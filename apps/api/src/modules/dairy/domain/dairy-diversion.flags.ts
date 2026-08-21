// modules/dairy/domain/dairy-diversion.flags.ts · PC-56 TENANT-6d-6.
//
// ONE STRING, in a file with no imports, read by the controller (to gate the routes), by the read-model (so the
// playbook says whether the step is built for THIS cooperative) and by the specs. A flag key duplicated across three
// files is a flag that switches off two of them — TENANT-6d-5's own lesson, applied on the way in this time.
export const DIVERSION_FLAG = 'dairy_shift_diversion';
