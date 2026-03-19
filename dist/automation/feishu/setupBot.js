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
    const browser = await playwright.chromium.launch({ headless: options.headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    const steps = [];
    await page.goto(selectors_1.feishuUrls.developerConsole, { waitUntil: "domcontentloaded" });
    const loggedIn = await waitForManualLogin(page, 5 * 60 * 1000, steps);
    if (!loggedIn) {
        const timeoutResult = {
            outputPath: options.outputPath,
            captured: { appId: "", appSecret: "", webhookUrl: "" },
            steps,
        };
        await (0, promises_1.writeFile)(node_path_1.default.resolve(options.outputPath), `${JSON.stringify(timeoutResult, null, 2)}\n`, "utf8");
        await browser.close();
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
        const openedPerm = await clickFirstVisible(page, selectors_1.feishuSelectors.permissionNavButtons);
        if (openedPerm) {
            steps.push("Opened permission management page.");
            await delay(1000);
            const openedBatchImport = await clickFirstVisible(page, selectors_1.feishuSelectors.batchImportButtons);
            if (openedBatchImport) {
                steps.push("Opened batch import dialog.");
                await delay(500);
                const filledPermissionJson = await fillFirstVisible(page, selectors_1.feishuSelectors.permissionImportInputs, FEISHU_PERMISSION_IMPORT_JSON);
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
            }
        }
        else {
            steps.push("Permission page entry not found; skipped permission automation.");
        }
    }
    catch {
        steps.push("Permission automation partially failed due to UI mismatch.");
    }
    try {
        const openedCapability = await clickFirstVisible(page, selectors_1.feishuSelectors.capabilityNavButtons);
        if (openedCapability) {
            steps.push("Opened capability section.");
            await delay(800);
            await clickFirstVisible(page, selectors_1.feishuSelectors.botCapabilityButtons);
            await delay(800);
            await fillFirstVisible(page, selectors_1.feishuSelectors.botNameInputs, options.botName);
            await clickFirstVisible(page, [selectors_1.feishuSelectors.saveButton]);
            steps.push("Bot capability setup attempted.");
        }
        else {
            steps.push("Capability page entry not found; skipped bot capability automation.");
        }
    }
    catch {
        steps.push("Bot capability automation partially failed due to UI mismatch.");
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const appIdFromUrl = extractByRegex(page.url(), /(cli_[a-zA-Z0-9]+)/);
    const appId = appIdFromUrl || extractByRegex(bodyText, /(cli_[a-zA-Z0-9]{8,})/);
    const appSecret = extractByRegex(bodyText, /(secret_[a-zA-Z0-9_\-]+)/i);
    const webhookUrl = extractByRegex(bodyText, /(https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9_\-]+)/i);
    const result = {
        outputPath: options.outputPath,
        captured: { appId, appSecret, webhookUrl },
        steps,
    };
    await (0, promises_1.writeFile)(node_path_1.default.resolve(options.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await browser.close();
    return result;
}
