import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathExists } from "./source";

const GITHUB_TARBALL_PATTERN = /https:\/\/codeload\.github\.com\/[^\s'"]+\/tar\.gz\/[A-Za-z0-9._-]+/g;

interface GithubTarballManifestEntry {
  url: string;
  file: string;
  sha256?: string;
}

interface GithubTarballManifest {
  tarballs: GithubTarballManifestEntry[];
}

export interface GithubTarballPreparationResult {
  ok: boolean;
  files: string[];
  urls: string[];
  error?: string;
}

export const DEFAULT_NPM_REGISTRY =
  process.env.CLAW_WRAPPER_NPM_REGISTRY?.trim() || "https://registry.npmmirror.com";

/** npmmirror Playwright path; often lags new Playwright releases (404 on `builds/cft/...`). Opt-in only. */
export const DEFAULT_PLAYWRIGHT_NPPMIRROR_HOST = "https://npmmirror.com/mirrors/playwright";

export function withMirrorRegistry(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    NPM_CONFIG_REGISTRY: env.NPM_CONFIG_REGISTRY ?? DEFAULT_NPM_REGISTRY,
    npm_config_registry: env.npm_config_registry ?? DEFAULT_NPM_REGISTRY,
  };
}

function playwrightUseNpmmirrorOptIn(env: NodeJS.ProcessEnv): boolean {
  const v = env.CLAW_WRAPPER_PLAYWRIGHT_USE_NPPMIRROR?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * npm registry mirror + optional Playwright browser download host.
 *
 * By default does **not** set `PLAYWRIGHT_DOWNLOAD_HOST`, so `playwright install` uses Playwright's built-in
 * multi-CDN failover. Forcing a single mirror (e.g. npmmirror) disables that and breaks when the mirror
 * lacks the exact `builds/cft/...` revision.
 *
 * Override download host explicitly with `PLAYWRIGHT_DOWNLOAD_HOST` / `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST`, or
 * `CLAW_WRAPPER_PLAYWRIGHT_DOWNLOAD_HOST`, or opt into npmmirror with `CLAW_WRAPPER_PLAYWRIGHT_USE_NPPMIRROR=1`.
 */
export function withPlaywrightAutomationEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const base = withMirrorRegistry(env);
  if (env.PLAYWRIGHT_DOWNLOAD_HOST?.trim() || env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST?.trim()) {
    return base;
  }
  const custom = env.CLAW_WRAPPER_PLAYWRIGHT_DOWNLOAD_HOST?.trim();
  if (custom) {
    return { ...base, PLAYWRIGHT_DOWNLOAD_HOST: custom };
  }
  if (playwrightUseNpmmirrorOptIn(env)) {
    return { ...base, PLAYWRIGHT_DOWNLOAD_HOST: DEFAULT_PLAYWRIGHT_NPPMIRROR_HOST };
  }
  return base;
}

export async function extractGithubTarballUrlsFromLock(sourceDir: string): Promise<string[]> {
  const lockfilePath = join(sourceDir, "pnpm-lock.yaml");
  if (!(await pathExists(lockfilePath))) {
    return [];
  }
  const content = await readFile(lockfilePath, "utf8");
  const urls = new Set<string>();
  for (const match of content.matchAll(GITHUB_TARBALL_PATTERN)) {
    const url = (match[0] ?? "").trim();
    if (url.length > 0) {
      urls.add(url);
    }
  }
  return [...urls].sort();
}

export async function prepareGithubTarballsForInstall(
  sourceDir: string,
): Promise<GithubTarballPreparationResult> {
  const urls = await extractGithubTarballUrlsFromLock(sourceDir);
  if (urls.length === 0) {
    return { ok: true, files: [], urls };
  }

  const manifestPath = resolve(process.cwd(), "vendor", "github-tarballs", "manifest.json");
  if (!(await pathExists(manifestPath))) {
    return {
      ok: false,
      files: [],
      urls,
      error:
        "Missing vendor/github-tarballs/manifest.json. This project requires bundled GitHub tarballs for OpenClaw.",
    };
  }

  let manifest: GithubTarballManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as GithubTarballManifest;
  } catch (error) {
    return {
      ok: false,
      files: [],
      urls,
      error: `Failed to parse github tarball manifest: ${String(error)}`,
    };
  }

  const entries = manifest.tarballs ?? [];
  const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
  const files: string[] = [];
  for (const url of urls) {
    const entry = byUrl.get(url);
    if (!entry) {
      return {
        ok: false,
        files: [],
        urls,
        error: `GitHub tarball not bundled for URL: ${url}`,
      };
    }
    const absFile = resolve(process.cwd(), "vendor", "github-tarballs", entry.file);
    if (!(await pathExists(absFile))) {
      return {
        ok: false,
        files: [],
        urls,
        error: `Bundled GitHub tarball file not found: ${absFile}`,
      };
    }
    files.push(absFile);
  }

  return { ok: true, files, urls };
}
