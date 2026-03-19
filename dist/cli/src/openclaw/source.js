"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENCLAW_PINNED_REF = exports.LOCAL_OPENCLAW_SOURCE_ABSOLUTE = exports.LOCAL_OPENCLAW_SOURCE_RELATIVE = void 0;
exports.pathExists = pathExists;
exports.verifyOpenClawSourcePreflight = verifyOpenClawSourcePreflight;
exports.preparePinnedOpenClawSource = preparePinnedOpenClawSource;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const exec_1 = require("../utils/exec");
const platform_1 = require("../utils/platform");
exports.LOCAL_OPENCLAW_SOURCE_RELATIVE = "vendor/openclaw";
exports.LOCAL_OPENCLAW_SOURCE_ABSOLUTE = (0, node_path_1.join)(process.cwd(), "vendor", "openclaw");
exports.OPENCLAW_PINNED_REF = process.env.OPENCLAW_PINNED_REF?.trim() || "v2026.3.8";
async function pathExists(path) {
    try {
        await (0, promises_1.access)(path);
        return true;
    }
    catch {
        return false;
    }
}
async function git(args, cwd) {
    return await (0, exec_1.runCommand)("git", args, { cwd });
}
async function resolveCommit(ref, cwd) {
    const resolved = await git(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
    if (resolved.code !== 0) {
        return null;
    }
    const commit = resolved.stdout.trim();
    return commit.length > 0 ? commit : null;
}
async function pickLatestStableTag(cwd) {
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
async function verifyOpenClawSourcePreflight(sourceDir) {
    const missing = [];
    for (const relPath of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
        if (!(await pathExists((0, node_path_1.join)(sourceDir, relPath)))) {
            missing.push(relPath);
        }
    }
    return missing;
}
async function preparePinnedOpenClawSource(sourceDir, pinnedRef, log) {
    const packageJsonPath = (0, node_path_1.join)(sourceDir, "package.json");
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
    if (!(await (0, platform_1.commandExists)("git"))) {
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
    if (!(await pathExists((0, node_path_1.join)(sourceDir, ".git")))) {
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
                message: `OpenClaw source has uncommitted changes. Please clean vendor/openclaw and retry, or manually checkout ${resolvedRef}.`,
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
        log?.(`Switched OpenClaw source from ${currentCommit.slice(0, 8)} to ${pinnedCommit.slice(0, 8)} (${resolvedRef}).`);
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
