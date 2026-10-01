// apps/web-tenant/src/features/comms/hub.ts · PURE validation for the comms hub (PC-27). Mirrors the API DTO
// (CreateBroadcastSchema: title ≤160, body ≤2000, optional role code). The server re-validates + gates by
// comm.manage. No IO → unit-tested.
// [PC-56 TENANT-8a] `buildTemplate` and its whatsapp-first `NOTIF_CHANNELS` are gone with the inert template form (F-1,
// F-22); template overrides are `features/templates/override.ts`.

export type BroadcastResult =
  | { ok: true; value: { title: string; body: string; audienceRoleCode?: string } }
  | { ok: false; error: 'title' | 'body' };

export function buildBroadcast(raw: { title: string; body: string; audienceRoleCode: string }): BroadcastResult {
  const title = raw.title.trim();
  if (!title || title.length > 160) return { ok: false, error: 'title' };
  const body = raw.body.trim();
  if (!body || body.length > 2000) return { ok: false, error: 'body' };
  const role = raw.audienceRoleCode.trim();
  const value: { title: string; body: string; audienceRoleCode?: string } = { title, body };
  if (role) value.audienceRoleCode = role;
  return { ok: true, value };
}
