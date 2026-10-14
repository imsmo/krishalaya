// modules/orders/storefront-cart.guard.ts · PC-56 STORE-2b · B5 (founder D2, migration 0208) — BUYING'S ONE KILL-SWITCH.
//
// `storefront_cart` (seeded ON — buying IS the store, the named Law 10 exception) is read in ONE place: `StorefrontCartGate.assertOpen()`, the
// pattern of listings/storefront-browse.guard.ts. `StorefrontCartGuard` sits on EVERY route of `carts.controller.ts` (read, add, update,
// remove, clear, accept-price) and of `checkout.controller.ts` (placement, the preview, the delivery-methods read) — one switch, because
// buying is one act. OFF → 503 STOREFRONT_CART_OFF, by name. The guard runs AFTER AuthGuard / PermissionsGuard: an anonymous or role-less
// caller is answered 401 / 403 exactly as before (the switch is not an oracle for who may buy).
//
// **WHY A FLAG-STORE FAILURE READS ON (fail OPEN)** — the reasoning of `storefront_browse`: this switch exists so a human can pause buying
// during an incident. It grants nothing and moves no money: every rule that protects a buyer's money (the minimum order, the accepted price,
// the regulated rules, the idempotent placement) is enforced whether this switch answers or not. A flag store that cannot answer must not
// close every organisation's till on the platform — that would turn a flags outage into a sales outage. The trade is stated: an operator who
// flips it OFF during a flag-store outage is honoured once the store answers again.
import { CanActivate, Injectable } from '@nestjs/common';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { DomainError } from '../../shared/errors/app-error';

export const STOREFRONT_CART_FLAG = 'storefront_cart';

/** The named refusal every cart / checkout route answers while the switch is OFF. 503: buying exists, it is paused for now. */
export class StorefrontCartOffError extends DomainError {
  constructor() { super('STOREFRONT_CART_OFF', 'Buying is paused on this platform for now (storefront_cart)', 503); }
}

@Injectable()
export class StorefrontCartGate {
  constructor(private readonly flags: FlagsService) {}

  /** True while buyers may buy. A PLATFORM switch (evaluated with no tenant — the same `{}` the flags endpoint uses); a failure = ON. */
  async isOpen(): Promise<boolean> {
    try { return await this.flags.isEnabled(STOREFRONT_CART_FLAG, {}); } catch { return true; }
  }

  /** Throws the named 503 when the switch is OFF; returns otherwise. */
  async assertOpen(): Promise<void> {
    if (!(await this.isOpen())) throw new StorefrontCartOffError();
  }
}

/** The gate as a route guard — on the cart and checkout controllers, after the auth guards. */
@Injectable()
export class StorefrontCartGuard implements CanActivate {
  constructor(private readonly gate: StorefrontCartGate) {}
  async canActivate(): Promise<boolean> {
    await this.gate.assertOpen();
    return true;
  }
}
