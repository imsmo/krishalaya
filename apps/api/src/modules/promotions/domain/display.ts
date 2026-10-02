// modules/promotions/domain/display.ts · PC-56 TENANT-10b · HOW A BUYER IS NAMED ON W130's REDEMPTIONS PANEL. PURE.
// The phone mask is the 1b masking read model's own (`maskPhone`, `+91 99••• ••205`) — imported, never re-typed, because a
// second mask is a second answer to how much of a member's number this console reveals. The buyer's NAME never crosses the
// wire on this panel; the place is the default address's own `village` (free text — most villages are in no region table),
// and a missing one is NULL ("place not recorded"), never guessed from a district.
export { maskPhone } from '../../identity/read-models/member-roster.read-model';
