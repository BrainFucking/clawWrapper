#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
OPENCLAW_SOURCE_DIR="${ROOT_DIR}/vendor/openclaw"
OPENCLAW_PINNED_REF="${OPENCLAW_PINNED_REF:-v2026.3.8}"
NPM_REGISTRY="${CLAW_WRAPPER_NPM_REGISTRY:-https://registry.npmmirror.com}"
export NPM_CONFIG_REGISTRY="$NPM_REGISTRY"
export npm_config_registry="$NPM_REGISTRY"
if [ -z "${PNPM_HOME:-}" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    export PNPM_HOME="${HOME}/Library/pnpm"
  else
    export PNPM_HOME="${HOME}/.local/share/pnpm"
  fi
fi
mkdir -p "${PNPM_HOME}"
export PATH="${PNPM_HOME}:${PATH}"

echo "==> claw-wrapper bootstrap (Unix)"
echo "==> Using npm mirror registry: ${NPM_REGISTRY}"

install_downloader() {
  echo "==> curl/wget not found; attempting automatic install"

  if command -v brew >/dev/null 2>&1; then
    brew install curl
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y curl
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y curl
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    sudo yum install -y curl
    return
  fi

  if command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm curl
    return
  fi

  if command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y curl
    return
  fi

  echo "Error: cannot install curl/wget automatically on this system." >&2
  exit 1
}

install_node_with_nvm() {
  echo "==> Node.js/npm not found; attempting nvm bootstrap"
  export NVM_DIR="${HOME}/.nvm"

  if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
      install_downloader
    fi

    if command -v curl >/dev/null 2>&1; then
      if ! curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash; then
        return 1
      fi
    elif command -v wget >/dev/null 2>&1; then
      if ! wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash; then
        return 1
      fi
    else
      echo "Error: curl or wget is required to install nvm." >&2
      return 1
    fi
  fi

  # shellcheck disable=SC1091
  if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
    return 1
  fi
  . "${NVM_DIR}/nvm.sh"
  nvm install --lts && nvm use --lts
}

install_node_with_pkg_macos() {
  echo "==> Falling back to official Node.js pkg installer (macOS)"
  local pkg_path pkg_name
  pkg_path=""
  pkg_name="$(ls -1 "${ROOT_DIR}/vendor/nodejs"/node-v22*.pkg 2>/dev/null | head -n 1 || true)"
  if [ -n "$pkg_name" ]; then
    pkg_path="$pkg_name"
    echo "==> Using bundled Node pkg: $pkg_path"
  else
    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
      install_downloader
    fi
    local filename pkg_url
    if command -v curl >/dev/null 2>&1; then
      filename="$(curl -fsSL "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" | awk '/ node-v22\\.[0-9]+\\.[0-9]+\\.pkg$/ {print $2; exit}')"
    else
      filename="$(wget -qO- "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" | awk '/ node-v22\\.[0-9]+\\.[0-9]+\\.pkg$/ {print $2; exit}')"
    fi
    if [ -z "$filename" ]; then
      echo "Error: could not resolve Node.js pkg filename for macOS." >&2
      return 1
    fi
    pkg_url="https://nodejs.org/dist/latest-v22.x/${filename}"
    pkg_path="/tmp/${filename}"
    echo "==> Downloading ${pkg_url}"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$pkg_url" -o "$pkg_path"
    else
      wget -qO "$pkg_path" "$pkg_url"
    fi
  fi

  echo "==> Installing Node.js pkg (requires admin password)"
  sudo installer -pkg "$pkg_path" -target /
  if [[ "$pkg_path" == /tmp/* ]]; then
    rm -f "$pkg_path"
  fi
  hash -r 2>/dev/null || true
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  if ! install_node_with_nvm; then
    if [ "$(uname -s)" = "Darwin" ]; then
      echo "==> nvm bootstrap failed (common on clean macOS VM without developer tools)."
      install_node_with_pkg_macos
    elif command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update && sudo apt-get install -y nodejs npm
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y nodejs npm
    elif command -v yum >/dev/null 2>&1; then
      sudo yum install -y nodejs npm
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -Sy --noconfirm nodejs npm
    elif command -v zypper >/dev/null 2>&1; then
      sudo zypper install -y nodejs npm
    else
      echo "Error: nvm bootstrap failed. Please install Node.js 22+ manually." >&2
      exit 1
    fi
  fi
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Warning: Node $(node -v) detected; Node 22+ is recommended."
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Error: Node.js/npm installation failed. Please install Node.js 22+ manually." >&2
  exit 1
fi

echo "==> Ensuring pnpm is available"
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack prepare pnpm@latest --activate
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    USER_PREFIX="${HOME}/.npm-global"
    mkdir -p "${USER_PREFIX}/bin"
    npm config set prefix "${USER_PREFIX}" >/dev/null 2>&1 || true
    npm install -g pnpm
    export PATH="${USER_PREFIX}/bin:${PATH}"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm bootstrap failed after corepack/npm fallback. Please install pnpm manually and rerun." >&2
  exit 1
fi
pnpm config set global-bin-dir "${PNPM_HOME}" >/dev/null 2>&1 || true

echo "==> Installing dependencies"
pnpm install

echo "==> Building project"
pnpm run build

echo "==> Linking claw-wrapper globally"
if ! pnpm link --global; then
  echo "Warning: pnpm link --global failed (likely permissions). Continuing with local CLI fallback."
fi

echo "==> Installing Playwright Chromium runtime"
pnpm exec playwright install chromium

echo "==> Running OpenClaw install workflow"
if [ ! -f "${OPENCLAW_SOURCE_DIR}/package.json" ]; then
  echo "Error: local OpenClaw source missing at ${OPENCLAW_SOURCE_DIR}" >&2
  echo "Please place OpenClaw source into vendor/openclaw before running install." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required to validate pinned OpenClaw source ref." >&2
  exit 1
fi
if [ ! -d "${OPENCLAW_SOURCE_DIR}/.git" ]; then
  echo "Error: ${OPENCLAW_SOURCE_DIR} is not a git repository." >&2
  exit 1
fi
echo "==> Ensuring OpenClaw pinned ref: ${OPENCLAW_PINNED_REF}"
if ! git -C "${OPENCLAW_SOURCE_DIR}" rev-parse --verify "${OPENCLAW_PINNED_REF}^{commit}" >/dev/null 2>&1; then
  FALLBACK_REF="$(git -C "${OPENCLAW_SOURCE_DIR}" tag --list "v*" --sort=-v:refname | awk 'BEGIN{IGNORECASE=1} !/(beta|alpha|rc)/{print; exit}')"
  if [ -z "${FALLBACK_REF}" ]; then
    echo "Error: pinned ref ${OPENCLAW_PINNED_REF} not found in vendor/openclaw, and no stable fallback tag was found." >&2
    exit 1
  fi
  echo "Warning: pinned ref ${OPENCLAW_PINNED_REF} not found; falling back to stable tag ${FALLBACK_REF}."
  OPENCLAW_PINNED_REF="${FALLBACK_REF}"
fi
CURRENT_COMMIT="$(git -C "${OPENCLAW_SOURCE_DIR}" rev-parse HEAD)"
PINNED_COMMIT="$(git -C "${OPENCLAW_SOURCE_DIR}" rev-parse --verify "${OPENCLAW_PINNED_REF}^{commit}")"
if [ "${CURRENT_COMMIT}" != "${PINNED_COMMIT}" ]; then
  if [ -n "$(git -C "${OPENCLAW_SOURCE_DIR}" status --porcelain)" ]; then
    echo "Error: vendor/openclaw has uncommitted changes; cannot auto-checkout pinned ref." >&2
    echo "Please clean the repo and retry, or manually checkout ${OPENCLAW_PINNED_REF}." >&2
    exit 1
  fi
  git -C "${OPENCLAW_SOURCE_DIR}" checkout --detach "${OPENCLAW_PINNED_REF}"
fi

for required in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
  if [ ! -f "${OPENCLAW_SOURCE_DIR}/${required}" ]; then
    echo "Error: vendor/openclaw is missing required file: ${required}" >&2
    exit 1
  fi
done

echo "==> Seeding bundled GitHub tarballs into pnpm store"
if [ ! -f "${ROOT_DIR}/vendor/github-tarballs/manifest.json" ]; then
  echo "Error: missing vendor/github-tarballs/manifest.json" >&2
  echo "This installer requires bundled GitHub tarballs from OpenClaw lockfile." >&2
  exit 1
fi
mapfile -t GITHUB_TARBALL_FILES < <(node -e '
const fs=require("node:fs");
const path=require("node:path");
const root=process.argv[1];
const sourceDir=path.join(root,"vendor","openclaw");
const lockPath=path.join(sourceDir,"pnpm-lock.yaml");
const manifestPath=path.join(root,"vendor","github-tarballs","manifest.json");
const lock=fs.readFileSync(lockPath,"utf8");
const urls=[...new Set((lock.match(/https:\/\/codeload\.github\.com\/[^\s'"'"'"]+\/tar\.gz\/[A-Za-z0-9._-]+/g)||[]))];
const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
const byUrl=new Map((manifest.tarballs||[]).map((item)=>[item.url,item.file]));
for(const url of urls){
  const rel=byUrl.get(url);
  if(!rel){
    console.error("MISSING_URL:"+url);
    process.exit(2);
  }
  const file=path.join(root,"vendor","github-tarballs",rel);
  if(!fs.existsSync(file)){
    console.error("MISSING_FILE:"+file);
    process.exit(3);
  }
  console.log(file);
}
' "$ROOT_DIR")
for tarball in "${GITHUB_TARBALL_FILES[@]}"; do
  [ -z "$tarball" ] && continue
  pnpm store add "$tarball"
done

if command -v claw-wrapper >/dev/null 2>&1; then
  claw-wrapper install --method local
else
  pnpm exec tsx cli/src/index.ts install --method local
fi

echo "==> Optional: guided Feishu bot setup"
echo "Run: claw-wrapper feishu:setup --bot-name \"Claw Assistant\" --output ./.feishu-bot.json"

echo "==> Optional: configuration wizard"
echo "Run: claw-wrapper configure --config ~/.openclaw/config.json --env-out ./.env.openclaw"

echo "Bootstrap complete."
