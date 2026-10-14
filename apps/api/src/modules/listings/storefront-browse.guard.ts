// modules/listings/storefront-browse.guard.ts · PC-56 STORE-2a · B4 (founder D4, migration 0207) — THE PUBLIC CATALOGUE'S ONE KILL-SWITCH.
//
// `storefront_browse` (seeded ON — browse IS the storefront, the named Law 10 exception) is read in ONE place: `StorefrontBrowseGate.assertOpen()`.
// Every public listing read calls it — the feed (`GET /v1/listings`, never the owner's `mine=true` view), the public detail (`GET /v1/listings/:id`
// for a non-owner), the tombstone, the lot attributes, the regulated marker and the organisation seller page — either through
// `StorefrontBrowseGuard` (the four purely public routes) or, where one route also serves an OWNER (the feed's `mine` view, the detail's owner
// read), from the public branch itself. OFF → 503 STOREFRONT_BROWSE_OFF, by name.
//
// **WHY A FLAG-STORE FAILURE READS ON (fail OPEN), when every other gate in this codebase fails closed:** this switch only ever REMOVES a read.
// It moves no money, grants nothing and exposes nothing that is not already public; it exists so a human can dark the catalogue during an
// incident. A flag store that cannot answer must not black out every organisation's store on the platform — that would turn a flags outage into
// a marketplace outage. The trade is stated: an operator who flips it OFF during a flag-store outage is honoured once the store answers again.
import { CanActivate, Injectable } from '@nestjs/common';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { DomainError } from '../../shared/errors/app-error';

export const STOREFRONT_BROWSE_FLAG = 'storefront_browse';

/** The named refusal every public listing read answers while the switch is OFF. 503: the catalogue exists, it is switched off for now. */
export class StorefrontBrowseOffError extends DomainError {
  constructor() { super('STOREFRONT_BROWSE_OFF', 'Browsing is switched off on this platform for now (storefront_browse)', 503); }
}

@Injectable()
export class StorefrontBrowseGate {
  constructor(private readonly flags: FlagsService) {}

  /** True while buyers may browse. A PLATFORM switch (evaluated with no tenant — the same `{}` the flags endpoint uses); a failure = ON. */
  async isOpen(): Promise<boolean> {
    try { return await this.flags.isEnabled(STOREFRONT_BROWSE_FLAG, {}); } catch { return true; }
  }

  /** Throws the named 503 when the switch is OFF; returns otherwise. */
  async assertOpen(): Promise<void> {
    if (!(await this.isOpen())) throw new StorefrontBrowseOffError();
  }
}

/** The gate as a route guard, for the routes that are ONLY public (tombstone, attributes, marker, organisation page). */
@Injectable()
export class StorefrontBrowseGuard implements CanActivate {
  constructor(private readonly gate: StorefrontBrowseGate) {}
  async canActivate(): Promise<boolean> {
    await this.gate.assertOpen();
    return true;
  }
}
