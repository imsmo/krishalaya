'use server';
// apps/web-tenant/src/app/ops/schemes/actions.ts · W203 — reveal ONE field of a scheme application's `form_data`, with a reason
// (≥ 20 characters) · PC-56 TENANT-SW-b. The 1b/9a/13b reveal law: the value is returned to the caller and put NOWHERE else (no
// redirect, no cookie, no revalidate); the API writes the audit row (`schemes.form_data.revealed` — the FIELD, never the value)
// before it returns. The client component (people/RevealField) holds the value in React state.
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { MIN_SCHEME_REVEAL_REASON, SCHEMES_DESK_HREF, isUuid } from '../../../features/swb/console';
import type { RevealResult } from '../../people/actions';

export async function revealSchemeFieldAction(applicationId: string, rawField: string, rawReason: string): Promise<RevealResult> {
  await requireSession(SCHEMES_DESK_HREF);
  const field = (rawField ?? '').trim(); const reason = (rawReason ?? '').trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(field)) return { ok: false, error: 'field' };
  if (reason.length < MIN_SCHEME_REVEAL_REASON || reason.length > 500) return { ok: false, error: 'reason' };
  if (!isUuid(applicationId)) return { ok: false, error: 'notFound' };
  try {
    const r = await tenantClient().schemes.revealFormField(applicationId, field, reason);
    const v = r.value;
    return { ok: true, field: r.field, value: v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v) };
  } catch (e) {
    if (e instanceof SdkError) {
      if (e.status === 403) return { ok: false, error: 'forbidden' };
      if (e.status === 404) return { ok: false, error: 'notFound' };
      if (e.code === 'REVEAL_REASON_REQUIRED') return { ok: false, error: 'reason' };
    }
    return { ok: false, error: 'failed' };
  }
}
