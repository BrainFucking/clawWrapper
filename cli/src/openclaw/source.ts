import { access } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../utils/exec";
import { commandExists } from "../utils/platform";

export const LOCAL_OPENCLAW_SOURCE_RELATIVE = "vendor/openclaw";
export const LOCAL_OPENCLAW_SOURCE_ABSOLUTE = join(process.cwd(), "vendor", "openclaw");
export const OPENCLAW_PINNED_REF = process.env.OPENCLAW_PINNED_REF?.trim() || "v2026.3.8";

export interface SourcePrepareResult {
  ok: boolean;
  changedRef: boolean;
  fallbackUsed: boolean;
  pinnedRef: string;
  resolvedRef: string;
  pinnedCommit: string;
  currentCommit: string;
  message?: string;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function git(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await runCommand("git", args, { cwd });
}

async function resolveCommit(ref: string, cwd: string): Promise<string | null> {
  const resolved = await git(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
  if (resolved.code !== 0) {
    return null;
  }
  const commit = resolved.stdout.trim();
  return commit.length > 0 ? commit : null;
}

async function pickLatestStableTag(cwd: string): Promise<string | null> {
  const tags = await git(["tag", "--list", "v*", "--sort=-v:refname"], cwd);
  if (tags.code !== 0) {
    return null;
  }
  const lines = tags.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const tag of lines) {
    if (!/(beta|alpha|rc)/i.test(tag)) {
      return tag;
    }
  }
  return null;
}

export async function verifyOpenClawSourcePreflight(sourceDir: string): Promise<string[]> {
  const missing: string[] = [];
  for (const relPath of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    if (!(await pathExists(join(sourceDir, relPath)))) {
      missing.push(relPath);
    }
  }
  return missing;
}

export async function preparePinnedOpenClawSource(
  sourceDir: string,
  pinnedRef: string,
  log?: (line: string) => void,
): Promise<SourcePrepareResult> {
  const packageJsonPath = join(sourceDir, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return {
      ok: false,
      changedRef: false,
      fallbackUsed: false,
      pinnedRef,
      resolvedRef: pinnedRef,
      pinnedCommit: "",
      currentCommit: "",
      message: `Local OpenClaw source not found at ${sourceDir}.`,
    };
  }
  if (!(await commandExists("git"))) {
    return {
      ok: false,
      changedRef: false,
      fallbackUsed: false,
      pinnedRef,
      resolvedRef: pinnedRef,
      pinnedCommit: "",
      currentCommit: "",
      message: "git is required to validate pinned OpenClaw source ref.",
    };
  }
  if (!(await pathExists(join(sourceDir, ".git")))) {
    return {
      ok: false,
      changedRef: false,
      fallbackUsed: false,
      pinnedRef,
      resolvedRef: pinnedRef,
      pinnedCommit: "",
      currentCommit: "",
      message: `${sourceDir} is not a git repository.`,
    };
  }

  log?.(`Preparing OpenClaw source at pinned ref ${pinnedRef} ...`);
  log?.("Using local refs/tags only (no git fetch).");

  let resolvedRef = pinnedRef;
  let pinnedCommit = await resolveCommit(resolvedRef, sourceDir);
  let fallbackUsed = false;
  if (!pinnedCommit) {
    const fallbackRef = await pickLatestStableTag(sourceDir);
    if (!fallbackRef) {
      return {
        ok: false,
        changedRef: false,
        fallbackUsed: false,
        pinnedRef,
        resolvedRef: pinnedRef,
        pinnedCommit: "",
        currentCommit: "",
        message: `Pinned ref '${pinnedRef}' does not exist and no stable fallback tag was found in vendor/openclaw.`,
      };
    }
    const fallbackCommit = await resolveCommit(fallbackRef, sourceDir);
    if (!fallbackCommit) {
      return {
        ok: false,
        changedRef: false,
        fallbackUsed: false,
        pinnedRef,
        resolvedRef: pinnedRef,
        pinnedCommit: "",
        currentCommit: "",
        message: `Pinned ref '${pinnedRef}' does not exist and fallback ref '${fallbackRef}' could not be resolved.`,
      };
    }
    resolvedRef = fallbackRef;
    pinnedCommit = fallbackCommit;
    fallbackUsed = true;
    log?.(`Pinned ref '${pinnedRef}' is unavailable. Falling back to stable tag '${resolvedRef}'.`);
  }

  const currentCommit = (await git(["rev-parse", "HEAD"], sourceDir)).stdout.trim();
  if (!currentCommit) {
    return {
      ok: false,
      changedRef: false,
      fallbackUsed,
      pinnedRef,
      resolvedRef,
      pinnedCommit,
      currentCommit: "",
      message: "Failed to resolve current OpenClaw commit.",
    };
  }

  if (currentCommit !== pinnedCommit) {
    const dirty = await git(["status", "--porcelain"], sourceDir);
    if (dirty.code !== 0) {
      return {
        ok: false,
        changedRef: false,
        fallbackUsed,
        pinnedRef,
        resolvedRef,
        pinnedCommit,
        currentCommit,
        message: `Unable to inspect OpenClaw working tree: ${dirty.stderr.trim() || dirty.stdout.trim()}`,
      };
    }
    if (dirty.stdout.trim().length > 0) {
      return {
        ok: false,
        changedRef: false,
        fallbackUsed,
        pinnedRef,
        resolvedRef,
        pinnedCommit,
        currentCommit,
        message:
          `OpenClaw source has uncommitted changes. Please clean vendor/openclaw and retry, or manually checkout ${resolvedRef}.`,
      };
    }
    const checkout = await git(["checkout", "--detach", resolvedRef], sourceDir);
    if (checkout.code !== 0) {
      return {
        ok: false,
        changedRef: false,
        fallbackUsed,
        pinnedRef,
        resolvedRef,
        pinnedCommit,
        currentCommit,
        message: `Failed to checkout pinned ref '${resolvedRef}': ${checkout.stderr.trim() || checkout.stdout.trim()}`,
      };
    }
    log?.(
      `Switched OpenClaw source from ${currentCommit.slice(0, 8)} to ${pinnedCommit.slice(0, 8)} (${resolvedRef}).`,
    );
    return {
      ok: true,
      changedRef: true,
      fallbackUsed,
      pinnedRef,
      resolvedRef,
      pinnedCommit,
      currentCommit,
    };
  }

  return {
    ok: true,
    changedRef: false,
    fallbackUsed,
    pinnedRef,
    resolvedRef,
    pinnedCommit,
    currentCommit,
  };
}
