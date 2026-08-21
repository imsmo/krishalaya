// modules/dairy/domain/bmc-call.flags.ts · PC-56 TENANT-6d-5.
//
// ONE STRING, in a file with no imports, because it is read by the controller (to gate the two routes), by the
// read-model (so the monitor knows whether to offer the button) and by the specs. A flag key duplicated across those
// three is a flag that switches off two of them.
export const BMC_CALL_FLAG = 'dairy_bmc_call';
