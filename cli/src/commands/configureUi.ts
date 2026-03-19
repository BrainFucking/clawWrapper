import { readFile as readFileFromFs, writeFile } from "node:fs/promises";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { runCommand } from "../utils/exec";
import { commandExists, getDefaultConfigPath, getDefaultStateDir } from "../utils/platform";
import { loadConfig, saveConfig, toEnv, validateConfig, type OpenClawConfig } from "../openclaw/config";
import {
  DEFAULT_NPM_REGISTRY,
  prepareGithubTarballsForInstall,
  withMirrorRegistry,
} from "../openclaw/githubTarballs";
import {
  LOCAL_OPENCLAW_SOURCE_ABSOLUTE,
  LOCAL_OPENCLAW_SOURCE_RELATIVE,
  OPENCLAW_PINNED_REF,
  pathExists,
  preparePinnedOpenClawSource,
  verifyOpenClawSourcePreflight,
} from "../openclaw/source";

export interface ConfigureUiCommandOptions {
  configPath?: string;
  envOut?: string;
  host?: string;
  port?: number;
  noOpen?: boolean;
}

interface ActionResponse {
  ok: boolean;
  title: string;
  logs: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface RuntimeState {
  openclawInstalled: boolean;
  daemonReady: boolean;
  gatewayRunning: boolean;
}

const chatMessages: ChatMessage[] = [];

interface InstallJobState {
  running: boolean;
  completed: boolean;
  ok: boolean;
  canceled: boolean;
  progress: number;
  title: string;
  logs: string[];
  currentStep: string;
  currentCommand: string;
  currentPid: number | null;
  stepStartedAt: number | null;
  lastActivityAt: number | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  lastFailureReason: string;
}

interface UninstallJobState {
  running: boolean;
  completed: boolean;
  ok: boolean;
  progress: number;
  title: string;
  logs: string[];
  currentStep: string;
  startedAt: number | null;
  lastFailureReason: string;
}

let installJob: InstallJobState = {
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
let uninstallJob: UninstallJobState = {
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
let installChild: ChildProcess | null = null;
let lastInstallStatusLogAt = 0;
let lastUninstallStatusLogAt = 0;

function debugLog(message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  if (data === undefined) {
    console.log(`[manager-ui][${ts}] ${message}`);
    return;
  }
  try {
    console.log(`[manager-ui][${ts}] ${message} ${JSON.stringify(data)}`);
  } catch {
    console.log(`[manager-ui][${ts}] ${message}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function openInBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true";
  }
  return undefined;
}

function parseConfigBody(body: Record<string, unknown>, existing: OpenClawConfig, configPath: string): OpenClawConfig {
  const parsedModels = (() => {
    try {
      return JSON.parse(asString(body.modelsJson) ?? "[]") as OpenClawConfig["models"]["list"];
    } catch {
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
        appSecret:
          asString(body.feishuAppSecret) ?? existing.channels.feishu.appSecret ?? existing.feishu.appSecret,
        botName: asString(body.feishuBotName) ?? existing.channels.feishu.botName ?? existing.feishu.botName,
        webhookUrl:
          asString(body.feishuWebhookUrl) ??
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

async function ensureShellPathExported(userBin: string): Promise<void> {
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
        content = await readFileFromFs(file, "utf8");
      } catch {
        content = "";
      }
      if (content.includes(userBin) || content.includes(line)) {
        continue;
      }
      const next = content.trimEnd().length > 0 ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
      await writeFile(file, next, "utf8");
    } catch {
      // best-effort; do not fail install job if shell rc write fails
    }
  }
}

async function reloadProcessPathFromZshrc(log: (line: string) => void): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const zshrc = `${process.env.HOME ?? ""}/.zshrc`;
  if (!(await pathExists(zshrc))) {
    return;
  }
  const shell = process.env.SHELL && process.env.SHELL.trim().length > 0 ? process.env.SHELL : "/bin/zsh";
  const refreshed = await runCommand(shell, ["-lc", "source ~/.zshrc >/dev/null 2>&1 || true; printf '%s' \"$PATH\""]);
  if (refreshed.code === 0 && refreshed.stdout.trim()) {
    process.env.PATH = refreshed.stdout.trim();
    log("已执行 source ~/.zshrc，并刷新当前进程 PATH。");
  }
}

async function ensurePnpmAvailable(log: (line: string) => void): Promise<boolean> {
  const mirrorEnv = withMirrorRegistry();
  if (await commandExists("pnpm")) {
    return true;
  }
  if (await commandExists("corepack")) {
    log("未检测到 pnpm，尝试通过 corepack 激活 pnpm...");
    const activate = await runCommand("corepack", ["prepare", "pnpm@latest", "--activate"], { env: mirrorEnv });
    if (activate.stdout.trim()) {
      log(activate.stdout.trim());
    }
    if (activate.stderr.trim()) {
      log(activate.stderr.trim());
    }
    if (activate.code === 0 && (await commandExists("pnpm"))) {
      return true;
    }
  }
  if (await commandExists("npm")) {
    log("corepack 激活 pnpm 失败，尝试 npm 全局安装 pnpm...");
    const home = process.env.HOME ?? "";
    const userPrefix = home ? `${home}/.npm-global` : "";
    const userBin = userPrefix ? `${userPrefix}/bin` : "";
    if (userPrefix) {
      await runCommand("bash", ["-lc", `mkdir -p "${userPrefix}" "${userBin}"`], { env: mirrorEnv });
      await runCommand("npm", ["config", "set", "prefix", userPrefix], { env: mirrorEnv });
    }
    const installEnv: NodeJS.ProcessEnv = {
      ...mirrorEnv,
      PATH: userBin ? `${userBin}:${process.env.PATH ?? ""}` : (process.env.PATH ?? ""),
    };
    const install = await runCommand("npm", ["install", "-g", "pnpm"], { env: installEnv });
    if (install.stdout.trim()) {
      log(install.stdout.trim());
    }
    if (install.stderr.trim()) {
      log(install.stderr.trim());
    }
    if (install.code === 0 && (await commandExists("pnpm"))) {
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

async function ensurePnpmGlobalBinConfigured(log: (line: string) => void): Promise<NodeJS.ProcessEnv> {
  const env = withMirrorRegistry();
  const home = process.env.HOME ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  let pnpmHome = (process.env.PNPM_HOME ?? "").trim();
  if (!pnpmHome) {
    if (process.platform === "darwin" && home) {
      pnpmHome = `${home}/Library/pnpm`;
    } else if (process.platform === "win32" && localAppData) {
      pnpmHome = `${localAppData}\\pnpm`;
    } else if (home) {
      pnpmHome = `${home}/.local/share/pnpm`;
    }
  }
  if (!pnpmHome) {
    return env;
  }
  await runCommand(process.platform === "win32" ? "powershell" : "bash", process.platform === "win32"
    ? ["-NoProfile", "-Command", `New-Item -ItemType Directory -Path "${pnpmHome}" -Force | Out-Null`]
    : ["-lc", `mkdir -p "${pnpmHome}"`], { env });
  env.PNPM_HOME = pnpmHome;
  env.PATH = process.platform === "win32"
    ? `${pnpmHome};${process.env.PATH ?? ""}`
    : `${pnpmHome}:${process.env.PATH ?? ""}`;
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const configured = await runCommand(pnpmCmd, ["config", "set", "global-bin-dir", pnpmHome], { env });
  if (configured.code !== 0) {
    log(`警告: pnpm global-bin-dir 配置失败，继续尝试安装: ${configured.stderr.trim() || configured.stdout.trim()}`);
  }
  if (process.platform !== "win32") {
    await ensureShellPathExported(pnpmHome);
  }
  return env;
}

function isHealthyOpenClawProbe(result: { code: number; stdout: string; stderr: string }): boolean {
  if (result.code !== 0) {
    return false;
  }
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  // Guard against false positives from wrappers/stubs that still exit 0.
  if (
    /(command not found|not found|no such file|cannot find module|module not found|permission denied|operation not permitted|enoent|eacces)/i
      .test(text)
  ) {
    return false;
  }
  return true;
}

async function runAction(action: string, payload: Record<string, string>): Promise<ActionResponse> {
  debugLog("action-start", { action });
  const logs: string[] = [];
  const add = (line: string): void => {
    logs.push(line);
  };

  const exec = async (label: string, cmd: string, args: string[]): Promise<boolean> => {
    add(`$ ${cmd} ${args.join(" ")}`.trim());
    const result = await runCommand(cmd, args);
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

  const uninstallByPlatform = async (): Promise<boolean> => {
    const hasOpenClaw = await commandExists("openclaw");
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
      await runCommand("bash", [
        "-lc",
        "launchctl bootout gui/$UID/ai.openclaw.gateway || true && rm -f ~/Library/LaunchAgents/ai.openclaw.gateway.plist",
      ]);
    } else if (process.platform === "linux") {
      await runCommand("bash", [
        "-lc",
        "systemctl --user disable --now openclaw-gateway.service || true && rm -f ~/.config/systemd/user/openclaw-gateway.service && systemctl --user daemon-reload || true",
      ]);
    } else if (process.platform === "win32") {
      await runCommand("cmd", ["/c", "schtasks /Delete /F /TN \"OpenClaw Gateway\""], {
        shell: true,
      });
      await runCommand("powershell", [
        "-NoProfile",
        "-Command",
        "Remove-Item -Force \"$env:USERPROFILE\\.openclaw\\gateway.cmd\" -ErrorAction SilentlyContinue",
      ]);
    }

    const removeState = process.platform === "win32"
      ? await runCommand("powershell", [
          "-NoProfile",
          "-Command",
          "Remove-Item -Recurse -Force \"$env:OPENCLAW_STATE_DIR\" -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force \"$env:USERPROFILE\\.openclaw\" -ErrorAction SilentlyContinue",
        ])
      : await runCommand("bash", [
          "-lc",
          "rm -rf \"${OPENCLAW_STATE_DIR:-$HOME/.openclaw}\" \"$HOME/.openclaw/workspace\"",
        ]);
    add(removeState.stdout.trim());
    add(removeState.stderr.trim());

    const npmRemoved = await runCommand("npm", ["rm", "-g", "openclaw"]);
    add(npmRemoved.stdout.trim());
    add(npmRemoved.stderr.trim());
    add(`(exit ${npmRemoved.code})`);

    const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    if (await commandExists("pnpm")) {
      const pnpmRemoved = await runCommand(pnpmCmd, ["remove", "-g", "openclaw"]);
      add(pnpmRemoved.stdout.trim());
      add(pnpmRemoved.stderr.trim());
      add(`(exit ${pnpmRemoved.code})`);

      const pnpmUnlinked = await runCommand(pnpmCmd, ["unlink", "--global", "openclaw"]);
      add(pnpmUnlinked.stdout.trim());
      add(pnpmUnlinked.stderr.trim());
      add(`(exit ${pnpmUnlinked.code})`);
    }

    const stillInstalledByNpm = await isOpenClawNpmInstalled();
    const stillUsable = await isOpenClawBinaryUsable();
    if (stillInstalledByNpm || stillUsable) {
      add(
        `Post-uninstall probe still detects OpenClaw (npmInstalled=${stillInstalledByNpm}, binaryUsable=${stillUsable}).`,
      );
      return false;
    }
    return builtInOk || npmRemoved.code === 0 || !stillInstalledByNpm;
  };

  const startDetached = async (cmd: string, args: string[]): Promise<{ ok: boolean; error?: string }> => {
    return await new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, {
          detached: true,
          stdio: "ignore",
        });
        let settled = false;
        const finish = (result: { ok: boolean; error?: string }): void => {
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
      } catch (error) {
        resolve({ ok: false, error: String(error) });
      }
    });
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
    case "update": {
      const ok = await exec("Update OpenClaw", "npm", [
        "install",
        "-g",
        "openclaw@latest",
        "--verbose",
        "--progress=true",
      ]);
      const response = { ok, title: ok ? "Update completed" : "Update failed", logs: logs.join("\n") };
      debugLog("action-finish", { action, ok: response.ok });
      return response;
    }
    case "fix": {
      const doctorOk = await exec("Health check", "openclaw", ["doctor"]);
      const statusOk = await exec("Status check", "openclaw", ["status"]);
      const response = {
        ok: doctorOk && statusOk,
        title: doctorOk && statusOk ? "Fix checks completed" : "Fix checks found issues",
        logs: logs.join("\n"),
      };
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
      const botName = (payload.botName ?? "").trim() || "OpenClaw 助手";
      const outputPath = join(process.env.HOME ?? ".", ".openclaw", "feishu-setup-result.json");
      const feishuUrl = "https://open.feishu.cn/app";
      const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

      // Always try to open one visible browser tab first.
      const openedTab = process.platform === "darwin"
        ? await startDetached("open", [feishuUrl])
        : process.platform === "win32"
        ? await startDetached("cmd", ["/c", "start", "", feishuUrl])
        : await startDetached("xdg-open", [feishuUrl]);

      const hasPnpm = await commandExists("pnpm");
      const hasNpx = await commandExists("npx");
      if (!hasPnpm && !hasNpx) {
        const response = openedTab.ok
          ? {
              ok: true,
              title: "Feishu 页面已打开（手动模式）",
              logs:
                "已打开飞书页面，但未检测到 pnpm/npx，无法启动自动化。\n" +
                "请先扫码登录后手动完成创建应用与权限配置。",
            }
          : {
              ok: false,
              title: "Feishu 配置启动失败",
              logs:
                "未检测到 pnpm/npx，且无法自动打开浏览器。\n" +
                `浏览器错误: ${openedTab.error ?? "unknown error"}`,
            };
        debugLog("action-finish", { action, ok: response.ok });
        return response;
      }

      const pnpmPlaywrightCheck = hasPnpm
        ? await runCommand(pnpmCmd, ["exec", "playwright", "--version"])
        : { code: 1, stdout: "", stderr: "" };
      const npxPlaywrightCheck = hasNpx
        ? await runCommand(npxCmd, ["playwright", "--version"])
        : { code: 1, stdout: "", stderr: "" };
      const playwrightReady = pnpmPlaywrightCheck.code === 0 || npxPlaywrightCheck.code === 0;
      if (!playwrightReady) {
        const checkErr = [
          (pnpmPlaywrightCheck.stderr || pnpmPlaywrightCheck.stdout || "").trim(),
          (npxPlaywrightCheck.stderr || npxPlaywrightCheck.stdout || "").trim(),
        ]
          .filter(Boolean)
          .join("\n");
        const response = openedTab.ok
          ? {
              ok: true,
              title: "Feishu 页面已打开（手动模式）",
              logs:
                "已打开飞书页面，但 Playwright 不可用，自动化未启动。\n" +
                (checkErr || "Playwright check failed."),
            }
          : {
              ok: false,
              title: "Feishu 配置启动失败",
              logs:
                "Playwright 不可用，且无法自动打开浏览器。\n" +
                `浏览器错误: ${openedTab.error ?? "unknown error"}\n` +
                (checkErr || ""),
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

      const started = hasPnpm ? await startDetached(pnpmCmd, pnpmArgs) : await startDetached(npxCmd, npxArgs);
      if (!started.ok && hasPnpm && hasNpx) {
        const retry = await startDetached(npxCmd, npxArgs);
        if (!retry.ok) {
          const response = openedTab.ok
            ? {
                ok: true,
                title: "Feishu 页面已打开（手动模式）",
                logs:
                  "飞书页面已打开，但自动化启动失败。\n" +
                  ([started.error, retry.error].filter(Boolean).join("\n") || "无法启动 Feishu 自动化流程。"),
              }
            : {
                ok: false,
                title: "Feishu 配置启动失败",
                logs:
                  ([started.error, retry.error].filter(Boolean).join("\n") || "无法启动 Feishu 自动化流程。") +
                  `\n浏览器错误: ${openedTab.error ?? "unknown error"}`,
              };
          debugLog("action-finish", { action, ok: response.ok });
          return response;
        }
      } else if (!started.ok) {
        const response = openedTab.ok
          ? {
              ok: true,
              title: "Feishu 页面已打开（手动模式）",
              logs: "飞书页面已打开，但自动化启动失败。\n" + (started.error ?? "无法启动 Feishu 自动化流程。"),
            }
          : {
              ok: false,
              title: "Feishu 配置启动失败",
              logs: (started.error ?? "无法启动 Feishu 自动化流程。") + `\n浏览器错误: ${openedTab.error ?? "unknown error"}`,
            };
        debugLog("action-finish", { action, ok: response.ok });
        return response;
      }

      const response = {
        ok: true,
        title: "Feishu 自动化流程已启动",
        logs:
          `已打开飞书页面并启动单 Tab 自动化流程（botName=${botName}）。\n` +
          "请在弹出的飞书页面扫码登录，登录后脚本会自动尝试：创建应用、权限批量导入、机器人能力配置。\n" +
          `结果文件: ${outputPath}`,
      };
      debugLog("action-finish", { action, ok: response.ok, botName });
      return response;
    }
    case "oneThingSetup": {
      const outputPath = join(process.env.HOME ?? ".", ".openclaw", "onething-setup-result.json");
      const oneThingUrl = "https://onethingai.com/";
      const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      const openedTab = process.platform === "darwin"
        ? await startDetached("open", [oneThingUrl])
        : process.platform === "win32"
        ? await startDetached("cmd", ["/c", "start", "", oneThingUrl])
        : await startDetached("xdg-open", [oneThingUrl]);
      const hasPnpm = await commandExists("pnpm");
      const hasNpx = await commandExists("npx");
      if (!hasPnpm && !hasNpx) {
        const response = openedTab.ok
          ? {
              ok: true,
              title: "OneThingAI 页面已打开（手动模式）",
              logs: "已打开 OneThingAI 页面，但未检测到 pnpm/npx，无法启动自动化。",
            }
          : {
              ok: false,
              title: "OneThingAI 引导启动失败",
              logs:
                "未检测到 pnpm/npx，且无法自动打开浏览器。\n" +
                `浏览器错误: ${openedTab.error ?? "unknown error"}`,
            };
        debugLog("action-finish", { action, ok: response.ok });
        return response;
      }

      const pnpmPlaywrightCheck = hasPnpm
        ? await runCommand(pnpmCmd, ["exec", "playwright", "--version"])
        : { code: 1, stdout: "", stderr: "" };
      const npxPlaywrightCheck = hasNpx
        ? await runCommand(npxCmd, ["playwright", "--version"])
        : { code: 1, stdout: "", stderr: "" };
      const playwrightReady = pnpmPlaywrightCheck.code === 0 || npxPlaywrightCheck.code === 0;
      if (!playwrightReady) {
        const checkErr = [
          (pnpmPlaywrightCheck.stderr || pnpmPlaywrightCheck.stdout || "").trim(),
          (npxPlaywrightCheck.stderr || npxPlaywrightCheck.stdout || "").trim(),
        ]
          .filter(Boolean)
          .join("\n");
        const response = openedTab.ok
          ? {
              ok: true,
              title: "OneThingAI 页面已打开（手动模式）",
              logs:
                "已打开 OneThingAI 页面，但 Playwright 不可用，自动化未启动。\n" +
                (checkErr || "Playwright check failed."),
            }
          : {
              ok: false,
              title: "OneThingAI 引导启动失败",
              logs:
                "Playwright 不可用，且无法自动打开浏览器。\n" +
                `浏览器错误: ${openedTab.error ?? "unknown error"}\n` +
                (checkErr || ""),
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

      const started = hasPnpm ? await startDetached(pnpmCmd, pnpmArgs) : await startDetached(npxCmd, npxArgs);
      if (!started.ok && hasPnpm && hasNpx) {
        const retry = await startDetached(npxCmd, npxArgs);
        if (!retry.ok) {
          const response = openedTab.ok
            ? {
                ok: true,
                title: "OneThingAI 页面已打开（手动模式）",
                logs:
                  "OneThingAI 页面已打开，但自动化启动失败。\n" +
                  ([started.error, retry.error].filter(Boolean).join("\n") || "无法启动 OneThingAI 自动化流程。"),
              }
            : {
                ok: false,
                title: "OneThingAI 引导启动失败",
                logs:
                  ([started.error, retry.error].filter(Boolean).join("\n") || "无法启动 OneThingAI 自动化流程。") +
                  `\n浏览器错误: ${openedTab.error ?? "unknown error"}`,
              };
          debugLog("action-finish", { action, ok: response.ok });
          return response;
        }
      } else if (!started.ok) {
        const response = openedTab.ok
          ? {
              ok: true,
              title: "OneThingAI 页面已打开（手动模式）",
              logs: "OneThingAI 页面已打开，但自动化启动失败。\n" + (started.error ?? "无法启动 OneThingAI 自动化流程。"),
            }
          : {
              ok: false,
              title: "OneThingAI 引导启动失败",
              logs: (started.error ?? "无法启动 OneThingAI 自动化流程。") + `\n浏览器错误: ${openedTab.error ?? "unknown error"}`,
            };
        debugLog("action-finish", { action, ok: response.ok });
        return response;
      }

      const response = {
        ok: true,
        title: "OneThingAI 引导已启动",
        logs:
          "已打开 OneThingAI 页面并启动单 Tab 引导流程：注册/登录后自动尝试进入 API Keys 并创建 Key。\n" +
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

async function isOpenClawNpmInstalled(): Promise<boolean> {
  // Primary check: ask npm whether the openclaw package is globally installed.
  // This is the most reliable signal – immune to leftover symlinks / stubs.
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmList = await runCommand(npmCmd, ["list", "-g", "openclaw", "--depth=0", "--json"]);
  if (npmList.code === 0) {
    try {
      const parsed = JSON.parse(npmList.stdout);
      const deps = parsed?.dependencies ?? {};
      if (deps.openclaw) {
        debugLog("detect-state: npm list confirms openclaw installed", { version: deps.openclaw.version ?? "unknown" });
        return true;
      }
    } catch {
      // JSON parse failed – fall through to secondary checks
    }
  }

  // Also check with the user-local prefix in case npm was configured with --prefix ~/.npm-global
  const home = process.env.HOME ?? "";
  if (home && process.platform !== "win32") {
    const userPrefix = `${home}/.npm-global`;
    const userNpmList = await runCommand(npmCmd, ["list", "-g", "openclaw", "--depth=0", "--json", "--prefix", userPrefix]);
    if (userNpmList.code === 0) {
      try {
        const parsed = JSON.parse(userNpmList.stdout);
        const deps = parsed?.dependencies ?? {};
        if (deps.openclaw) {
          debugLog("detect-state: npm list (user prefix) confirms openclaw installed", { version: deps.openclaw.version ?? "unknown" });
          return true;
        }
      } catch {
        // fall through
      }
    }
  }

  debugLog("detect-state: npm list did not find openclaw in any global prefix");
  return false;
}

async function isOpenClawBinaryUsable(): Promise<boolean> {
  const foundInPath = await commandExists("openclaw");
  if (!foundInPath) {
    return false;
  }
  // Verify the binary actually works (not a broken stub)
  const versionProbe = await runCommand("openclaw", ["--version"]);
  return isHealthyOpenClawProbe(versionProbe);
}

async function isDaemonReady(binaryUsable: boolean): Promise<boolean> {
  if (!binaryUsable) {
    return false;
  }
  const status = await runCommand("openclaw", ["status"]);
  const text = `${status.stdout}\n${status.stderr}`.toLowerCase();
  if (status.code !== 0) {
    return false;
  }
  if (
    /(onboard --install-daemon|daemon not installed|daemon is not installed|daemon not configured|not configured|未安装.*daemon|请先.*install-daemon)/i
      .test(text)
  ) {
    return false;
  }
  if (/(daemon|gateway|service|launchagent|systemd|scheduler|running|active|installed|已安装|已配置|运行中)/i.test(text)) {
    return true;
  }
  return false;
}

async function isGatewayProcessRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const ps = await runCommand("powershell", [
        "-NoProfile",
        "-Command",
        "$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'openclaw\\s+gateway\\s+run' }; if ($p) { exit 0 } else { exit 1 }",
      ]);
      return ps.code === 0;
    }
    const probe = await runCommand("bash", [
      "-lc",
      "ps -ax -o command | awk '/openclaw gateway run/ {found=1} END{exit found?0:1}'",
    ]);
    return probe.code === 0;
  } catch {
    return false;
  }
}

async function isGatewayPortReady(): Promise<boolean> {
  const curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
  const hasCurl = await commandExists(curlCmd);
  if (!hasCurl) {
    return false;
  }
  const probe = await runCommand(curlCmd, ["--silent", "--show-error", "--max-time", "2", "http://127.0.0.1:18789"]);
  return probe.code === 0;
}

async function detectRuntimeState(): Promise<RuntimeState> {
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

function appendInstallLog(text: string): void {
  const normalized = text.trim();
  if (!normalized) {
    return;
  }
  installJob.logs.push(normalized);
  if (installJob.logs.length > 500) {
    installJob.logs = installJob.logs.slice(-500);
  }
}

function tailText(text: string, maxLines = 160, maxChars = 10000): string {
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

function extractNpmDebugLogPath(text: string): string | null {
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

async function appendNpmDebugLogTail(output: string): Promise<void> {
  const debugLogPath = extractNpmDebugLogPath(output);
  if (!debugLogPath) {
    return;
  }
  appendInstallLog(`检测到 npm debug 日志: ${debugLogPath}`);
  try {
    const content = await readFileFromFs(debugLogPath, "utf8");
    const snippet = tailText(content, 140, 9000);
    if (snippet) {
      appendInstallLog("npm debug log tail:");
      appendInstallLog(snippet);
    }
  } catch (error) {
    appendInstallLog(`读取 npm debug 日志失败: ${String(error)}`);
  }
}

function parsePercentFromOutput(text: string): number | null {
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

function parseNpmProgressFromOutput(text: string): number | null {
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

async function runInstallStep(
  cmd: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    inactivityTimeoutMs?: number;
    timeoutMs?: number;
    stepName?: string;
    useSyntheticProgress?: boolean;
  } = {},
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
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
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        shell: false,
        detached: process.platform !== "win32",
        env: options.env ?? process.env,
        cwd: options.cwd ?? process.cwd(),
      });
    } catch (error) {
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

    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(progressTicker);
      clearTimeout(stepTimeout);
      resolve(ok && !installJob.canceled);
    };

    const onChunk = (chunk: Buffer, source: "stdout" | "stderr"): void => {
      const text = chunk.toString();
      const parsed = parsePercentFromOutput(text);
      if (parsed !== null) {
        installJob.progress = Math.max(installJob.progress, parsed);
      } else if (isPackageInstallStep) {
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
      } else {
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
        const reason =
          `步骤无输出超时(${idleSec}s): ${commandText} (pid=${child.pid ?? "unknown"}, elapsed=${elapsedSec}s)`;
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
            void runCommand("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
          } else if (child.pid) {
            process.kill(-child.pid, "SIGTERM");
          }
        } catch {
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
          void runCommand("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
        } else if (child.pid) {
          process.kill(-child.pid, "SIGTERM");
        }
      } catch {
        // ignore
      }
      finish(false);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => onChunk(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => onChunk(chunk, "stderr"));
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

async function terminateInstallChild(): Promise<void> {
  const child = installChild;
  if (!child?.pid) {
    return;
  }

  if (process.platform === "win32") {
    const pid = String(child.pid);
    await runCommand("taskkill", ["/PID", pid, "/T", "/F"]);
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
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
    } catch {
      try {
        current.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 1500);
}

function startInstallJob(): boolean {
  if (installJob.running) {
    debugLog("install-job-start-skip", { reason: "already-running" });
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
  const sourceDir = LOCAL_OPENCLAW_SOURCE_ABSOLUTE;
  let activeSourceRef = OPENCLAW_PINNED_REF;
  let mirrorEnv = withMirrorRegistry();

  void (async () => {
    appendInstallLog(`使用镜像源: ${DEFAULT_NPM_REGISTRY}`);
    const packageJsonPath = join(sourceDir, "package.json");
    if (!(await pathExists(packageJsonPath))) {
      installJob.running = false;
      installJob.completed = true;
      installJob.ok = false;
      installJob.title = "安装失败（缺少本地源码）";
      installJob.lastFailureReason = `未找到本地源码: ${LOCAL_OPENCLAW_SOURCE_RELATIVE}`;
      appendInstallLog(`未找到本地源码目录 ${LOCAL_OPENCLAW_SOURCE_RELATIVE}。`);
      appendInstallLog("请先将 OpenClaw 源码放到 vendor/openclaw，再点击安装。");
      return;
    }

    const sourcePrepared = await preparePinnedOpenClawSource(sourceDir, OPENCLAW_PINNED_REF, appendInstallLog);
    if (!sourcePrepared.ok) {
      installJob.running = false;
      installJob.completed = true;
      installJob.ok = false;
      installJob.title = "安装失败（源码版本不匹配）";
      installJob.lastFailureReason = sourcePrepared.message ?? "源码版本校验失败";
      appendInstallLog(`已固定 OpenClaw 版本: ${OPENCLAW_PINNED_REF}`);
      appendInstallLog(sourcePrepared.message ?? "源码版本校验失败");
      appendInstallLog("请修复源码版本后重试，或重新执行 clone/checkout 到已验证版本。");
      return;
    }
    activeSourceRef = sourcePrepared.resolvedRef;
    if (sourcePrepared.fallbackUsed) {
      appendInstallLog(`Pinned ref ${OPENCLAW_PINNED_REF} 不可用，已回退到稳定版本 ${sourcePrepared.resolvedRef}。`);
    }
    appendInstallLog(`源码版本已确认: ${activeSourceRef} (${sourcePrepared.pinnedCommit.slice(0, 8)})`);

    const missingFiles = await verifyOpenClawSourcePreflight(sourceDir);
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

    const githubTarballs = await prepareGithubTarballsForInstall(sourceDir);
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
        const seeded = await runInstallStep(
          pnpmCmd,
          ["store", "add", file],
          { cwd: sourceDir, inactivityTimeoutMs: 3 * 60 * 1000, stepName: `pnpm store add ${file}`, env: mirrorEnv },
        );
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
    const depOk = await runInstallStep(
      pnpmCmd,
      ["install"],
      { cwd: sourceDir, inactivityTimeoutMs: 10 * 60 * 1000, stepName: "pnpm install", env: mirrorEnv },
    );
    if (!depOk) {
      installJob.running = false;
      installJob.completed = true;
      installJob.ok = false;
      installJob.title = "安装失败（依赖安装）";
      return;
    }

    installJob.progress = Math.max(installJob.progress, 40);
    const uiBuildOk = await runInstallStep(
      pnpmCmd,
      ["ui:build"],
      { cwd: sourceDir, inactivityTimeoutMs: 10 * 60 * 1000, stepName: "pnpm ui:build", env: mirrorEnv },
    );
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
    const coreBuildOk = await runInstallStep(
      pnpmCmd,
      ["build"],
      { cwd: sourceDir, inactivityTimeoutMs: 10 * 60 * 1000, stepName: "pnpm build", env: mirrorEnv },
    );
    if (!coreBuildOk) {
      installJob.running = false;
      installJob.completed = true;
      installJob.ok = false;
      installJob.title = "安装失败（核心构建）";
      return;
    }

    installJob.progress = Math.max(installJob.progress, 85);
    const linkOk = await runInstallStep(
      pnpmCmd,
      ["link", "--global"],
      { cwd: sourceDir, inactivityTimeoutMs: 3 * 60 * 1000, stepName: "pnpm link --global", env: mirrorEnv },
    );
    if (!linkOk) {
      installJob.running = false;
      installJob.completed = true;
      installJob.ok = false;
      installJob.title = "安装失败（全局链接）";
      return;
    }

    if (process.platform !== "win32") {
      const pnpmBin = await runCommand(pnpmCmd, ["bin", "-g"]);
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
    } else {
      installJob.title = "安装完成";
      installJob.lastFailureReason = "";
      appendInstallLog("OpenClaw 本地源码构建安装已完成。onboarding 已移到配置步骤，请点击“保存配置”应用。");
      debugLog("install-job-finished", { ok: true, phase: "local-source" });
    }
  })();

  return true;
}

async function cancelInstallJob(): Promise<boolean> {
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

function startUninstallJob(): boolean {
  if (uninstallJob.running || installJob.running) {
    debugLog("uninstall-job-start-skip", { uninstallRunning: uninstallJob.running, installRunning: installJob.running });
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
    } catch (error) {
      uninstallJob.running = false;
      uninstallJob.completed = true;
      uninstallJob.ok = false;
      uninstallJob.progress = 100;
      uninstallJob.title = "卸载失败";
      uninstallJob.currentStep = "failed";
      uninstallJob.lastFailureReason = String(error);
      uninstallJob.logs.push(`卸载任务异常: ${String(error)}`);
      debugLog("uninstall-job-error", { error: String(error) });
    } finally {
      clearInterval(ticker);
    }
  })();

  return true;
}

function commonStyles(): string {
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
    @media (max-width: 920px) { .grid, .row, .chatInput { grid-template-columns: 1fr; } }
  `;
}

function renderDashboardPage(configPath: string, state: RuntimeState): string {
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

function renderOnboardingPage(configPath: string): string {
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
      <div class="small">源码目录要求: <code>${escapeHtml(LOCAL_OPENCLAW_SOURCE_RELATIVE)}</code></div>
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

function renderControlPage(configPath: string, config: OpenClawConfig, state: RuntimeState): string {
  const requiresInstallDisabled = state.openclawInstalled ? "" : "disabled";
  const requiresDaemonDisabled = state.openclawInstalled && state.daemonReady ? "" : "disabled";
  const runGatewayDisabled = state.openclawInstalled && state.daemonReady && !state.gatewayRunning ? "" : "disabled";
  const installButtonHtml = state.openclawInstalled
    ? ""
    : `<button id="installBtn" data-action="install">安装 OpenClaw</button>`;
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
        <div id="uninstallingTip" class="installing-tip" style="color:#ff95aa;">正在卸载 OpenClaw，请稍候...</div>
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
          <input id="stateDir" value="${escapeHtml(config.openclaw.stateDir ?? getDefaultStateDir())}" />
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
        <div><label for="modelsJson">模型列表(JSON 数组)</label><textarea id="modelsJson">${escapeHtml(
          JSON.stringify(config.models.list, null, 2),
        )}</textarea></div>
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
      if (installSkillBtn) installSkillBtn.disabled = !runtimeOpenclawInstalled;
      if (saveControlBtn) saveControlBtn.disabled = !runtimeOpenclawInstalled;
      if (feishuSetupBtn) feishuSetupBtn.disabled = !runtimeOpenclawInstalled;
      if (guideFeishuBtn) guideFeishuBtn.disabled = !runtimeOpenclawInstalled;
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
    const showFailure = (msg, details = "") => {
      setResult(false, msg);
      if (details) setLogs(details);
      window.alert(msg);
    };
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
      if (!uninstallingTip) return;
      if (running) {
        if (uiUninstalling) return;
        uiUninstalling = true;
        disableAllButtons(true);
        let dots = 0;
        uninstallingTip.style.display = "block";
        const initial = Number.parseInt((uninstallingTip.dataset.progress || "0"), 10) || 0;
        uninstallingTip.textContent = "正在卸载 OpenClaw，请稍候 (" + initial + "%)";
        uninstallTick = setInterval(() => {
          dots = (dots + 1) % 4;
          const current = Number.parseInt((uninstallingTip.dataset.progress || "0"), 10) || 0;
          uninstallingTip.textContent = "正在卸载 OpenClaw，请稍候 (" + current + "%)" + ".".repeat(dots);
        }, 500);
      } else {
        uiUninstalling = false;
        if (uninstallTick) {
          clearInterval(uninstallTick);
          uninstallTick = null;
        }
        uninstallingTip.style.display = "none";
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

    async function invokeAction(action, payload = {}) {
      if (uiUninstalling && action !== "uninstall") {
        showFailure("正在卸载 OpenClaw，其他操作已禁用，请等待卸载完成。");
        return;
      }
      if (!runtimeOpenclawInstalled && action !== "install") {
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
        setResult(true, "正在启动卸载任务...");
        const startRes = await fetch("/uninstall/start", { method: "POST" });
        const startData = await startRes.json();
        if (!startRes.ok || !startData.ok) {
          showFailure("卸载启动失败: " + (startData.title || "无法启动卸载"), startData.logs || "");
          return;
        }
        setUninstalling(true);
        await refreshUninstallStatus();
        const poll = setInterval(async () => {
          const data = await refreshUninstallStatus();
          if (!data.running) {
            clearInterval(poll);
          }
        }, 2000);
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

function renderChatPage(configPath: string): string {
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

export async function runConfigureUiCommand(options: ConfigureUiCommandOptions): Promise<number> {
  const configPath = options.configPath ?? getDefaultConfigPath();
  const envOut = options.envOut;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 18791;
  let existing = await loadConfig(configPath);
  const initialState = await detectRuntimeState();
  debugLog("server-init", { host, port, configPath, envOut: envOut ?? "", initialState });
  if (!initialState.openclawInstalled) {
    console.log("OpenClaw command not found yet. Use install button in control page.");
  }

  const server = http.createServer(async (req, res) => {
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
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, errors: [String(error)] }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/install/start") {
      const started = startInstallJob();
      debugLog("install-start-route", { started });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: started,
          title: started ? "安装任务已启动" : "安装任务已在运行中",
        }),
      );
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
      res.end(
        JSON.stringify({
          ...installJob,
          elapsedSeconds,
          idleSeconds,
          logs: installJob.logs.slice(-120),
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/uninstall/start") {
      const started = startUninstallJob();
      debugLog("uninstall-start-route", { started });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: started,
          title: started ? "卸载任务已启动" : "当前已有运行中的安装/卸载任务",
        }),
      );
      return;
    }

    if (req.method === "GET" && req.url === "/uninstall/status") {
      const now = Date.now();
      if (now - lastUninstallStatusLogAt > 5000) {
        debugLog("uninstall-status-route", { running: uninstallJob.running, progress: uninstallJob.progress });
        lastUninstallStatusLogAt = now;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ...uninstallJob,
          logs: uninstallJob.logs.slice(-120),
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/install/cancel") {
      const canceled = await cancelInstallJob();
      debugLog("install-cancel-route", { canceled });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: canceled,
          title: canceled ? "安装任务已取消" : "当前没有运行中的安装任务",
        }),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/app/exit") {
      debugLog("app-exit-route", { installRunning: installJob.running });
      if (installJob.running) {
        await cancelInstallJob();
      }
      if (process.platform === "darwin") {
        void runCommand("osascript", ["-e", 'tell application "Terminal" to quit']);
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, title: "应用即将退出" }));
      setTimeout(() => {
        try {
          process.kill(process.pid, "SIGINT");
        } catch {
          // ignore
        }
      }, 100);
      return;
    }

    if (req.method === "POST" && req.url === "/save") {
      try {
        const body = await readBody(req);
        const next = parseConfigBody(body, existing, configPath);
        const errors = validateConfig(next);
        if (errors.length > 0) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, errors }));
          return;
        }
        await saveConfig(configPath, next);
        if (envOut) {
          await writeFile(envOut, toEnv(next), "utf8");
        }
        existing = next;
        debugLog("config-saved", {
          openclawHome: next.openclaw.home ?? "",
          stateDir: next.openclaw.stateDir ?? "",
          defaultModel: next.models.defaultModel,
        });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, title: "配置保存成功", logs: "Config saved to disk." }));
      } catch (error) {
        debugLog("config-save-error", { error: String(error) });
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, errors: [String(error)] }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/action") {
      try {
        const body = await readBody(req);
        const action = asString(body.action) ?? "";
        const payloadRaw =
          body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
            ? (body.payload as Record<string, unknown>)
            : {};
        const payload: Record<string, string> = {};
        for (const [key, value] of Object.entries(payloadRaw)) {
          const str = asString(value);
          if (str !== undefined) {
            payload[key] = str;
          }
        }
        const result = await runAction(action, payload);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(result));
      } catch (error) {
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

  await new Promise<void>((resolve, reject) => {
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

  return await new Promise<number>((resolve) => {
    process.on("SIGINT", () => {
      debugLog("server-sigint", { message: "closing server" });
      server.close(() => resolve(0));
    });
  });
}