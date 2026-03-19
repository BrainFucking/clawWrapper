# Usage

## Install dependencies

```bash
pnpm install
```

## One-command bootstrap (Option C UX)

### Unix/macOS

```bash
bash ./scripts/install.sh
```

The script will try to install Node.js/npm automatically if missing.
On Unix/macOS this uses `nvm` and `nvm install --lts`. If `nvm` bootstrap fails on a clean macOS VM, it first uses bundled `vendor/nodejs/node-v22*.pkg` (if present), then falls back to downloading official Node.js v22 pkg installer. Linux will also try distro package managers when needed.

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

The script will try to install Node.js/npm automatically if missing.
On Windows it uses `winget`/`choco`, then falls back to `nvm-windows`.

Both Unix and Windows bootstraps now ensure `pnpm` availability (corepack first, npm fallback).
Installation uses local OpenClaw source from `vendor/openclaw` and does not run `git clone`.
Install flow validates and pins `vendor/openclaw` to a stable ref (default `v2026.3.8`; override with `OPENCLAW_PINNED_REF`).
Install flow defaults to mirror registry `https://registry.npmmirror.com`.

Windows optional flags:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -RunFeishuSetup -RunConfigure
```

## Build

```bash
pnpm run build
```

## Commands

### Install OpenClaw

```bash
npx tsx cli/src/index.ts install --method local
```

Useful flags:

- `--method auto|local`
- `--dry-run`
- `--no-onboard`

Prerequisite:

- Put OpenClaw source code under `vendor/openclaw` (must include its `package.json`).
- Keep `vendor/openclaw` as a git repo so wrapper can validate/checkout pinned ref.
- Bundle lockfile GitHub tarballs under `vendor/github-tarballs`:

```bash
npm run bundle:openclaw:github-tarballs
```

- Ensure `vendor/github-tarballs/manifest.json` exists before install.

Pinned version workflow:

- Default pinned ref: `v2026.3.8`
- Override once: `OPENCLAW_PINNED_REF=<tag-or-sha> npx tsx cli/src/index.ts install --method local`
- If pinned ref is missing locally, wrapper falls back to latest stable non-beta tag and prints the selected tag in logs.
- If install reports source mismatch, run:
  - `git -C vendor/openclaw fetch --tags --force origin`
  - `git -C vendor/openclaw checkout --detach <pinned-ref>`

### Guided Feishu bot setup

```bash
npx tsx cli/src/index.ts feishu:setup --bot-name "Claw Assistant" --output ./.feishu-bot.json
```

This command uses Playwright and pauses for manual login/verification steps.

### Configure OpenClaw + Feishu

```bash
npx tsx cli/src/index.ts configure --config ~/.openclaw/config.json --env-out ./.env.openclaw
```

### OpenClaw 管理工具 UI

```bash
npx tsx cli/src/index.ts configure:ui --config ~/.openclaw/config.json --env-out ./.env.openclaw
```

Alias:

```bash
npx tsx cli/src/index.ts manager:ui --config ~/.openclaw/config.json --env-out ./.env.openclaw
```

State-based flow:

- if OpenClaw is not installed: open `/onboarding` (single install button + progress/logs)
- if installed: open `/control`
- optional navigation to `/dashboard` and `/chat`

UI includes:

- install OpenClaw
- uninstall OpenClaw (uses `openclaw uninstall --all --yes --non-interactive` first, then OS-specific fallback)
- open official OpenClaw web page (`openclaw dashboard`)
- update OpenClaw
- fix checks (`doctor` + `status`)
- install skill/plugin package
- one-click Feishu setup kickoff via Playwright
- model management (provider/default model/daily limit/models list JSON)
- channel management (Feishu/QQ/企业微信)
- lightweight internal chat page (`POST /chat/send`, local session echo)

Useful flags:

- `--host 127.0.0.1`
- `--port 18791`
- `--no-open` (do not auto-open browser)

### Uninstall and clean

```bash
npx tsx cli/src/index.ts uninstall --purge-all
```

Use `--dry-run` first for safer cleanup preview.
