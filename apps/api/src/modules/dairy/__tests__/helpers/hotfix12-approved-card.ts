// modules/dairy/__tests__/helpers/hotfix12-approved-card.ts · PC-56 HOTFIX-12 — the NAMED UPDATE every dairy live spec shares.
//
// Before HOTFIX-12 these specs created a rate card through the real service and priced pours with it at once, usually with
// `effectiveFrom: '2026-01-01'`. Founder Q1-A (2026-11-08) makes both impossible through the product: a card prices nothing
// until a SECOND person approves it, and it starts on the tenant's TOMORROW at the earliest (founder follow-up 2026-11-08: today
// itself is refused, so no day is ever priced by two cards). So the fixture now does what a
// cooperative does — the real service creates the card (one person, recorded) and the real service approves it (a SECOND
// fixture user, recorded) — and only then, when the spec's own pours are dated today or earlier, the ADMIN connection moves the
// approved card's `effective_from` back to the date the spec asked for. That last step stands in for "this card was created
// and approved on that day"; it runs in the admin realm, the only realm 0234's guard trigger exempts, and the exclusion
// constraint still holds over it. Nothing a spec asserts about pricing, bills or money is relaxed by this helper.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { makeUser } from '../../../../../test/helpers/fixtures';
import type { MilkRateCardService } from '../../services/milk-rate-card.service';
import type { DairyActor } from '../../services/mcc-centre.service';

export async function tenantTodayForTest(admin: Pool, tenantId: string): Promise<string> {
  const r = await admin.query(`SELECT to_char(now() AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS d FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $1`, [tenantId]);
  return String(r.rows[0].d);
}

export async function tenantTomorrowForTest(admin: Pool, tenantId: string): Promise<string> {
  const r = await admin.query(`SELECT to_char((now() AT TIME ZONE co.timezone)::date + 1, 'YYYY-MM-DD') AS d FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $1`, [tenantId]);
  return String(r.rows[0].d);
}

/** Create through the real service as `maker`, approve through the real service as a second fixture person, then (admin
 *  realm, only if asked for a past start) move the start back. Returns the approved card as the API returns it. */
export async function approvedCardForTest(
  cards: MilkRateCardService, admin: Pool, tenantId: string, maker: DairyActor, dto: Record<string, unknown> & { effectiveFrom: string },
  opts: { checkerUserId?: string } = {},
) {
  const tomorrow = await tenantTomorrowForTest(admin, tenantId);
  const wanted = dto.effectiveFrom;
  const start = wanted < tomorrow ? tomorrow : wanted;   // the earliest start the product allows
  const checkerUserId = opts.checkerUserId ?? await makeUser(admin);
  const created = await cards.create(tenantId, maker, `idem-${randomUUID()}`, { ...dto, effectiveFrom: start } as never);
  const approved = await cards.approve(tenantId, { userId: checkerUserId, canManage: true }, `idem-${randomUUID()}`, created.id);
  if (wanted < start) {
    // ADMIN REALM, commented: the spec prices pours dated today or earlier, which only a card created and approved on an
    // earlier day could do; this stands in for that history. 0234's exclusion still holds over the moved row.
    await admin.query(`UPDATE milk_rate_cards SET effective_from = $2::date WHERE id = $1`, [created.id, wanted]);
    return { ...approved, effectiveFrom: wanted };
  }
  return approved;
}
