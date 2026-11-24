#!/usr/bin/env bash
# scripts/security/rotate-local-postgres-password.sh · PC-56 SEC-7
# Your LOCAL Postgres owner password was committed to this public repository (history only — it can never be removed
# from GitHub's copy), so it is public. Postgres on your Mac listens on localhost only, so the risk is low, but a public
# password must not stay in use — and if you used the same password anywhere else, change it there too.
#
# What this does (nothing leaves your Mac):
#   1. reads the current owner URL from krishalaya/.env (DATABASE_URL / MIGRATION_DATABASE_URL),
#   2. generates a new random password and runs ALTER ROLE <you> PASSWORD … through that connection,
#   3. replaces the old password in every local .env / .env.local in the repo (never .env.example, never tracked files),
#   4. redacts it from the two programme notes outside the repo that still contain it in plain text.
# Usage:  bash scripts/security/rotate-local-postgres-password.sh            # dry run: shows what would change
#         bash scripts/security/rotate-local-postgres-password.sh --apply    # do it
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
cd "$ROOT"

url=$(grep -E '^(export )?(MIGRATION_DATABASE_URL|DATABASE_URL)=' .env | head -1 | sed -E 's/^(export )?[A-Z_]+=//; s/^"//; s/"$//; s/[[:space:]]+#.*$//')
[ -n "$url" ] || { echo "No DATABASE_URL in .env"; exit 1; }
user=$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^:/@]+):.*#\1#')
old_enc=$(printf '%s' "$url" | sed -E 's#^[a-z]+://[^:/@]+:([^@]+)@.*#\1#')
[ "$old_enc" != "$url" ] || { echo "The URL in .env has no password — nothing to rotate"; exit 1; }
old_raw=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$old_enc")

files=()
while IFS= read -r f; do
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 && continue          # never touch tracked files
  if grep -qF -- "$old_enc" "$f" || grep -qF -- "$old_raw" "$f"; then files+=("$f"); fi
done < <(find . \( -name node_modules -o -name .git -o -name .next \) -prune -o -type f \( -name '.env' -o -name '.env.*' \) ! -name '*.example' -print)
notes=()
for f in ../Development_Program/DEV-56_ADMIN_LOCAL_RUN.md ../Development_Program/MOBILE_FIX_BACKLOG_R2.md; do
  [ -f "$f" ] && { grep -qF -- "$old_raw" "$f" || grep -qF -- "$old_enc" "$f"; } && notes+=("$f")
done

echo "Role to rotate: $user (password length ${#old_raw})"
echo "Local env files to update (${#files[@]}):"; printf '  %s\n' "${files[@]}"
echo "Programme notes to redact (${#notes[@]}):"; printf '  %s\n' "${notes[@]:-}"
if [ "$APPLY" -ne 1 ]; then echo; echo "Dry run. Re-run with --apply to rotate."; exit 0; fi

new=$(openssl rand -hex 24)     # hex: safe in a URL without encoding
# The new password travels on stdin, never on the command line (ps would show it).
printf "ALTER ROLE \"%s\" WITH PASSWORD '%s';\n" "$user" "$new" | psql "$url" -v ON_ERROR_STOP=1 -q
newurl=${url/":$old_enc@"/":$new@"}
psql "$newurl" -Atc 'select 1' >/dev/null || { echo "FATAL: the new password does not log in — the env files were NOT changed. Old password: still in .env"; exit 1; }

for f in "${files[@]}"; do
  cp -p "$f" "$f.bak-sec7"
  OLD_ENC="$old_enc" OLD_RAW="$old_raw" NEW="$new" python3 - "$f" <<'PY'
import os, sys
p = sys.argv[1]; s = open(p).read()
s = s.replace(os.environ['OLD_ENC'], os.environ['NEW']).replace(os.environ['OLD_RAW'], os.environ['NEW'])
open(p, 'w').write(s)
PY
done
for f in "${notes[@]:-}"; do
  [ -n "$f" ] || continue
  OLD_ENC="$old_enc" OLD_RAW="$old_raw" python3 - "$f" <<'PY'
import os, sys
p = sys.argv[1]; s = open(p).read()
s = s.replace(os.environ['OLD_ENC'], '<local-password: see krishalaya/.env>').replace(os.environ['OLD_RAW'], '<local-password: see krishalaya/.env>')
open(p, 'w').write(s)
PY
done
echo "Rotated. ${#files[@]} env file(s) updated (backups: *.bak-sec7 — delete them once the apps start)."
echo "Restart any running api / admin-api / worker / web app so they pick up the new password."
echo "If you used the OLD password anywhere else (another database, an account), change it there as well."
