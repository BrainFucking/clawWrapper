import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureApp } from "../actions/appCreation";
import { ensureCapability } from "../actions/capabilitySetup";
import { ensureConsoleReady } from "../actions/navigation";
import { importPermissions } from "../actions/permissionImport";
import { withRetry } from "../actions/actionUtils";
import { capturePageArtifacts } from "../browser/telemetry";
import { extractCredentialsFromPage } from "../extractors/credentials";
import { validateCapturedCredentials } from "../extractors/validators";
import { writeRunReport } from "../reporting/runReport";
import { createSecretStore } from "../security/secretStore";
import { getSelectorPack, resolveSelectorById } from "../selectors/selectorEngine";
import type {
  ActionOutcome,
  CapturedCredentials,
  SetupCheckpoint,
  SetupRequest,
  SetupResult,
  SetupStep,
  SetupStepEvent,
} from "../types";
import { runTokenCheck } from "../verification/tokenCheck";
import { runWebhookProbe } from "../verification/webhookProbe";
import { CheckpointStore } from "./checkpointStore";
import type { Page } from "playwright";

const DEFAULT_CONSOLE_URL = "https://open.feishu.cn/app";

interface RuntimeContext {
  runId: string;
  runsDir: string;
  checkpointStore: CheckpointStore;
  request: SetupRequest;
  stepEvents: SetupStepEvent[];
  captured: Partial<CapturedCredentials>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function baseRequestForCheckpoint(request: SetupRequest): Omit<SetupRequest, "resumeFromRunId"> {
  return {
    botName: request.botName,
    outputPath: request.outputPath,
    headless: request.headless,
    timeoutMs: request.timeoutMs,
    selectorPack: request.selectorPack,
    secretStore: request.secretStore,
    webhookProbe: request.webhookProbe,
  };
}

async function appendEvent(
  ctx: RuntimeContext,
  step: SetupStep,
  status: SetupStepEvent["status"],
  message: string,
  artifacts?: SetupStepEvent["artifacts"],
): Promise<void> {
  ctx.stepEvents.push({
    runId: ctx.runId,
    step,
    status,
    message,
    timestamp: nowIso(),
    artifacts,
  });
}

async function saveCheckpoint(
  ctx: RuntimeContext,
  status: SetupCheckpoint["status"],
  lastCompletedStep?: SetupStep,
): Promise<void> {
  const existing = await ctx.checkpointStore.load(ctx.runId);
  const createdAt = existing?.createdAt ?? nowIso();
  const checkpoint: SetupCheckpoint = {
    runId: ctx.runId,
    version: 1,
    status,
    lastCompletedStep,
    request: baseRequestForCheckpoint(ctx.request),
    captured: ctx.captured,
    createdAt,
    updatedAt: nowIso(),
  };
  await ctx.checkpointStore.save(checkpoint);
}

function runsDirFromOutput(outputPath: string): string {
  return path.join(path.dirname(path.resolve(outputPath)), ".feishu-v2-runs");
}

function checkpointRequest(base: SetupRequest, checkpoint: SetupCheckpoint): SetupRequest {
  return {
    ...checkpoint.request,
    outputPath: base.outputPath || checkpoint.request.outputPath,
    resumeFromRunId: checkpoint.runId,
  };
}

async function runManualLogin(page: import("playwright").Page, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const currentUrl = page.url();
      const body = (await page.locator("body").innerText({ timeout: 1200 })).toLowerCase();
      const loggedInByUrl = currentUrl.includes("open.feishu.cn/app");
      const loggedInByUi =
        body.includes("控制台") ||
        body.includes("开发者后台") ||
        body.includes("创建企业自建应用") ||
        body.includes("应用管理") ||
        body.includes("app id");
      if (loggedInByUrl && loggedInByUi) {
        return true;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return false;
}

function pausedResultFromContext(ctx: RuntimeContext, outputPath: string, nextAction: string): SetupResult {
  return {
    runId: ctx.runId,
    status: "paused_manual",
    outputPath,
    captured: {
      appId: ctx.captured.appId ?? "",
      webhookUrl: ctx.captured.webhookUrl,
    },
    verification: {
      tokenCheck: "skipped",
      webhookProbe: "skipped",
    },
    stepEvents: ctx.stepEvents,
    nextAction,
  };
}

function failedResultFromContext(ctx: RuntimeContext, outputPath: string, nextAction: string): SetupResult {
  return {
    runId: ctx.runId,
    status: "failed",
    outputPath,
    captured: {
      appId: ctx.captured.appId ?? "",
      webhookUrl: ctx.captured.webhookUrl,
    },
    verification: {
      tokenCheck: "skipped",
      webhookProbe: "skipped",
    },
    stepEvents: ctx.stepEvents,
    nextAction,
  };
}

async function handleActionOutcome(
  ctx: RuntimeContext,
  step: SetupStep,
  outcome: ActionOutcome<undefined>,
  outputPath: string,
  page: Page,
): Promise<SetupResult | undefined> {
  if (outcome.type === "ok") {
    await appendEvent(ctx, step, "ok", outcome.message);
    await saveCheckpoint(ctx, "running", step);
    return undefined;
  }
  if (outcome.type === "manual_required") {
    const artifacts = await capturePageArtifacts(
      page,
      path.join(ctx.runsDir, ctx.runId, "artifacts"),
      `${step.toLowerCase()}-manual`,
    );
    await appendEvent(ctx, step, "manual_required", `${outcome.message} ${outcome.hint}`, artifacts);
    await saveCheckpoint(ctx, "paused_manual");
    const result = pausedResultFromContext(ctx, outputPath, outcome.hint);
    await writeFile(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeRunReport(ctx.runsDir, result);
    return result;
  }
  const errorMessage =
    outcome.type === "retryable_error"
      ? `${outcome.message} Retries exhausted.`
      : outcome.message;
  const artifacts = await capturePageArtifacts(
    page,
    path.join(ctx.runsDir, ctx.runId, "artifacts"),
    `${step.toLowerCase()}-error`,
  );
  await appendEvent(ctx, step, "error", errorMessage, artifacts);
  await saveCheckpoint(ctx, "failed");
  const result = failedResultFromContext(ctx, outputPath, "Check report artifacts and rerun.");
  await writeFile(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeRunReport(ctx.runsDir, result);
  return result;
}

export async function runFeishuSetupV2(request: SetupRequest): Promise<SetupResult> {
  const runId = request.resumeFromRunId ?? randomUUID();
  const runsDir = runsDirFromOutput(request.outputPath);
  const checkpointStore = new CheckpointStore(runsDir);
  const checkpoint = request.resumeFromRunId ? await checkpointStore.load(request.resumeFromRunId) : undefined;
  const resolvedRequest = checkpoint ? checkpointRequest(request, checkpoint) : request;

  const ctx: RuntimeContext = {
    runId,
    runsDir,
    checkpointStore,
    request: resolvedRequest,
    stepEvents: [],
    captured: checkpoint?.captured ?? {},
  };
  const selectorPack = getSelectorPack(resolvedRequest.selectorPack);
  const selectors = (id: Parameters<typeof resolveSelectorById>[1]) =>
    resolveSelectorById(selectorPack, id).orderedCandidates;

  await mkdir(runsDir, { recursive: true });
  await saveCheckpoint(ctx, "running");

  const playwright = await import("playwright");
  const browser = await playwright.chromium.launch({ headless: resolvedRequest.headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await appendEvent(ctx, "OPEN_CONSOLE", "start", "Opening Feishu developer console.");
    await page.goto(DEFAULT_CONSOLE_URL, { waitUntil: "domcontentloaded" });
    await appendEvent(ctx, "OPEN_CONSOLE", "ok", "Feishu console opened.");
    await saveCheckpoint(ctx, "running", "OPEN_CONSOLE");

    await appendEvent(ctx, "WAIT_MANUAL_LOGIN", "start", "Waiting for manual QR login.");
    const loggedIn = await runManualLogin(page, resolvedRequest.timeoutMs ?? 5 * 60 * 1000);
    if (!loggedIn) {
      const artifacts = await capturePageArtifacts(
        page,
        path.join(ctx.runsDir, ctx.runId, "artifacts"),
        "wait_manual_login-timeout",
      );
      await appendEvent(
        ctx,
        "WAIT_MANUAL_LOGIN",
        "manual_required",
        "Login timed out. Resume after QR/captcha completion.",
        artifacts,
      );
      await saveCheckpoint(ctx, "paused_manual", "OPEN_CONSOLE");
      const pausedResult: SetupResult = {
        runId: ctx.runId,
        status: "paused_manual",
        outputPath: resolvedRequest.outputPath,
        captured: {
          appId: ctx.captured.appId ?? "",
          webhookUrl: ctx.captured.webhookUrl,
        },
        verification: {
          tokenCheck: "skipped",
          webhookProbe: "skipped",
        },
        stepEvents: ctx.stepEvents,
        nextAction: "Complete login in the opened browser and rerun with --resume-run-id.",
      };
      await writeFile(path.resolve(resolvedRequest.outputPath), `${JSON.stringify(pausedResult, null, 2)}\n`, "utf8");
      await writeRunReport(ctx.runsDir, pausedResult);
      return pausedResult;
    }
    await appendEvent(ctx, "WAIT_MANUAL_LOGIN", "ok", "Manual login detected.");
    await saveCheckpoint(ctx, "running", "WAIT_MANUAL_LOGIN");

    await appendEvent(ctx, "ENSURE_CONSOLE_READY", "start", "Ensuring console page readiness.");
    const consoleOutcome = await withRetry(() => ensureConsoleReady(page, selectors("consoleEntry")));
    const consoleResult = await handleActionOutcome(
      ctx,
      "ENSURE_CONSOLE_READY",
      consoleOutcome,
      resolvedRequest.outputPath,
      page,
    );
    if (consoleResult) {
      return consoleResult;
    }

    await appendEvent(ctx, "ENSURE_APP", "start", `Ensuring app exists: ${resolvedRequest.botName}`);
    const appOutcome = await withRetry(() =>
      ensureApp(page, resolvedRequest.botName, {
        createAppButton: selectors("createAppButton"),
        appNameInput: selectors("appNameInput"),
        saveButton: selectors("saveButton"),
      }),
    );
    const appResult = await handleActionOutcome(ctx, "ENSURE_APP", appOutcome, resolvedRequest.outputPath, page);
    if (appResult) {
      return appResult;
    }

    await appendEvent(ctx, "PERMISSIONS", "start", "Importing bot permissions.");
    const permissionOutcome = await withRetry(() =>
      importPermissions(page, {
        permissionNav: selectors("permissionNav"),
        batchImportButton: selectors("batchImportButton"),
        permissionImportInput: selectors("permissionImportInput"),
        saveButton: selectors("saveButton"),
      }),
    );
    const permissionResult = await handleActionOutcome(
      ctx,
      "PERMISSIONS",
      permissionOutcome,
      resolvedRequest.outputPath,
      page,
    );
    if (permissionResult) {
      return permissionResult;
    }

    await appendEvent(ctx, "CAPABILITIES", "start", "Configuring bot capabilities.");
    const capabilityOutcome = await withRetry(() =>
      ensureCapability(page, resolvedRequest.botName, {
        capabilityNav: selectors("capabilityNav"),
        botCapability: selectors("botCapability"),
        appNameInput: selectors("appNameInput"),
        saveButton: selectors("saveButton"),
      }),
    );
    const capabilityResult = await handleActionOutcome(
      ctx,
      "CAPABILITIES",
      capabilityOutcome,
      resolvedRequest.outputPath,
      page,
    );
    if (capabilityResult) {
      return capabilityResult;
    }

    await appendEvent(ctx, "EXTRACT_CREDENTIALS", "start", "Extracting credentials from current page.");
    const extracted = await extractCredentialsFromPage(page);
    ctx.captured = { ...ctx.captured, ...extracted };
    const credentialErrors = validateCapturedCredentials({
      appId: ctx.captured.appId ?? "",
      appSecret: ctx.captured.appSecret,
      webhookUrl: ctx.captured.webhookUrl,
    });
    if (credentialErrors.length > 0) {
      const artifacts = await capturePageArtifacts(
        page,
        path.join(ctx.runsDir, ctx.runId, "artifacts"),
        "extract_credentials-manual",
      );
      await appendEvent(ctx, "EXTRACT_CREDENTIALS", "manual_required", credentialErrors.join(" "), artifacts);
    } else {
      await appendEvent(ctx, "EXTRACT_CREDENTIALS", "ok", "Credential extraction passed basic validation.");
    }
    await saveCheckpoint(ctx, "running", "EXTRACT_CREDENTIALS");

    await appendEvent(ctx, "VERIFY", "start", "Running token/webhook checks.");
    const secretStore = createSecretStore({
      kind: resolvedRequest.secretStore ?? "memory",
      secretsDir: path.join(os.homedir(), ".openclaw", "feishu-v2-secrets"),
    });
    const secretRef = ctx.captured.appSecret ? await secretStore.put(ctx.captured.appSecret) : undefined;
    const tokenCheck = await runTokenCheck(ctx.captured.appId ?? "", ctx.captured.appSecret);
    const webhookProbe = await runWebhookProbe(ctx.captured.webhookUrl, Boolean(resolvedRequest.webhookProbe));
    await appendEvent(ctx, "VERIFY", "ok", `Verification finished. token=${tokenCheck}, webhook=${webhookProbe}`);
    await saveCheckpoint(ctx, "running", "VERIFY");

    const result: SetupResult = {
      runId: ctx.runId,
      status: "completed",
      outputPath: resolvedRequest.outputPath,
      captured: {
        appId: ctx.captured.appId ?? "",
        webhookUrl: ctx.captured.webhookUrl,
        secretRef,
      },
      verification: { tokenCheck, webhookProbe },
      stepEvents: ctx.stepEvents,
    };

    await appendEvent(ctx, "PERSIST", "start", "Persisting setup result and run report.");
    await writeFile(path.resolve(resolvedRequest.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeRunReport(ctx.runsDir, result);
    await appendEvent(ctx, "PERSIST", "ok", "Result persisted.");
    await saveCheckpoint(ctx, "completed", "PERSIST");

    return result;
  } catch (error) {
    const artifacts = await capturePageArtifacts(
      page,
      path.join(ctx.runsDir, ctx.runId, "artifacts"),
      "run-failed",
    );
    await appendEvent(ctx, "PERSIST", "error", `Run failed: ${String(error)}`, artifacts);
    await saveCheckpoint(ctx, "failed");
    const failedResult: SetupResult = {
      runId: ctx.runId,
      status: "failed",
      outputPath: resolvedRequest.outputPath,
      captured: {
        appId: ctx.captured.appId ?? "",
        webhookUrl: ctx.captured.webhookUrl,
      },
      verification: {
        tokenCheck: "skipped",
        webhookProbe: "skipped",
      },
      stepEvents: ctx.stepEvents,
      nextAction: "Inspect run report artifacts and resume or rerun setup.",
    };
    await writeFile(path.resolve(resolvedRequest.outputPath), `${JSON.stringify(failedResult, null, 2)}\n`, "utf8");
    await writeRunReport(ctx.runsDir, failedResult);
    return failedResult;
  } finally {
    await browser.close();
  }
}

