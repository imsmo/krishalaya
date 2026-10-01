// modules/cms/domain/banner-acts.ts · PC-56 TENANT-8d · the banner MUTATE chain's verdicts (W2507–W2509) — activate ·
// pause · resume · archive.
//
// W2507: *"confirming writes an audit-trail entry with actor, time and reason"*. Before 0178 Pause was `deactivate`: no
// reason, no audit row (F-7). Every act now takes a reason (3–300 characters) and is audited with it; and an act that
// puts a banner on a member's screen (activate · resume) is judged against the ACTIVATION LAW — the refusals 0178's
// `banner_activation_refusals()` returns for that banner, the same function the act calls inside its transaction and
// the deferred trigger re-takes at commit:
//   TEXT_MISSING:<lang>   — en · hi · gu each need words (W174: *"Missing variant = banner hidden for that language"*;
//                            the platform does not let a banner reach members in fewer);
//   MEDIA_NOT_YOURS / MEDIA_NOT_IMAGE / MEDIA_NOT_CLEAN — F-8, re-checked at every activation (a scan can turn later);
//   WINDOW_ENDED          — the window is over: activating it would put nothing anywhere;
//   AUDIENCE_INVALID      — a role or region the registries no longer hold.
// A verdict lists EVERY reason, not the first.
import { BannerAct, BannerState, bannerTarget, reachesMembers } from './banner.state';
import { reasonIssue } from './banner-rules';

export const ACTIVATION_REFUSALS = ['TEXT_MISSING', 'MEDIA_NOT_YOURS', 'MEDIA_NOT_IMAGE', 'MEDIA_NOT_CLEAN', 'WINDOW_ENDED', 'AUDIENCE_INVALID', 'BANNER_NOT_FOUND'] as const;
export type ActivationRefusal = (typeof ACTIVATION_REFUSALS)[number];
export const BANNER_ACT_REFUSALS = ['NO_PERMISSION', 'ILLEGAL_FROM_STATE', ...ACTIVATION_REFUSALS, 'REASON_REQUIRED', 'REASON_TOO_LONG', 'REFUSED_BY_DATABASE'] as const;
export type BannerActRefusal = (typeof BANNER_ACT_REFUSALS)[number];

export interface ParsedActivation { codes: ActivationRefusal[]; missingLanguages: string[]; unknown: string[] }

/** 0178's `{TEXT_MISSING:gu, MEDIA_NOT_CLEAN}` → codes (each once), the missing languages, and anything unrecognised. */
export function parseActivationRefusals(raw: readonly string[]): ParsedActivation {
  const codes: ActivationRefusal[] = []; const missingLanguages: string[] = []; const unknown: string[] = [];
  for (const r of raw) {
    const [head, tail] = r.split(':', 2);
    if (!(ACTIVATION_REFUSALS as readonly string[]).includes(head)) { unknown.push(r); continue; }
    const code = head as ActivationRefusal;
    if (!codes.includes(code)) codes.push(code);
    if (code === 'TEXT_MISSING' && tail) missingLanguages.push(tail);
  }
  return { codes, missingLanguages, unknown };
}

export interface BannerActVerdict { act: BannerAct; allowed: boolean; refusals: BannerActRefusal[]; to: BannerState | null; missingLanguages: string[] }

export function bannerActVerdict(i: {
  act: BannerAct; canManage: boolean; state: BannerState; reason: string | null | undefined; activationRefusals: readonly string[];
}): BannerActVerdict {
  const refusals: BannerActRefusal[] = [];
  if (!i.canManage) refusals.push('NO_PERMISSION');
  const to = bannerTarget(i.state, i.act);
  if (to === null) refusals.push('ILLEGAL_FROM_STATE');
  let missingLanguages: string[] = [];
  if (to !== null && reachesMembers(i.act)) {
    const p = parseActivationRefusals(i.activationRefusals);
    refusals.push(...p.codes);
    if (p.unknown.length > 0) refusals.push('REFUSED_BY_DATABASE');
    missingLanguages = p.missingLanguages;
  }
  const r = reasonIssue(i.reason);
  if (r !== null) refusals.push(r);
  return { act: i.act, allowed: refusals.length === 0, refusals, to, missingLanguages };
}

/** A verdict drawn before the member typed a reason (the editor's buttons): the reason is the confirm step's to judge. */
export function ignoringReason(v: BannerActVerdict): BannerActVerdict {
  const refusals = v.refusals.filter((r) => r !== 'REASON_REQUIRED' && r !== 'REASON_TOO_LONG');
  return { ...v, refusals, allowed: refusals.length === 0 };
}
