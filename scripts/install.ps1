param(
  [string]$BotName = "Claw Assistant",
  [switch]$RunFeishuSetup = $false,
  [switch]$RunConfigure = $false
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OpenClawSourceDir = Join-Path $RootDir "vendor\openclaw"
$OpenClawPinnedRef = if ($env:OPENCLAW_PINNED_REF) { $env:OPENCLAW_PINNED_REF } else { "v2026.3.8" }
$NpmRegistry = if ($env:CLAW_WRAPPER_NPM_REGISTRY) { $env:CLAW_WRAPPER_NPM_REGISTRY } else { "https://registry.npmmirror.com" }
$env:NPM_CONFIG_REGISTRY = $NpmRegistry
$env:npm_config_registry = $NpmRegistry
$PnpmHome = if ($env:PNPM_HOME) { $env:PNPM_HOME } elseif ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "pnpm" } else { Join-Path $HOME ".pnpm" }
$env:PNPM_HOME = $PnpmHome
New-Item -ItemType Directory -Path $PnpmHome -Force | Out-Null
$env:Path = "$PnpmHome;$env:Path"
Set-Location $RootDir

Write-Host "==> claw-wrapper bootstrap (PowerShell)"
Write-Host "==> Using npm mirror registry: $NpmRegistry"

function Install-Node {
  Write-Host "==> Node.js/npm not found; attempting automatic install"

  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    return
  }

  if (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install nodejs-lts -y
    return
  }

  Write-Host "==> winget/choco unavailable; installing nvm-windows"
  $tempDir = Join-Path $env:TEMP "claw-wrapper-nvm"
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $zipPath = Join-Path $tempDir "nvm-setup.zip"
  $extractDir = Join-Path $tempDir "extract"

  Invoke-WebRequest -Uri "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.zip" -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $installer = Get-ChildItem -Path $extractDir -Filter "nvm-setup.exe" -Recurse | Select-Object -First 1
  if (-not $installer) {
    throw "Failed to find nvm-setup.exe in downloaded archive."
  }
  Start-Process -FilePath $installer.FullName -ArgumentList "/SILENT" -Wait
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Install-Node
}

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command nvm -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm installation failed and nvm is unavailable. Please install Node.js 22+ manually, then rerun."
  }

  nvm install lts
  nvm use lts
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js/npm installation did not complete successfully. Please reopen PowerShell and rerun."
}

$nodeVersion = node -p "process.versions.node"
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) {
  Write-Warning "Node $nodeVersion detected; Node 22+ is recommended."
}

Write-Host "==> Ensuring pnpm is available"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    try {
      corepack prepare pnpm@latest --activate | Out-Null
    } catch {
      Write-Warning "corepack prepare pnpm failed: $($_.Exception.Message)"
    }
  }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $userPrefix = Join-Path $HOME ".npm-global"
  New-Item -ItemType Directory -Path (Join-Path $userPrefix "bin") -Force | Out-Null
  npm config set prefix $userPrefix | Out-Null
  npm install -g pnpm
  $env:Path = "$userPrefix\bin;$env:Path"
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm bootstrap failed. Please install pnpm manually and rerun."
}
pnpm config set global-bin-dir $PnpmHome | Out-Null

Write-Host "==> Installing dependencies"
pnpm install

Write-Host "==> Building project"
pnpm run build

Write-Host "==> Linking claw-wrapper globally"
pnpm link --global

Write-Host "==> Installing Playwright Chromium runtime"
pnpm exec playwright install chromium

Write-Host "==> Running OpenClaw install workflow"
if (-not (Test-Path (Join-Path $OpenClawSourceDir "package.json"))) {
  throw "Local OpenClaw source missing at vendor\openclaw. Place source there before install."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to validate pinned OpenClaw source ref."
}
if (-not (Test-Path (Join-Path $OpenClawSourceDir ".git"))) {
  throw "$OpenClawSourceDir is not a git repository."
}
Write-Host "==> Ensuring OpenClaw pinned ref: $OpenClawPinnedRef"
try {
  $pinnedCommit = (git -C $OpenClawSourceDir rev-parse --verify "$OpenClawPinnedRef`^{commit}").Trim()
} catch {
  $fallbackRef = (git -C $OpenClawSourceDir tag --list "v*" --sort=-v:refname | Where-Object { $_ -and ($_ -notmatch '(?i)(beta|alpha|rc)') } | Select-Object -First 1)
  if (-not $fallbackRef) {
    throw "Pinned ref $OpenClawPinnedRef not found in vendor/openclaw, and no stable fallback tag was found."
  }
  Write-Warning "Pinned ref $OpenClawPinnedRef not found; falling back to stable tag $fallbackRef."
  $OpenClawPinnedRef = $fallbackRef
  $pinnedCommit = (git -C $OpenClawSourceDir rev-parse --verify "$OpenClawPinnedRef`^{commit}").Trim()
}
$currentCommit = (git -C $OpenClawSourceDir rev-parse HEAD).Trim()
if ($currentCommit -ne $pinnedCommit) {
  $dirty = git -C $OpenClawSourceDir status --porcelain
  if ($dirty) {
    throw "vendor/openclaw has uncommitted changes; cannot auto-checkout pinned ref. Clean repo or checkout $OpenClawPinnedRef manually."
  }
  git -C $OpenClawSourceDir checkout --detach $OpenClawPinnedRef
}
foreach ($required in @("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")) {
  if (-not (Test-Path (Join-Path $OpenClawSourceDir $required))) {
    throw "vendor/openclaw is missing required file: $required"
  }
}
if (-not (Test-Path (Join-Path $RootDir "vendor\github-tarballs\manifest.json"))) {
  throw "Missing vendor\github-tarballs\manifest.json. This installer requires bundled GitHub tarballs from OpenClaw lockfile."
}
$githubTarballs = node -e @'
const fs=require("node:fs");
const path=require("node:path");
const root=process.argv[1];
const sourceDir=path.join(root,"vendor","openclaw");
const lockPath=path.join(sourceDir,"pnpm-lock.yaml");
const manifestPath=path.join(root,"vendor","github-tarballs","manifest.json");
const lock=fs.readFileSync(lockPath,"utf8");
const urls=[...new Set((lock.match(/https:\/\/codeload\.github\.com\/[^\s'"]+\/tar\.gz\/[A-Za-z0-9._-]+/g)||[]))];
const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
const byUrl=new Map((manifest.tarballs||[]).map((item)=>[item.url,item.file]));
for(const url of urls){
  const rel=byUrl.get(url);
  if(!rel){ console.error("MISSING_URL:"+url); process.exit(2); }
  const abs=path.join(root,"vendor","github-tarballs",rel);
  if(!fs.existsSync(abs)){ console.error("MISSING_FILE:"+abs); process.exit(3); }
  console.log(abs);
}
'@ $RootDir
if ($LASTEXITCODE -ne 0) {
  throw "Failed to resolve bundled GitHub tarballs."
}
foreach ($line in ($githubTarballs -split "`r?`n")) {
  $tarball = $line.Trim()
  if ($tarball) {
    pnpm store add $tarball
  }
}
claw-wrapper install --method local

if ($RunFeishuSetup) {
  Write-Host "==> Running guided Feishu setup"
  claw-wrapper feishu:setup --bot-name $BotName --output ".\.feishu-bot.json"
}
else {
  Write-Host "==> Optional: run `claw-wrapper feishu:setup --bot-name `"$BotName`" --output .\.feishu-bot.json`"
}

if ($RunConfigure) {
  Write-Host "==> Running configuration wizard"
  claw-wrapper configure --config "$HOME/.openclaw/config.json" --env-out ".\.env.openclaw"
}
else {
  Write-Host "==> Optional: run `claw-wrapper configure --config $HOME/.openclaw/config.json --env-out .\.env.openclaw`"
}

Write-Host "Bootstrap complete."
