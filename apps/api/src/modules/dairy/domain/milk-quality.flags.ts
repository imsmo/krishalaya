// modules/dairy/domain/milk-quality.flags.ts · the flag keys W168's money paths are gated by (Law 10).
// Kept beside the domain rather than inside it so the pure rules never reach for a service, and in one place so the
// desk and the pricing path can never disagree about which key they are asking about.

/** Apply `milk_rate_cards.bonus_rules` when pricing a pour. OFF ships: honouring a slab for the first time changes what
 *  a cooperative pays, and that is a treasury decision, not a deployment. See migration 0156. */
export const BONUS_SLABS_FLAG = 'dairy_bonus_slabs';

/** W168's quality desk itself (TENANT-6b-2 draws it). The HOLD on a flagged pour is deliberately NOT behind this or any
 *  flag — a farmer's money must not depend on whether a screen is switched on. */
export const QUALITY_DESK_FLAG = 'dairy_quality_desk';
