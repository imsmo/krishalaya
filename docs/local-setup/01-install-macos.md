# Step 1 — Install the tools on macOS

Do these in order. After each install there's a **verify** command — run it and confirm the version before moving
on. If a verify fails, fix it before continuing (a missing tool here causes confusing errors later).

> Apple Silicon (M1/M2/M3) and Intel Macs both work. Commands are identical.

---

## 1.1 Xcode Command Line Tools (compilers git etc.)

```bash
xcode-select --install
```
A popup appears → click **Install** → wait. If it says "already installed", great.

**Verify:** `git --version` prints a version.

---

## 1.2 Homebrew (the macOS package manager)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
At the end it prints 2 "Next steps" lines starting with `echo`. **Run those exact lines** (they add `brew` to your
PATH). On Apple Silicon they look like:
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

**Verify:** `brew --version` prints a version.

---

## 1.3 Node.js 22 (via nvm — the repo pins Node 22 in `.nvmrc`; Expo SDK 58 needs ≥ 22.13)

Install nvm (the Node Version Manager), then Node 22:
```bash
brew install nvm
mkdir -p ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc
nvm install 22
nvm alias default 22
```

**Verify:** `node -v` prints `v22.x` (22.13 or newer). (If it prints anything else, run `nvm use 22`.)

> Tip: inside the repo you can just run `nvm use` and it reads `.nvmrc` (→ 22) automatically.

---

## 1.4 pnpm 9 (the package manager this repo uses — NOT npm)

The repo declares `"packageManager": "pnpm@9"`. Enable it via Corepack (ships with Node):
```bash
corepack enable
corepack prepare pnpm@9 --activate
```

**Verify:** `pnpm -v` prints `9.x`.

> ⚠️ Do not use `npm install` in this repo — it will create a broken `node_modules`. Always use `pnpm`.

---

## 1.5 Docker Desktop (runs Postgres/Redis/etc.)

Download and install **Docker Desktop for Mac** from <https://www.docker.com/products/docker-desktop/> (pick the
Apple Silicon or Intel build to match your Mac). Open the app once and let it finish starting (the whale icon in the
menu bar stops animating).

**Verify:** `docker --version` prints a version, and `docker compose version` works (note: it's `docker compose`,
two words — the modern form).

---

## 1.6 Python 3.11+ (only for the optional `ai-services`)

```bash
brew install python@3.11
```

**Verify:** `python3.11 --version` prints `3.11.x`.

> You can **skip this** if you're not running `ai-services` (it's optional). Come back later if needed.

---

## 1.7 Mobile tools (for `apps/mobile`)

You have two paths. **For a beginner, Path A is by far the easiest** — no Xcode/Android Studio needed.

### Path A (recommended): run on your real phone with Expo Go
1. On your iPhone/Android phone, install **"Expo Go"** from the App Store / Play Store.
2. Install Watchman (makes the file-watcher reliable):
   ```bash
   brew install watchman
   ```
That's all the install you need for Path A. (Your Mac and phone must be on the **same Wi-Fi** later.)

### Path B (optional): iOS Simulator / Android Emulator on the Mac
- **iOS Simulator:** install **Xcode** from the Mac App Store (large, ~7 GB), open it once, accept the license,
  then `xcode-select` is already set from step 1.1. Run `xcodebuild -version` to verify.
- **Android Emulator:** install **Android Studio** from <https://developer.android.com/studio>, open it →
  *More Actions → Virtual Device Manager* → create a Pixel device. This is heavier; only do it if you specifically
  want Android. Beginners should start with Path A.

---

## 1.8 (Optional) helper CLIs for poking services
```bash
brew install jq         # pretty-print JSON from curl
brew install grpcurl    # only if you want to call the wallet gRPC service directly
brew install postgresql@16   # gives you the `psql` client (handy; the DB itself runs in Docker)
```
**Verify:** `psql --version` prints 16.x. If `psql` isn't found, add it to PATH:
`echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc`.

---

## 1.9 Final check — all green?

```bash
echo "node:    $(node -v)"        # v22.x
echo "pnpm:    $(pnpm -v)"        # 9.x
echo "docker:  $(docker --version)"
echo "compose: $(docker compose version | head -1)"
echo "psql:    $(psql --version 2>/dev/null || echo 'optional - not installed')"
echo "python:  $(python3.11 --version 2>/dev/null || echo 'optional - not installed')"
```

If node is 22.x, pnpm is 9.x, and docker works → continue to **`02-infra-and-database.md`**.
