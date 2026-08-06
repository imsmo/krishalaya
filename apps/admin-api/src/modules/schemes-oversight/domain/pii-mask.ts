// apps/admin-api/src/modules/schemes-oversight/domain/pii-mask.ts · RE-EXPORT.
//
// The mask moved to core/pii/mask.ts at its second consumer (ADMIN-5b's consent registry). This file stays as a
// re-export rather than being deleted with a sweep of import rewrites: the move is not a behaviour change, and turning
// it into a twelve-file diff would bury the one thing that did change. New code should import from core/pii/mask.
export {
  maskPhone, maskName, maskApplicant, assertUnmaskReason, govtRefFor,
  MASK_UNAVAILABLE, UNMASK_REASON_MIN, UnmaskReasonRequiredError,
  type MaskedApplicant,
} from '../../../core/pii/mask';
