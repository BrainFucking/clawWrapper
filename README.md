# clawWrapper

Cross-platform toolkit to:

1. Install OpenClaw on a system.
2. Guide users through Feishu bot creation using Playwright.
3. Configure OpenClaw in a simple interactive way.
4. Uninstall and clean OpenClaw safely.

## Why this exists

This project wraps official OpenClaw installation guidance from the docs and adds a guided end-to-end operator workflow for Feishu bot onboarding and lifecycle cleanup.

References:

- [OpenClaw Install Docs](https://docs.openclaw.ai/install)
- [OpenClaw Installer Script](https://openclaw.ai/install.sh)

## Quick start (install + manage via UI)

On **macOS**, the usual workflow is to run the manager launcher once; it bootstraps what is missing and opens **OpenClaw 管理工具** (install, config, Feishu/OneThing flows, uninstall, etc.):

```bash
open ./scripts/start-ui.command
```

Or from Terminal (same script):

```bash
bash ./scripts/start-ui.command
```

Double-click **`start-ui.command`** in Finder if the file is executable; macOS runs it in Terminal.

What the launcher does in short:

- Loads your shell `PATH` (e.g. from `~/.zshrc`) so `node` / `pnpm` / `openclaw` resolve the same as in an interactive shell.
- If **Node.js/npm** are missing, runs **`scripts/install.sh`** once, then continues.
- Runs **`pnpm install`** when `node_modules` is missing or incomplete.
- Repairs **OpenClaw** under `vendor/openclaw` when the local mirror looks broken (install / UI build / build as needed).
- Starts **`manager:ui`** with `~/.openclaw/config.json` and `./.env.openclaw`.

Optional environment variables (see script for defaults):

- **`OPENCLAW_PINNED_REF`** — OpenClaw git ref (default pinned in repo).
- **`CLAW_WRAPPER_NPM_REGISTRY`** — npm registry for installs (default: npmmirror).

For a **manual** dev build without the launcher:

```bash
pnpm install
pnpm run build
```

## one-command bootstrap

Unix/macOS:

```bash
bash ./scripts/install.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

This bootstrap flow:

- auto-installs Node.js/npm when missing
  - Unix/macOS: installs via `nvm` (`nvm install --lts`), then uses bundled `vendor/nodejs/node-v22*.pkg` fallback, then remote Node.js v22 pkg
  - Linux: uses distro package managers (`apt/dnf/yum/pacman/zypper`) if needed
  - Windows: uses `winget`/`choco` first, then falls back to `nvm-windows` + `nvm install lts`
- bootstraps `pnpm` (corepack first, npm fallback)
- installs project dependencies
- builds and globally links `claw-wrapper`
- installs Playwright Chromium runtime
- runs local-source install `claw-wrapper install --method local` (no git clone)
- prints next-step commands for Feishu setup and config

Prerequisites before install:

- Place OpenClaw source code at `vendor/openclaw`
- Bundle GitHub tarballs referenced by OpenClaw lockfile:

```bash
npm run bundle:openclaw:github-tarballs
```

Default install mode uses China mirror registry (`https://registry.npmmirror.com`) for normal npm packages, and uses local `vendor/github-tarballs` for GitHub tarball dependencies.

## Pinned OpenClaw version policy

- The installer uses a pinned OpenClaw ref (default: `v2026.3.8`) for reproducible local builds.
- Override temporarily with environment variable `OPENCLAW_PINNED_REF` if you must test another ref.
- If the pinned ref is unavailable in local tags, wrapper auto-falls back to the latest stable non-beta tag and logs the fallback.
- During install/UI startup, wrapper validates `vendor/openclaw` git repo, fetches tags, and checks out pinned ref when safe.
- If `vendor/openclaw` has local uncommitted changes, auto-checkout is blocked and the UI shows a clear remediation error.

### Bump procedure

1. Pick a new stable upstream tag.
2. Update pinned defaults in:
   - `cli/src/openclaw/source.ts`
   - `scripts/install.sh`
   - `scripts/install.ps1`
   - `scripts/start-ui.command`
3. Validate on clean environment:
   - `pnpm install`
   - `pnpm run build`
   - manager UI install flow (`pnpm install -> pnpm ui:build -> pnpm build -> pnpm link --global`)
4. Update docs if pinned ref changes.

### Rollback procedure

- Set `OPENCLAW_PINNED_REF=<previous-stable-tag>` and rerun install.
- Or restore the previous default pinned ref in files above and rebuild wrapper.

## CLI commands

```bash
npx tsx cli/src/index.ts install --method local
npx tsx cli/src/index.ts feishu:setup --bot-name "Claw Assistant" --output ./.feishu-bot.json
npx tsx cli/src/index.ts feishu:setup --engine v2 --bot-name "Claw Assistant" --output ./.feishu-bot.json --secret-store file
npx tsx cli/src/index.ts configure --config ~/.openclaw/config.json --env-out ./.env.openclaw
npx tsx cli/src/index.ts configure:ui --config ~/.openclaw/config.json --env-out ./.env.openclaw
npx tsx cli/src/index.ts manager:ui --config ~/.openclaw/config.json --env-out ./.env.openclaw
npx tsx cli/src/index.ts uninstall --purge-all
```

## OpenClaw 管理工具 UI

Primary entry on macOS: **`scripts/start-ui.command`** (see the **Quick start** section).

- Title updated to `OpenClaw 管理工具`
- Startup route split by runtime state:
  - `/onboarding`: minimal install page (single install button + progress/logs)
  - `/control`: config/model/channel/ops management (shown only when installed)
  - `/chat`: internal simplified chat page
- Control page supports:
  - install/uninstall/update/fix/status
  - open official OpenClaw web (`openclaw dashboard`)
  - Feishu Playwright setup kickoff
  - jump to OneThingAI registration/API key flow
  - model management (provider, default model, daily limit, model list)
  - channel management (Feishu/QQ/企业微信)
  - skill plugin install

## Safety controls

- `--dry-run` on install/configure/uninstall shows actions without making changes.
- Uninstall asks for explicit confirmation before deleting config/state paths (unless `--purge-all` is provided).
- Feishu setup runs in guided mode to tolerate QR login, captcha, and UI changes.

## Feishu guided flow

The Playwright flow opens Feishu/Open Platform pages, then pauses for manual steps:

1. Log in and pass any verification.
2. Confirm app/bot settings.
3. Copy App ID, App Secret, and webhook URL.
4. Toolkit saves captured values to the output JSON file.

This approach is intentionally semi-automated for stability.

## Docs

- See [docs/usage.md](docs/usage.md) for command details.
- See [docs/feishu-automation-v2.md](docs/feishu-automation-v2.md) for v2 Feishu automation architecture.
- See [templates/openclaw.config.example.json](templates/openclaw.config.example.json) for config format.
