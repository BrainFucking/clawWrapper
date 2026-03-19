#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
OPENCLAW_PINNED_REF="${OPENCLAW_PINNED_REF:-v2026.3.8}"
NPM_REGISTRY="${CLAW_WRAPPER_NPM_REGISTRY:-https://registry.npmmirror.com}"
export NPM_CONFIG_REGISTRY="$NPM_REGISTRY"
export npm_config_registry="$NPM_REGISTRY"

echo "==> Starting OpenClaw Manager UI..."
echo "==> Using npm mirror registry: ${NPM_REGISTRY}"

# Load user shell PATH.
if [[ -f "${HOME}/.zshrc" ]]; then
  # shellcheck disable=SC1090
  source "${HOME}/.zshrc" >/dev/null 2>&1 || true
fi

# UTM shared folders can occasionally return corrupted bytes for live TS transforms.
# To keep startup stable, run from a local workspace mirror inside the VM.
if [[ "$ROOT_DIR" == /Volumes/* ]]; then
  LOCAL_ROOT="${HOME}/.clawwrapper-local"
  CODE_ARCHIVE="${HOME}/.clawwrapper-code.zip"
  CODE_SOURCE_ARCHIVE="${HOME}/.clawwrapper-code-source.zip"
  VENDOR_ARCHIVE="${HOME}/.clawwrapper-vendor.zip"
  VENDOR_SOURCE_ARCHIVE="${HOME}/.clawwrapper-vendor-source.zip"
  TMP_VENDOR_KEEP="${HOME}/.clawwrapper-vendor-keep"
  TMP_OPENCLAW_DIST_KEEP="${HOME}/.clawwrapper-openclaw-dist-keep"
  SOURCE_VENDOR_VERSION_FILE="${ROOT_DIR}/vendor/.mirror-version"
  LOCAL_VENDOR_VERSION_FILE="${LOCAL_ROOT}/vendor/.mirror-version"
  NEED_VENDOR_COPY=1

  echo "==> Detected shared-volume path. Rebuilding local workspace mirror: ${LOCAL_ROOT}"
  if ! command -v zip >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    echo "Error: zip/unzip is required to mirror the shared workspace." >&2
    exit 1
  fi

  if [[ -f "$SOURCE_VENDOR_VERSION_FILE" && -f "$LOCAL_VENDOR_VERSION_FILE" && -d "${LOCAL_ROOT}/vendor" ]]; then
    if cmp -s "$SOURCE_VENDOR_VERSION_FILE" "$LOCAL_VENDOR_VERSION_FILE"; then
      NEED_VENDOR_COPY=0
      echo "==> Vendor mirror version unchanged; vendor copy will be skipped."
    fi
  elif [[ ! -f "$SOURCE_VENDOR_VERSION_FILE" ]]; then
    echo "warning: ${SOURCE_VENDOR_VERSION_FILE} is missing; forcing vendor copy." >&2
  fi

  rm -rf "$TMP_VENDOR_KEEP"
  rm -rf "$TMP_OPENCLAW_DIST_KEEP"
  if [[ -d "${LOCAL_ROOT}/vendor/openclaw/dist" ]]; then
    cp -R "${LOCAL_ROOT}/vendor/openclaw/dist" "$TMP_OPENCLAW_DIST_KEEP" || true
  fi
  if [[ "$NEED_VENDOR_COPY" -eq 0 && -d "${LOCAL_ROOT}/vendor" ]]; then
    mv "${LOCAL_ROOT}/vendor" "$TMP_VENDOR_KEEP"
  fi

  rm -rf "$LOCAL_ROOT"
  rm -f "$CODE_ARCHIVE" "$CODE_SOURCE_ARCHIVE" "$VENDOR_ARCHIVE" "$VENDOR_SOURCE_ARCHIVE"
  mkdir -p "$LOCAL_ROOT"
  if [[ -d "$TMP_VENDOR_KEEP" ]]; then
    mv "$TMP_VENDOR_KEEP" "${LOCAL_ROOT}/vendor"
  fi

  echo "==> Mirroring code archive (always refresh)..."
  (
    cd "$ROOT_DIR"
    # Zip from "." so hidden files/directories (e.g. .github) are included.
    zip -rq "$CODE_SOURCE_ARCHIVE" . \
      -x "node_modules/*" \
      -x "*/node_modules/*" \
      -x "dist/*" \
      -x "*/dist/*" \
      -x "vendor/*"
  )
  cp "$CODE_SOURCE_ARCHIVE" "$CODE_ARCHIVE"
  unzip -q "$CODE_ARCHIVE" -d "$LOCAL_ROOT"

  if [[ "$NEED_VENDOR_COPY" -eq 1 ]]; then
    echo "==> Mirroring vendor archive (version changed or missing)..."
    (
      cd "$ROOT_DIR"
      zip -rq "$VENDOR_SOURCE_ARCHIVE" "vendor" \
        -x "vendor/*/node_modules/*"
    )
    cp "$VENDOR_SOURCE_ARCHIVE" "$VENDOR_ARCHIVE"
    unzip -q "$VENDOR_ARCHIVE" -d "$LOCAL_ROOT"
  else
    echo "==> Reusing existing local vendor directory."
  fi

  if [[ ! -d "${LOCAL_ROOT}/vendor/openclaw/dist" && -d "$TMP_OPENCLAW_DIST_KEEP" ]]; then
    echo "==> Restoring previous OpenClaw dist build output into local mirror."
    mkdir -p "${LOCAL_ROOT}/vendor/openclaw"
    cp -R "$TMP_OPENCLAW_DIST_KEEP" "${LOCAL_ROOT}/vendor/openclaw/dist" || true
  fi

  python3 - "$LOCAL_ROOT" <<'PY'
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])
removed = 0
for p in root.rglob("node_modules"):
    if p.is_dir():
        shutil.rmtree(p, ignore_errors=True)
        removed += 1
print(f"==> Removed {removed} node_modules directories from local mirror")
PY
  rm -rf "$TMP_VENDOR_KEEP"
  rm -rf "$TMP_OPENCLAW_DIST_KEEP"
  rm -f "$CODE_ARCHIVE" "$CODE_SOURCE_ARCHIVE" "$VENDOR_ARCHIVE" "$VENDOR_SOURCE_ARCHIVE"
  for required in "package.json" "scripts/start-ui.command" "cli/src/index.ts"; do
    if [[ ! -e "$LOCAL_ROOT/$required" ]]; then
      echo "warning: local workspace mirror is incomplete; missing $required" >&2
    fi
  done

  ROOT_DIR="$LOCAL_ROOT"
  cd "$ROOT_DIR"
  echo "==> Using local workspace: $ROOT_DIR"
fi

OPENCLAW_SOURCE_DIR="${ROOT_DIR}/vendor/openclaw"

echo "==> Sanitizing source files (remove unexpected NUL bytes if any)..."
python3 - <<'PY'
from pathlib import Path

root = Path(".")
targets = [
    root / "cli",
    root / "automation",
    root / "tests",
]

fixed = []
for base in targets:
    if not base.exists():
        continue
    for p in base.rglob("*.ts"):
        b = p.read_bytes()
        if b"\x00" in b:
            p.write_bytes(b.replace(b"\x00", b""))
            fixed.append(str(p))

if fixed:
    print("Fixed NUL bytes in:")
    for item in fixed:
        print(" -", item)
else:
    print("No NUL-byte corruption found.")
PY

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm not found. Running bootstrap installer first..."
  bash ./scripts/install.sh
fi

# Ensure npm global bin is on PATH for this non-interactive launch.
if command -v npm >/dev/null 2>&1; then
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
  if [[ -n "${NPM_PREFIX}" && -d "${NPM_PREFIX}/bin" ]]; then
    export PATH="${NPM_PREFIX}/bin:${PATH}"
  fi
fi
if [[ -d "${HOME}/.npm-global/bin" ]]; then
  export PATH="${HOME}/.npm-global/bin:${PATH}"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "==> Enabling pnpm via corepack..."
    corepack prepare pnpm@latest --activate || true
  fi
fi
if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="$(pnpm bin -g 2>/dev/null || true)"
  if [[ -n "${PNPM_BIN}" && -d "${PNPM_BIN}" ]]; then
    export PATH="${PNPM_BIN}:${PATH}"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    echo "==> pnpm not found; installing pnpm to user prefix..."
    USER_PREFIX="${HOME}/.npm-global"
    mkdir -p "${USER_PREFIX}/bin"
    npm config set prefix "${USER_PREFIX}" >/dev/null 2>&1 || true
    npm install -g pnpm || true
    export PATH="${USER_PREFIX}/bin:${PATH}"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm not found after corepack/npm fallback." >&2
  exit 1
fi

if [ ! -d "./node_modules" ]; then
  echo "Installing project dependencies..."
  pnpm install
fi

if [ -f "./vendor/openclaw/openclaw.mjs" ] \
  && [ ! -f "./vendor/openclaw/dist/entry.mjs" ] \
  && [ ! -f "./vendor/openclaw/dist/entry.js" ]; then
  echo "==> Detected missing OpenClaw dist/entry build output; attempting local repair build..."
  if [ -f "./vendor/openclaw/package.json" ]; then
    (
      cd "./vendor/openclaw"
      pnpm install
      pnpm ui:build
      pnpm build
    ) || echo "warning: OpenClaw repair build failed; openclaw command may still be broken." >&2
  fi
fi

if [ ! -f "./cli/src/index.ts" ]; then
  echo "Error: cli/src/index.ts not found." >&2
  exit 1
fi

if [ -f "${OPENCLAW_SOURCE_DIR}/package.json" ]; then
  if command -v git >/dev/null 2>&1 && [ -d "${OPENCLAW_SOURCE_DIR}/.git" ]; then
    echo "==> Validating OpenClaw pinned ref for UI installer: ${OPENCLAW_PINNED_REF}"
    if git -C "${OPENCLAW_SOURCE_DIR}" rev-parse --verify "${OPENCLAW_PINNED_REF}^{commit}" >/dev/null 2>&1; then
      CURRENT_COMMIT="$(git -C "${OPENCLAW_SOURCE_DIR}" rev-parse HEAD)"
      PINNED_COMMIT="$(git -C "${OPENCLAW_SOURCE_DIR}" rev-parse --verify "${OPENCLAW_PINNED_REF}^{commit}")"
      if [ "${CURRENT_COMMIT}" != "${PINNED_COMMIT}" ] && [ -z "$(git -C "${OPENCLAW_SOURCE_DIR}" status --porcelain)" ]; then
        git -C "${OPENCLAW_SOURCE_DIR}" checkout --detach "${OPENCLAW_PINNED_REF}" >/dev/null 2>&1 || true
      fi
    fi
  fi
fi

exec pnpm exec tsx ./cli/src/index.ts manager:ui --config "${HOME}/.openclaw/config.json" --env-out "./.env.openclaw"