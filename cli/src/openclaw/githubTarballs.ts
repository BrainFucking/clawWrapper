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

export function withMirrorRegistry(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    NPM_CONFIG_REGISTRY: env.NPM_CONFIG_REGISTRY ?? DEFAULT_NPM_REGISTRY,
    npm_config_registry: env.npm_config_registry ?? DEFAULT_NPM_REGISTRY,
  };
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
