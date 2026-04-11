"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFeishuSetupV2 = runFeishuSetupV2;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const appCreation_1 = require("../actions/appCreation");
const capabilitySetup_1 = require("../actions/capabilitySetup");
const navigation_1 = require("../actions/navigation");
const permissionImport_1 = require("../actions/permissionImport");
const actionUtils_1 = require("../actions/actionUtils");
const telemetry_1 = require("../browser/telemetry");
const credentials_1 = require("../extractors/credentials");
const validators_1 = require("../extractors/validators");
const runReport_1 = require("../reporting/runReport");
const secretStore_1 = require("../security/secretStore");
const selectorEngine_1 = require("../selectors/selectorEngine");
const tokenCheck_1 = require("../verification/tokenCheck");
const webhookProbe_1 = require("../verification/webhookProbe");
const checkpointStore_1 = require("./checkpointStore");
const DEFAULT_CONSOLE_URL = "https://open.feishu.cn/app";
function nowIso() {
    return new Date().toISOString();
}
function baseRequestForCheckpoint(request) {
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
async function appendEvent(ctx, step, status, message, artifacts) {
    ctx.stepEvents.push({
        runId: ctx.runId,
        step,
        status,
        message,
        timestamp: nowIso(),
        artifacts,
    });
}
async function saveCheckpoint(ctx, status, lastCompletedStep) {
    const existing = await ctx.checkpointStore.load(ctx.runId);
    const createdAt = existing?.createdAt ?? nowIso();
    const checkpoint = {
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
function runsDirFromOutput(outputPath) {
    return node_path_1.default.join(node_path_1.default.dirname(node_path_1.default.resolve(outputPath)), ".feishu-v2-runs");
}
function checkpointRequest(base, checkpoint) {
    return {
        ...checkpoint.request,
        outputPath: base.outputPath || checkpoint.request.outputPath,
        resumeFromRunId: checkpoint.runId,
    };
}
async function runManualLogin(page, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const currentUrl = page.url();
            const body = (await page.locator("body").innerText({ timeout: 1200 })).toLowerCase();
            const loggedInByUrl = currentUrl.includes("open.feishu.cn/app");
            const loggedInByUi = body.includes("控制台") ||
                body.includes("开发者后台") ||
                body.includes("创建企业自建应用") ||
                body.includes("应用管理") ||
                body.includes("app id");
            if (loggedInByUrl && loggedInByUi) {
                return true;
            }
        }
        catch {
            // keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return false;
}
function pausedResultFromContext(ctx, outputPath, nextAction) {
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
function failedResultFromContext(ctx, outputPath, nextAction) {
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
async function handleActionOutcome(ctx, step, outcome, outputPath, page) {
    if (outcome.type === "ok") {
        await appendEvent(ctx, step, "ok", outcome.message);
        await saveCheckpoint(ctx, "running", step);
        return undefined;
    }
    if (outcome.type === "manual_required") {
        const artifacts = await (0, telemetry_1.capturePageArtifacts)(page, node_path_1.default.join(ctx.runsDir, ctx.runId, "artifacts"), `${step.toLowerCase()}-manual`);
        await appendEvent(ctx, step, "manual_required", `${outcome.message} ${outcome.hint}`, artifacts);
        await saveCheckpoint(ctx, "paused_manual");
        const result = pausedResultFromContext(ctx, outputPath, outcome.hint);
        await (0, promises_1.writeFile)(node_path_1.default.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
        await (0, runReport_1.writeRunReport)(ctx.runsDir, result);
        return result;
    }
    const errorMessage = outcome.type === "retryable_error"
        ? `${outcome.message} Retries exhausted.`
        : outcome.message;
    const artifacts = await (0, telemetry_1.capturePageArtifacts)(page, node_path_1.default.join(ctx.runsDir, ctx.runId, "artifacts"), `${step.toLowerCase()}-error`);
    await appendEvent(ctx, step, "error", errorMessage, artifacts);
    await saveCheckpoint(ctx, "failed");
    const result = failedResultFromContext(ctx, outputPath, "Check report artifacts and rerun.");
    await (0, promises_1.writeFile)(node_path_1.default.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await (0, runReport_1.writeRunReport)(ctx.runsDir, result);
    return result;
}
async function runFeishuSetupV2(request) {
    const runId = request.resumeFromRunId ?? (0, node_crypto_1.randomUUID)();
    const runsDir = runsDirFromOutput(request.outputPath);
    const checkpointStore = new checkpointStore_1.CheckpointStore(runsDir);
    const checkpoint = request.resumeFromRunId ? await checkpointStore.load(request.resumeFromRunId) : undefined;
    const resolvedRequest = checkpoint ? checkpointRequest(request, checkpoint) : request;
    const ctx = {
        runId,
        runsDir,
        checkpointStore,
        request: resolvedRequest,
        stepEvents: [],
        captured: checkpoint?.captured ?? {},
    };
    const selectorPack = (0, selectorEngine_1.getSelectorPack)(resolvedRequest.selectorPack);
    const selectors = (id) => (0, selectorEngine_1.resolveSelectorById)(selectorPack, id).orderedCandidates;
    await (0, promises_1.mkdir)(runsDir, { recursive: true });
    await saveCheckpoint(ctx, "running");
    const playwright = await Promise.resolve().then(() => __importStar(require("playwright")));
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
            const artifacts = await (0, telemetry_1.capturePageArtifacts)(page, node_path_1.default.join(ctx.runsDir, ctx.runId, "artifacts"), "wait_manual_login-timeout");
            await appendEvent(ctx, "WAIT_MANUAL_LOGIN", "manual_required", "Login timed out. Resume after QR/captcha completion.", artifacts);
            await saveCheckpoint(ctx, "paused_manual", "OPEN_CONSOLE");
            const pausedResult = {
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
            await (0, promises_1.writeFile)(node_path_1.default.resolve(resolvedRequest.outputPath), `${JSON.stringify(pausedResult, null, 2)}\n`, "utf8");
            await (0, runReport_1.writeRunReport)(ctx.runsDir, pausedResult);
            return pausedResult;
        }
        await appendEvent(ctx, "WAIT_MANUAL_LOGIN", "ok", "Manual login detected.");
        await saveCheckpoint(ctx, "running", "WAIT_MANUAL_LOGIN");
        await appendEvent(ctx, "ENSURE_CONSOLE_READY", "start", "Ensuring console page readiness.");
        const consoleOutcome = await (0, actionUtils_1.withRetry)(() => (0, navigation_1.ensureConsoleReady)(page, selectors("consoleEntry")));
        const consoleResult = await handleActionOutcome(ctx, "ENSURE_CONSOLE_READY", consoleOutcome, resolvedRequest.outputPath, page);
        if (consoleResult) {
            return consoleResult;
        }
        await appendEvent(ctx, "ENSURE_APP", "start", `Ensuring app exists: ${resolvedRequest.botName}`);
        const appOutcome = await (0, actionUtils_1.withRetry)(() => (0, appCreation_1.ensureApp)(page, resolvedRequest.botName, {
            createAppButton: selectors("createAppButton"),
            appNameInput: selectors("appNameInput"),
            saveButton: selectors("saveButton"),
        }));
        const appResult = await handleActionOutcome(ctx, "ENSURE_APP", appOutcome, resolvedRequest.outputPath, page);
        if (appResult) {
            return appResult;
        }
        await appendEvent(ctx, "PERMISSIONS", "start", "Importing bot permissions.");
        const permissionOutcome = await (0, actionUtils_1.withRetry)(() => (0, permissionImport_1.importPermissions)(page, {
            permissionNav: selectors("permissionNav"),
            batchImportButton: selectors("batchImportButton"),
            permissionImportInput: selectors("permissionImportInput"),
            saveButton: selectors("saveButton"),
        }));
        const permissionResult = await handleActionOutcome(ctx, "PERMISSIONS", permissionOutcome, resolvedRequest.outputPath, page);
        if (permissionResult) {
            return permissionResult;
        }
        await appendEvent(ctx, "CAPABILITIES", "start", "Configuring bot capabilities.");
        const capabilityOutcome = await (0, actionUtils_1.withRetry)(() => (0, capabilitySetup_1.ensureCapability)(page, resolvedRequest.botName, {
            capabilityNav: selectors("capabilityNav"),
            botCapability: selectors("botCapability"),
            appNameInput: selectors("appNameInput"),
            saveButton: selectors("saveButton"),
        }));
        const capabilityResult = await handleActionOutcome(ctx, "CAPABILITIES", capabilityOutcome, resolvedRequest.outputPath, page);
        if (capabilityResult) {
            return capabilityResult;
        }
        await appendEvent(ctx, "EXTRACT_CREDENTIALS", "start", "Extracting credentials from current page.");
        const extracted = await (0, credentials_1.extractCredentialsFromPage)(page);
        ctx.captured = { ...ctx.captured, ...extracted };
        const credentialErrors = (0, validators_1.validateCapturedCredentials)({
            appId: ctx.captured.appId ?? "",
            appSecret: ctx.captured.appSecret,
            webhookUrl: ctx.captured.webhookUrl,
        });
        if (credentialErrors.length > 0) {
            const artifacts = await (0, telemetry_1.capturePageArtifacts)(page, node_path_1.default.join(ctx.runsDir, ctx.runId, "artifacts"), "extract_credentials-manual");
            await appendEvent(ctx, "EXTRACT_CREDENTIALS", "manual_required", credentialErrors.join(" "), artifacts);
        }
        else {
            await appendEvent(ctx, "EXTRACT_CREDENTIALS", "ok", "Credential extraction passed basic validation.");
        }
        await saveCheckpoint(ctx, "running", "EXTRACT_CREDENTIALS");
        await appendEvent(ctx, "VERIFY", "start", "Running token/webhook checks.");
        const secretStore = (0, secretStore_1.createSecretStore)({
            kind: resolvedRequest.secretStore ?? "memory",
            secretsDir: node_path_1.default.join(node_os_1.default.homedir(), ".openclaw", "feishu-v2-secrets"),
        });
        const secretRef = ctx.captured.appSecret ? await secretStore.put(ctx.captured.appSecret) : undefined;
        const tokenCheck = await (0, tokenCheck_1.runTokenCheck)(ctx.captured.appId ?? "", ctx.captured.appSecret);
        const webhookProbe = await (0, webhookProbe_1.runWebhookProbe)(ctx.captured.webhookUrl, Boolean(resolvedRequest.webhookProbe));
        await appendEvent(ctx, "VERIFY", "ok", `Verification finished. token=${tokenCheck}, webhook=${webhookProbe}`);
        await saveCheckpoint(ctx, "running", "VERIFY");
        const result = {
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
        await (0, promises_1.writeFile)(node_path_1.default.resolve(resolvedRequest.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
        await (0, runReport_1.writeRunReport)(ctx.runsDir, result);
        await appendEvent(ctx, "PERSIST", "ok", "Result persisted.");
        await saveCheckpoint(ctx, "completed", "PERSIST");
        return result;
    }
    catch (error) {
        const artifacts = await (0, telemetry_1.capturePageArtifacts)(page, node_path_1.default.join(ctx.runsDir, ctx.runId, "artifacts"), "run-failed");
        await appendEvent(ctx, "PERSIST", "error", `Run failed: ${String(error)}`, artifacts);
        await saveCheckpoint(ctx, "failed");
        const failedResult = {
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
        await (0, promises_1.writeFile)(node_path_1.default.resolve(resolvedRequest.outputPath), `${JSON.stringify(failedResult, null, 2)}\n`, "utf8");
        await (0, runReport_1.writeRunReport)(ctx.runsDir, failedResult);
        return failedResult;
    }
    finally {
        await browser.close();
    }
}
