#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
OPENCLAW_PINNED_REF="${OPENCLAW_PINNED_REF:-v2026.4.10}"
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
  CODE_HASH_FILE="${HOME}/.clawwrapper-code.sha256"
  VENDOR_ARCHIVE="${HOME}/.clawwrapper-vendor.zip"
  VENDOR_HASH_FILE="${HOME}/.clawwrapper-vendor.sha256"
  NEED_CODE_COPY=1
  NEED_VENDOR_COPY=1
  REFRESHED_ANY=0

  echo "==> Detected shared-volume path. Refreshing local workspace mirror in place: ${LOCAL_ROOT}"
  if ! command -v zip >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    echo "Error: zip/unzip is required to mirror the shared workspace." >&2
    exit 1
  fi
  compute_sha256() {
    python3 - "$1" <<'PY'
import hashlib
import sys
from pathlib import Path
path = Path(sys.argv[1])
h = hashlib.sha256()
with path.open("rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)
print(h.hexdigest(), end="")
PY
  }
  compute_tree_sha256() {
    python3 - "$1" "$2" <<'PY'
import hashlib
import os
import sys
from pathlib import Path

mode = sys.argv[1]
root = Path(sys.argv[2])
h = hashlib.sha256()

if not root.exists():
    print("", end="")
    raise SystemExit(0)

def include(rel: str) -> bool:
    rel = rel.replace(os.sep, "/")
    if mode == "code":
        if rel.startswith("vendor/"):
            return False
        if rel == "node_modules" or rel.startswith("node_modules/"):
            return False
        if "/node_modules/" in rel:
            return False
        if rel == "dist" or rel.startswith("dist/"):
            return False
        if "/dist/" in rel:
            return False
        return True
    if mode == "vendor":
        if rel == "vendor/node_modules" or rel.startswith("vendor/node_modules/"):
            return False
        if "/node_modules/" in rel:
            return False
        return rel == "vendor" or rel.startswith("vendor/")
    return True

for path in sorted(p for p in root.rglob("*") if p.is_file()):
    rel = path.relative_to(root).as_posix()
    if not include(rel):
        continue
    h.update(rel.encode("utf-8"))
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)

print(h.hexdigest(), end="")
PY
  }
  validate_pinned_ref() {
    local target_dir="$1"
    local label="$2"
    if [ ! -f "${target_dir}/package.json" ]; then
      return 0
    fi
    if ! command -v git >/dev/null 2>&1 || [ ! -d "${target_dir}/.git" ]; then
      return 0
    fi
    echo "==> Validating OpenClaw pinned ref for ${label}: ${OPENCLAW_PINNED_REF}"
    if git -C "${target_dir}" rev-parse --verify "${OPENCLAW_PINNED_REF}^{commit}" >/dev/null 2>&1; then
      CURRENT_COMMIT="$(git -C "${target_dir}" rev-parse HEAD 2>/dev/null || true)"
      PINNED_COMMIT="$(git -C "${target_dir}" rev-parse --verify "${OPENCLAW_PINNED_REF}^{commit}" 2>/dev/null || true)"
      if [ -n "${CURRENT_COMMIT}" ] && [ -n "${PINNED_COMMIT}" ] && [ "${CURRENT_COMMIT}" != "${PINNED_COMMIT}" ] && [ -z "$(git -C "${target_dir}" status --porcelain 2>/dev/null)" ]; then
        git -C "${target_dir}" checkout --detach "${OPENCLAW_PINNED_REF}" >/dev/null 2>&1 || true
      fi
    fi
  }

  rm -f "$CODE_ARCHIVE" "$VENDOR_ARCHIVE"
  mkdir -p "$LOCAL_ROOT"

  CODE_HASH="$(compute_tree_sha256 "code" "$ROOT_DIR")"
  if [[ -f "$CODE_HASH_FILE" ]] && [[ "$(tr -d '\n' < "$CODE_HASH_FILE")" == "$CODE_HASH" ]] \
    && [[ -f "$LOCAL_ROOT/package.json" ]] \
    && [[ -f "$LOCAL_ROOT/scripts/start-ui.command" ]] \
    && [[ -f "$LOCAL_ROOT/cli/src/index.ts" ]]; then
    NEED_CODE_COPY=0
    echo "==> Code source hash unchanged; code unzip will be skipped."
  fi
  if [[ "$NEED_CODE_COPY" -eq 1 ]]; then
    echo "==> Mirroring code archive (content changed)..."
    (
      cd "$ROOT_DIR"
      # Zip from "." so hidden files/directories (e.g. .github) are included.
      zip -rq "$CODE_ARCHIVE" . \
        -x "node_modules/*" \
        -x "*/node_modules/*" \
        -x "dist/*" \
        -x "*/dist/*" \
        -x "vendor/*"
    )
    unzip -oq "$CODE_ARCHIVE" -d "$LOCAL_ROOT"
    printf '%s' "$CODE_HASH" > "$CODE_HASH_FILE"
    REFRESHED_ANY=1
  fi

  echo "==> Preparing vendor source hash check..."
  VENDOR_HASH="$(compute_tree_sha256 "vendor" "$ROOT_DIR")"
  if [[ -f "$VENDOR_HASH_FILE" ]] && [[ "$(tr -d '\n' < "$VENDOR_HASH_FILE")" == "$VENDOR_HASH" ]] \
    && [[ -d "${LOCAL_ROOT}/vendor/openclaw" ]]; then
    NEED_VENDOR_COPY=0
    echo "==> Vendor source hash unchanged; vendor unzip will be skipped."
  fi
  if [[ "$NEED_VENDOR_COPY" -eq 1 ]]; then
    echo "==> Mirroring vendor archive (content changed or local vendor missing)..."
    (
      cd "$ROOT_DIR"
      zip -rq "$VENDOR_ARCHIVE" "vendor" \
        -x "vendor/*/node_modules/*"
    )
    unzip -oq "$VENDOR_ARCHIVE" -d "$LOCAL_ROOT"
    printf '%s' "$VENDOR_HASH" > "$VENDOR_HASH_FILE"
    REFRESHED_ANY=1
  else
    echo "==> Reusing existing local vendor directory without overwrite."
  fi

  if [[ "$REFRESHED_ANY" -eq 1 ]]; then
    python3 - "$LOCAL_ROOT" <<'PY'
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])
removed = 0
preserved = 0
for p in root.rglob("node_modules"):
    # Keep the main workspace deps and mirrored OpenClaw runtime deps so
    # second launch does not re-run installs just because the mirror refreshed.
    if p in {
        root / "node_modules",
        root / "vendor" / "openclaw" / "node_modules",
    }:
        preserved += 1
        continue
    if p.is_dir():
        shutil.rmtree(p, ignore_errors=True)
        removed += 1
print(f"==> Removed {removed} node_modules directories from local mirror (preserved {preserved})")
PY
  else
    echo "==> Mirror content hashes unchanged; skipping node_modules cleanup."
  fi
  rm -f "$CODE_ARCHIVE" "$VENDOR_ARCHIVE"
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
OPENCLAW_STABLE_SOURCE_DIR="${OPENCLAW_STABLE_SOURCE_DIR:-${HOME}/.openclaw-source}"

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

# Prepend common pnpm global-bin locations before probing `pnpm`/`openclaw`.
if [[ -z "${PNPM_HOME:-}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    export PNPM_HOME="${HOME}/Library/pnpm"
  else
    export PNPM_HOME="${HOME}/.local/share/pnpm"
  fi
fi
if [[ -n "${PNPM_HOME:-}" && -d "${PNPM_HOME}" ]]; then
  export PATH="${PNPM_HOME}:${PATH}"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "==> Enabling pnpm via corepack..."
    corepack prepare pnpm@latest --activate || true
  fi
fi
if command -v pnpm >/dev/null 2>&1; then
  PNPM_GLOBAL_BIN="$(pnpm config get global-bin-dir 2>/dev/null || true)"
  if [[ -n "${PNPM_GLOBAL_BIN}" && "${PNPM_GLOBAL_BIN}" != "undefined" && -d "${PNPM_GLOBAL_BIN}" ]]; then
    export PATH="${PNPM_GLOBAL_BIN}:${PATH}"
  fi
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

if [ ! -d "./node_modules" ] \
  || [ ! -f "./node_modules/tsx/dist/cli.mjs" ] \
  || [ ! -f "./node_modules/typescript/bin/tsc" ]; then
  echo "==> Project dependencies missing or incomplete; running pnpm install..."
  pnpm install
fi

if [ -f "./vendor/openclaw/openclaw.mjs" ] \
  && {
    [ ! -d "./vendor/openclaw/node_modules" ] \
    || {
      [ ! -f "./vendor/openclaw/dist/entry.mjs" ] \
      && [ ! -f "./vendor/openclaw/dist/entry.js" ];
    };
  }; then
  echo "==> Detected incomplete OpenClaw local mirror (missing node_modules or dist/entry); attempting local repair build..."
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

probe_openclaw_ok() {
  command -v openclaw >/dev/null 2>&1 && openclaw --version >/dev/null 2>&1
}

sync_openclaw_source_to_stable_dir() {
  if [ ! -d "${OPENCLAW_SOURCE_DIR}" ]; then
    return 1
  fi
  echo "==> Syncing OpenClaw source to stable install dir: ${OPENCLAW_STABLE_SOURCE_DIR}"
  python3 - "${OPENCLAW_SOURCE_DIR}" "${OPENCLAW_STABLE_SOURCE_DIR}" <<'PY'
import shutil
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
tmp = dst.with_name(dst.name + ".tmp")
shutil.rmtree(tmp, ignore_errors=True)
if tmp.exists():
    raise SystemExit("failed to remove temp dir")

def ignore(dirpath, names):
    ignored = set()
    if Path(dirpath).name == "node_modules":
        return set(names)
    if ".pnpm-store" in names:
        ignored.add(".pnpm-store")
    return ignored

shutil.copytree(src, tmp, dirs_exist_ok=True, ignore=ignore)
shutil.rmtree(dst, ignore_errors=True)
tmp.rename(dst)
PY
}

if [ -f "${OPENCLAW_SOURCE_DIR}/package.json" ]; then
  LOCAL_OPENCLAW_HEAD="$(git -C "${OPENCLAW_SOURCE_DIR}" rev-parse HEAD 2>/dev/null || true)"
  STABLE_OPENCLAW_HEAD="$(git -C "${OPENCLAW_STABLE_SOURCE_DIR}" rev-parse HEAD 2>/dev/null || true)"
  if [ ! -f "${OPENCLAW_STABLE_SOURCE_DIR}/package.json" ] || [ -n "${LOCAL_OPENCLAW_HEAD}" ] && [ "${LOCAL_OPENCLAW_HEAD}" != "${STABLE_OPENCLAW_HEAD}" ]; then
    sync_openclaw_source_to_stable_dir || echo "warning: failed to sync stable OpenClaw source dir." >&2
  fi
fi

validate_pinned_ref "${OPENCLAW_SOURCE_DIR}" "UI mirror source"
validate_pinned_ref "${OPENCLAW_STABLE_SOURCE_DIR}" "stable install source"

if ! probe_openclaw_ok && [ -f "${OPENCLAW_STABLE_SOURCE_DIR}/package.json" ]; then
  echo "==> openclaw command unavailable or broken; repairing global link from stable source..."
  (
    cd "${OPENCLAW_STABLE_SOURCE_DIR}"
    if [ ! -d "./node_modules" ]; then
      pnpm install
    fi
    if [ ! -f "./dist/entry.mjs" ] && [ ! -f "./dist/entry.js" ]; then
      pnpm ui:build
      pnpm build
    fi
    pnpm link --global
  ) || echo "warning: failed to repair global openclaw link from stable source." >&2
  hash -r 2>/dev/null || true
fi

exec pnpm exec tsx ./cli/src/index.ts manager:ui --config "${HOME}/.openclaw/config.json" --env-out "./.env.openclaw"