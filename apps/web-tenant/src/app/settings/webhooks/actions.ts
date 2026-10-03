// apps/web-tenant/src/app/settings/webhooks/actions.ts · RETIRED by PC-56 TENANT-13a (F-5).
// These server actions redirected to `/settings/webhooks?secret=…&secretFor=…` — the signing secret in a URL (history, proxy and Next
// access logs, Referer). The webhook writes now live in app/settings/developers/webhooks/actions.ts, where register and rotate RETURN the
// secret in the action's response body to a client component that holds it in memory only. Nothing imports this module; it exports
// nothing so no form can post to the old actions.
export {};
