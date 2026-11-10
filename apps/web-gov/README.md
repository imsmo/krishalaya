# @krishalaya/web-gov — the government console (PC-40; signing in rebuilt in PC-56 GOV-1a)

A person who holds a role in a GOVERNMENT AUTHORITY signs in to that authority — never to a farmer organisation — through the API's
government realm `/v1/gov/*` (PC-56 GOV-0, behind the platform switch `gov_console`, OFF by default): the phone code, then the code from
their own authenticator app (an account without one sets it up first). The gov token carries the authority and no tenant; the API refuses
it on every organisation and partner route. (Survey GOV-1 C-1: this file used to say "gov-persona scoped tokens"; before GOV-0 the
console signed a phone into ONE organisation with an ordinary tenant token.) Never admin-api, never god-mode.
Built so far: `/login` (W355 + its chain) and `/access` (W359 + its chain). `/dashboard` is rebuilt in GOV-1b; the pre-canon `/schemes`,
`/registers`, `/verification`, `/mgnrega` pages read an organisation and are gone (307 → /dashboard) until their GOV waves.
Dev: `pnpm dev` (port 3007) · test: `pnpm test` · render: `pnpm test:render`.
