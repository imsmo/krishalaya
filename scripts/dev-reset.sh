#!/usr/bin/env bash
# scripts/dev-reset.sh — one command to refresh ALL stale layers after code fixes.
# WHY: the app runs on 3 independently-cached layers (API dist, shared package dist, Metro
# bundle). A fix only shows once ITS layer is rebuilt. This rebuilds every shared package the
# mobile app imports, so no fix is left invisible. Run this whenever "I still see old behavior".
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/2] Rebuilding EVERY shared package (mobile AND the six web consoles import these)…"
# Order matters: tokens first (ui/ui-native consume it), then the rest.
# NOTE: packages/ui is what the six Next.js consoles import — omitting it left their dist/
# holding stale imports (this caused "Module not found: @krishi-verse/tokens" after the rebrand).
pnpm --filter @krishalaya/tokens    build
pnpm --filter @krishalaya/contracts build
pnpm --filter @krishalaya/i18n      build
pnpm --filter @krishalaya/sdk-js    build
pnpm --filter @krishalaya/ui        build
pnpm --filter @krishalaya/ui-native build
pnpm --filter @krishalaya/testing   build
echo "    shared packages rebuilt (7)."

echo "==> [2/2] Rebuilding the API…"
pnpm --filter @krishalaya/api build
echo "    API built."

cat <<'NEXT'

============================================================
 dev-reset complete. Now, in order:

 TERMINAL 1  — start the API from SOURCE (always fresh, no build step to forget):
     pnpm --filter @krishalaya/api start:dev
   (leave running; wait for "listening" / "started")

 TERMINAL 2  — one-time data + flags (only if not already done today):
     psql "$MIGRATION_DATABASE_URL" -c "INSERT INTO feature_flags (key,description,is_enabled,rollout_pct,rules) VALUES ('support','pilot',true,100,'{}'::jsonb),('wallet','pilot',true,100,'{}'::jsonb),('payments_addmoney','pilot',true,100,'{}'::jsonb) ON CONFLICT (key) DO UPDATE SET is_enabled=true,rollout_pct=100;"
     node scripts/demo-seed/run.mjs        # needs Terminal 1 API running

 TERMINAL 3  — start the app with a CLEARED Metro cache (kills the stale JS bundle):
     cd apps/mobile && npx expo start --tunnel --clear

 Then on the phone: fully close Expo Go and reopen (not just reload), log in as +91 9900000101.
============================================================
NEXT
