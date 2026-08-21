// core/feature-flags/flags.guard.ts
// @FeatureFlag('catalogue.write') gates a route behind a flag. If the flag is OFF for
// the caller, returns 404 (NOT 403) — a disabled feature should be invisible, never
// "exists but forbidden". Kill-switch: flip feature_flags.is_enabled=false → instant off.
//
// ------------------------------------------------------------------------------------------------------------------
// [PC-56 TENANT-6d-2] **FLAGS COMPOSE. THEY USED TO OVERRIDE, AND THE MODULE KILL-SWITCH DID NOT SWITCH THE MODULE OFF.**
//
// This guard read the flag with `getAllAndOverride([handler, class])`, which returns the HANDLER's flag when a route
// carries one and discards the controller's. Every route written as "the module's flag, plus this screen's flag" was
// therefore behind the screen's flag ALONE. On the dairy module that meant:
//
//   • `POST dairy/bill-cycles/:id/preview` and `/approve` — class `dairy`, method `dairy_cycle_preview` /
//     `dairy_cycle_approve`. Turning the dairy module OFF for a tenant left both callable: the two acts that decide
//     what 312 families are paid, on a module the cooperative is not licensed for;
//   • `POST dairy/member-credits` — same shape;
//   • `POST ambassadors/field-ops/on-behalf/listings/suggest` — class `ambassadors`, method `assisted_doc_prefill`,
//     and its own comment says *"same consent gate; behind assisted_doc_prefill"* — i.e. AS WELL AS, not INSTEAD OF.
//
// Law 10 says every feature is behind a flag with a kill-switch. A kill-switch that a child flag silently cancels is
// not a kill-switch, and this is the shape of defect Rule Zero is about: a feature that cannot be flagged off per
// tenant. So the rule is now the one the call sites already assumed — **a route is behind EVERY flag named on it and
// on its controller**, and all of them must be on.
//
// `@FeatureFlag('a', 'b')` is accepted for the case where one place names several.
// ------------------------------------------------------------------------------------------------------------------
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FlagsService } from './flags.service';
import { tryGetRequestContext } from '../tenancy-context/request-context';
import { NotFoundError } from '../../shared/errors/app-error';

export const FEATURE_FLAG_KEY = 'feature_flag';
export const FeatureFlag = (...keys: string[]) => SetMetadata(FEATURE_FLAG_KEY, keys);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly flags: FlagsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // `getAll` — both levels, in order — and then flattened, because the answer is a UNION and not a choice. A string
    // is tolerated so a decorator applied by anything older than this change still gates its route.
    const declared = this.reflector.getAll<Array<string | string[] | undefined>>(FEATURE_FLAG_KEY, [ctx.getClass(), ctx.getHandler()]);
    const keys = Array.from(new Set(
      (declared ?? []).flatMap((d) => (typeof d === 'string' ? [d] : Array.isArray(d) ? d : [])).filter((k) => k.length > 0),
    ));
    if (keys.length === 0) return true;

    const rc = tryGetRequestContext();
    const scope = { tenantId: rc?.tenantId, userId: rc?.userId };
    // Sequential and short-circuiting: the FIRST flag that is off ends the request. The CONTROLLER's flags are read
    // before the handler's, so the module gate is evaluated before the screen gate — indistinguishable to a caller
    // (both answers are the same 404) and the order a reader of the decorators expects.
    for (const key of keys) {
      if (!(await this.flags.isEnabled(key, scope))) throw new NotFoundError('Not found'); // invisible when disabled
    }
    return true;
  }
}
