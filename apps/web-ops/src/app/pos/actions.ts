'use server';
// apps/web-ops/src/app/pos/actions.ts · PC-56 OPS-3a · THE RECORD ACT (W362 "Record this pour" → W3335–W3337), REAL over the EXISTING
// `POST /v1/dairy/collections` (dairy.collect or dairy.manage; keyed). Moved here from app/dairy/actions.ts (one write, one path — the 6d-4 rule).
// Before sending, the console re-reads the person's custody and the centre's roll: the centre must be in your OPEN custody, and the member on
// that centre's roll with that code — so a hand-edited form cannot record another centre's member. The day is checked against the
// organisation's today (the server refuses again by name, before any write: POUR_DATE_IN_FUTURE, POUR_WINDOW_ALREADY_BILLED). The SERVER
// prices the pour; nothing here computes money. The key is minted when the check step renders, so a double submit records once.
// Outcome: success → `/pos/slip?act=success` with the server's answer kept for this browser (httpOnly, path /pos, one hour); failure →
// `/pos/quality?act=failure&reason=<named>` with the pour echoed for its Back.
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { SdkError, type DairyCollection } from '@krishalaya/sdk-js';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import {
  POS, ROLL_PAGE_SIZE, SLIP_COOKIE, SLIP_COOKIE_MAX_AGE_SEC, encodeRecorded, formFields, parseId, pickCentre, pourFailureReason, pourFromParams, pourQuery,
  type PourReason,
} from '../../features/ops3/counter';

export async function recordPourAction(formData: FormData): Promise<void> {
  await requireSession(POS.quality);
  const fields = formFields(formData);
  const key = parseId(String(formData.get('key') ?? ''));
  const mcc = parseId(fields.mcc as string);
  const echo = (r: { ok: boolean; value?: unknown; code: string | null }) =>
    (r.ok && mcc && r.code ? `&${pourQuery((r as { value: Parameters<typeof pourQuery>[0] }).value, mcc, r.code)}` : mcc ? `&mcc=${mcc}` : '');
  const c = opsClient();
  let mine: Awaited<ReturnType<typeof c.dairy.counterCentres>> | null = null; let mineReason: PourReason | null = null;
  try { mine = await c.dairy.counterCentres(); } catch (e) { mineReason = e instanceof SdkError ? pourFailureReason(e.status, e.code) : 'record'; }
  if (!mine) redirect(`${POS.quality}?act=failure&reason=${mineReason ?? 'record'}${mcc ? `&mcc=${mcc}` : ''}`);
  const built = pourFromParams(fields, mine.today);
  const fail = (reason: PourReason): never => redirect(`${POS.quality}?act=failure&reason=${reason}${echo(built)}`);
  const centre = pickCentre(mine.centres, mcc);
  if (!centre || !mcc) return fail('custody');
  if (!built.ok) return fail(built.error);
  if (!key || !built.code) return fail('member');
  let onRoll = false; let rollReason: PourReason | null = null;
  try {
    const roll = await c.dairy.listMemberships({ box: 'mcc', mccId: centre.id, code: built.code, limit: ROLL_PAGE_SIZE });
    onRoll = roll.items.some((m) => m.id === built.value.membershipId && m.memberCode === built.code && m.mccId === centre.id);
  } catch (e) { rollReason = e instanceof SdkError ? pourFailureReason(e.status, e.code) : 'record'; }
  if (rollReason) return fail(rollReason);
  if (!onRoll) return fail('member');
  let rec: DairyCollection | null = null; let recReason: PourReason | null = null;
  try { rec = await c.dairy.recordCollection({ ...built.value, mccId: centre.id }, key); }
  catch (e) { recReason = e instanceof SdkError ? pourFailureReason(e.status, e.code) : 'record'; }
  if (!rec) return fail(recReason ?? 'record');
  cookies().set(SLIP_COOKIE, encodeRecorded({
    id: rec.id, memberCode: built.code, mccId: rec.mccId, shift: rec.shift, collectedOn: rec.collectedOn,
    weightKg: rec.weightKg ?? '', fatPct: rec.fatPct ?? '', snfPct: rec.snfPct ?? '', amountMinor: rec.amountMinor, rateCardId: rec.rateCardId,
    holdState: rec.holdState ?? 'none', createdAt: rec.createdAt ?? null, waterFlag: rec.waterFlag, adulterationFlags: rec.adulterationFlags ?? [],
  }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/pos', maxAge: SLIP_COOKIE_MAX_AGE_SEC });
  redirect(`${POS.slip}?act=success`);
}
