"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConfigureUiCommand = runConfigureUiCommand;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_http_1 = __importDefault(require("node:http"));
const node_child_process_1 = require("node:child_process");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const exec_1 = require("../utils/exec");
const platform_1 = require("../utils/platform");
const config_1 = require("../openclaw/config");
const githubTarballs_1 = require("../openclaw/githubTarballs");
const source_1 = require("../openclaw/source");
let cachedProjectRoot = null;
const chatMessages = [];
let installJob = {
    running: false,
    completed: false,
    ok: false,
    canceled: false,
    progress: 0,
    title: "idle",
    logs: [],
    currentStep: "",
    currentCommand: "",
    currentPid: null,
    stepStartedAt: null,
    lastActivityAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    lastFailureReason: "",
};
let uninstallJob = {
    running: false,
    completed: false,
    ok: false,
    progress: 0,
    title: "idle",
    logs: [],
    currentStep: "",
    startedAt: null,
    lastFailureReason: "",
};
let installChild = null;
let lastInstallStatusLogAt = 0;
let lastUninstallStatusLogAt = 0;
let lastMaintenanceStatusLogAt = 0;
let maintenanceJob = {
    running: false,
    completed: false,
    ok: false,
    kind: "idle",
    progress: 0,
    title: "idle",
    logs: [],
    currentStep: "",
    currentCommand: "",
    currentPid: null,
    stepStartedAt: null,
    lastActivityAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    lastFailureReason: "",
};
function debugLog(message, data) {
    const ts = new Date().toISOString();
    if (data === undefined) {
        console.log(`[manager-ui][${ts}] ${message}`);
        return;
    }
    try {
        console.log(`[manager-ui][${ts}] ${message} ${JSON.stringify(data)}`);
    }
    catch {
        console.log(`[manager-ui][${ts}] ${message}`);
    }
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}
function resolveHomeDir() {
    return process.env.HOME ?? process.env.USERPROFILE ?? ".";
}
function getOpenClawDir() {
    return (0, node_path_1.join)(resolveHomeDir(), ".openclaw");
}
function getOpenClawSetupResultPath(kind) {
    const home = resolveHomeDir();
    const file = kind === "onething" ? "onething-setup-result.json" : "feishu-setup-result.json";
    return (0, node_path_1.join)(home, ".openclaw", file);
}
function getOpenClawDotEnvPath() {
    return (0, node_path_1.join)(resolveHomeDir(), ".openclaw", ".env");
}
async function tryReadJsonFile(filePath) {
    try {
        const raw = await (0, promises_1.readFile)(filePath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function maskSecret(value, head = 3, tail = 3) {
    const v = value ?? "";
    const trimmed = v.trim();
    if (!trimmed)
        return "";
    if (trimmed.length <= head + tail) {
        return `${trimmed.slice(0, Math.max(1, head))}***`;
    }
    return `${trimmed.slice(0, head)}...${trimmed.slice(-tail)}`;
}
function upsertDotEnvVar(envText, key, value) {
    const lines = (envText || "").split(/\r?\n/);
    const prefix = `${key}=`;
    let found = false;
    const next = lines.map((line) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith(prefix)) {
            found = true;
            return `${key}=${value}`;
        }
        return line;
    });
    if (!found) {
        next.push(`${key}=${value}`);
    }
    return next.join("\n").trimEnd() + "\n";
}
function openInBrowser(url) {
    if (process.platform === "darwin") {
        (0, node_child_process_1.spawn)("open", [url], { stdio: "ignore", detached: true }).unref();
        return;
    }
    if (process.platform === "win32") {
        (0, node_child_process_1.spawn)("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
        return;
    }
    (0, node_child_process_1.spawn)("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
            try {
                const raw = Buffer.concat(chunks).toString("utf8");
                resolve(raw ? JSON.parse(raw) : {});
            }
            catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}
function asString(value) {
    return typeof value === "string" ? value : undefined;
}
function asBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return value === "true";
    }
    return undefined;
}
function parseConfigBody(body, existing, configPath) {
    const parsedModels = (() => {
        try {
            return JSON.parse(asString(body.modelsJson) ?? "[]");
        }
        catch {
            return existing.models.list;
        }
    })();
    return {
        ...existing,
        openclaw: {
            home: asString(body.openclawHome) ?? existing.openclaw.home ?? "",
            stateDir: asString(body.stateDir) ?? existing.openclaw.stateDir ?? "",
            configPath,
        },
        models: {
            provider: asString(body.provider) ?? existing.models.provider,
            baseUrl: asString(body.baseUrl) ?? existing.models.baseUrl,
            apiKeyEnv: asString(body.apiKeyEnv) ?? existing.models.apiKeyEnv,
            defaultModel: asString(body.defaultModel) ?? existing.models.defaultModel,
            dailyLimit: asString(body.dailyLimit) ?? existing.models.dailyLimit,
            list: parsedModels,
        },
        channels: {
            feishu: {
                enabled: asBoolean(body.feishuEnabled) ?? existing.channels.feishu.enabled,
                appId: asString(body.feishuAppId) ?? existing.channels.feishu.appId ?? existing.feishu.appId,
                appSecret: asString(body.feishuAppSecret) ?? existing.channels.feishu.appSecret ?? existing.feishu.appSecret,
                botName: asString(body.feishuBotName) ?? existing.channels.feishu.botName ?? existing.feishu.botName,
                webhookUrl: asString(body.feishuWebhookUrl) ??
                    existing.channels.feishu.webhookUrl ??
                    existing.feishu.webhookUrl,
            },
            qq: {
                enabled: asBoolean(body.qqEnabled) ?? existing.channels.qq.enabled,
                botId: asString(body.qqBotId) ?? existing.channels.qq.botId,
                token: asString(body.qqToken) ?? existing.channels.qq.token,
            },
            wecom: {
                enabled: asBoolean(body.wecomEnabled) ?? existing.channels.wecom.enabled,
                corpId: asString(body.wecomCorpId) ?? existing.channels.wecom.corpId,
                agentId: asString(body.wecomAgentId) ?? existing.channels.wecom.agentId,
                secret: asString(body.wecomSecret) ?? existing.channels.wecom.secret,
            },
        },
        feishu: {
            appId: asString(body.feishuAppId) ?? existing.feishu.appId,
            appSecret: asString(body.feishuAppSecret) ?? existing.feishu.appSecret,
            botName: asString(body.feishuBotName) ?? existing.feishu.botName,
            webhookUrl: asString(body.feishuWebhookUrl) ?? existing.feishu.webhookUrl,
        },
    };
}
async function ensureShellPathExported(userBin) {
    const home = process.env.HOME ?? "";
    if (!home || !userBin) {
        return;
    }
    const line = `export PATH="${userBin}:$PATH"`;
    const targets = [`${home}/.zshrc`, `${home}/.bashrc`, `${home}/.profile`];
    for (const file of targets) {
        try {
            let content = "";
            try {
                content = await (0, promises_1.readFile)(file, "utf8");
            }
            catch {
                content = "";
            }
            if (content.includes(userBin) || content.includes(line)) {
                continue;
            }
            const next = content.trimEnd().length > 0 ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
            await (0, promises_1.writeFile)(file, next, "utf8");
        }
        catch {
            // best-effort; do not fail install job if shell rc write fails
        }
    }
}
async function reloadProcessPathFromZshrc(log) {
    if (process.platform === "win32") {
        return;
    }
    const zshrc = `${process.env.HOME ?? ""}/.zshrc`;
    if (!(await (0, source_1.pathExists)(zshrc))) {
        return;
    }
    const shell = process.env.SHELL && process.env.SHELL.trim().length > 0 ? process.env.SHELL : "/bin/zsh";
    const refreshed = await (0, exec_1.runCommand)(shell, ["-lc", "source ~/.zshrc >/dev/null 2>&1 || true; printf '%s' \"$PATH\""]);
    if (refreshed.code === 0 && refreshed.stdout.trim()) {
        process.env.PATH = refreshed.stdout.trim();
        log("已执行 source ~/.zshrc，并刷新当前进程 PATH。");
    }
}
async function resolveProjectRoot() {
    if (cachedProjectRoot) {
        return cachedProjectRoot;
    }
    const candidates = [
        process.cwd(),
        (0, node_path_1.join)(__dirname, "..", "..", ".."),
        (0, node_path_1.join)(__dirname, "..", "..", "..", ".."),
    ];
    for (const candidate of candidates) {
        if ((await (0, source_1.pathExists)((0, node_path_1.join)(candidate, "package.json"))) && (await (0, source_1.pathExists)((0, node_path_1.join)(candidate, "automation")))) {
            cachedProjectRoot = candidate;
            return candidate;
        }
    }
    cachedProjectRoot = process.cwd();
    return cachedProjectRoot;
}
async function ensurePnpmAvailable(log) {
    const mirrorEnv = (0, githubTarballs_1.withMirrorRegistry)();
    if (await (0, platform_1.commandExists)("pnpm")) {
        return true;
    }
    if (await (0, platform_1.commandExists)("corepack")) {
        log("未检测到 pnpm，尝试通过 corepack 激活 pnpm...");
        const activate = await (0, exec_1.runCommand)("corepack", ["prepare", "pnpm@latest", "--activate"], { env: mirrorEnv });
        if (activate.stdout.trim()) {
            log(activate.stdout.trim());
        }
        if (activate.stderr.trim()) {
            log(activate.stderr.trim());
        }
        if (activate.code === 0 && (await (0, platform_1.commandExists)("pnpm"))) {
            return true;
        }
    }
    if (await (0, platform_1.commandExists)("npm")) {
        log("corepack 激活 pnpm 失败，尝试 npm 全局安装 pnpm...");
        const home = process.env.HOME ?? "";
        const userPrefix = home ? `${home}/.npm-global` : "";
        const userBin = userPrefix ? `${userPrefix}/bin` : "";
        if (userPrefix) {
            await (0, exec_1.runCommand)("bash", ["-lc", `mkdir -p "${userPrefix}" "${userBin}"`], { env: mirrorEnv });
            await (0, exec_1.runCommand)("npm", ["config", "set", "prefix", userPrefix], { env: mirrorEnv });
        }
        const installEnv = {
            ...mirrorEnv,
            PATH: userBin ? `${userBin}:${process.env.PATH ?? ""}` : (process.env.PATH ?? ""),
        };
        const install = await (0, exec_1.runCommand)("npm", ["install", "-g", "pnpm"], { env: installEnv });
        if (install.stdout.trim()) {
            log(install.stdout.trim());
        }
        if (install.stderr.trim()) {
            log(install.stderr.trim());
        }
        if (install.code === 0 && (await (0, platform_1.commandExists)("pnpm"))) {
            if (userBin) {
                const current = process.env.PATH ?? "";
                if (!current.includes(`${userBin}:`)) {
                    process.env.PATH = `${userBin}:${current}`;
                }
                await ensureShellPathExported(userBin);
            }
            return true;
        }
    }
    return false;
}
function prependExistingBinDirs(dirs) {
    const current = process.env.PATH ?? "";
    const parts = current.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
    const sep = process.platform === "win32" ? ";" : ":";
    const next = [];
    for (const dir of dirs) {
        if (!dir || parts.includes(dir)) {
            continue;
        }
        next.push(dir);
    }
    if (next.length > 0) {
        process.env.PATH = `${next.join(sep)}${sep}${current}`;
    }
}
function addCommonUserBinDirsToPath() {
    const home = process.env.HOME ?? "";
    const candidates = process.platform === "darwin"
        ? [
            `${home}/Library/pnpm`,
            `${home}/.npm-global/bin`,
            `${home}/.local/bin`,
        ]
        : process.platform === "win32"
            ? [
                `${process.env.LOCALAPPDATA ?? ""}\\pnpm`,
                `${process.env.APPDATA ?? ""}\\npm`,
            ]
            : [
                `${home}/.local/share/pnpm`,
                `${home}/.npm-global/bin`,
                `${home}/.local/bin`,
            ];
    prependExistingBinDirs(candidates.filter(Boolean));
}
async function refreshProcessPathFromLoginShell() {
    if (process.platform === "win32") {
        return;
    }
    const shell = process.env.SHELL && process.env.SHELL.trim().length > 0 ? process.env.SHELL : "/bin/zsh";
    const refreshed = await (0, exec_1.runCommand)(shell, ["-lc", "printf '%s' \"$PATH\""]);
    if (refreshed.code === 0 && refreshed.stdout.trim()) {
        process.env.PATH = refreshed.stdout.trim();
    }
}
async function ensurePnpmGlobalBinConfigured(log) {
    const env = (0, githubTarballs_1.withMirrorRegistry)();
    const home = process.env.HOME ?? "";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    let pnpmHome = (process.env.PNPM_HOME ?? "").trim();
    if (!pnpmHome) {
        if (process.platform === "darwin" && home) {
            pnpmHome = `${home}/Library/pnpm`;
        }
        else if (process.platform === "win32" && localAppData) {
            pnpmHome = `${localAppData}\\pnpm`;
        }
        else if (home) {
            pnpmHome = `${home}/.local/share/pnpm`;
        }
    }
    if (!pnpmHome) {
        return env;
    }
    await (0, exec_1.runCommand)(process.platform === "win32" ? "powershell" : "bash", process.platform === "win32"
        ? ["-NoProfile", "-Command", `New-Item -ItemType Directory -Path "${pnpmHome}" -Force | Out-Null`]
        : ["-lc", `mkdir -p "${pnpmHome}"`], { env });
    env.PNPM_HOME = pnpmHome;
    env.PATH = process.platform === "win32"
        ? `${pnpmHome};${process.env.PATH ?? ""}`
        : `${pnpmHome}:${process.env.PATH ?? ""}`;
    const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const configured = await (0, exec_1.runCommand)(pnpmCmd, ["config", "set", "global-bin-dir", pnpmHome], { env });
    if (configured.code !== 0) {
        log(`警告: pnpm global-bin-dir 配置失败，继续尝试安装: ${configured.stderr.trim() || configured.stdout.trim()}`);
    }
    if (process.platform !== "win32") {
        await ensureShellPathExported(pnpmHome);
    }
    return env;
}
function isHealthyOpenClawProbe(result) {
    if (result.code !== 0) {
        return false;
    }
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    // Guard against false positives from wrappers/stubs that still exit 0.
    if (/(command not found|not found|no such file|cannot find module|module not found|permission denied|operation not permitted|enoent|eacces)/i
        .test(text)) {
        return false;
    }
    return true;
}
async function runAction(action, payload) {
    debugLog("action-start", { action });
    const logs = [];
    const add = (line) => {
        logs.push(line);
    };
    const exec = async (label, cmd, args) => {
        add(`$ ${cmd} ${args.join(" ")}`.trim());
        const result = await (0, exec_1.runCommand)(cmd, args);
        if (result.stdout.trim()) {
            add(result.stdout.trim());
        }
        if (result.stderr.trim()) {
            add(result.stderr.trim());
        }
        add(`(exit ${result.code})`);
        if (result.code !== 0) {
            add(`${label} failed.`);
            return false;
        }
        return true;
    };
    const uninstallByPlatform = async () => {
        const hasOpenClaw = await (0, platform_1.commandExists)("openclaw");
        let builtInOk = false;
        if (hasOpenClaw) {
            builtInOk = await exec("OpenClaw builtin uninstall", "openclaw", [
                "uninstall",
                "--all",
                "--yes",
                "--non-interactive",
            ]);
        }
        if (process.platform === "darwin") {
            await (0, exec_1.runCommand)("bash", [
                "-lc",
                "launchctl bootout gui/$UID/ai.openclaw.gateway || true && rm -f ~/Library/LaunchAgents/ai.openclaw.gateway.plist",
            ]);
        }
        else if (process.platform === "linux") {
            await (0, exec_1.runCommand)("bash", [
                "-lc",
                "systemctl --user disable --now openclaw-gateway.service || true && rm -f ~/.config/systemd/user/openclaw-gateway.service && systemctl --user daemon-reload || true",
            ]);
        }
        else if (process.platform === "win32") {
            await (0, exec_1.runCommand)("cmd", ["/c", "schtasks /Delete /F /TN \"OpenClaw Gateway\""], {
                shell: true,
            });
            await (0, exec_1.runCommand)("powershell", [
                "-NoProfile",
                "-Command",
                "Remove-Item -Force \"$env:USERPROFILE\\.openclaw\\gateway.cmd\" -ErrorAction SilentlyContinue",
            ]);
        }
        const removeState = process.platform === "win32"
            ? await (0, exec_1.runCommand)("powershell", [
                "-NoProfile",
                "-Command",
                "Remove-Item -Recurse -Force \"$env:OPENCLAW_STATE_DIR\" -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force \"$env:USERPROFILE\\.openclaw\" -ErrorAction SilentlyContinue",
            ])
            : await (0, exec_1.runCommand)("bash", [
                "-lc",
                "rm -rf \"${OPENCLAW_STATE_DIR:-$HOME/.openclaw}\" \"$HOME/.openclaw/workspace\"",
            ]);
        add(removeState.stdout.trim());
        add(removeState.stderr.trim());
        const npmRemoved = await (0, exec_1.runCommand)("npm", ["rm", "-g", "openclaw"]);
        add(npmRemoved.stdout.trim());
        add(npmRemoved.stderr.trim());
        add(`(exit ${npmRemoved.code})`);
        const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
        if (await (0, platform_1.commandExists)("pnpm")) {
            const pnpmRemoved = await (0, exec_1.runCommand)(pnpmCmd, ["remove", "-g", "openclaw"]);
            add(pnpmRemoved.stdout.trim());
            add(pnpmRemoved.stderr.trim());
            add(`(exit ${pnpmRemoved.code})`);
            const pnpmUnlinked = await (0, exec_1.runCommand)(pnpmCmd, ["unlink", "--global", "openclaw"]);
            add(pnpmUnlinked.stdout.trim());
            add(pnpmUnlinked.stderr.trim());
            add(`(exit ${pnpmUnlinked.code})`);
        }
        const stillInstalledByNpm = await isOpenClawNpmInstalled();
        const stillUsable = await isOpenClawBinaryUsable();
        if (stillInstalledByNpm || stillUsable) {
            add(`Post-uninstall probe still detects OpenClaw (npmInstalled=${stillInstalledByNpm}, binaryUsable=${stillUsable}).`);
            return false;
        }
        return builtInOk || npmRemoved.code === 0 || !stillInstalledByNpm;
    };
    const startDetached = async (cmd, args, cwd) => {
        return await new Promise((resolve) => {
            try {
                const child = (0, node_child_process_1.spawn)(cmd, args, {
                    cwd,
                    detached: true,
                    stdio: "ignore",
                });
                let settled = false;
                const finish = (result) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolve(result);
                };
                child.once("spawn", () => {
                    child.unref();
                    finish({ ok: true });
                });
                child.once("error", (error) => {
                    finish({ ok: false, error: String(error) });
                });
            }
            catch (error) {
                resolve({ ok: false, error: String(error) });
            }
        });
    };
    /** Detached spawn with ~2.8s grace: fail if process exits early or is gone (captures stdout/stderr tail). */
    const startAutomationDetached = async (cmd, args, cwd, env = process.env) => {
        const logPath = (0, node_path_1.join)((0, node_os_1.tmpdir)(), `clawwrapper-automation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.log`);
        let logFd;
        try {
            logFd = (0, node_fs_1.openSync)(logPath, "a");
        }
        catch (error) {
            return { ok: false, error: String(error) };
        }
        const readLogTail = () => {
            try {
                const raw = (0, node_fs_1.readFileSync)(logPath, "utf8").trimEnd();
                if (!raw) {
                    return "";
                }
                const lines = raw.split("\n");
                return lines.slice(-20).join("\n");
            }
            catch {
                return "";
            }
        };
        let logFdClosed = false;
        const closeLogFdOnce = () => {
            if (logFdClosed) {
                return;
            }
            logFdClosed = true;
            try {
                (0, node_fs_1.closeSync)(logFd);
            }
            catch {
                // ignore
            }
        };
        const unlinkLogFile = () => {
            try {
                (0, node_fs_1.unlinkSync)(logPath);
            }
            catch {
                // ignore (e.g. Windows lock)
            }
        };
        const endLogSession = (keepLogFile) => {
            closeLogFdOnce();
            if (!keepLogFile) {
                unlinkLogFile();
            }
        };
        return await new Promise((resolve) => {
            let settled = false;
            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                endLogSession(!result.ok);
                resolve(result);
            };
            let child;
            try {
                child = (0, node_child_process_1.spawn)(cmd, args, {
                    cwd,
                    env,
                    detached: true,
                    stdio: ["ignore", logFd, logFd],
                });
            }
            catch (error) {
                endLogSession(true);
                resolve({ ok: false, error: String(error) + `\n(log file: ${logPath})` });
                return;
            }
            const graceMs = 2800;
            let exitTimer;
            const failWithTail = (headline) => {
                const tail = readLogTail();
                finish({
                    ok: false,
                    error: tail ? `${headline}\n---\n${tail}\n(log file: ${logPath})` : `${headline}\n(log file: ${logPath})`,
                });
            };
            child.once("error", (error) => {
                if (exitTimer !== undefined) {
                    clearTimeout(exitTimer);
                }
                finish({ ok: false, error: String(error) + `\n(log file: ${logPath})` });
            });
            child.once("spawn", () => {
                closeLogFdOnce();
                child.unref();
            });
            child.once("exit", (code, signal) => {
                if (exitTimer !== undefined) {
                    clearTimeout(exitTimer);
                }
                if (settled) {
                    return;
                }
                settled = true;
                const tail = readLogTail();
                endLogSession(true);
                const detail = code === 0 && !signal
                    ? "自动化进程在启动阶段已退出 (code=0)。若未看到 Playwright Chromium 窗口，请检查是否已执行 playwright install chromium。"
                    : `进程退出 (code=${code ?? "?"}, signal=${signal ?? "none"})。`;
                resolve({
                    ok: false,
                    error: tail ? `${detail}\n---\n${tail}\n(log file: ${logPath})` : `${detail}\n(log file: ${logPath})`,
                });
            });
            exitTimer = setTimeout(() => {
                if (settled) {
                    return;
                }
                const pid = child.pid;
                if (pid === undefined) {
                    failWithTail("无法获取子进程 PID。");
                    return;
                }
                try {
                    process.kill(pid, 0);
                    finish({ ok: true });
                }
                catch {
                    failWithTail("子进程在启动宽限期内已退出（可能缺少依赖或脚本报错）。");
                }
            }, graceMs);
        });
    };
    const installPlaywrightChromiumForProject = async (projectRoot, pnpmCmd, npxCmd, hasPnpm, hasNpx, env) => {
        const pnpmInstall = ["exec", "playwright", "install", "chromium"];
        const npxInstall = ["playwright", "install", "chromium"];
        const summarize = (r) => [r.stderr, r.stdout].map((s) => s.trim()).filter(Boolean).join("\n");
        const first = hasPnpm
            ? await (0, exec_1.runCommand)(pnpmCmd, pnpmInstall, { cwd: projectRoot, env })
            : await (0, exec_1.runCommand)(npxCmd, npxInstall, { cwd: projectRoot, env });
        if (first.code === 0) {
            return { ok: true, detail: "" };
        }
        const firstLog = summarize(first);
        if (hasPnpm && hasNpx) {
            const second = await (0, exec_1.runCommand)(npxCmd, npxInstall, { cwd: projectRoot, env });
            if (second.code === 0) {
                return { ok: true, detail: "" };
            }
            return {
                ok: false,
                detail: [summarize(second), firstLog].filter(Boolean).join("\n---\n"),
            };
        }
        return { ok: false, detail: firstLog || "playwright install chromium failed" };
    };
    if (["runGateway", "restartGateway", "openDashboard"].includes(action)) {
        const runtime = await detectRuntimeState();
        if (!runtime.openclawInstalled) {
            return {
                ok: false,
                title: "OpenClaw 未安装",
                logs: "OpenClaw 尚未安装，无法执行该操作。",
            };
        }
        if (!runtime.daemonReady) {
            return {
                ok: false,
                title: "请先完成 OpenClaw 配置",
                logs: "需要先执行 openclaw onboard --install-daemon。请先在控制页完成配置并保存。",
            };
        }
    }
    switch (action) {
        case "install": {
            const ok = await exec("Install OpenClaw", "npm", [
                "install",
                "-g",
                "openclaw@latest",
                "--verbose",
                "--progress=true",
            ]);
            if (!ok) {
                return { ok: false, title: "Install failed", logs: logs.join("\n") };
            }
            const response = { ok: true, title: "Install completed (no onboarding)", logs: logs.join("\n") };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "applyConfig": {
            const ok = await exec("Apply OpenClaw configuration", "openclaw", ["onboard", "--install-daemon"]);
            const response = { ok, title: ok ? "配置已应用" : "配置应用失败", logs: logs.join("\n") };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "uninstall": {
            const ok = await uninstallByPlatform();
            const response = {
                ok,
                title: ok ? "OpenClaw uninstall completed" : "OpenClaw uninstall may be incomplete",
                logs: logs.join("\n"),
            };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "update":
        case "fix": {
            if (maintenanceJob.running) {
                const response = {
                    ok: false,
                    title: "维护任务进行中",
                    logs: "已有升级/检查任务在运行，请稍候。",
                };
                debugLog("action-finish", { action, ok: response.ok, reason: "maintenance-busy" });
                return response;
            }
            const kind = action;
            const syncJob = {
                running: false,
                completed: true,
                ok: false,
                kind,
                progress: 0,
                title: "",
                logs: [],
                currentStep: "",
                currentCommand: "",
                currentPid: null,
                stepStartedAt: null,
                lastActivityAt: null,
                lastExitCode: null,
                lastExitSignal: null,
                lastFailureReason: "",
            };
            const appendSync = (line) => {
                const normalized = line.trim();
                if (!normalized) {
                    return;
                }
                syncJob.logs.push(normalized);
                if (syncJob.logs.length > 500) {
                    syncJob.logs = syncJob.logs.slice(-500);
                }
            };
            const response = await runMaintenancePipelineOnJob(syncJob, kind, appendSync);
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "status": {
            const ok = await exec("OpenClaw status", "openclaw", ["status"]);
            const response = { ok, title: ok ? "Status fetched" : "Status failed", logs: logs.join("\n") };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "openDashboard": {
            const ok = await exec("OpenClaw dashboard", "openclaw", ["dashboard"]);
            const response = { ok, title: ok ? "Dashboard opened" : "Dashboard open failed", logs: logs.join("\n") };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "feishuSetup": {
            const projectRoot = await resolveProjectRoot();
            const botName = (payload.botName ?? "").trim() || "OpenClaw 助手";
            const outputPath = (0, node_path_1.join)(process.env.HOME ?? ".", ".openclaw", "feishu-setup-result.json");
            const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
            const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
            const hasPnpm = await (0, platform_1.commandExists)("pnpm");
            const hasNpx = await (0, platform_1.commandExists)("npx");
            if (!hasPnpm && !hasNpx) {
                const response = {
                    ok: false,
                    title: "Feishu 配置启动失败",
                    logs: "未检测到 pnpm/npx，无法启动 Playwright 自动化浏览器。",
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const pwEnv = (0, githubTarballs_1.withPlaywrightAutomationEnv)(process.env);
            const pnpmPlaywrightCheck = hasPnpm
                ? await (0, exec_1.runCommand)(pnpmCmd, ["exec", "playwright", "--version"], { cwd: projectRoot, env: pwEnv })
                : { code: 1, stdout: "", stderr: "" };
            const npxPlaywrightCheck = hasNpx
                ? await (0, exec_1.runCommand)(npxCmd, ["playwright", "--version"], { cwd: projectRoot, env: pwEnv })
                : { code: 1, stdout: "", stderr: "" };
            const playwrightReady = pnpmPlaywrightCheck.code === 0 || npxPlaywrightCheck.code === 0;
            if (!playwrightReady) {
                const checkErr = [
                    (pnpmPlaywrightCheck.stderr || pnpmPlaywrightCheck.stdout || "").trim(),
                    (npxPlaywrightCheck.stderr || npxPlaywrightCheck.stdout || "").trim(),
                ]
                    .filter(Boolean)
                    .join("\n");
                const response = {
                    ok: false,
                    title: "Feishu 配置启动失败",
                    logs: "Playwright 不可用，自动化浏览器未启动。\n" + (checkErr || "Playwright check failed."),
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const chromiumInstall = await installPlaywrightChromiumForProject(projectRoot, pnpmCmd, npxCmd, hasPnpm, hasNpx, pwEnv);
            if (!chromiumInstall.ok) {
                const response = {
                    ok: false,
                    title: "Feishu 配置启动失败",
                    logs: "安装 Playwright Chromium 失败。默认使用 Playwright 官方多 CDN；若需国内镜像可设置 CLAW_WRAPPER_PLAYWRIGHT_DOWNLOAD_HOST，或 CLAW_WRAPPER_PLAYWRIGHT_USE_NPPMIRROR=1（镜像可能滞后导致 404）。\n" +
                        chromiumInstall.detail,
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const pnpmArgs = [
                "exec",
                "tsx",
                "./automation/feishu/runAutoSetup.ts",
                "--bot-name",
                botName,
                "--output",
                outputPath,
                "--headless",
                "false",
            ];
            const npxArgs = [
                "tsx",
                "./automation/feishu/runAutoSetup.ts",
                "--bot-name",
                botName,
                "--output",
                outputPath,
                "--headless",
                "false",
            ];
            const started = hasPnpm
                ? await startAutomationDetached(pnpmCmd, pnpmArgs, projectRoot, pwEnv)
                : await startAutomationDetached(npxCmd, npxArgs, projectRoot, pwEnv);
            if (!started.ok && hasPnpm && hasNpx) {
                const retry = await startAutomationDetached(npxCmd, npxArgs, projectRoot, pwEnv);
                if (!retry.ok) {
                    const response = {
                        ok: false,
                        title: "Feishu 配置启动失败",
                        logs: [started.error, retry.error].filter(Boolean).join("\n") || "无法启动 Feishu 自动化流程。",
                    };
                    debugLog("action-finish", { action, ok: response.ok });
                    return response;
                }
            }
            else if (!started.ok) {
                const response = {
                    ok: false,
                    title: "Feishu 配置启动失败",
                    logs: started.error ?? "无法启动 Feishu 自动化流程。",
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const response = {
                ok: true,
                title: "Feishu 自动化流程已启动",
                logs: `已启动独立 Playwright Chromium 窗口（飞书专用临时配置目录，与 OneThing 互不共享）。botName=${botName}\n` +
                    "请在弹出的 Chromium 窗口中完成飞书登录；登录后脚本会尝试创建应用、权限导入与机器人能力配置。\n" +
                    `结果文件: ${outputPath}`,
            };
            debugLog("action-finish", { action, ok: response.ok, botName });
            return response;
        }
        case "oneThingSetup": {
            const projectRoot = await resolveProjectRoot();
            const outputPath = (0, node_path_1.join)(process.env.HOME ?? ".", ".openclaw", "onething-setup-result.json");
            const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
            const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
            const hasPnpm = await (0, platform_1.commandExists)("pnpm");
            const hasNpx = await (0, platform_1.commandExists)("npx");
            if (!hasPnpm && !hasNpx) {
                const response = {
                    ok: false,
                    title: "OneThingAI 引导启动失败",
                    logs: "未检测到 pnpm/npx，无法启动 Playwright 自动化浏览器。",
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const pwEnv = (0, githubTarballs_1.withPlaywrightAutomationEnv)(process.env);
            const pnpmPlaywrightCheck = hasPnpm
                ? await (0, exec_1.runCommand)(pnpmCmd, ["exec", "playwright", "--version"], { cwd: projectRoot, env: pwEnv })
                : { code: 1, stdout: "", stderr: "" };
            const npxPlaywrightCheck = hasNpx
                ? await (0, exec_1.runCommand)(npxCmd, ["playwright", "--version"], { cwd: projectRoot, env: pwEnv })
                : { code: 1, stdout: "", stderr: "" };
            const playwrightReady = pnpmPlaywrightCheck.code === 0 || npxPlaywrightCheck.code === 0;
            if (!playwrightReady) {
                const checkErr = [
                    (pnpmPlaywrightCheck.stderr || pnpmPlaywrightCheck.stdout || "").trim(),
                    (npxPlaywrightCheck.stderr || npxPlaywrightCheck.stdout || "").trim(),
                ]
                    .filter(Boolean)
                    .join("\n");
                const response = {
                    ok: false,
                    title: "OneThingAI 引导启动失败",
                    logs: "Playwright 不可用，自动化浏览器未启动。\n" + (checkErr || "Playwright check failed."),
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const chromiumInstall = await installPlaywrightChromiumForProject(projectRoot, pnpmCmd, npxCmd, hasPnpm, hasNpx, pwEnv);
            if (!chromiumInstall.ok) {
                const response = {
                    ok: false,
                    title: "OneThingAI 引导启动失败",
                    logs: "安装 Playwright Chromium 失败。默认使用 Playwright 官方多 CDN；若需国内镜像可设置 CLAW_WRAPPER_PLAYWRIGHT_DOWNLOAD_HOST，或 CLAW_WRAPPER_PLAYWRIGHT_USE_NPPMIRROR=1（镜像可能滞后导致 404）。\n" +
                        chromiumInstall.detail,
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const pnpmArgs = [
                "exec",
                "tsx",
                "./automation/onething/runAutoSetup.ts",
                "--output",
                outputPath,
                "--headless",
                "false",
            ];
            const npxArgs = [
                "tsx",
                "./automation/onething/runAutoSetup.ts",
                "--output",
                outputPath,
                "--headless",
                "false",
            ];
            const started = hasPnpm
                ? await startAutomationDetached(pnpmCmd, pnpmArgs, projectRoot, pwEnv)
                : await startAutomationDetached(npxCmd, npxArgs, projectRoot, pwEnv);
            if (!started.ok && hasPnpm && hasNpx) {
                const retry = await startAutomationDetached(npxCmd, npxArgs, projectRoot, pwEnv);
                if (!retry.ok) {
                    const response = {
                        ok: false,
                        title: "OneThingAI 引导启动失败",
                        logs: [started.error, retry.error].filter(Boolean).join("\n") || "无法启动 OneThingAI 自动化流程。",
                    };
                    debugLog("action-finish", { action, ok: response.ok });
                    return response;
                }
            }
            else if (!started.ok) {
                const response = {
                    ok: false,
                    title: "OneThingAI 引导启动失败",
                    logs: started.error ?? "无法启动 OneThingAI 自动化流程。",
                };
                debugLog("action-finish", { action, ok: response.ok });
                return response;
            }
            const response = {
                ok: true,
                title: "OneThingAI 引导已启动",
                logs: "已启动独立 Playwright Chromium 窗口（OneThing 专用临时配置目录，与飞书互不共享）。注册/登录后将尝试进入 API Keys 并创建 Key。\n" +
                    `结果文件: ${outputPath}`,
            };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "runGateway": {
            const started = await startDetached("openclaw", ["gateway", "run"]);
            const response = started.ok
                ? { ok: true, title: "Gateway started", logs: "Started `openclaw gateway run` in background." }
                : { ok: false, title: "Gateway 启动失败", logs: started.error ?? "无法启动 `openclaw gateway run`。" };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "restartGateway": {
            await exec("Stop gateway", "openclaw", ["daemon", "stop"]);
            const ok = await exec("Restart gateway", "openclaw", ["onboard", "--install-daemon"]);
            const response = { ok, title: ok ? "Gateway restarted" : "Gateway restart failed", logs: logs.join("\n") };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        case "skillInstall": {
            const pkg = (payload.packageName ?? "").trim();
            if (!pkg) {
                return { ok: false, title: "Skill install failed", logs: "Package name is required." };
            }
            const ok = await exec("Install skill plugin", "openclaw", ["plugins", "install", pkg]);
            const response = { ok, title: ok ? "Skill installed" : "Skill install failed", logs: logs.join("\n") };
            debugLog("action-finish", { action, ok: response.ok });
            return response;
        }
        default:
            debugLog("action-unknown", { action });
            return { ok: false, title: "Unknown action", logs: `Unsupported action: ${action}` };
    }
}
async function isOpenClawNpmInstalled() {
    // Primary check: ask npm whether the openclaw package is globally installed.
    // This is the most reliable signal – immune to leftover symlinks / stubs.
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const npmList = await (0, exec_1.runCommand)(npmCmd, ["list", "-g", "openclaw", "--depth=0", "--json"]);
    if (npmList.code === 0) {
        try {
            const parsed = JSON.parse(npmList.stdout);
            const deps = parsed?.dependencies ?? {};
            if (deps.openclaw) {
                debugLog("detect-state: npm list confirms openclaw installed", { version: deps.openclaw.version ?? "unknown" });
                return true;
            }
        }
        catch {
            // JSON parse failed – fall through to secondary checks
        }
    }
    // Also check with the user-local prefix in case npm was configured with --prefix ~/.npm-global
    const home = process.env.HOME ?? "";
    if (home && process.platform !== "win32") {
        const userPrefix = `${home}/.npm-global`;
        const userNpmList = await (0, exec_1.runCommand)(npmCmd, ["list", "-g", "openclaw", "--depth=0", "--json", "--prefix", userPrefix]);
        if (userNpmList.code === 0) {
            try {
                const parsed = JSON.parse(userNpmList.stdout);
                const deps = parsed?.dependencies ?? {};
                if (deps.openclaw) {
                    debugLog("detect-state: npm list (user prefix) confirms openclaw installed", { version: deps.openclaw.version ?? "unknown" });
                    return true;
                }
            }
            catch {
                // fall through
            }
        }
    }
    debugLog("detect-state: npm list did not find openclaw in any global prefix");
    return false;
}
async function getOpenClawBinaryCandidates() {
    const home = process.env.HOME ?? "";
    const candidates = new Set();
    const names = process.platform === "win32"
        ? ["openclaw.cmd", "openclaw.exe", "openclaw.bat"]
        : ["openclaw"];
    const addDir = (dir) => {
        if (!dir) {
            return;
        }
        for (const name of names) {
            candidates.add(`${dir}${process.platform === "win32" ? "\\" : "/"}${name}`);
        }
    };
    if (process.platform === "darwin") {
        addDir(`${home}/Library/pnpm`);
        addDir(`${home}/.npm-global/bin`);
        addDir(`${home}/.local/bin`);
    }
    else if (process.platform === "win32") {
        addDir(`${process.env.LOCALAPPDATA ?? ""}\\pnpm`);
        addDir(`${process.env.APPDATA ?? ""}\\npm`);
    }
    else {
        addDir(`${home}/.local/share/pnpm`);
        addDir(`${home}/.npm-global/bin`);
        addDir(`${home}/.local/bin`);
    }
    if (await (0, platform_1.commandExists)("npm")) {
        const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
        const prefix = await (0, exec_1.runCommand)(npmCmd, ["config", "get", "prefix"]);
        const dir = prefix.stdout.trim();
        if (dir) {
            addDir(process.platform === "win32" ? dir : `${dir}/bin`);
        }
    }
    return Array.from(candidates);
}
async function resolveOpenClawCommand() {
    addCommonUserBinDirsToPath();
    if (await (0, platform_1.commandExists)("openclaw")) {
        return "openclaw";
    }
    await refreshProcessPathFromLoginShell();
    addCommonUserBinDirsToPath();
    if (await (0, platform_1.commandExists)("openclaw")) {
        return "openclaw";
    }
    for (const candidate of await getOpenClawBinaryCandidates()) {
        if (await (0, source_1.pathExists)(candidate)) {
            return candidate;
        }
    }
    return null;
}
async function isOpenClawBinaryUsable() {
    const openclawCmd = await resolveOpenClawCommand();
    if (!openclawCmd) {
        return false;
    }
    process.env.OPENCLAW_RESOLVED_CMD = openclawCmd;
    const probe = await (0, exec_1.runCommand)(openclawCmd, ["--version"]);
    return isHealthyOpenClawProbe(probe);
}
async function isDaemonReady(binaryUsable) {
    if (!binaryUsable) {
        return false;
    }
    const openclawCmd = process.env.OPENCLAW_RESOLVED_CMD || "openclaw";
    const status = await (0, exec_1.runCommand)(openclawCmd, ["status"]);
    const text = `${status.stdout}\n${status.stderr}`.toLowerCase();
    if (status.code !== 0) {
        return false;
    }
    if (/(onboard --install-daemon|daemon not installed|daemon is not installed|daemon not configured|not configured|未安装.*daemon|请先.*install-daemon)/i
        .test(text)) {
        return false;
    }
    if (/(daemon|gateway|service|launchagent|systemd|scheduler|running|active|installed|已安装|已配置|运行中)/i.test(text)) {
        return true;
    }
    return false;
}
async function isGatewayProcessRunning() {
    try {
        if (process.platform === "win32") {
            const ps = await (0, exec_1.runCommand)("powershell", [
                "-NoProfile",
                "-Command",
                "$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'openclaw\\s+gateway\\s+run' }; if ($p) { exit 0 } else { exit 1 }",
            ]);
            return ps.code === 0;
        }
        const probe = await (0, exec_1.runCommand)("bash", [
            "-lc",
            "ps -ax -o command | awk '/openclaw gateway run/ {found=1} END{exit found?0:1}'",
        ]);
        return probe.code === 0;
    }
    catch {
        return false;
    }
}
async function isGatewayPortReady() {
    const curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
    const hasCurl = await (0, platform_1.commandExists)(curlCmd);
    if (!hasCurl) {
        return false;
    }
    const probe = await (0, exec_1.runCommand)(curlCmd, ["--silent", "--show-error", "--max-time", "2", "http://127.0.0.1:18789"]);
    return probe.code === 0;
}
async function detectRuntimeState() {
    // Use npm list as the primary, authoritative check for installation.
    const npmInstalled = await isOpenClawNpmInstalled();
    // Also check if the binary is usable in PATH (covers non-npm installs)
    const binaryUsable = await isOpenClawBinaryUsable();
    const openclawInstalled = npmInstalled || binaryUsable;
    const daemonReady = await isDaemonReady(binaryUsable);
    debugLog("detect-state", { npmInstalled, binaryUsable, openclawInstalled, daemonReady });
    if (!openclawInstalled) {
        return { openclawInstalled: false, daemonReady: false, gatewayRunning: false };
    }
    if (!daemonReady) {
        return { openclawInstalled: true, daemonReady: false, gatewayRunning: false };
    }
    const processRunning = await isGatewayProcessRunning();
    const portReady = await isGatewayPortReady();
    const gatewayRunning = processRunning && portReady;
    debugLog("detect-state-gateway", { processRunning, portReady, gatewayRunning });
    return { openclawInstalled, daemonReady, gatewayRunning };
}
function appendInstallLog(text) {
    const normalized = text.trim();
    if (!normalized) {
        return;
    }
    installJob.logs.push(normalized);
    if (installJob.logs.length > 500) {
        installJob.logs = installJob.logs.slice(-500);
    }
}
function appendMaintenanceLog(text) {
    const normalized = text.trim();
    if (!normalized) {
        return;
    }
    maintenanceJob.logs.push(normalized);
    if (maintenanceJob.logs.length > 500) {
        maintenanceJob.logs = maintenanceJob.logs.slice(-500);
    }
}
function tailText(text, maxLines = 160, maxChars = 10000) {
    if (!text.trim()) {
        return "";
    }
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const tailLines = lines.slice(-maxLines).join("\n");
    if (tailLines.length <= maxChars) {
        return tailLines;
    }
    return tailLines.slice(-maxChars);
}
function extractNpmDebugLogPath(text) {
    const singleLine = text.match(/A complete log of this run can be found in:\s*(\S+)/i);
    if (singleLine?.[1]) {
        return singleLine[1].trim();
    }
    const multiline = text.match(/A complete log of this run can be found in:\s*\r?\n\s*(\S+)/i);
    if (multiline?.[1]) {
        return multiline[1].trim();
    }
    return null;
}
async function appendNpmDebugLogTailToAppender(output, appendLog) {
    const debugLogPath = extractNpmDebugLogPath(output);
    if (!debugLogPath) {
        return;
    }
    appendLog(`检测到 npm debug 日志: ${debugLogPath}`);
    try {
        const content = await (0, promises_1.readFile)(debugLogPath, "utf8");
        const snippet = tailText(content, 140, 9000);
        if (snippet) {
            appendLog("npm debug log tail:");
            appendLog(snippet);
        }
    }
    catch (error) {
        appendLog(`读取 npm debug 日志失败: ${String(error)}`);
    }
}
async function appendNpmDebugLogTail(output) {
    await appendNpmDebugLogTailToAppender(output, appendInstallLog);
}
function parsePercentFromOutput(text) {
    const matches = [...text.matchAll(/(\d{1,3})%/g)];
    if (matches.length === 0) {
        return null;
    }
    const value = Number.parseInt(matches[matches.length - 1]?.[1] ?? "", 10);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
        return null;
    }
    return value;
}
function parseNpmProgressFromOutput(text) {
    const lower = text.toLowerCase();
    // npm often omits explicit percentages in non-TTY mode; infer coarse progress from lifecycle logs.
    if (/npm verbose cli|npm info using/.test(lower)) {
        return 5;
    }
    if (/idealtree/.test(lower)) {
        return 20;
    }
    if (/fetch|get 20\d|packumentcache/.test(lower)) {
        return 35;
    }
    if (/reify|audit/.test(lower)) {
        return 60;
    }
    if (/added\s+\d+\s+packages?|changed\s+\d+\s+packages?|removed\s+\d+\s+packages?/.test(lower)) {
        return 90;
    }
    return null;
}
async function runInstallStep(cmd, args, options = {}) {
    return await new Promise((resolve) => {
        const commandText = `${cmd} ${args.join(" ")}`.trim();
        const stepName = options.stepName ?? commandText;
        const isPackageInstallStep = /\b(npm|pnpm)\s+install\b/i.test(stepName);
        const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
        const useSyntheticProgress = options.useSyntheticProgress ?? false;
        debugLog("install-step-start", { cmd, args, stepName, timeoutMs, useSyntheticProgress });
        appendInstallLog(`$ ${commandText}`);
        installJob.currentStep = stepName;
        installJob.currentCommand = commandText;
        installJob.stepStartedAt = Date.now();
        installJob.lastActivityAt = Date.now();
        installJob.title = `正在执行: ${commandText}`;
        let child;
        try {
            child = (0, node_child_process_1.spawn)(cmd, args, {
                shell: false,
                detached: process.platform !== "win32",
                env: options.env ?? process.env,
                cwd: options.cwd ?? process.cwd(),
            });
        }
        catch (error) {
            const reason = `启动失败: ${String(error)}`;
            appendInstallLog(reason);
            installJob.lastFailureReason = reason;
            installJob.currentPid = null;
            installJob.lastExitCode = null;
            installJob.lastExitSignal = null;
            debugLog("install-step-spawn-throw", { cmd, args, error: String(error) });
            resolve(false);
            return;
        }
        installChild = child;
        installJob.currentPid = child.pid ?? null;
        installJob.lastFailureReason = "";
        let stderrBuffer = "";
        let stdoutBuffer = "";
        let settled = false;
        const stepStartedAt = Date.now();
        let lastActivityAt = Date.now();
        const inactivityTimeoutMs = options.inactivityTimeoutMs ?? 0;
        const finish = (ok) => {
            if (settled) {
                return;
            }
            settled = true;
            clearInterval(progressTicker);
            clearTimeout(stepTimeout);
            resolve(ok && !installJob.canceled);
        };
        const onChunk = (chunk, source) => {
            const text = chunk.toString();
            const parsed = parsePercentFromOutput(text);
            if (parsed !== null) {
                installJob.progress = Math.max(installJob.progress, parsed);
            }
            else if (isPackageInstallStep) {
                const inferred = parseNpmProgressFromOutput(text);
                if (inferred !== null) {
                    installJob.progress = Math.max(installJob.progress, inferred);
                }
            }
            if (text.trim()) {
                lastActivityAt = Date.now();
                installJob.lastActivityAt = lastActivityAt;
            }
            if (source === "stdout") {
                stdoutBuffer += text;
            }
            else {
                stderrBuffer += text;
            }
            const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            for (const line of lines) {
                appendInstallLog(line);
            }
        };
        const progressTicker = setInterval(() => {
            if (installJob.canceled) {
                return;
            }
            if (inactivityTimeoutMs > 0 && Date.now() - lastActivityAt > inactivityTimeoutMs) {
                const elapsedSec = Math.floor((Date.now() - stepStartedAt) / 1000);
                const idleSec = Math.floor((Date.now() - lastActivityAt) / 1000);
                const reason = `步骤无输出超时(${idleSec}s): ${commandText} (pid=${child.pid ?? "unknown"}, elapsed=${elapsedSec}s)`;
                appendInstallLog(reason);
                installJob.lastFailureReason = reason;
                debugLog("install-step-inactivity-timeout", {
                    cmd,
                    args,
                    pid: child.pid ?? 0,
                    elapsedSec,
                    idleSec,
                });
                try {
                    if (process.platform === "win32" && child.pid) {
                        void (0, exec_1.runCommand)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
                    }
                    else if (child.pid) {
                        process.kill(-child.pid, "SIGTERM");
                    }
                }
                catch {
                    // ignore
                }
                finish(false);
                return;
            }
            if (useSyntheticProgress && installJob.progress < 99) {
                installJob.progress = Math.max(installJob.progress, installJob.progress + 1);
            }
        }, 2000);
        const stepTimeout = setTimeout(() => {
            const reason = `步骤超时: ${commandText}`;
            appendInstallLog(reason);
            installJob.lastFailureReason = reason;
            debugLog("install-step-timeout", { cmd, args });
            try {
                if (process.platform === "win32") {
                    void (0, exec_1.runCommand)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
                }
                else if (child.pid) {
                    process.kill(-child.pid, "SIGTERM");
                }
            }
            catch {
                // ignore
            }
            finish(false);
        }, timeoutMs);
        child.stdout?.on("data", (chunk) => onChunk(chunk, "stdout"));
        child.stderr?.on("data", (chunk) => onChunk(chunk, "stderr"));
        child.on("error", (error) => {
            const reason = `启动失败: ${String(error)}`;
            appendInstallLog(reason);
            installJob.lastFailureReason = reason;
            debugLog("install-step-error", { cmd, args, error: String(error) });
            installChild = null;
            installJob.currentPid = null;
            installJob.lastExitCode = null;
            installJob.lastExitSignal = null;
            finish(false);
        });
        child.on("close", async (code, signal) => {
            debugLog("install-step-close", { cmd, args, code, signal });
            installChild = null;
            installJob.currentPid = null;
            installJob.lastExitCode = code ?? null;
            installJob.lastExitSignal = signal ?? null;
            if (code !== 0 && !installJob.canceled) {
                const reason = `命令失败: ${commandText} (exit=${code ?? "null"}, signal=${signal ?? "none"})`;
                installJob.lastFailureReason = reason;
                appendInstallLog(reason);
                const stderrTail = tailText(stderrBuffer);
                const stdoutTail = tailText(stdoutBuffer);
                if (stderrTail) {
                    appendInstallLog("stderr tail:");
                    appendInstallLog(stderrTail);
                }
                if (stdoutTail) {
                    appendInstallLog("stdout tail:");
                    appendInstallLog(stdoutTail);
                }
                if (!stderrTail && !stdoutTail) {
                    appendInstallLog("未捕获到结构化错误输出，已回退到原始命令失败提示。");
                }
                if (/(^|\s)(npm|npm\.cmd)(\s|$)/i.test(commandText)) {
                    await appendNpmDebugLogTail(`${stdoutBuffer}\n${stderrBuffer}`);
                }
            }
            finish(code === 0);
        });
    });
}
async function runMaintenanceStep(cmd, args, job, appendLog, options = {}) {
    return await new Promise((resolve) => {
        const commandText = `${cmd} ${args.join(" ")}`.trim();
        const stepName = options.stepName ?? commandText;
        const isPackageInstallStep = /\b(npm|pnpm)\s+install\b/i.test(stepName);
        const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
        const useSyntheticProgress = options.useSyntheticProgress ?? false;
        debugLog("maintenance-step-start", { cmd, args, stepName, timeoutMs, useSyntheticProgress });
        appendLog(`$ ${commandText}`);
        job.currentStep = stepName;
        job.currentCommand = commandText;
        job.stepStartedAt = Date.now();
        job.lastActivityAt = Date.now();
        job.title = `正在执行: ${commandText}`;
        let child;
        try {
            child = (0, node_child_process_1.spawn)(cmd, args, {
                shell: false,
                detached: process.platform !== "win32",
                env: options.env ?? process.env,
                cwd: options.cwd ?? process.cwd(),
            });
        }
        catch (error) {
            const reason = `启动失败: ${String(error)}`;
            appendLog(reason);
            job.lastFailureReason = reason;
            job.currentPid = null;
            job.lastExitCode = null;
            job.lastExitSignal = null;
            debugLog("maintenance-step-spawn-throw", { cmd, args, error: String(error) });
            resolve(false);
            return;
        }
        job.currentPid = child.pid ?? null;
        job.lastFailureReason = "";
        let stderrBuffer = "";
        let stdoutBuffer = "";
        let settled = false;
        const stepStartedAt = Date.now();
        let lastActivityAt = Date.now();
        const inactivityTimeoutMs = options.inactivityTimeoutMs ?? 0;
        const finish = (ok) => {
            if (settled) {
                return;
            }
            settled = true;
            clearInterval(progressTicker);
            clearTimeout(stepTimeout);
            resolve(ok);
        };
        const onChunk = (chunk, source) => {
            const text = chunk.toString();
            const parsed = parsePercentFromOutput(text);
            if (parsed !== null) {
                job.progress = Math.max(job.progress, parsed);
            }
            else if (isPackageInstallStep) {
                const inferred = parseNpmProgressFromOutput(text);
                if (inferred !== null) {
                    job.progress = Math.max(job.progress, inferred);
                }
            }
            if (text.trim()) {
                lastActivityAt = Date.now();
                job.lastActivityAt = lastActivityAt;
            }
            if (source === "stdout") {
                stdoutBuffer += text;
            }
            else {
                stderrBuffer += text;
            }
            const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            for (const line of lines) {
                appendLog(line);
            }
        };
        const progressTicker = setInterval(() => {
            if (inactivityTimeoutMs > 0 && Date.now() - lastActivityAt > inactivityTimeoutMs) {
                const elapsedSec = Math.floor((Date.now() - stepStartedAt) / 1000);
                const idleSec = Math.floor((Date.now() - lastActivityAt) / 1000);
                const reason = `步骤无输出超时(${idleSec}s): ${commandText} (pid=${child.pid ?? "unknown"}, elapsed=${elapsedSec}s)`;
                appendLog(reason);
                job.lastFailureReason = reason;
                debugLog("maintenance-step-inactivity-timeout", {
                    cmd,
                    args,
                    pid: child.pid ?? 0,
                    elapsedSec,
                    idleSec,
                });
                try {
                    if (process.platform === "win32" && child.pid) {
                        void (0, exec_1.runCommand)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
                    }
                    else if (child.pid) {
                        process.kill(-child.pid, "SIGTERM");
                    }
                }
                catch {
                    // ignore
                }
                finish(false);
                return;
            }
            if (useSyntheticProgress && job.progress < 99) {
                job.progress = Math.max(job.progress, job.progress + 1);
            }
        }, 2000);
        const stepTimeout = setTimeout(() => {
            const reason = `步骤超时: ${commandText}`;
            appendLog(reason);
            job.lastFailureReason = reason;
            debugLog("maintenance-step-timeout", { cmd, args });
            try {
                if (process.platform === "win32") {
                    void (0, exec_1.runCommand)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
                }
                else if (child.pid) {
                    process.kill(-child.pid, "SIGTERM");
                }
            }
            catch {
                // ignore
            }
            finish(false);
        }, timeoutMs);
        child.stdout?.on("data", (chunk) => onChunk(chunk, "stdout"));
        child.stderr?.on("data", (chunk) => onChunk(chunk, "stderr"));
        child.on("error", (error) => {
            const reason = `启动失败: ${String(error)}`;
            appendLog(reason);
            job.lastFailureReason = reason;
            debugLog("maintenance-step-error", { cmd, args, error: String(error) });
            job.currentPid = null;
            job.lastExitCode = null;
            job.lastExitSignal = null;
            finish(false);
        });
        child.on("close", async (code, signal) => {
            debugLog("maintenance-step-close", { cmd, args, code, signal });
            job.currentPid = null;
            job.lastExitCode = code ?? null;
            job.lastExitSignal = signal ?? null;
            if (code !== 0) {
                const reason = `命令失败: ${commandText} (exit=${code ?? "null"}, signal=${signal ?? "none"})`;
                job.lastFailureReason = reason;
                appendLog(reason);
                const stderrTail = tailText(stderrBuffer);
                const stdoutTail = tailText(stdoutBuffer);
                if (stderrTail) {
                    appendLog("stderr tail:");
                    appendLog(stderrTail);
                }
                if (stdoutTail) {
                    appendLog("stdout tail:");
                    appendLog(stdoutTail);
                }
                if (!stderrTail && !stdoutTail) {
                    appendLog("未捕获到结构化错误输出，已回退到原始命令失败提示。");
                }
                if (/(^|\s)(npm|npm\.cmd)(\s|$)/i.test(commandText)) {
                    await appendNpmDebugLogTailToAppender(`${stdoutBuffer}\n${stderrBuffer}`, appendLog);
                }
            }
            finish(code === 0);
        });
    });
}
async function runMaintenancePipelineOnJob(job, kind, appendLog) {
    job.progress = Math.max(job.progress, 1);
    job.lastFailureReason = "";
    if (kind === "update") {
        appendLog(`使用镜像源: ${githubTarballs_1.DEFAULT_NPM_REGISTRY}`);
        const mirrorEnv = (0, githubTarballs_1.withMirrorRegistry)();
        const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
        const ok = await runMaintenanceStep(npmCmd, ["install", "-g", "openclaw@latest", "--verbose", "--progress=true"], job, appendLog, { env: mirrorEnv, stepName: "npm install -g openclaw@latest", inactivityTimeoutMs: 10 * 60 * 1000 });
        return { ok, title: ok ? "Update completed" : "Update failed", logs: job.logs.join("\n") };
    }
    const doctorOk = await runMaintenanceStep("openclaw", ["doctor"], job, appendLog, { stepName: "openclaw doctor" });
    if (!doctorOk) {
        return { ok: false, title: "Fix checks found issues", logs: job.logs.join("\n") };
    }
    const statusOk = await runMaintenanceStep("openclaw", ["status"], job, appendLog, { stepName: "openclaw status" });
    const ok = statusOk;
    return { ok, title: ok ? "Fix checks completed" : "Fix checks found issues", logs: job.logs.join("\n") };
}
function startMaintenanceJob(kind) {
    if (installJob.running || uninstallJob.running || maintenanceJob.running) {
        debugLog("maintenance-job-start-skip", {
            installRunning: installJob.running,
            uninstallRunning: uninstallJob.running,
            maintenanceRunning: maintenanceJob.running,
        });
        return false;
    }
    maintenanceJob = {
        running: true,
        completed: false,
        ok: false,
        kind,
        progress: 0,
        title: kind === "update" ? "正在升级 OpenClaw" : "正在执行自动修复检查",
        logs: [kind === "update" ? "开始升级 OpenClaw..." : "开始自动修复检查..."],
        currentStep: "preflight",
        currentCommand: "",
        currentPid: null,
        stepStartedAt: Date.now(),
        lastActivityAt: Date.now(),
        lastExitCode: null,
        lastExitSignal: null,
        lastFailureReason: "",
    };
    debugLog("maintenance-job-started", { kind });
    void (async () => {
        try {
            const result = await runMaintenancePipelineOnJob(maintenanceJob, kind, appendMaintenanceLog);
            maintenanceJob.ok = result.ok;
            maintenanceJob.title = result.title;
            maintenanceJob.completed = true;
            maintenanceJob.running = false;
            maintenanceJob.progress = result.ok ? 100 : Math.max(maintenanceJob.progress, 1);
            maintenanceJob.currentStep = "completed";
            maintenanceJob.currentPid = null;
            if (result.ok) {
                maintenanceJob.lastFailureReason = "";
            }
            else if (!maintenanceJob.lastFailureReason) {
                maintenanceJob.lastFailureReason = result.title;
            }
            debugLog("maintenance-job-finished", { ok: result.ok, kind });
        }
        catch (error) {
            maintenanceJob.running = false;
            maintenanceJob.completed = true;
            maintenanceJob.ok = false;
            maintenanceJob.progress = 100;
            maintenanceJob.title = "Maintenance failed";
            maintenanceJob.currentStep = "failed";
            maintenanceJob.currentPid = null;
            maintenanceJob.lastFailureReason = String(error);
            appendMaintenanceLog(`维护任务异常: ${String(error)}`);
            debugLog("maintenance-job-error", { kind, error: String(error) });
        }
    })();
    return true;
}
async function terminateInstallChild() {
    const child = installChild;
    if (!child?.pid) {
        return;
    }
    if (process.platform === "win32") {
        const pid = String(child.pid);
        await (0, exec_1.runCommand)("taskkill", ["/PID", pid, "/T", "/F"]);
        return;
    }
    try {
        process.kill(-child.pid, "SIGTERM");
    }
    catch {
        try {
            child.kill("SIGTERM");
        }
        catch {
            return;
        }
    }
    setTimeout(() => {
        const current = installChild;
        if (!current?.pid) {
            return;
        }
        try {
            process.kill(-current.pid, "SIGKILL");
        }
        catch {
            try {
                current.kill("SIGKILL");
            }
            catch {
                // ignore
            }
        }
    }, 1500);
}
function startInstallJob() {
    if (installJob.running) {
        debugLog("install-job-start-skip", { reason: "already-running" });
        return false;
    }
    if (maintenanceJob.running) {
        debugLog("install-job-start-skip", { reason: "maintenance-running" });
        return false;
    }
    installJob = {
        running: true,
        completed: false,
        ok: false,
        canceled: false,
        progress: 0,
        title: "正在安装 OpenClaw",
        logs: ["开始安装 OpenClaw..."],
        currentStep: "preflight",
        currentCommand: "",
        currentPid: null,
        stepStartedAt: Date.now(),
        lastActivityAt: Date.now(),
        lastExitCode: null,
        lastExitSignal: null,
        lastFailureReason: "",
    };
    debugLog("install-job-started");
    const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    let sourceDir = "";
    let activeSourceRef = source_1.OPENCLAW_PINNED_REF;
    let mirrorEnv = (0, githubTarballs_1.withMirrorRegistry)();
    void (async () => {
        appendInstallLog(`使用镜像源: ${githubTarballs_1.DEFAULT_NPM_REGISTRY}`);
        const stableSource = await (0, source_1.ensureStableOpenClawSource)(appendInstallLog);
        if (!stableSource.ok) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（缺少本地源码）";
            installJob.lastFailureReason = stableSource.message ?? `未找到本地源码: ${source_1.LOCAL_OPENCLAW_SOURCE_RELATIVE}`;
            appendInstallLog(stableSource.message ?? `未找到本地源码目录 ${source_1.LOCAL_OPENCLAW_SOURCE_RELATIVE}。`);
            appendInstallLog("请先将 OpenClaw 源码放到 vendor/openclaw，再点击安装。");
            return;
        }
        sourceDir = stableSource.sourceDir;
        appendInstallLog(`稳定安装目录: ${sourceDir}`);
        const sourcePrepared = await (0, source_1.preparePinnedOpenClawSource)(sourceDir, source_1.OPENCLAW_PINNED_REF, appendInstallLog);
        if (!sourcePrepared.ok) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（源码版本不匹配）";
            installJob.lastFailureReason = sourcePrepared.message ?? "源码版本校验失败";
            appendInstallLog(`已固定 OpenClaw 版本: ${source_1.OPENCLAW_PINNED_REF}`);
            appendInstallLog(sourcePrepared.message ?? "源码版本校验失败");
            appendInstallLog("请修复源码版本后重试，或重新执行 clone/checkout 到已验证版本。");
            return;
        }
        activeSourceRef = sourcePrepared.resolvedRef;
        if (sourcePrepared.fallbackUsed) {
            appendInstallLog(`Pinned ref ${source_1.OPENCLAW_PINNED_REF} 不可用，已回退到稳定版本 ${sourcePrepared.resolvedRef}。`);
        }
        appendInstallLog(`源码版本已确认: ${activeSourceRef} (${sourcePrepared.pinnedCommit.slice(0, 8)})`);
        const missingFiles = await (0, source_1.verifyOpenClawSourcePreflight)(sourceDir);
        if (missingFiles.length > 0) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（源码预检）";
            installJob.lastFailureReason = `源码缺少必要文件: ${missingFiles.join(", ")}`;
            appendInstallLog(`源码预检失败，缺少文件: ${missingFiles.join(", ")}`);
            return;
        }
        const hasPnpm = await ensurePnpmAvailable(appendInstallLog);
        if (!hasPnpm) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（pnpm 不可用）";
            installJob.lastFailureReason = "pnpm bootstrap failed";
            appendInstallLog("pnpm 不可用，corepack/npm 引导均失败。");
            debugLog("install-job-finished", { ok: false, phase: "pnpm-bootstrap", canceled: installJob.canceled });
            return;
        }
        mirrorEnv = await ensurePnpmGlobalBinConfigured(appendInstallLog);
        const githubTarballs = await (0, githubTarballs_1.prepareGithubTarballsForInstall)(sourceDir);
        if (!githubTarballs.ok) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（GitHub tarball 缺失）";
            installJob.lastFailureReason = githubTarballs.error ?? "github tarball bundle not ready";
            appendInstallLog(githubTarballs.error ?? "GitHub tarball bundle preparation failed.");
            return;
        }
        if (githubTarballs.files.length > 0) {
            appendInstallLog(`检测到 ${githubTarballs.files.length} 个 GitHub tarball，本地注入 pnpm store...`);
            for (const file of githubTarballs.files) {
                const seeded = await runInstallStep(pnpmCmd, ["store", "add", file], { cwd: sourceDir, inactivityTimeoutMs: 3 * 60 * 1000, stepName: `pnpm store add ${file}`, env: mirrorEnv });
                if (!seeded) {
                    installJob.running = false;
                    installJob.completed = true;
                    installJob.ok = false;
                    installJob.title = "安装失败（GitHub tarball 注入）";
                    return;
                }
            }
        }
        installJob.progress = Math.max(installJob.progress, 10);
        const depOk = await runInstallStep(pnpmCmd, ["install"], { cwd: sourceDir, inactivityTimeoutMs: 10 * 60 * 1000, stepName: "pnpm install", env: mirrorEnv });
        if (!depOk) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（依赖安装）";
            return;
        }
        installJob.progress = Math.max(installJob.progress, 40);
        const uiBuildOk = await runInstallStep(pnpmCmd, ["ui:build"], { cwd: sourceDir, inactivityTimeoutMs: 10 * 60 * 1000, stepName: "pnpm ui:build", env: mirrorEnv });
        if (!uiBuildOk) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（UI 构建）";
            appendInstallLog("UI 构建失败：当前源码可能不稳定或与依赖版本不兼容。");
            appendInstallLog(`建议操作：确认 vendor/openclaw 在稳定版本 ${activeSourceRef}，然后重试。`);
            return;
        }
        installJob.progress = Math.max(installJob.progress, 65);
        const coreBuildOk = await runInstallStep(pnpmCmd, ["build"], { cwd: sourceDir, inactivityTimeoutMs: 10 * 60 * 1000, stepName: "pnpm build", env: mirrorEnv });
        if (!coreBuildOk) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（核心构建）";
            return;
        }
        installJob.progress = Math.max(installJob.progress, 85);
        const linkOk = await runInstallStep(pnpmCmd, ["link", "--global"], { cwd: sourceDir, inactivityTimeoutMs: 3 * 60 * 1000, stepName: "pnpm link --global", env: mirrorEnv });
        if (!linkOk) {
            installJob.running = false;
            installJob.completed = true;
            installJob.ok = false;
            installJob.title = "安装失败（全局链接）";
            return;
        }
        if (process.platform !== "win32") {
            const pnpmBin = await (0, exec_1.runCommand)(pnpmCmd, ["bin", "-g"]);
            const globalBin = pnpmBin.stdout.trim();
            if (pnpmBin.code === 0 && globalBin) {
                const currentPath = process.env.PATH ?? "";
                if (!currentPath.includes(`${globalBin}:`)) {
                    process.env.PATH = `${globalBin}:${currentPath}`;
                }
                await ensureShellPathExported(globalBin);
                appendInstallLog(`已写入 shell PATH: ${globalBin}`);
            }
            await reloadProcessPathFromZshrc(appendInstallLog);
        }
        installJob.running = false;
        installJob.completed = true;
        installJob.ok = true;
        installJob.progress = 100;
        installJob.currentStep = "completed";
        installJob.currentCommand = "";
        installJob.currentPid = null;
        if (installJob.canceled) {
            installJob.title = "安装已取消";
            debugLog("install-job-finished", { ok: false, phase: "canceled" });
        }
        else {
            installJob.title = "安装完成";
            installJob.lastFailureReason = "";
            appendInstallLog("OpenClaw 本地源码构建安装已完成。onboarding 已移到配置步骤，请点击“保存配置”应用。");
            debugLog("install-job-finished", { ok: true, phase: "local-source" });
        }
    })();
    return true;
}
async function cancelInstallJob() {
    if (!installJob.running) {
        debugLog("install-job-cancel-skip", { reason: "not-running" });
        return false;
    }
    debugLog("install-job-cancel-requested");
    installJob.canceled = true;
    installJob.running = false;
    installJob.completed = true;
    installJob.ok = false;
    installJob.title = "安装已取消";
    installJob.lastFailureReason = "用户取消安装";
    appendInstallLog("用户取消安装，正在终止后台进程...");
    await terminateInstallChild();
    debugLog("install-job-cancelled");
    return true;
}
function startUninstallJob() {
    if (uninstallJob.running || installJob.running || maintenanceJob.running) {
        debugLog("uninstall-job-start-skip", {
            uninstallRunning: uninstallJob.running,
            installRunning: installJob.running,
            maintenanceRunning: maintenanceJob.running,
        });
        return false;
    }
    uninstallJob = {
        running: true,
        completed: false,
        ok: false,
        progress: 1,
        title: "正在卸载 OpenClaw",
        logs: ["开始卸载 OpenClaw..."],
        currentStep: "preflight",
        startedAt: Date.now(),
        lastFailureReason: "",
    };
    debugLog("uninstall-job-started");
    void (async () => {
        let synthetic = uninstallJob.progress;
        const ticker = setInterval(() => {
            if (!uninstallJob.running) {
                return;
            }
            if (synthetic < 95) {
                synthetic += 3;
                uninstallJob.progress = Math.max(uninstallJob.progress, synthetic);
            }
        }, 1500);
        try {
            uninstallJob.currentStep = "running";
            const result = await runAction("uninstall", {});
            uninstallJob.logs = (result.logs || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-300);
            uninstallJob.ok = result.ok;
            uninstallJob.completed = true;
            uninstallJob.running = false;
            uninstallJob.progress = 100;
            uninstallJob.title = result.title || (result.ok ? "卸载完成" : "卸载失败");
            uninstallJob.currentStep = "completed";
            uninstallJob.lastFailureReason = result.ok ? "" : (result.title || "卸载失败");
            debugLog("uninstall-job-finished", { ok: result.ok });
        }
        catch (error) {
            uninstallJob.running = false;
            uninstallJob.completed = true;
            uninstallJob.ok = false;
            uninstallJob.progress = 100;
            uninstallJob.title = "卸载失败";
            uninstallJob.currentStep = "failed";
            uninstallJob.lastFailureReason = String(error);
            uninstallJob.logs.push(`卸载任务异常: ${String(error)}`);
            debugLog("uninstall-job-error", { error: String(error) });
        }
        finally {
            clearInterval(ticker);
        }
    })();
    return true;
}
function commonStyles() {
    return `
    body { margin: 0; font-family: Arial, sans-serif; background: #0b111f; color: #eef2ff; }
    .wrap { max-width: 1080px; margin: 24px auto; padding: 0 12px 24px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    p.sub { margin: 0 0 14px; color: #9eb0df; }
    .small { color: #7f8db4; font-size: 13px; margin-bottom: 14px; }
    .daemon-guide-alert {
      color: #ffd166;
      font-weight: 700;
      background: rgba(255, 209, 102, 0.14);
      border: 1px solid rgba(255, 209, 102, 0.38);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
    }
    .guide-focus {
      box-shadow: 0 0 0 2px rgba(90, 124, 255, 0.6);
      transition: box-shadow 0.25s ease;
    }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
    .card { background: #101a35; border: 1px solid #2c3c70; border-radius: 12px; padding: 14px; }
    .card h2 { margin: 0 0 8px; font-size: 18px; }
    .row { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    label { display:block; margin: 8px 0 4px; color:#bbcaed; font-size: 13px; }
    input, select, textarea { width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid #34477f; background:#0d1630; color:#eef2ff; }
    textarea { min-height:100px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    button, .btn { border:0; border-radius:8px; background:#5a7cff; color:#fff; padding:10px 12px; cursor:pointer; margin: 8px 8px 0 0; text-decoration: none; display:inline-block; }
    button[disabled] { opacity: 0.45; cursor: not-allowed; }
    button.secondary, .btn.secondary { background:#2b3767; }
    button.warn { background:#91435f; }
    .badge-ok { color: #8ef0aa; font-weight: 700; }
    .badge-warn { color: #ffd166; font-weight: 700; }
    .installing-tip { margin-top: 8px; color: #ffd166; font-weight: 700; display: none; }
    .install-meta { margin-top: 6px; color: #9eb0df; font-size: 12px; display: none; white-space: pre-wrap; }
    .nav { margin-bottom: 10px; }
    #result { min-height: 20px; margin-top: 10px; font-weight: 600; }
    #logs, #chatLog { margin-top: 10px; min-height: 180px; white-space: pre-wrap; overflow-y: auto; border:1px solid #31447d; border-radius:8px; background:#0a1126; padding:10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .chatInput { display:grid; grid-template-columns: 1fr auto; gap: 8px; }
    .maintenance-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 10000;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
    }
    .maintenance-modal.is-open { display: flex; }
    .maintenance-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.62);
      animation: maintenance-fade-in 0.2s ease;
    }
    .maintenance-modal-panel {
      position: relative;
      z-index: 1;
      width: min(720px, 100%);
      max-height: min(84vh, 640px);
      display: flex;
      flex-direction: column;
      background: #101a35;
      border: 1px solid #2c3c70;
      border-radius: 12px;
      padding: 16px 18px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      animation: maintenance-panel-in 0.25s ease;
    }
    .maintenance-modal-panel--compact {
      max-height: min(40vh, 320px);
      width: min(440px, 100%);
    }
    .maintenance-modal-logs--hidden {
      display: none !important;
    }
    .maintenance-modal-panel h2 { margin: 0 0 8px; font-size: 18px; }
    .maintenance-modal-status {
      color: #9eb0df;
      font-size: 13px;
      margin-bottom: 8px;
      white-space: pre-wrap;
      min-height: 1.2em;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .maintenance-modal-logs {
      flex: 1;
      min-height: 200px;
      max-height: 42vh;
      overflow: auto;
      margin: 0;
      padding: 10px;
      background: #0a1126;
      border: 1px solid #31447d;
      border-radius: 8px;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .maintenance-modal-actions { margin-top: 12px; text-align: right; }
    .maintenance-spinner {
      display: none;
      width: 14px;
      height: 14px;
      border: 2px solid #5a7cff;
      border-top-color: transparent;
      border-radius: 50%;
      animation: maintenance-spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    .maintenance-spinner.is-visible { display: inline-block; }
    @keyframes maintenance-spin { to { transform: rotate(360deg); } }
    @keyframes maintenance-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes maintenance-panel-in {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }
    @media (max-width: 920px) { .grid, .row, .chatInput { grid-template-columns: 1fr; } }
  `;
}
function renderDashboardPage(configPath, state) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw 管理工具</title>
  <style>${commonStyles()}</style>
</head>
<body>
  <div class="wrap">
    <h1>OpenClaw 管理工具</h1>
    <p class="sub">先进入 Dashboard，再选择配置管理或聊天页面。</p>
    <div class="small">配置文件: <code>${escapeHtml(configPath)}</code></div>
    <div class="card">
      <h2>系统状态</h2>
      <p>OpenClaw 命令检测: <strong>${state.openclawInstalled ? "已安装" : "未检测到"}</strong></p>
      <p>Gateway 状态: <strong>${state.gatewayRunning ? "运行中" : "未运行"}</strong></p>
      <button id="statusBtn">刷新状态</button>
      <button class="secondary" id="openOfficialBtn">打开官方 Dashboard</button>
      <div id="result"></div>
      <div id="logs">Action logs appear here.</div>
    </div>
    <div class="card" style="margin-top: 12px;">
      <h2>入口</h2>
      <a class="btn" href="/control">进入配置管理</a>
      <a class="btn secondary" href="/chat">进入聊天页面</a>
    </div>
  </div>
  <script>
    const result = document.getElementById("result");
    const logs = document.getElementById("logs");
    const setResult = (ok, msg) => {
      result.style.color = ok ? "#8ef0aa" : "#ff95aa";
      result.textContent = msg;
    };
    const setLogs = (text) => { logs.textContent = text; logs.scrollTop = logs.scrollHeight; };
    async function invokeAction(action) {
      setResult(true, "执行中: " + action + " ...");
      const response = await fetch("/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload: {} })
      });
      const data = await response.json();
      setResult(Boolean(data.ok), data.title || "完成");
      setLogs(data.logs || "");
    }
    document.getElementById("statusBtn").addEventListener("click", () => invokeAction("status"));
    document.getElementById("openOfficialBtn").addEventListener("click", () => invokeAction("openDashboard"));
  </script>
</body>
</html>`;
}
function renderOnboardingPage(configPath) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw 管理工具</title>
  <style>${commonStyles()}
    .onboarding-wrap { min-height: 70vh; display:flex; align-items:center; justify-content:center; }
    .onboarding-card { width: min(760px, 95vw); text-align:center; }
  </style>
</head>
<body>
  <div class="wrap onboarding-wrap">
    <section class="card onboarding-card">
      <h1>OpenClaw 管理工具</h1>
      <p class="sub">当前未检测到可用的 OpenClaw。点击按钮开始安装。</p>
      <div class="small">源码目录要求: <code>${escapeHtml(source_1.LOCAL_OPENCLAW_SOURCE_RELATIVE)}</code></div>
      <button id="installBtn" style="font-size:22px; padding:16px 24px;">安装 OpenClaw</button>
      <div id="result"></div>
      <div id="installingTip" class="installing-tip">正在安装 OpenClaw，请稍候...</div>
      <div id="installMeta" class="install-meta"></div>
      <div id="logs">Install logs appear here.</div>
    </section>
  </div>
  <script>
    const result = document.getElementById("result");
    const logs = document.getElementById("logs");
    const installBtn = document.getElementById("installBtn");
    const installingTip = document.getElementById("installingTip");
    const installMeta = document.getElementById("installMeta");
    let tick = null;
    const setResult = (ok, msg) => {
      result.style.color = ok ? "#8ef0aa" : "#ff95aa";
      result.textContent = msg;
    };
    const setLogs = (text) => { logs.textContent = text; logs.scrollTop = logs.scrollHeight; };
    const setInstalling = (running) => {
      if (running) {
        installBtn.disabled = true;
        installingTip.style.display = "block";
        let dots = 0;
        tick = setInterval(() => {
          dots = (dots + 1) % 4;
          const current = Number.parseInt((installingTip.dataset.progress || "0"), 10) || 0;
          const suffix = current > 0 ? (" (" + current + "%)") : " (进行中)";
          installingTip.textContent = "正在安装 OpenClaw，请稍候" + suffix + ".".repeat(dots);
        }, 500);
      } else {
        installBtn.disabled = false;
        installingTip.style.display = "none";
        if (tick) {
          clearInterval(tick);
          tick = null;
        }
      }
    };
    const updateMeta = (data) => {
      const lines = [];
      if (data.currentStep) lines.push("步骤: " + data.currentStep);
      if (data.currentCommand) lines.push("命令: " + data.currentCommand);
      if (data.currentPid) lines.push("PID: " + data.currentPid);
      if (data.lastFailureReason) lines.push("失败原因: " + data.lastFailureReason);
      installMeta.textContent = lines.join("\\n");
      installMeta.style.display = lines.length ? "block" : "none";
    };
    const refreshStatus = async () => {
      const response = await fetch("/install/status");
      const data = await response.json();
      installingTip.dataset.progress = String(data.progress || 0);
      updateMeta(data);
      if (data.running) {
        setInstalling(true);
        setResult(true, data.title || "正在安装");
        setLogs((data.logs || []).join("\\n"));
      } else if (data.completed) {
        setInstalling(false);
        setResult(Boolean(data.ok), data.title || "安装结束");
        setLogs((data.logs || []).join("\\n"));
        if (data.ok) {
          // Install success should always move user into control page.
          window.location.href = "/control";
        }
      }
      return data;
    };
    installBtn.addEventListener("click", async () => {
      setResult(true, "正在启动安装任务...");
      const startRes = await fetch("/install/start", { method: "POST" });
      const startData = await startRes.json();
      if (!startRes.ok || !startData.ok) {
        setResult(false, startData.title || "无法启动安装");
        return;
      }
      setInstalling(true);
      await refreshStatus();
      const poll = setInterval(async () => {
        const data = await refreshStatus();
        if (!data.running) {
          clearInterval(poll);
        }
      }, 2000);
    });
  </script>
</body>
</html>`;
}
function renderControlPage(configPath, config, state) {
    const requiresInstallDisabled = state.openclawInstalled ? "" : "disabled";
    const requiresDaemonDisabled = state.openclawInstalled && state.daemonReady ? "" : "disabled";
    const runGatewayDisabled = state.openclawInstalled && state.daemonReady && !state.gatewayRunning ? "" : "disabled";
    const installButtonHtml = state.openclawInstalled
        ? ""
        : `<button id="installBtn" data-action="install">安装 OpenClaw</button>`;
    const configErrors = (0, config_1.validateConfig)(config);
    const configErrorHtml = configErrors.length
        ? configErrors.map((e) => `• ${escapeHtml(e)}`).join("<br/>")
        : "";
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw 管理工具</title>
  <style>${commonStyles()}</style>
</head>
<body>
  <div class="wrap">
    <div class="nav">
      <a class="btn secondary" href="/dashboard">返回 Dashboard</a>
      <a class="btn secondary" href="/chat">进入聊天页面</a>
    </div>
    <h1>OpenClaw 管理工具</h1>
    <p class="sub">配置管理页面（模型、通道、运维、技能安装）。</p>
    <div class="small">配置文件: <code>${escapeHtml(configPath)}</code></div>

    <div class="grid">
      <section class="card">
        <h2>运行与维护</h2>
        <p class="small ${state.daemonReady ? "" : "daemon-guide-alert"}" id="daemonGuideTip">${state.daemonReady ? "Daemon 已就绪，可执行网关相关操作。" : "需要先完成 openclaw 配置（保存配置会执行 onboard --install-daemon）后，才能启动网关/重启/打开官方 Dashboard。点击这里可自动定位到第一步引导。"}</p>
        ${installButtonHtml}
        <button id="cancelInstallBtn" class="warn" style="display:none;">取消安装</button>
        <button class="warn" data-action="uninstall" ${requiresInstallDisabled}>卸载 OpenClaw</button>
        <button class="secondary" data-action="update" ${requiresInstallDisabled}>升级 OpenClaw</button>
        <button class="warn" data-action="fix" ${requiresInstallDisabled}>自动修复检查</button>
        <button class="secondary" data-action="status" ${requiresInstallDisabled}>查看状态</button>
        <button class="secondary" data-action="runGateway" ${runGatewayDisabled}>启动 Gateway</button>
        <button class="warn" data-action="restartGateway" ${requiresDaemonDisabled}>重启 Gateway</button>
        <button class="secondary" data-action="openDashboard" ${requiresDaemonDisabled}>打开官方 Dashboard</button>
        <div id="installingTip" class="installing-tip">正在安装 OpenClaw，请稍候...</div>
        <div id="installMeta" class="install-meta"></div>
        <div id="uninstallingTip" class="installing-tip" style="display:none;color:#ff95aa;" aria-hidden="true">正在卸载 OpenClaw，请稍候...</div>
        <p class="small">
          安装状态：<span id="installStateBadge" class="${state.openclawInstalled ? "badge-ok" : "badge-warn"}">${state.openclawInstalled ? "已安装（安装按钮已禁用）" : "未安装（可点击安装）"}</span>；
          Daemon：<span id="daemonStateBadge" class="${state.daemonReady ? "badge-ok" : "badge-warn"}">${state.daemonReady ? "已配置（可启动网关）" : "未配置（请先保存配置）"}</span>；
          Gateway：<span id="gatewayStateBadge" class="${state.gatewayRunning ? "badge-ok" : "badge-warn"}">${state.gatewayRunning ? "运行中（启动按钮已禁用）" : "未运行（可点击启动）"}</span>。
        </p>
      </section>
      <section class="card">
        <h2>技能安装</h2>
        <label for="skillPackage">插件包名</label>
        <input id="skillPackage" value="@m1heng-clawd/feishu" />
        <button id="installSkillBtn" ${requiresInstallDisabled}>安装技能</button>
      </section>
    </div>

    <section class="card" id="section-guide" style="margin-top:12px;">
      <h2>第一步引导</h2>
      <p class="sub">先完成模型与通道配置，再保存配置以安装 daemon。模型可跳转 OneThingAI，飞书可自动打开本地浏览器引导。</p>
      <button id="guideStepOneBtn" class="secondary">第一步：去模型/通道配置</button>
      <button id="guideModelBtn" class="secondary">模型配置引导（OneThingAI）</button>
      <button id="guideFeishuBtn" class="secondary" ${requiresInstallDisabled}>飞书配置引导（自动打开浏览器）</button>
    </section>

    <section class="card" id="section-basic-config" style="margin-top:12px;">
      <h2>基础配置</h2>
      <div class="row">
        <div>
          <label for="openclawHome">OpenClaw Home</label>
          <input id="openclawHome" value="${escapeHtml(config.openclaw.home ?? "")}" />
        </div>
        <div>
          <label for="stateDir">State Dir</label>
          <input id="stateDir" value="${escapeHtml(config.openclaw.stateDir ?? (0, platform_1.getDefaultStateDir)())}" />
        </div>
      </div>
    </section>

    <section class="card" id="section-models" style="margin-top:12px;">
      <h2>模型管理</h2>
      <div class="row">
        <div><label for="provider">Provider</label><input id="provider" value="${escapeHtml(config.models.provider)}" /></div>
        <div><label for="baseUrl">Base URL</label><input id="baseUrl" value="${escapeHtml(config.models.baseUrl)}" /></div>
      </div>
      <div class="row">
        <div><label for="apiKeyEnv">API Key Env</label><input id="apiKeyEnv" value="${escapeHtml(config.models.apiKeyEnv)}" /></div>
        <div><label for="defaultModel">默认模型</label><input id="defaultModel" value="${escapeHtml(config.models.defaultModel)}" /></div>
      </div>
      <div class="row">
        <div>
          <label for="dailyLimit">今日限额</label>
          <select id="dailyLimit">
            <option value="unlimited">不限</option>
            <option value="10k">10K</option>
            <option value="50k">50K</option>
            <option value="100k">100K</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div><label for="modelsJson">模型列表(JSON 数组)</label><textarea id="modelsJson">${escapeHtml(JSON.stringify(config.models.list, null, 2))}</textarea></div>
      </div>
    </section>

    <section class="card" id="section-channels" style="margin-top:12px;">
      <h2>通道管理</h2>
      <div class="row">
        <div>
          <label><input type="checkbox" id="feishuEnabled" ${config.channels.feishu.enabled ? "checked" : ""}/> 启用飞书</label>
          <label for="feishuAppId">Feishu App ID</label><input id="feishuAppId" value="${escapeHtml(config.channels.feishu.appId || config.feishu.appId)}" />
          <label for="feishuAppSecret">Feishu App Secret</label><input id="feishuAppSecret" value="${escapeHtml(config.channels.feishu.appSecret || config.feishu.appSecret)}" />
          <label for="feishuBotName">Feishu Bot Name</label><input id="feishuBotName" value="${escapeHtml(config.channels.feishu.botName || config.feishu.botName)}" />
          <label for="feishuWebhookUrl">Feishu Webhook URL</label><input id="feishuWebhookUrl" value="${escapeHtml(config.channels.feishu.webhookUrl || config.feishu.webhookUrl)}" />
        </div>
        <div>
          <label><input type="checkbox" id="qqEnabled" ${config.channels.qq.enabled ? "checked" : ""}/> 启用 QQ</label>
          <label for="qqBotId">QQ Bot ID</label><input id="qqBotId" value="${escapeHtml(config.channels.qq.botId)}" />
          <label for="qqToken">QQ Token</label><input id="qqToken" value="${escapeHtml(config.channels.qq.token)}" />
          <label><input type="checkbox" id="wecomEnabled" ${config.channels.wecom.enabled ? "checked" : ""}/> 启用企业微信</label>
          <label for="wecomCorpId">Corp ID</label><input id="wecomCorpId" value="${escapeHtml(config.channels.wecom.corpId)}" />
          <label for="wecomAgentId">Agent ID</label><input id="wecomAgentId" value="${escapeHtml(config.channels.wecom.agentId)}" />
          <label for="wecomSecret">Secret</label><input id="wecomSecret" value="${escapeHtml(config.channels.wecom.secret)}" />
        </div>
      </div>
      <button id="saveControlBtn" ${requiresInstallDisabled}>保存配置</button>
      ${configErrorHtml
        ? `<p class="small" style="margin-top:10px;color:#ffd166;white-space:pre-wrap;" id="configMissingTip">
               配置缺失项（点击保存会再次校验）：<br/>${configErrorHtml}
             </p>`
        : ""}
      <button class="secondary" id="feishuSetupBtn" ${requiresInstallDisabled}>配置飞书（Playwright）</button>
      <p id="result"></p>
      <div id="logs">Action logs appear here.</div>
    </section>

    <section class="card" style="margin-top:12px;">
      <h2>模型服务入口</h2>
      <p class="sub">点击进入 OneThingAI 注册或配置 API Key 流程。</p>
      <a class="btn" href="https://onethingai.com/" target="_blank" rel="noreferrer">前往 OneThingAI</a>
    </section>
  </div>
  <div id="maintenanceModal" class="maintenance-modal" aria-hidden="true">
    <div class="maintenance-modal-backdrop" id="maintenanceModalBackdrop"></div>
    <div id="maintenanceModalPanel" class="maintenance-modal-panel" role="dialog" aria-labelledby="maintenanceModalTitle">
      <h2 id="maintenanceModalTitle">维护任务</h2>
      <div id="maintenanceModalStatus" class="maintenance-modal-status">
        <span id="maintenanceModalSpinner" class="maintenance-spinner"></span>
        <span id="maintenanceModalStatusText"></span>
      </div>
      <pre id="maintenanceModalLogs" class="maintenance-modal-logs"></pre>
      <div class="maintenance-modal-actions">
        <button type="button" id="maintenanceModalClose" class="secondary">关闭</button>
      </div>
    </div>
  </div>
  <script>
    document.getElementById("dailyLimit").value = "${escapeHtml(config.models.dailyLimit)}";
    const result = document.getElementById("result");
    const logs = document.getElementById("logs");
    const installBtn = document.getElementById("installBtn");
    const cancelInstallBtn = document.getElementById("cancelInstallBtn");
    const installingTip = document.getElementById("installingTip");
    const installMeta = document.getElementById("installMeta");
    const uninstallingTip = document.getElementById("uninstallingTip");
    const installStateBadge = document.getElementById("installStateBadge");
    const daemonStateBadge = document.getElementById("daemonStateBadge");
    const gatewayStateBadge = document.getElementById("gatewayStateBadge");
    const daemonGuideTip = document.getElementById("daemonGuideTip");
    let installTick = null;
    let uiInstalling = false;
    let uiUninstalling = false;
    let uninstallTick = null;
    const maintenanceModal = document.getElementById("maintenanceModal");
    const maintenanceModalPanel = document.getElementById("maintenanceModalPanel");
    const maintenanceModalTitle = document.getElementById("maintenanceModalTitle");
    const maintenanceModalStatusText = document.getElementById("maintenanceModalStatusText");
    const maintenanceModalLogs = document.getElementById("maintenanceModalLogs");
    const maintenanceModalClose = document.getElementById("maintenanceModalClose");
    const maintenanceModalSpinner = document.getElementById("maintenanceModalSpinner");
    const maintenanceModalBackdrop = document.getElementById("maintenanceModalBackdrop");
    let taskModalPoll = null;
    let taskModalContext = "idle";
    let uiMaintenanceRunning = false;
    const setResult = (ok, msg) => {
      result.style.color = ok ? "#8ef0aa" : "#ff95aa";
      result.textContent = msg;
    };
    const setLogs = (text) => { logs.textContent = text; logs.scrollTop = logs.scrollHeight; };
    let runtimeOpenclawInstalled = ${state.openclawInstalled ? "true" : "false"};
    let runtimeDaemonReady = ${state.daemonReady ? "true" : "false"};
    let runtimeGatewayRunning = ${state.gatewayRunning ? "true" : "false"};
    const allButtons = Array.from(document.querySelectorAll("button"));
    const actionButtons = Array.from(document.querySelectorAll("[data-action]"));
    const disableAllButtons = (disabled) => {
      allButtons.forEach((btn) => { btn.disabled = disabled; });
    };
    const applyActionButtonsState = () => {
      actionButtons.forEach((btn) => {
        const action = btn.dataset.action;
        if (action === "install") {
          btn.disabled = runtimeOpenclawInstalled;
          return;
        }
        if (!runtimeOpenclawInstalled) {
          btn.disabled = true;
          return;
        }
        if (["runGateway", "restartGateway", "openDashboard"].includes(action)) {
          if (!runtimeDaemonReady) {
            btn.disabled = true;
            return;
          }
        }
        if (action === "runGateway") {
          btn.disabled = runtimeGatewayRunning;
          return;
        }
        btn.disabled = false;
      });
      if (installBtn) {
        installBtn.disabled = runtimeOpenclawInstalled;
      }
      const installSkillBtn = document.getElementById("installSkillBtn");
      const saveControlBtn = document.getElementById("saveControlBtn");
      const feishuSetupBtn = document.getElementById("feishuSetupBtn");
      const guideFeishuBtn = document.getElementById("guideFeishuBtn");
      const guideModelBtn = document.getElementById("guideModelBtn");
      if (installSkillBtn) installSkillBtn.disabled = !runtimeOpenclawInstalled;
      if (saveControlBtn) saveControlBtn.disabled = !runtimeOpenclawInstalled;
      if (feishuSetupBtn) feishuSetupBtn.disabled = false;
      if (guideFeishuBtn) guideFeishuBtn.disabled = false;
      if (guideModelBtn) guideModelBtn.disabled = false;
      if (installStateBadge) {
        installStateBadge.className = runtimeOpenclawInstalled ? "badge-ok" : "badge-warn";
        installStateBadge.textContent = runtimeOpenclawInstalled ? "已安装（安装按钮已禁用）" : "未安装（可点击安装）";
      }
      if (daemonStateBadge) {
        daemonStateBadge.className = runtimeDaemonReady ? "badge-ok" : "badge-warn";
        daemonStateBadge.textContent = runtimeDaemonReady ? "已配置（可启动网关）" : "未配置（请先保存配置）";
      }
      if (gatewayStateBadge) {
        gatewayStateBadge.className = runtimeGatewayRunning ? "badge-ok" : "badge-warn";
        gatewayStateBadge.textContent = runtimeGatewayRunning ? "运行中（启动按钮已禁用）" : "未运行（可点击启动）";
      }
      if (daemonGuideTip) {
        daemonGuideTip.classList.toggle("daemon-guide-alert", !runtimeDaemonReady);
        daemonGuideTip.textContent = runtimeDaemonReady
          ? "Daemon 已就绪，可执行网关相关操作。"
          : "需要先完成 openclaw 配置（保存配置会执行 onboard --install-daemon）后，才能启动网关/重启/打开官方 Dashboard。点击这里可自动定位到第一步引导。";
      }
    };
    applyActionButtonsState();
    const showFailure = (msg, details = "", silent = false) => {
      setResult(false, msg);
      if (details) setLogs(details);
      if (!silent) window.alert(msg);
    };
    const reportTaskModalFailure = (title, details = "") => {
      setResult(false, title || "失败");
      if (details) setLogs(details);
      if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = title || "失败";
      if (maintenanceModalLogs && details) maintenanceModalLogs.textContent = details;
      setMaintenanceSpinner(false);
    };
    const setMaintenanceSpinner = (visible) => {
      if (maintenanceModalSpinner) maintenanceModalSpinner.classList.toggle("is-visible", visible);
    };
    const clearTaskModalPoll = () => {
      if (taskModalPoll) {
        clearInterval(taskModalPoll);
        taskModalPoll = null;
      }
    };
    const openTaskModal = (title, options = {}) => {
      clearTaskModalPoll();
      const compact = Boolean(options.compact);
      const showLogs = compact ? Boolean(options.showLogs) : options.showLogs !== false;
      taskModalContext = typeof options.context === "string" ? options.context : "generic";
      if (maintenanceModalTitle) maintenanceModalTitle.textContent = title;
      if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = compact ? "执行中…" : "正在启动…";
      if (maintenanceModalLogs) {
        maintenanceModalLogs.textContent = "";
        maintenanceModalLogs.classList.toggle("maintenance-modal-logs--hidden", !showLogs);
      }
      if (maintenanceModalPanel) {
        maintenanceModalPanel.classList.toggle("maintenance-modal-panel--compact", compact);
      }
      setMaintenanceSpinner(true);
      if (maintenanceModal) {
        maintenanceModal.classList.add("is-open");
        maintenanceModal.setAttribute("aria-hidden", "false");
      }
      document.body.style.overflow = "hidden";
    };
    const closeTaskModal = () => {
      clearTaskModalPoll();
      taskModalContext = "idle";
      setMaintenanceSpinner(false);
      if (maintenanceModalPanel) {
        maintenanceModalPanel.classList.remove("maintenance-modal-panel--compact");
      }
      if (maintenanceModalLogs) {
        maintenanceModalLogs.classList.remove("maintenance-modal-logs--hidden");
      }
      if (maintenanceModal) {
        maintenanceModal.classList.remove("is-open");
        maintenanceModal.setAttribute("aria-hidden", "true");
      }
      document.body.style.overflow = "";
    };
    const refreshMaintenanceStatus = async () => {
      const response = await fetch("/maintenance/status");
      const data = await response.json();
      if (maintenanceModalLogs) {
        maintenanceModalLogs.textContent = (data.logs || []).join("\\n");
        maintenanceModalLogs.scrollTop = maintenanceModalLogs.scrollHeight;
      }
      if (maintenanceModalStatusText) {
        const pct = typeof data.progress === "number" ? data.progress : 0;
        let line = (data.title || "") + (data.running ? " (" + pct + "%)" : "");
        if (data.currentCommand) {
          line = (line ? line + "\\n" : "") + "命令: " + data.currentCommand;
        }
        maintenanceModalStatusText.textContent = line || (data.running ? "进行中…" : "");
      }
      setMaintenanceSpinner(Boolean(data.running));
      return data;
    };
    const syncUninstallToTaskModal = (data) => {
      if (taskModalContext !== "uninstall") return;
      if (maintenanceModalLogs) {
        maintenanceModalLogs.textContent = (data.logs || []).join("\\n");
        maintenanceModalLogs.scrollTop = maintenanceModalLogs.scrollHeight;
      }
      if (maintenanceModalStatusText) {
        const pct = typeof data.progress === "number" ? data.progress : 0;
        let line = (data.title || "") + (data.running ? " (" + pct + "%)" : "");
        if (data.currentStep) {
          line = (line ? line + "\\n" : "") + "步骤: " + data.currentStep;
        }
        if (data.lastFailureReason) {
          line = (line ? line + "\\n" : "") + "失败原因: " + data.lastFailureReason;
        }
        maintenanceModalStatusText.textContent = line || (data.running ? "进行中…" : "");
      }
      setMaintenanceSpinner(Boolean(data.running));
    };
    if (maintenanceModalClose) {
      maintenanceModalClose.addEventListener("click", () => {
        if (!maintenanceModalClose.disabled) closeTaskModal();
      });
    }
    if (maintenanceModalBackdrop) {
      maintenanceModalBackdrop.addEventListener("click", () => {
        if (maintenanceModalClose && !maintenanceModalClose.disabled) closeTaskModal();
      });
    }
    const formatDuration = (seconds) => {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return "-";
      const s = Math.floor(n);
      const m = Math.floor(s / 60);
      const r = s % 60;
      return m > 0 ? (m + "m " + r + "s") : (r + "s");
    };
    const updateInstallMeta = (data) => {
      if (!installMeta) return;
      const lines = [];
      if (data.currentStep) lines.push("步骤: " + data.currentStep);
      if (data.currentCommand) lines.push("命令: " + data.currentCommand);
      if (data.currentPid) lines.push("PID: " + data.currentPid);
      if (typeof data.stepStartedAt === "number" && data.stepStartedAt > 0) {
        const elapsed = Math.floor((Date.now() - data.stepStartedAt) / 1000);
        lines.push("已运行: " + formatDuration(elapsed));
      }
      if (typeof data.lastActivityAt === "number" && data.lastActivityAt > 0) {
        const idle = Math.floor((Date.now() - data.lastActivityAt) / 1000);
        lines.push("空闲: " + formatDuration(idle));
      }
      if (data.lastFailureReason) lines.push("失败原因: " + data.lastFailureReason);
      if (lines.length > 0) {
        installMeta.textContent = lines.join("\\n");
        installMeta.style.display = "block";
      } else {
        installMeta.textContent = "";
        installMeta.style.display = "none";
      }
    };
    const getInstallTipPrefix = () => {
      const step = (installMeta?.textContent || "").toLowerCase();
      if (step.includes("npm install") || step.includes("pnpm install")) {
        return "正在安装 OpenClaw，请稍候";
      }
      return "正在执行安装步骤";
    };
    const setInstalling = (running) => {
      if (!installingTip) return;
      if (running) {
        if (uiInstalling) return;
        uiInstalling = true;
        let dots = 0;
        installingTip.style.display = "block";
        if (cancelInstallBtn) cancelInstallBtn.style.display = "inline-block";
        if (installBtn) installBtn.disabled = true;
        const initial = Number.parseInt((installingTip.dataset.progress || "0"), 10) || 0;
        const prefix = getInstallTipPrefix();
        installingTip.textContent = initial > 0
          ? (prefix + " (" + initial + "%)")
          : (prefix + " (等待命令输出进度)");
        installTick = setInterval(() => {
          dots = (dots + 1) % 4;
          const current = Number.parseInt((installingTip.dataset.progress || "0"), 10);
          const prefixNow = getInstallTipPrefix();
          const suffix = current > 0 ? (" (" + current + "%)") : " (等待命令输出进度)";
          installingTip.textContent = prefixNow + suffix + ".".repeat(dots);
        }, 500);
      } else {
        uiInstalling = false;
        if (installTick) {
          clearInterval(installTick);
          installTick = null;
        }
        installingTip.style.display = "none";
        if (cancelInstallBtn) cancelInstallBtn.style.display = "none";
        if (installMeta) {
          installMeta.style.display = "none";
        }
      }
    };

    const setUninstalling = (running) => {
      if (running) {
        if (uiUninstalling) return;
        uiUninstalling = true;
        disableAllButtons(true);
        if (uninstallTick) {
          clearInterval(uninstallTick);
          uninstallTick = null;
        }
        if (uninstallingTip) uninstallingTip.style.display = "none";
      } else {
        uiUninstalling = false;
        if (uninstallTick) {
          clearInterval(uninstallTick);
          uninstallTick = null;
        }
        if (uninstallingTip) uninstallingTip.style.display = "none";
        applyActionButtonsState();
      }
    };

    const syncRuntimeState = async () => {
      try {
        const response = await fetch("/runtime/state");
        const data = await response.json();
        runtimeOpenclawInstalled = Boolean(data.openclawInstalled);
        runtimeDaemonReady = Boolean(data.daemonReady);
        runtimeGatewayRunning = Boolean(data.gatewayRunning);
      } catch {
        // keep previous state when probe fails
      }
      applyActionButtonsState();
    };

    const refreshInstallStatus = async () => {
      const response = await fetch("/install/status");
      const data = await response.json();
      if (installingTip) {
        installingTip.dataset.progress = String(data.progress || 0);
      }
      updateInstallMeta(data);
      if (data.running) {
        if (!uiInstalling) setInstalling(true);
        setResult(true, data.title || "正在安装");
        setLogs((data.logs || []).join("\\n"));
      } else if (data.completed) {
        setInstalling(false);
        if (!data.ok && data.lastFailureReason) {
          setResult(false, (data.title || "安装结束") + ": " + data.lastFailureReason);
        } else {
          setResult(Boolean(data.ok), data.title || "安装结束");
        }
        setLogs((data.logs || []).join("\\n"));
        await syncRuntimeState();
      }
      return data;
    };

    const refreshUninstallStatus = async () => {
      const response = await fetch("/uninstall/status");
      const data = await response.json();
      if (uninstallingTip) {
        uninstallingTip.dataset.progress = String(data.progress || 0);
      }
      syncUninstallToTaskModal(data);
      if (data.running) {
        if (!uiUninstalling) setUninstalling(true);
        setResult(true, data.title || "正在卸载");
        setLogs((data.logs || []).join("\\n"));
      } else if (data.completed) {
        setUninstalling(false);
        if (!data.ok && data.lastFailureReason) {
          setResult(false, (data.title || "卸载结束") + ": " + data.lastFailureReason);
        } else {
          setResult(Boolean(data.ok), data.title || "卸载结束");
        }
        setLogs((data.logs || []).join("\\n"));
        await syncRuntimeState();
      }
      return data;
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const parseModelsJson = () => {
      const raw = document.getElementById("modelsJson").value || "[]";
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("modelsJson must be a JSON array.");
      }
      return parsed;
    };

    const ensureModelEntry = (modelsList, entry) => {
      const existingIndex = modelsList.findIndex((m) => m && m.id === entry.id);
      if (existingIndex !== -1) {
        modelsList[existingIndex] = { ...modelsList[existingIndex], ...entry };
        return modelsList;
      }
      modelsList.push(entry);
      return modelsList;
    };

    const applyOneThingAutoFill = (data) => {
      const fields = data.fields || {};
      const models = fields.models || {};

      if (models.provider !== undefined) document.getElementById("provider").value = models.provider;
      if (models.baseUrl !== undefined) document.getElementById("baseUrl").value = models.baseUrl;
      if (models.apiKeyEnv !== undefined) document.getElementById("apiKeyEnv").value = models.apiKeyEnv;
      if (models.defaultModel !== undefined) document.getElementById("defaultModel").value = models.defaultModel;

      // Merge/append model entry into modelsJson array.
      const entry = data.modelEntryToEnsure;
      if (entry) {
        const list = parseModelsJson();
        const next = ensureModelEntry(list, entry);
        document.getElementById("modelsJson").value = JSON.stringify(next, null, 2);
      }
    };

    const applyFeishuAutoFill = (data) => {
      const fields = data.fields || {};
      const feishu = fields.feishu || {};
      if (feishu.appId !== undefined) document.getElementById("feishuAppId").value = feishu.appId;
      if (feishu.appSecret !== undefined) document.getElementById("feishuAppSecret").value = feishu.appSecret;
      if (feishu.webhookUrl !== undefined) document.getElementById("feishuWebhookUrl").value = feishu.webhookUrl;
    };

    const pollAutomationResultAndAutoFill = async (action, payload = {}) => {
      const kind = action === "oneThingSetup" ? "oneThing" : "feishu";
      const statusUrl = kind === "oneThing" ? "/automation/onething/status" : "/automation/feishu/status";
      const applyUrl = kind === "oneThing" ? "/automation/onething/apply" : "/automation/feishu/apply";

      const maxTries = 120; // ~4 minutes
      const intervalMs = 2000;

      for (let i = 0; i < maxTries; i++) {
        const statusRes = await fetch(statusUrl, { method: "GET" });
        const statusData = await statusRes.json();
        if (!statusRes.ok || !statusData.ok) {
          reportTaskModalFailure(action + " 状态轮询失败", statusData.error || statusData.title || "");
          return;
        }
        if (!statusData.ready) {
          const waitMsg = "等待浏览器自动化完成… (" + Math.floor(i + 1) + "/" + maxTries + ")";
          setResult(true, waitMsg);
          if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = waitMsg;
          await sleep(intervalMs);
          continue;
        }

        if (!statusData.success) {
          reportTaskModalFailure(
            statusData.title || action + " 自动化失败",
            statusData.error || statusData.logs || "",
          );
          return;
        }

        const applyRes = await fetch(applyUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const applyData = await applyRes.json();
        if (!applyRes.ok || !applyData.ok) {
          reportTaskModalFailure(
            applyData.title || action + " 自动填充失败",
            applyData.error || applyData.logs || "",
          );
          return;
        }

        try {
          if (kind === "oneThing") {
            applyOneThingAutoFill(applyData);
          } else {
            applyFeishuAutoFill(applyData);
          }
        } catch (e) {
          reportTaskModalFailure(action + " 自动填充完成但回填 UI 失败", String(e));
          return;
        }

        setResult(true, applyData.title || "自动填充完成");
        if (applyData.logs) setLogs(applyData.logs);
        if (maintenanceModalStatusText) {
          maintenanceModalStatusText.textContent =
            applyData.title || "已回填到表单，可在下方核对后保存配置。";
        }
        if (maintenanceModalLogs && applyData.logs) {
          maintenanceModalLogs.textContent = applyData.logs;
        }
        return;
      }

      reportTaskModalFailure(
        action + " 自动化结果超时",
        "超过轮询上限，建议检查 ~/.openclaw/*-setup-result.json 文件与步骤日志。",
      );
    };

    async function invokeAction(action, payload = {}) {
      if (uiUninstalling && action !== "uninstall") {
        showFailure("正在卸载 OpenClaw，其他操作已禁用，请等待卸载完成。");
        return;
      }
      if (!runtimeOpenclawInstalled && !["install", "oneThingSetup", "feishuSetup"].includes(action)) {
        showFailure("OpenClaw 尚未安装，请先点击“安装 OpenClaw”。");
        return;
      }
      if (["runGateway", "restartGateway", "openDashboard"].includes(action) && !runtimeDaemonReady) {
        showFailure("需要先完成 openclaw 配置（保存配置将执行 onboard --install-daemon）后，才能执行该操作。");
        return;
      }
      if (action === "install") {
        setResult(true, "正在启动安装任务...");
        const startRes = await fetch("/install/start", { method: "POST" });
        const startData = await startRes.json();
        if (!startRes.ok || !startData.ok) {
          showFailure("安装启动失败: " + (startData.title || "无法启动安装"), startData.logs || "");
          return;
        }
        setInstalling(true);
        await refreshInstallStatus();
        const poll = setInterval(async () => {
          const data = await refreshInstallStatus();
          if (!data.running) {
            clearInterval(poll);
          }
        }, 2000);
        return;
      }
      if (action === "uninstall") {
        if (uiMaintenanceRunning) {
          setResult(false, "已有升级/检查任务进行中，请稍候再卸载。");
          return;
        }
        openTaskModal("卸载 OpenClaw", { context: "uninstall", showLogs: true });
        disableAllButtons(true);
        if (maintenanceModalClose) maintenanceModalClose.disabled = true;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        try {
          setResult(true, "正在启动卸载任务...");
          const startRes = await fetch("/uninstall/start", { method: "POST" });
          const startData = await startRes.json();
          if (!startRes.ok || !startData.ok) {
            setMaintenanceSpinner(false);
            reportTaskModalFailure(startData.title || "无法启动卸载", startData.logs || "");
            if (maintenanceModalClose) maintenanceModalClose.disabled = false;
            disableAllButtons(false);
            applyActionButtonsState();
            return;
          }
          setResult(true, startData.title || "任务已启动");
          setUninstalling(true);
          const first = await refreshUninstallStatus();
          if (!first.running) {
            setMaintenanceSpinner(false);
            if (maintenanceModalClose) maintenanceModalClose.disabled = false;
            disableAllButtons(false);
            applyActionButtonsState();
            await syncRuntimeState();
            return;
          }
          taskModalPoll = setInterval(async () => {
            const data = await refreshUninstallStatus();
            if (!data.running) {
              clearInterval(taskModalPoll);
              taskModalPoll = null;
              setMaintenanceSpinner(false);
              if (maintenanceModalClose) maintenanceModalClose.disabled = false;
              disableAllButtons(false);
              applyActionButtonsState();
              await syncRuntimeState();
            }
          }, 2000);
        } catch (error) {
          setMaintenanceSpinner(false);
          reportTaskModalFailure(String(error), "");
          if (maintenanceModalClose) maintenanceModalClose.disabled = false;
          disableAllButtons(false);
          applyActionButtonsState();
          setUninstalling(false);
        }
        return;
      }
      if (action === "update" || action === "fix") {
        if (uiInstalling) {
          showFailure("正在安装 OpenClaw，请等待安装完成后再试。");
          return;
        }
        if (uiMaintenanceRunning) {
          setResult(false, "已有升级/检查任务在进行中。");
          return;
        }
        const kind = action;
        const titleCn = kind === "update" ? "升级 OpenClaw" : "自动修复检查";
        openTaskModal(titleCn, { context: "maintenance", showLogs: true });
        uiMaintenanceRunning = true;
        disableAllButtons(true);
        if (maintenanceModalClose) maintenanceModalClose.disabled = true;

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        try {
          const startRes = await fetch("/maintenance/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind }),
          });
          const startData = await startRes.json();
          if (!startRes.ok || !startData.ok) {
            setMaintenanceSpinner(false);
            if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = startData.title || "无法启动任务";
            if (maintenanceModalLogs) maintenanceModalLogs.textContent = startData.logs || "";
            setResult(false, startData.title || "无法启动任务");
            setLogs(startData.logs || "");
            if (maintenanceModalClose) maintenanceModalClose.disabled = false;
            disableAllButtons(false);
            applyActionButtonsState();
            uiMaintenanceRunning = false;
            return;
          }
          setResult(true, startData.title || "任务已启动");
          const first = await refreshMaintenanceStatus();
          if (!first.running) {
            setMaintenanceSpinner(false);
            if (maintenanceModalClose) maintenanceModalClose.disabled = false;
            disableAllButtons(false);
            applyActionButtonsState();
            uiMaintenanceRunning = false;
            setResult(Boolean(first.ok), first.title || (first.ok ? "完成" : "失败"));
            setLogs((first.logs || []).join("\\n"));
            await syncRuntimeState();
            return;
          }
          taskModalPoll = setInterval(async () => {
            const data = await refreshMaintenanceStatus();
            if (!data.running) {
              clearInterval(taskModalPoll);
              taskModalPoll = null;
              setMaintenanceSpinner(false);
              if (maintenanceModalClose) maintenanceModalClose.disabled = false;
              disableAllButtons(false);
              applyActionButtonsState();
              uiMaintenanceRunning = false;
              setResult(Boolean(data.ok), data.title || (data.ok ? "完成" : "失败"));
              setLogs((data.logs || []).join("\\n"));
              await syncRuntimeState();
            }
          }, 2000);
        } catch (error) {
          setMaintenanceSpinner(false);
          if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = String(error);
          setResult(false, String(error));
          if (maintenanceModalClose) maintenanceModalClose.disabled = false;
          disableAllButtons(false);
          applyActionButtonsState();
          uiMaintenanceRunning = false;
        }
        return;
      }

      if (action === "runGateway" || action === "restartGateway") {
        if (uiUninstalling) {
          showFailure("正在卸载 OpenClaw，其他操作已禁用，请等待卸载完成。");
          return;
        }
        if (!runtimeDaemonReady) {
          showFailure("需要先完成 openclaw 配置（保存配置将执行 onboard --install-daemon）后，才能执行该操作。");
          return;
        }
        const titleCn = action === "runGateway" ? "启动 Gateway" : "重启 Gateway";
        openTaskModal(titleCn, { compact: true, showLogs: false, context: "gateway" });
        if (maintenanceModalClose) maintenanceModalClose.disabled = true;
        disableAllButtons(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        try {
          if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = "正在执行…";
          const response = await fetch("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, payload }),
          });
          const data = await response.json();
          setMaintenanceSpinner(false);
          if (!response.ok || !data.ok) {
            reportTaskModalFailure(data.title || "执行失败", data.logs || "");
            if (data.logs && maintenanceModalLogs) {
              maintenanceModalLogs.classList.remove("maintenance-modal-logs--hidden");
              maintenanceModalLogs.textContent = data.logs;
            }
            if (maintenanceModalPanel && data.logs) {
              maintenanceModalPanel.classList.remove("maintenance-modal-panel--compact");
            }
            setResult(false, data.title || "执行失败");
            if (data.logs) setLogs(data.logs);
          } else {
            if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = data.title || "完成";
            setResult(true, data.title || "完成");
            setLogs(data.logs || "");
          }
          if (maintenanceModalClose) maintenanceModalClose.disabled = false;
          disableAllButtons(false);
          applyActionButtonsState();
          await syncRuntimeState();
        } catch (error) {
          setMaintenanceSpinner(false);
          reportTaskModalFailure(String(error), "");
          if (maintenanceModalClose) maintenanceModalClose.disabled = false;
          disableAllButtons(false);
          applyActionButtonsState();
        }
        return;
      }

      if (action === "oneThingSetup" || action === "feishuSetup") {
        if (uiUninstalling) {
          showFailure("正在卸载 OpenClaw，其他操作已禁用，请等待卸载完成。");
          return;
        }
        const titleCn = action === "oneThingSetup" ? "OneThingAI 配置引导" : "飞书配置（Playwright）";
        openTaskModal(titleCn, { context: "automation", showLogs: true });
        if (maintenanceModalClose) maintenanceModalClose.disabled = true;
        disableAllButtons(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        try {
          if (maintenanceModalStatusText) maintenanceModalStatusText.textContent = "正在启动自动化脚本…";
          const response = await fetch("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, payload }),
          });
          const data = await response.json();
          if (!response.ok || !data.ok) {
            reportTaskModalFailure(
              data.title || (action === "oneThingSetup" ? "OneThing 启动失败" : "飞书配置启动失败"),
              data.logs || "",
            );
            return;
          }
          setResult(true, data.title || "已启动");
          setLogs(data.logs || "");
          if (maintenanceModalLogs) maintenanceModalLogs.textContent = data.logs || "";
          if (maintenanceModalStatusText) {
            maintenanceModalStatusText.textContent = "请在打开的浏览器中完成操作，等待结果回写…";
          }
          setMaintenanceSpinner(true);
          await pollAutomationResultAndAutoFill(action, payload);
        } catch (error) {
          reportTaskModalFailure(String(error), "");
        } finally {
          setMaintenanceSpinner(false);
          if (maintenanceModalClose) maintenanceModalClose.disabled = false;
          disableAllButtons(false);
          applyActionButtonsState();
          await syncRuntimeState();
        }
        return;
      }

      try {
        setResult(true, "执行中: " + action + " ...");
        const response = await fetch("/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, payload })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          showFailure((data.title || (action + " 执行失败")), data.logs || "");
          await syncRuntimeState();
          return;
        }
        setResult(true, data.title || "完成");
        setLogs(data.logs || "");
        await syncRuntimeState();
      } catch (error) {
        showFailure(action + " 请求失败", String(error));
      }
    }

    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => invokeAction(btn.dataset.action));
    });

    document.getElementById("installSkillBtn").addEventListener("click", () => {
      const packageName = document.getElementById("skillPackage").value.trim();
      invokeAction("skillInstall", { packageName });
    });
    if (cancelInstallBtn) {
      cancelInstallBtn.addEventListener("click", async () => {
        await fetch("/install/cancel", { method: "POST" });
        await fetch("/app/exit", { method: "POST", keepalive: true });
        setInstalling(false);
        setResult(false, "安装已取消，正在关闭页面和终端进程...");
        setTimeout(() => {
          window.close();
          window.location.href = "about:blank";
        }, 500);
      });
    }
    const getFeishuBotName = () => {
      const input = document.getElementById("feishuBotName");
      return input ? input.value.trim() : "";
    };
    document.getElementById("feishuSetupBtn").addEventListener("click", () => {
      invokeAction("feishuSetup", { botName: getFeishuBotName() });
    });
    const scrollToSection = (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    const centerGuideStepOne = () => {
      const guideBtn = document.getElementById("guideStepOneBtn");
      const guideSection = document.getElementById("section-guide");
      if (guideBtn) {
        guideBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        guideBtn.classList.add("guide-focus");
        setTimeout(() => guideBtn.classList.remove("guide-focus"), 1400);
        return;
      }
      if (guideSection) {
        guideSection.scrollIntoView({ behavior: "smooth", block: "center" });
        guideSection.classList.add("guide-focus");
        setTimeout(() => guideSection.classList.remove("guide-focus"), 1400);
      }
    };
    document.getElementById("guideStepOneBtn").addEventListener("click", () => {
      scrollToSection("section-models");
    });
    document.getElementById("guideModelBtn").addEventListener("click", () => {
      scrollToSection("section-models");
      invokeAction("oneThingSetup");
    });
    document.getElementById("guideFeishuBtn").addEventListener("click", () => {
      scrollToSection("section-channels");
      invokeAction("feishuSetup", { botName: getFeishuBotName() });
    });
    if (daemonGuideTip) {
      daemonGuideTip.addEventListener("click", () => {
        if (!runtimeDaemonReady) {
          centerGuideStepOne();
        }
      });
    }

    document.getElementById("saveControlBtn").addEventListener("click", async () => {
      let parsedModels = [];
      try {
        parsedModels = JSON.parse(document.getElementById("modelsJson").value || "[]");
      } catch {
        setResult(false, "模型列表 JSON 格式错误");
        return;
      }
      const payload = {
        openclawHome: document.getElementById("openclawHome").value.trim(),
        stateDir: document.getElementById("stateDir").value.trim(),
        provider: document.getElementById("provider").value.trim(),
        baseUrl: document.getElementById("baseUrl").value.trim(),
        apiKeyEnv: document.getElementById("apiKeyEnv").value.trim(),
        defaultModel: document.getElementById("defaultModel").value.trim(),
        dailyLimit: document.getElementById("dailyLimit").value,
        modelsJson: JSON.stringify(parsedModels),
        feishuEnabled: document.getElementById("feishuEnabled").checked,
        feishuAppId: document.getElementById("feishuAppId").value.trim(),
        feishuAppSecret: document.getElementById("feishuAppSecret").value.trim(),
        feishuBotName: document.getElementById("feishuBotName").value.trim(),
        feishuWebhookUrl: document.getElementById("feishuWebhookUrl").value.trim(),
        qqEnabled: document.getElementById("qqEnabled").checked,
        qqBotId: document.getElementById("qqBotId").value.trim(),
        qqToken: document.getElementById("qqToken").value.trim(),
        wecomEnabled: document.getElementById("wecomEnabled").checked,
        wecomCorpId: document.getElementById("wecomCorpId").value.trim(),
        wecomAgentId: document.getElementById("wecomAgentId").value.trim(),
        wecomSecret: document.getElementById("wecomSecret").value.trim()
      };
      const response = await fetch("/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        setResult(true, "配置保存成功，正在应用配置...");
        setLogs(data.logs || "");
        await invokeAction("applyConfig");
      } else {
        showFailure("保存失败: " + (data.errors || []).join(" | "), (data.errors || []).join("\\n"));
      }
    });
  </script>
</body>
</html>`;
}
function renderChatPage(configPath) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenClaw 管理工具</title>
  <style>${commonStyles()}</style>
</head>
<body>
  <div class="wrap">
    <div class="nav">
      <a class="btn secondary" href="/dashboard">返回 Dashboard</a>
      <a class="btn secondary" href="/control">进入配置管理</a>
    </div>
    <h1>OpenClaw 管理工具</h1>
    <p class="sub">本地简化聊天页面（首版为本地会话回显，可后续接入 OpenClaw/Gateway）。</p>
    <div class="small">配置文件: <code>${escapeHtml(configPath)}</code></div>
    <section class="card">
      <h2>聊天</h2>
      <div id="chatLog">暂无消息</div>
      <div class="chatInput">
        <input id="chatInput" placeholder="输入消息..." />
        <button id="sendBtn">发送</button>
      </div>
    </section>
  </div>
  <script>
    const chatLog = document.getElementById("chatLog");
    const chatInput = document.getElementById("chatInput");
    const renderMessages = (messages) => {
      if (!messages.length) {
        chatLog.textContent = "暂无消息";
        return;
      }
      chatLog.textContent = messages.map((m) => "[" + m.createdAt + "] " + m.role + ": " + m.content).join("\\n");
      chatLog.scrollTop = chatLog.scrollHeight;
    };
    async function sendMessage() {
      const text = chatInput.value.trim();
      if (!text) return;
      const response = await fetch("/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text })
      });
      const data = await response.json();
      renderMessages(data.messages || []);
      chatInput.value = "";
    }
    document.getElementById("sendBtn").addEventListener("click", sendMessage);
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") sendMessage();
    });
    fetch("/chat/history").then((r) => r.json()).then((d) => renderMessages(d.messages || []));
  </script>
</body>
</html>`;
}
async function runConfigureUiCommand(options) {
    const configPath = options.configPath ?? (0, platform_1.getDefaultConfigPath)();
    const envOut = options.envOut;
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 18791;
    let existing = await (0, config_1.loadConfig)(configPath);
    const initialState = await detectRuntimeState();
    debugLog("server-init", { host, port, configPath, envOut: envOut ?? "", initialState });
    if (!initialState.openclawInstalled) {
        console.log("OpenClaw command not found yet. Use install button in control page.");
    }
    const server = node_http_1.default.createServer(async (req, res) => {
        if (!req.url) {
            debugLog("request-invalid", { method: req.method ?? "", url: "" });
            res.statusCode = 400;
            res.end("bad request");
            return;
        }
        debugLog("request", { method: req.method ?? "", url: req.url });
        if (req.method === "GET" && req.url === "/") {
            const runtime = await detectRuntimeState();
            res.statusCode = 302;
            res.setHeader("location", runtime.openclawInstalled ? "/control" : "/onboarding");
            res.end();
            return;
        }
        if (req.method === "GET" && req.url === "/dashboard") {
            const runtime = await detectRuntimeState();
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(renderDashboardPage(configPath, runtime));
            return;
        }
        if (req.method === "GET" && req.url === "/control") {
            const runtime = await detectRuntimeState();
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(renderControlPage(configPath, existing, runtime));
            return;
        }
        if (req.method === "GET" && req.url === "/onboarding") {
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(renderOnboardingPage(configPath));
            return;
        }
        if (req.method === "GET" && req.url === "/chat") {
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(renderChatPage(configPath));
            return;
        }
        if (req.method === "GET" && req.url === "/chat/history") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ messages: chatMessages }));
            return;
        }
        if (req.method === "GET" && req.url === "/runtime/state") {
            const runtime = await detectRuntimeState();
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(runtime));
            return;
        }
        if (req.method === "POST" && req.url === "/chat/send") {
            try {
                const body = await readBody(req);
                const message = asString(body.message)?.trim() ?? "";
                if (!message) {
                    res.statusCode = 400;
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({ ok: false, errors: ["message is required"] }));
                    return;
                }
                const now = new Date().toISOString();
                chatMessages.push({ role: "user", content: message, createdAt: now });
                chatMessages.push({
                    role: "assistant",
                    content: `已收到: ${message}。这是本地简化聊天页，后续可接入 OpenClaw Gateway。`,
                    createdAt: new Date().toISOString(),
                });
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: true, messages: chatMessages.slice(-50) }));
            }
            catch (error) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: false, errors: [String(error)] }));
            }
            return;
        }
        if (req.method === "POST" && req.url === "/install/start") {
            const started = startInstallJob();
            let failTitle = "安装任务已在运行中";
            if (!started && maintenanceJob.running && !installJob.running) {
                failTitle = "已有升级/检查任务进行中，请等待完成后再安装";
            }
            debugLog("install-start-route", { started });
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ok: started,
                title: started ? "安装任务已启动" : failTitle,
            }));
            return;
        }
        if (req.method === "GET" && req.url === "/install/status") {
            const now = Date.now();
            if (now - lastInstallStatusLogAt > 5000) {
                debugLog("install-status-route", { running: installJob.running, progress: installJob.progress });
                lastInstallStatusLogAt = now;
            }
            const elapsedSeconds = installJob.stepStartedAt ? Math.max(0, Math.floor((Date.now() - installJob.stepStartedAt) / 1000)) : 0;
            const idleSeconds = installJob.lastActivityAt ? Math.max(0, Math.floor((Date.now() - installJob.lastActivityAt) / 1000)) : 0;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ...installJob,
                elapsedSeconds,
                idleSeconds,
                logs: installJob.logs.slice(-120),
            }));
            return;
        }
        if (req.method === "POST" && req.url === "/uninstall/start") {
            const started = startUninstallJob();
            debugLog("uninstall-start-route", { started });
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ok: started,
                title: started ? "卸载任务已启动" : "当前已有运行中的安装/卸载/维护任务",
            }));
            return;
        }
        if (req.method === "GET" && req.url === "/uninstall/status") {
            const now = Date.now();
            if (now - lastUninstallStatusLogAt > 5000) {
                debugLog("uninstall-status-route", { running: uninstallJob.running, progress: uninstallJob.progress });
                lastUninstallStatusLogAt = now;
            }
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ...uninstallJob,
                logs: uninstallJob.logs.slice(-120),
            }));
            return;
        }
        if (req.method === "POST" && req.url === "/maintenance/start") {
            try {
                const body = await readBody(req);
                const kindRaw = asString(body.kind)?.trim() ?? "";
                const kind = kindRaw === "fix" ? "fix" : kindRaw === "update" ? "update" : "";
                if (kind !== "update" && kind !== "fix") {
                    res.statusCode = 400;
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({ ok: false, title: "无效的 kind", logs: "请使用 update 或 fix。" }));
                    return;
                }
                const started = startMaintenanceJob(kind);
                debugLog("maintenance-start-route", { started, kind });
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    ok: started,
                    title: started
                        ? kind === "update"
                            ? "升级任务已启动"
                            : "检查任务已启动"
                        : installJob.running || uninstallJob.running
                            ? "当前已有运行中的安装/卸载任务"
                            : "维护任务已在运行中",
                }));
            }
            catch (error) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: false, title: "维护任务启动失败", logs: String(error) }));
            }
            return;
        }
        if (req.method === "GET" && req.url === "/maintenance/status") {
            const now = Date.now();
            if (now - lastMaintenanceStatusLogAt > 5000) {
                debugLog("maintenance-status-route", { running: maintenanceJob.running, progress: maintenanceJob.progress });
                lastMaintenanceStatusLogAt = now;
            }
            const elapsedSeconds = maintenanceJob.stepStartedAt
                ? Math.max(0, Math.floor((Date.now() - maintenanceJob.stepStartedAt) / 1000))
                : 0;
            const idleSeconds = maintenanceJob.lastActivityAt
                ? Math.max(0, Math.floor((Date.now() - maintenanceJob.lastActivityAt) / 1000))
                : 0;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ...maintenanceJob,
                elapsedSeconds,
                idleSeconds,
                logs: maintenanceJob.logs.slice(-120),
            }));
            return;
        }
        if (req.method === "POST" && req.url === "/install/cancel") {
            const canceled = await cancelInstallJob();
            debugLog("install-cancel-route", { canceled });
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ok: canceled,
                title: canceled ? "安装任务已取消" : "当前没有运行中的安装任务",
            }));
            return;
        }
        if (req.method === "POST" && req.url === "/app/exit") {
            debugLog("app-exit-route", { installRunning: installJob.running });
            if (installJob.running) {
                await cancelInstallJob();
            }
            if (process.platform === "darwin") {
                void (0, exec_1.runCommand)("osascript", ["-e", 'tell application "Terminal" to quit']);
            }
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, title: "应用即将退出" }));
            setTimeout(() => {
                try {
                    process.kill(process.pid, "SIGINT");
                }
                catch {
                    // ignore
                }
            }, 100);
            return;
        }
        if (req.method === "POST" && req.url === "/save") {
            try {
                const body = await readBody(req);
                const next = parseConfigBody(body, existing, configPath);
                const errors = (0, config_1.validateConfig)(next);
                if (errors.length > 0) {
                    res.statusCode = 400;
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({ ok: false, errors }));
                    return;
                }
                await (0, config_1.saveConfig)(configPath, next);
                if (envOut) {
                    await (0, promises_1.writeFile)(envOut, (0, config_1.toEnv)(next), "utf8");
                }
                existing = next;
                debugLog("config-saved", {
                    openclawHome: next.openclaw.home ?? "",
                    stateDir: next.openclaw.stateDir ?? "",
                    defaultModel: next.models.defaultModel,
                });
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: true, title: "配置保存成功", logs: "Config saved to disk." }));
            }
            catch (error) {
                debugLog("config-save-error", { error: String(error) });
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: false, errors: [String(error)] }));
            }
            return;
        }
        if (req.method === "GET" && req.url === "/automation/onething/status") {
            const result = await tryReadJsonFile(getOpenClawSetupResultPath("onething"));
            const ready = result !== null;
            if (!ready) {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: true, ready: false, success: false, title: "等待 OneThing 自动化结果..." }));
                return;
            }
            const apiKey = typeof result?.captured?.apiKey === "string" ? result.captured.apiKey.trim() : "";
            const success = apiKey.length > 0;
            const tailSteps = Array.isArray(result?.steps) ? result.steps.slice(-10) : [];
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ok: true,
                ready: true,
                success,
                title: success ? "OneThing 自动化已完成" : "OneThing 自动化未捕获到 API Key",
                error: success
                    ? undefined
                    : tailSteps.length > 0
                        ? "最近步骤：\n" + tailSteps.map((s) => "- " + s).join("\n")
                        : "脚本已结束，但未捕获到 API Key。",
            }));
            return;
        }
        if (req.method === "POST" && req.url === "/automation/onething/apply") {
            try {
                const result = await tryReadJsonFile(getOpenClawSetupResultPath("onething"));
                if (!result) {
                    res.statusCode = 404;
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({ ok: false, title: "OneThing 结果尚未就绪" }));
                    return;
                }
                const apiKey = typeof result?.captured?.apiKey === "string" ? result.captured.apiKey.trim() : "";
                if (!apiKey) {
                    res.statusCode = 400;
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({
                        ok: false,
                        title: "OneThing 自动填充失败",
                        error: "未在结果中捕获到 API Key，请在 OneThing 浏览器中手动完成并重试。",
                    }));
                    return;
                }
                await (0, promises_1.mkdir)(getOpenClawDir(), { recursive: true });
                const envPath = getOpenClawDotEnvPath();
                let envText = "";
                try {
                    envText = await (0, promises_1.readFile)(envPath, "utf8");
                }
                catch {
                    envText = "";
                }
                const nextEnv = upsertDotEnvVar(envText, "ONETHINGAI_API_KEY", apiKey);
                await (0, promises_1.writeFile)(envPath, nextEnv, "utf8");
                const modelEntryToEnsure = {
                    id: "minimax-m2.1",
                    name: "Minimax M2.1",
                    contextWindow: 200000,
                    maxTokens: 8192,
                    reasoning: false,
                };
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    ok: true,
                    title: "OneThing 配置已自动回填",
                    logs: "已回填模型配置，并写入 ~/.openclaw/.env：ONETHINGAI_API_KEY（已隐藏）",
                    fields: {
                        models: {
                            provider: "onethingai",
                            baseUrl: "https://api-model.onethingai.com/v2/openai",
                            apiKeyEnv: "ONETHINGAI_API_KEY",
                            defaultModel: "onethingai/minimax-m2.1",
                        },
                    },
                    modelEntryToEnsure,
                }));
            }
            catch (error) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: false, title: "OneThing 回填失败", error: String(error) }));
            }
            return;
        }
        if (req.method === "GET" && req.url === "/automation/feishu/status") {
            const result = await tryReadJsonFile(getOpenClawSetupResultPath("feishu"));
            const ready = result !== null;
            if (!ready) {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: true, ready: false, success: false, title: "等待飞书自动化结果..." }));
                return;
            }
            const appId = typeof result?.captured?.appId === "string" ? result.captured.appId.trim() : "";
            const appSecret = typeof result?.captured?.appSecret === "string" ? result.captured.appSecret.trim() : "";
            const webhookUrl = typeof result?.captured?.webhookUrl === "string" ? result.captured.webhookUrl.trim() : "";
            const success = appId.length > 0 && appSecret.length > 0 && webhookUrl.length > 0;
            const tailSteps = Array.isArray(result?.steps) ? result.steps.slice(-10) : [];
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                ok: true,
                ready: true,
                success,
                title: success ? "飞书自动化已完成" : "飞书自动化未捕获到所需字段",
                error: success
                    ? undefined
                    : tailSteps.length > 0
                        ? "最近步骤：\n" + tailSteps.map((s) => "- " + s).join("\n")
                        : "脚本已结束，但未捕获到 App ID/Secret/Webhook URL。",
            }));
            return;
        }
        if (req.method === "POST" && req.url === "/automation/feishu/apply") {
            try {
                const result = await tryReadJsonFile(getOpenClawSetupResultPath("feishu"));
                if (!result) {
                    res.statusCode = 404;
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({ ok: false, title: "飞书结果尚未就绪" }));
                    return;
                }
                const appId = typeof result?.captured?.appId === "string" ? result.captured.appId.trim() : "";
                const appSecret = typeof result?.captured?.appSecret === "string" ? result.captured.appSecret.trim() : "";
                const webhookUrl = typeof result?.captured?.webhookUrl === "string" ? result.captured.webhookUrl.trim() : "";
                if (!appId || !appSecret || !webhookUrl) {
                    res.statusCode = 400;
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({
                        ok: false,
                        title: "飞书自动填充失败",
                        error: "未在结果中捕获到完整字段，请在飞书浏览器中手动完成并重试。",
                    }));
                    return;
                }
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    ok: true,
                    title: "飞书配置已自动回填",
                    fields: {
                        feishu: {
                            appId,
                            appSecret,
                            webhookUrl,
                        },
                    },
                }));
            }
            catch (error) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: false, title: "飞书回填失败", error: String(error) }));
            }
            return;
        }
        if (req.method === "POST" && req.url === "/action") {
            try {
                const body = await readBody(req);
                const action = asString(body.action) ?? "";
                const payloadRaw = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
                    ? body.payload
                    : {};
                const payload = {};
                for (const [key, value] of Object.entries(payloadRaw)) {
                    const str = asString(value);
                    if (str !== undefined) {
                        payload[key] = str;
                    }
                }
                const result = await runAction(action, payload);
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify(result));
            }
            catch (error) {
                debugLog("action-route-error", { error: String(error) });
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ ok: false, title: "Action failed", logs: String(error) }));
            }
            return;
        }
        res.statusCode = 404;
        debugLog("request-404", { method: req.method ?? "", url: req.url });
        res.end("not found");
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
    });
    debugLog("server-listening", { host, port });
    const url = `http://${host}:${port}/${initialState.openclawInstalled ? "control" : "onboarding"}`;
    console.log(`Config UI running at ${url}`);
    console.log("Press Ctrl+C to stop.");
    if (!options.noOpen) {
        openInBrowser(url);
    }
    return await new Promise((resolve) => {
        process.on("SIGINT", () => {
            debugLog("server-sigint", { message: "closing server" });
            server.close(() => resolve(0));
        });
    });
}
