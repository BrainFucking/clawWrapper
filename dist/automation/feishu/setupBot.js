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
exports.runGuidedFeishuSetup = runGuidedFeishuSetup;
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const selectors_1 = require("./selectors");
const FEISHU_PERMISSION_IMPORT_JSON = JSON.stringify({
    scopes: {
        tenant: [
            "aily:file:read",
            "aily:file:write",
            "application:application.app_message_stats.overview:readonly",
            "application:application:self_manage",
            "application:bot.menu:write",
            "cardkit:card:write",
            "contact:user.employee_id:readonly",
            "corehr:file:download",
            "docs:document.content:read",
            "event:ip_list",
            "im:chat",
            "im:chat.access_event.bot_p2p_chat:read",
            "im:chat.members:bot_access",
            "im:message",
            "im:message.group_at_msg:readonly",
            "im:message.group_msg",
            "im:message.p2p_msg:readonly",
            "im:message:readonly",
            "im:message:send_as_bot",
            "im:resource",
            "sheets:spreadsheet",
            "wiki:wiki:readonly",
        ],
        user: ["aily:file:read", "aily:file:write", "im:chat.access_event.bot_p2p_chat:read"],
    },
}, null, 2);
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function clickFirstVisible(page, selectors) {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
            if (await locator.isVisible({ timeout: 1200 })) {
                await locator.click({ timeout: 2000 });
                return true;
            }
        }
        catch {
            // try next selector
        }
    }
    return false;
}
async function fillFirstVisible(page, selectors, value) {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
            if (await locator.isVisible({ timeout: 1200 })) {
                await locator.fill(value, { timeout: 2000 });
                return true;
            }
        }
        catch {
            // try next selector
        }
    }
    return false;
}
async function fillPermissionImportTextBestEffort(page, value) {
    // 1) direct fill via known inputs
    const filledDirect = await fillFirstVisible(page, selectors_1.feishuSelectors.permissionImportInputs, value);
    if (filledDirect) {
        return true;
    }
    // 2) click contenteditable then keyboard paste/type fallback
    try {
        const editable = page.locator('[contenteditable="true"]').first();
        if (await editable.isVisible({ timeout: 1200 })) {
            await editable.click({ timeout: 2000 });
            await page.keyboard.press("Meta+A").catch(async () => {
                await page.keyboard.press("Control+A");
            });
            await page.keyboard.type(value, { delay: 0 });
            return true;
        }
    }
    catch {
        // ignore
    }
    return false;
}
async function capturePageDebug(page, label, steps) {
    try {
        const url = page.url();
        const body = await page.locator("body").innerText().catch(() => "");
        const snippet = body.slice(0, 240).replaceAll("\n", " ");
        steps.push(`DEBUG ${label} url=${url}`);
        steps.push(`DEBUG ${label} snippet=${snippet}`);
    }
    catch {
        // best-effort
    }
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function collectCliAppIdsFromLinks(page) {
    const links = page.locator('a[href*="/app/cli_"]');
    const n = await links.count().catch(() => 0);
    const ids = new Set();
    for (let i = 0; i < n; i++) {
        const href = (await links.nth(i).getAttribute("href").catch(() => null)) ?? "";
        const m = href.match(/(cli_[a-zA-Z0-9]+)/);
        if (m) {
            ids.add(m[1]);
        }
    }
    return [...ids];
}
async function openAppDetailsByNameBestEffort(page, botName, steps) {
    const normalized = botName.trim();
    if (!normalized)
        return false;
    try {
        const appLink = page
            .locator('a[href*="/app/cli_"]')
            .filter({ hasText: new RegExp(escapeRegExp(normalized), "i") })
            .first();
        if (await appLink.isVisible({ timeout: 3000 })) {
            await appLink.click({ timeout: 4000 });
            await delay(1500);
            steps.push(`Opened app via list link matching name: ${normalized}`);
            return true;
        }
    }
    catch {
        // continue
    }
    try {
        const byText = page.getByText(normalized, { exact: false }).first();
        if (await byText.isVisible({ timeout: 2500 })) {
            await byText.click({ timeout: 3000 });
            await delay(1200);
            steps.push(`Opened app details by name: ${normalized}`);
            return true;
        }
    }
    catch {
        // continue
    }
    try {
        const entry = page.locator(`a:has-text("${normalized}"), button:has-text("${normalized}"), [role="link"]:has-text("${normalized}")`).first();
        if (await entry.isVisible({ timeout: 2500 })) {
            await entry.click({ timeout: 3000 });
            await delay(1200);
            steps.push(`Opened app details via link/button: ${normalized}`);
            return true;
        }
    }
    catch {
        // continue
    }
    try {
        const manage = page.locator('button:has-text("管理"), a:has-text("管理"), button:has-text("进入开发"), a:has-text("进入开发")').first();
        if (await manage.isVisible({ timeout: 2000 })) {
            await manage.click({ timeout: 3000 });
            await delay(1200);
            steps.push("Opened app details via 管理/进入开发 button.");
            return true;
        }
    }
    catch {
        // continue
    }
    return false;
}
async function resolveCliAppIdFromContext(page, botName, steps) {
    const fromUrl = extractByRegex(page.url(), /\/(cli_[a-zA-Z0-9]+)/);
    if (fromUrl) {
        return fromUrl;
    }
    const ids = await collectCliAppIdsFromLinks(page);
    if (ids.length === 1) {
        const only = ids[0];
        steps.push(`Detected single app id on page: ${only}`);
        return only;
    }
    const normalized = botName.trim();
    if (normalized) {
        for (const id of ids) {
            const link = page.locator(`a[href*="${id}"]`).filter({ hasText: new RegExp(escapeRegExp(normalized), "i") }).first();
            if (await link.isVisible({ timeout: 800 }).catch(() => false)) {
                await link.click({ timeout: 4000 }).catch(() => { });
                await delay(1500);
                steps.push(`Clicked list entry for ${id} matching "${normalized}".`);
                const after = extractByRegex(page.url(), /\/(cli_[a-zA-Z0-9]+)/);
                return after ?? id;
            }
        }
    }
    return null;
}
async function gotoAppSubpageMatching(page, appId, steps, label, matchers) {
    for (const url of (0, selectors_1.feishuAppSubpageUrls)(appId)) {
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 28000 });
            await delay(1200);
            const body = await page.locator("body").innerText().catch(() => "");
            const lower = body.toLowerCase();
            if (matchers.some((re) => re.test(lower) || re.test(body))) {
                steps.push(`Reached ${label} (matched content) via ${url}`);
                return true;
            }
        }
        catch {
            // try next
        }
    }
    return false;
}
function extractByRegex(text, regex) {
    const match = text.match(regex);
    return match?.[1]?.trim() ?? "";
}
async function clickConsoleEntry(page, steps) {
    if (await clickFirstVisible(page, selectors_1.feishuSelectors.consoleEntryButtons)) {
        steps.push("Clicked Feishu 控制台 / 开发者后台.");
        await delay(1200);
        return true;
    }
    try {
        const roleLink = page.getByRole("link", { name: /控制台|开发者后台|console/i }).first();
        if (await roleLink.isVisible({ timeout: 1200 })) {
            await roleLink.click({ timeout: 2500 });
            steps.push("Clicked console entry via role locator.");
            await delay(1200);
            return true;
        }
    }
    catch {
        // continue
    }
    return false;
}
async function waitForConsolePageReady(page, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const body = (await page.locator("body").innerText({ timeout: 1000 })).toLowerCase();
            const ready = body.includes("创建企业自建应用") ||
                body.includes("应用管理") ||
                body.includes("凭证与基础信息") ||
                body.includes("权限管理");
            if (ready) {
                return true;
            }
        }
        catch {
            // keep waiting
        }
        await delay(1200);
    }
    return false;
}
async function waitForManualLogin(page, timeoutMs, steps) {
    steps.push("Opened Feishu console in one tab. Please scan QR/login in that tab.");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const currentUrl = page.url();
            const body = (await page.locator("body").innerText({ timeout: 1000 })).toLowerCase();
            const loggedInByUrl = currentUrl.includes("open.feishu.cn/app");
            const loggedInByUi = body.includes("控制台") ||
                body.includes("开发者后台") ||
                body.includes("创建企业自建应用") ||
                body.includes("应用管理") ||
                body.includes("凭证与基础信息") ||
                body.includes("权限管理") ||
                body.includes("app id");
            if (loggedInByUrl && loggedInByUi) {
                steps.push("Login detected, continue automation.");
                return true;
            }
        }
        catch {
            // keep waiting
        }
        await delay(1500);
    }
    steps.push("Login wait timed out. Browser remains open for manual continuation.");
    return false;
}
async function runGuidedFeishuSetup(options) {
    const playwright = await Promise.resolve().then(() => __importStar(require("playwright")));
    const userDataDir = node_path_1.default.join((0, node_os_1.tmpdir)(), `clawwrapper-feishu-${Date.now()}-${process.pid}`);
    await (0, promises_1.mkdir)(userDataDir, { recursive: true });
    const context = await playwright.chromium.launchPersistentContext(userDataDir, {
        headless: options.headless,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    const steps = [];
    steps.push(`飞书应用配置说明（官方）: ${selectors_1.feishuUrls.docReference}`);
    await page.goto(selectors_1.feishuUrls.developerConsole, { waitUntil: "domcontentloaded" });
    const loggedIn = await waitForManualLogin(page, 5 * 60 * 1000, steps);
    if (!loggedIn) {
        const timeoutResult = {
            outputPath: options.outputPath,
            captured: { appId: "", appSecret: "", webhookUrl: "" },
            steps,
        };
        await (0, promises_1.writeFile)(node_path_1.default.resolve(options.outputPath), `${JSON.stringify(timeoutResult, null, 2)}\n`, "utf8");
        await context.close();
        return timeoutResult;
    }
    const enteredConsole = await clickConsoleEntry(page, steps);
    if (!enteredConsole) {
        steps.push("Console entry not clicked automatically. Waiting for console-ready page...");
    }
    const consoleReady = await waitForConsolePageReady(page, 90 * 1000);
    if (!consoleReady) {
        steps.push("Console page not ready after login. Please click 控制台 manually, then rerun automation.");
    }
    else {
        steps.push("Console page ready. Continue with semi-automation.");
    }
    try {
        const created = await clickFirstVisible(page, selectors_1.feishuSelectors.createAppButtons);
        if (created) {
            steps.push("Clicked create-app entry.");
            await delay(800);
        }
        else {
            steps.push("Create-app entry not found, assuming existing app page.");
        }
    }
    catch {
        steps.push("Create-app click skipped due to UI mismatch.");
    }
    try {
        const tab = await clickFirstVisible(page, selectors_1.feishuSelectors.selfBuiltAppTabButtons);
        if (tab) {
            steps.push("Focused 企业自建应用 list (if tab was present).");
            await delay(800);
        }
    }
    catch {
        // ignore
    }
    try {
        const named = await fillFirstVisible(page, [selectors_1.feishuSelectors.appNameInput], options.botName);
        if (named) {
            steps.push(`Filled app/bot name: ${options.botName}`);
            await clickFirstVisible(page, [selectors_1.feishuSelectors.saveButton]);
            await delay(1000);
        }
        else {
            steps.push("App name input not found; skipped naming step.");
        }
    }
    catch {
        steps.push("Naming step skipped due to UI mismatch.");
    }
    try {
        await page.waitForURL(/\/app\/cli_[a-zA-Z0-9]+/i, { timeout: 18000 });
        steps.push("Navigated into app detail URL after create/save.");
    }
    catch {
        // stay on list or dialog
    }
    let appId = await resolveCliAppIdFromContext(page, options.botName, steps);
    if (!appId) {
        const opened = await openAppDetailsByNameBestEffort(page, options.botName, steps);
        if (!opened) {
            steps.push("App list entry not found by name; try manual click or refresh app list.");
            await capturePageDebug(page, "app-details-missing", steps);
        }
        appId = await resolveCliAppIdFromContext(page, options.botName, steps);
    }
    if (!appId) {
        try {
            await page.goto("https://open.feishu.cn/app", { waitUntil: "domcontentloaded", timeout: 25000 });
            await delay(1500);
            await clickFirstVisible(page, selectors_1.feishuSelectors.selfBuiltAppTabButtons);
            await delay(800);
            steps.push("Reloaded https://open.feishu.cn/app (no query) and retried app id discovery.");
            appId = await resolveCliAppIdFromContext(page, options.botName, steps);
        }
        catch {
            steps.push("Reload app list for cli_ discovery failed.");
        }
    }
    if (appId) {
        steps.push(`Using app id ${appId} for deep links (凭证/权限/应用能力).`);
        const credOk = await gotoAppSubpageMatching(page, appId, steps, "credentials/basic info", [
            /凭证|app\s*id|app\s*secret|应用密钥|基础信息/i,
        ]);
        if (!credOk) {
            await clickFirstVisible(page, selectors_1.feishuSelectors.credentialNavButtons);
            await delay(800);
        }
    }
    try {
        let openedPerm = false;
        if (appId) {
            openedPerm = await gotoAppSubpageMatching(page, appId, steps, "permission management", [
                /权限管理|批量导入|开通权限|api\s*权限|应用身份权限/i,
            ]);
        }
        if (!openedPerm) {
            openedPerm = await clickFirstVisible(page, selectors_1.feishuSelectors.permissionNavButtons);
        }
        if (openedPerm) {
            steps.push("Opened permission management page.");
            await delay(1000);
            const openedBatchImport = await clickFirstVisible(page, selectors_1.feishuSelectors.batchImportButtons);
            if (openedBatchImport) {
                steps.push("Opened batch import dialog.");
                await delay(500);
                const filledPermissionJson = await fillPermissionImportTextBestEffort(page, FEISHU_PERMISSION_IMPORT_JSON);
                if (filledPermissionJson) {
                    steps.push("Filled permission import JSON.");
                    await clickFirstVisible(page, selectors_1.feishuSelectors.confirmButtons);
                    await delay(1200);
                    steps.push("Submitted permission import.");
                }
                else {
                    steps.push("Permission import input not found; please paste JSON manually.");
                }
            }
            else {
                steps.push("Batch import button not found; please configure permissions manually.");
                await capturePageDebug(page, "permission-batch-import-missing", steps);
            }
        }
        else {
            steps.push("Permission page entry not found; skipped permission automation.");
            await capturePageDebug(page, "permission-nav-missing", steps);
        }
    }
    catch {
        steps.push("Permission automation partially failed due to UI mismatch.");
        await capturePageDebug(page, "permission-exception", steps);
    }
    try {
        let openedCapability = false;
        if (appId) {
            openedCapability = await gotoAppSubpageMatching(page, appId, steps, "app capabilities / bot", [
                /应用能力|添加应用能力|机器人|启用机器人|bot capability/i,
            ]);
        }
        if (!openedCapability) {
            openedCapability = await clickFirstVisible(page, selectors_1.feishuSelectors.capabilityNavButtons);
        }
        if (openedCapability) {
            steps.push("Opened capability section.");
            await delay(800);
            await clickFirstVisible(page, selectors_1.feishuSelectors.botCapabilityButtons);
            await delay(800);
            await fillFirstVisible(page, selectors_1.feishuSelectors.botNameInputs, options.botName);
            await clickFirstVisible(page, [selectors_1.feishuSelectors.saveButton]);
            steps.push("Bot capability setup attempted (官方文档: 应用能力 > 机器人).");
        }
        else {
            steps.push("Capability page entry not found; skipped bot capability automation.");
            await capturePageDebug(page, "capability-nav-missing", steps);
        }
    }
    catch {
        steps.push("Bot capability automation partially failed due to UI mismatch.");
        await capturePageDebug(page, "capability-exception", steps);
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const appIdFromUrl = extractByRegex(page.url(), /(cli_[a-zA-Z0-9]+)/);
    const capturedAppId = appIdFromUrl || appId || extractByRegex(bodyText, /(cli_[a-zA-Z0-9]{8,})/);
    const appSecret = extractByRegex(bodyText, /(secret_[a-zA-Z0-9_\-]+)/i);
    const webhookUrl = extractByRegex(bodyText, /(https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_\-]+)/i);
    const result = {
        outputPath: options.outputPath,
        captured: { appId: capturedAppId, appSecret, webhookUrl },
        steps,
    };
    await (0, promises_1.writeFile)(node_path_1.default.resolve(options.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await context.close();
    return result;
}
