"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NPM_REGISTRY = void 0;
exports.withMirrorRegistry = withMirrorRegistry;
exports.extractGithubTarballUrlsFromLock = extractGithubTarballUrlsFromLock;
exports.prepareGithubTarballsForInstall = prepareGithubTarballsForInstall;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const source_1 = require("./source");
const GITHUB_TARBALL_PATTERN = /https:\/\/codeload\.github\.com\/[^\s'"]+\/tar\.gz\/[A-Za-z0-9._-]+/g;
exports.DEFAULT_NPM_REGISTRY = process.env.CLAW_WRAPPER_NPM_REGISTRY?.trim() || "https://registry.npmmirror.com";
function withMirrorRegistry(env = process.env) {
    return {
        ...env,
        NPM_CONFIG_REGISTRY: env.NPM_CONFIG_REGISTRY ?? exports.DEFAULT_NPM_REGISTRY,
        npm_config_registry: env.npm_config_registry ?? exports.DEFAULT_NPM_REGISTRY,
    };
}
async function extractGithubTarballUrlsFromLock(sourceDir) {
    const lockfilePath = (0, node_path_1.join)(sourceDir, "pnpm-lock.yaml");
    if (!(await (0, source_1.pathExists)(lockfilePath))) {
        return [];
    }
    const content = await (0, promises_1.readFile)(lockfilePath, "utf8");
    const urls = new Set();
    for (const match of content.matchAll(GITHUB_TARBALL_PATTERN)) {
        const url = (match[0] ?? "").trim();
        if (url.length > 0) {
            urls.add(url);
        }
    }
    return [...urls].sort();
}
async function prepareGithubTarballsForInstall(sourceDir) {
    const urls = await extractGithubTarballUrlsFromLock(sourceDir);
    if (urls.length === 0) {
        return { ok: true, files: [], urls };
    }
    const manifestPath = (0, node_path_1.resolve)(process.cwd(), "vendor", "github-tarballs", "manifest.json");
    if (!(await (0, source_1.pathExists)(manifestPath))) {
        return {
            ok: false,
            files: [],
            urls,
            error: "Missing vendor/github-tarballs/manifest.json. This project requires bundled GitHub tarballs for OpenClaw.",
        };
    }
    let manifest;
    try {
        manifest = JSON.parse(await (0, promises_1.readFile)(manifestPath, "utf8"));
    }
    catch (error) {
        return {
            ok: false,
            files: [],
            urls,
            error: `Failed to parse github tarball manifest: ${String(error)}`,
        };
    }
    const entries = manifest.tarballs ?? [];
    const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
    const files = [];
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
        const absFile = (0, node_path_1.resolve)(process.cwd(), "vendor", "github-tarballs", entry.file);
        if (!(await (0, source_1.pathExists)(absFile))) {
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
