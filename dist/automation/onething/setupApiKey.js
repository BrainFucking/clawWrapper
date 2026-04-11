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
exports.runOneThingApiKeySetup = runOneThingApiKeySetup;
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function clickFirstVisible(page, selectors) {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
            if (await locator.isVisible({ timeout: 2500 })) {
                await locator.click({ timeout: 3500 });
                return true;
            }
        }
        catch {
            // try next selector
        }
    }
    return false;
}
async function countVisibleBySelectors(page, selectors) {
    let count = 0;
    for (const selector of selectors) {
        try {
            const loc = page.locator(selector);
            const n = await loc.count();
            for (let i = 0; i < n; i += 1) {
                try {
                    if (await loc.nth(i).isVisible({ timeout: 500 })) {
                        count += 1;
                    }
                }
                catch {
                    // ignore one bad node
                }
            }
        }
        catch {
            // ignore bad selector on current page
        }
    }
    return count;
}
async function closeAnnouncementPopupBestEffort(page, steps) {
    const modalSelectors = [
        '[role="dialog"]',
        ".modal",
        ".ant-modal",
        ".el-dialog",
        '[class*="modal"]',
        '[class*="popup"]',
    ];
    const closeSelectors = [
        // Exact close element from provided DOM snippet
        'i.i-actpop-close--XpamOQAs[title="关闭"]',
        'i.i-actpop-close--XpamOQAs',
        'i[title="关闭"]',
        // modal close icon / x button variants (including the circled X in the top-right corner)
        '[role="dialog"] button:has-text("×")',
        '[role="dialog"] [role="button"]:has-text("×")',
        '[role="dialog"] button:has-text("✕")',
        '[role="dialog"] [role="button"]:has-text("✕")',
        '[role="dialog"] button:has-text("x")',
        '[role="dialog"] [role="button"]:has-text("x")',
        '[role="dialog"] .ant-modal-close',
        '[role="dialog"] .ant-modal-close-x',
        '[role="dialog"] .el-dialog__headerbtn',
        '[role="dialog"] [class*="close"][class*="icon"]',
        '[role="dialog"] [class*="closeBtn"]',
        '[role="dialog"] [class*="close-btn"]',
        '[role="dialog"] button:near(:text("恭喜你"), 250)',
        '[role="dialog"] button[aria-label*="close" i]',
        '[role="dialog"] button[title*="close" i]',
        '[role="dialog"] button:has-text("关闭")',
        '[role="dialog"] button:has-text("Close")',
        '[role="dialog"] span:has-text("关闭")',
        'button[aria-label*="close" i]',
        'button[title*="close" i]',
        'button:has-text("×")',
        '[role="button"]:has-text("×")',
        'button:has-text("✕")',
        '[role="button"]:has-text("✕")',
        'button:has-text("x")',
        '[role="button"]:has-text("x")',
        '.ant-modal-close',
        '.ant-modal-close-x',
        '.el-dialog__headerbtn',
        '[class*="close"][class*="icon"]',
        '[class*="closeBtn"]',
        '[class*="close-btn"]',
        'button:has-text("关闭")',
        'button:has-text("Close")',
        'span:has-text("关闭")',
        '[class*="close"]',
    ];
    const experienceSelectors = [
        // Exact popup CTA from provided DOM snippet
        'div.btn-wrapper--SSGLEHcN',
        'img.actpop-btn--S5iSbYq9',
        'div.btn-wrapper--SSGLEHcN img[alt="btn"]',
        'img[alt="btn"]',
        '[role="dialog"] button:has-text("去免费体验")',
        '[role="dialog"] [role="button"]:has-text("去免费体验")',
        '[role="dialog"] div:has-text("去免费体验")',
        '[role="dialog"] span:has-text("去免费体验")',
        '[role="dialog"] button:has-text("去体验")',
        '[role="dialog"] [role="button"]:has-text("去体验")',
        '[role="dialog"] div:has-text("去体验")',
        '[role="dialog"] span:has-text("去体验")',
        'button:has-text("去免费体验")',
        '[role="button"]:has-text("去免费体验")',
        'div:has-text("去免费体验")',
        'span:has-text("去免费体验")',
        'button:has-text("去体验")',
        '[role="button"]:has-text("去体验")',
        'div:has-text("去体验")',
        'span:has-text("去体验")',
    ];
    const before = await countVisibleBySelectors(page, modalSelectors);
    let foundAny = false;
    let clickedAny = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        // Highest priority: exact close icon from current popup implementation.
        try {
            const exactClose = page.locator('i.i-actpop-close--XpamOQAs[title="关闭"]').first();
            await exactClose.waitFor({ state: "visible", timeout: 1800 });
            foundAny = true;
            await exactClose.scrollIntoViewIfNeeded().catch(() => { });
            await exactClose.click({ timeout: 2200, force: true });
            clickedAny = true;
            steps.push("Popup action attempted: clicked exact close icon (i.i-actpop-close--XpamOQAs[title=\"关闭\"])");
            await delay(400);
        }
        catch {
            for (const selector of [
                'i.i-actpop-close--XpamOQAs[title="关闭"]',
                'i.i-actpop-close--XpamOQAs',
                'i[title="关闭"]',
            ]) {
                try {
                    const loc = page.locator(selector).first();
                    if (await loc.isVisible({ timeout: 900 })) {
                        foundAny = true;
                        await loc.scrollIntoViewIfNeeded().catch(() => { });
                        await loc.click({ timeout: 1800, force: true });
                        clickedAny = true;
                        steps.push(`Popup action attempted: clicked close icon (${selector})`);
                        await delay(300);
                        break;
                    }
                }
                catch {
                    // best-effort
                }
            }
        }
        // Highest priority: exact image/button wrapper from current popup implementation.
        for (const selector of [
            'div.btn-wrapper--SSGLEHcN',
            'img.actpop-btn--S5iSbYq9',
            'div.btn-wrapper--SSGLEHcN img[alt="btn"]',
            'img[alt="btn"]',
        ]) {
            try {
                const loc = page.locator(selector).first();
                if (await loc.isVisible({ timeout: 900 })) {
                    foundAny = true;
                    await loc.scrollIntoViewIfNeeded().catch(() => { });
                    await loc.click({ timeout: 2200, force: true });
                    clickedAny = true;
                    steps.push(`Popup action attempted: clicked image CTA (${selector})`);
                    await delay(350);
                    break;
                }
            }
            catch {
                // best-effort
            }
        }
        // Highest priority: text-based CTA click in your screenshot ("去免费体验").
        try {
            const cta = page.getByText(/去\s*免费\s*体验|去体验/, { exact: false }).first();
            if (await cta.isVisible({ timeout: 900 })) {
                foundAny = true;
                await cta.scrollIntoViewIfNeeded().catch(() => { });
                await cta.click({ timeout: 2200, force: true });
                clickedAny = true;
                steps.push("Popup action attempted: clicked red-circle button (去免费体验)");
                await delay(350);
            }
        }
        catch {
            // best-effort
        }
        // Prefer CTA on this specific popup when present.
        for (const selector of experienceSelectors) {
            try {
                const loc = page.locator(selector).first();
                if (await loc.isVisible({ timeout: 700 })) {
                    foundAny = true;
                    await loc.scrollIntoViewIfNeeded().catch(() => { });
                    await loc.click({ timeout: 1800, force: true });
                    clickedAny = true;
                    steps.push("Popup action attempted: clicked 去体验 button");
                    await delay(350);
                }
            }
            catch {
                // best-effort: continue
            }
        }
        // Extra fallback: execute a DOM click on elements containing CTA text.
        if (!clickedAny) {
            try {
                const domClicked = await page.evaluate(() => {
                    const texts = ["去免费体验", "去体验"];
                    const all = Array.from(document.querySelectorAll("button, a, div, span"));
                    for (const el of all) {
                        const txt = (el.innerText || el.textContent || "").trim();
                        if (!txt)
                            continue;
                        if (!texts.some((t) => txt.includes(t)))
                            continue;
                        const rect = el.getBoundingClientRect();
                        if (rect.width < 40 || rect.height < 20)
                            continue;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")
                            continue;
                        el.click();
                        return true;
                    }
                    return false;
                });
                if (domClicked) {
                    foundAny = true;
                    clickedAny = true;
                    steps.push("Popup action attempted: clicked 去免费体验 via DOM fallback");
                    await delay(350);
                }
            }
            catch {
                // best-effort
            }
        }
        for (const selector of closeSelectors) {
            try {
                const loc = page.locator(selector).first();
                if (await loc.isVisible({ timeout: 700 })) {
                    foundAny = true;
                    await loc.scrollIntoViewIfNeeded().catch(() => { });
                    await loc.click({ timeout: 1500, force: true });
                    clickedAny = true;
                    await delay(350);
                }
            }
            catch {
                // best-effort: continue
            }
        }
        if (clickedAny) {
            const after = await countVisibleBySelectors(page, modalSelectors);
            if (after < before || after === 0) {
                steps.push("Popup close attempted: success");
                return;
            }
            steps.push("Popup action clicked but modal still present; retrying...");
        }
        await delay(350);
    }
    if (!foundAny) {
        steps.push("Popup close attempted: not found");
    }
    else {
        steps.push("Popup close attempted: failed but continuing");
    }
}
async function fillFirstVisible(page, selectors, value) {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
            if (await locator.isVisible({ timeout: 1200 })) {
                await locator.fill(value, { timeout: 2500 });
                return true;
            }
        }
        catch {
            // try next selector
        }
    }
    return false;
}
async function fillCreateKeyNameBestEffort(page, value, steps) {
    const selectors = [
        '[role="dialog"] input[placeholder*="API"]',
        '[role="dialog"] input[placeholder*="Key Name"]',
        '[role="dialog"] input[placeholder*="name"]',
        '[role="dialog"] input[placeholder*="名称"]',
        '[role="dialog"] input[placeholder*="密钥"]',
        '[role="dialog"] input',
        '.ant-modal input',
        '.modal input',
        'input[placeholder*="API"]',
        'input[placeholder*="Key Name"]',
        'input[placeholder*="name"]',
        'input[placeholder*="名称"]',
        'input[placeholder*="密钥"]',
    ];
    if (await fillFirstVisible(page, selectors, value)) {
        return true;
    }
    try {
        const filled = await page.evaluate((nextValue) => {
            const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea'));
            for (const node of inputs) {
                const rect = node.getBoundingClientRect();
                if (rect.width < 40 || rect.height < 20)
                    continue;
                const style = window.getComputedStyle(node);
                if (style.visibility === "hidden" || style.display === "none")
                    continue;
                node.focus();
                node.value = "";
                node.dispatchEvent(new Event("input", { bubbles: true }));
                node.value = nextValue;
                node.dispatchEvent(new Event("input", { bubbles: true }));
                node.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
            }
            return false;
        }, value);
        if (filled) {
            steps.push("Filled key name via DOM input fallback.");
            return true;
        }
    }
    catch {
        // ignore
    }
    return false;
}
async function waitForKeyRow(page, keyName, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const body = await page.locator("body").innerText({ timeout: 1000 });
            if (body.includes(keyName)) {
                return true;
            }
        }
        catch {
            // ignore
        }
        await delay(800);
    }
    return false;
}
async function captureCreateKeyDebug(page, steps, label) {
    try {
        const debug = await page.evaluate(() => {
            const texts = Array.from(document.querySelectorAll("button, a, span, div, label"))
                .map((node) => (node.textContent || "").trim())
                .filter(Boolean)
                .filter((text) => /新建|创建|密钥|api|token|名称/i.test(text))
                .slice(0, 20);
            const inputs = Array.from(document.querySelectorAll("input, textarea")).map((node) => ({
                placeholder: node.getAttribute("placeholder") || "",
                aria: node.getAttribute("aria-label") || "",
                type: node.getAttribute("type") || "",
                value: node.value || "",
            }));
            const buttons = Array.from(document.querySelectorAll("button, [role='button']")).map((node) => ({
                text: (node.textContent || "").trim(),
                cls: node.getAttribute("class") || "",
            }));
            return { texts, inputs, buttons: buttons.slice(0, 20) };
        });
        steps.push(`DEBUG ${label} texts=${JSON.stringify(debug.texts)}`);
        steps.push(`DEBUG ${label} inputs=${JSON.stringify(debug.inputs)}`);
        steps.push(`DEBUG ${label} buttons=${JSON.stringify(debug.buttons)}`);
    }
    catch {
        // ignore
    }
}
async function submitCreateKeyBestEffort(page, steps) {
    for (const selector of [
        '[role="dialog"] .ant-btn-primary',
        '.ant-modal .ant-btn-primary',
        '[role="dialog"] button:has-text("确定")',
        '[role="dialog"] button:has-text("确认")',
        '[role="dialog"] button:has-text("创建")',
        '[role="dialog"] button:has-text("保存")',
        '.ant-modal button:has-text("确定")',
        '.ant-modal button:has-text("确认")',
        '.ant-modal button:has-text("创建")',
        '.ant-modal button:has-text("保存")',
        'button:has-text("确定")',
        'button:has-text("确认")',
        'button:has-text("创建")',
        'button:has-text("保存")',
    ]) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 1200 })) {
                await loc.scrollIntoViewIfNeeded().catch(() => { });
                await loc.click({ timeout: 2500, force: true });
                steps.push(`Submitted create key via selector: ${selector}`);
                await delay(1200);
                return true;
            }
        }
        catch {
            // continue
        }
    }
    try {
        await page.keyboard.press("Enter");
        steps.push("Submitted create key via Enter key.");
        await delay(1200);
        return true;
    }
    catch {
        // ignore
    }
    return false;
}
async function clickConsoleEntry(page, steps) {
    // Exact console action link from provided DOM snippet.
    for (const selector of [
        'a.head-action--ioOeSNbb:has-text("控制台")',
        'a.head-action--ioOeSNbb',
        'a:has(img):has-text("控制台")',
    ]) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 1800 })) {
                await loc.scrollIntoViewIfNeeded().catch(() => { });
                await loc.click({ timeout: 2500, force: true });
                steps.push(`Clicked 控制台 entry via exact selector: ${selector}`);
                await delay(1200);
                return true;
            }
        }
        catch {
            // continue to fallbacks
        }
    }
    const consoleSelectors = [
        'a:has-text("控制台")',
        'button:has-text("控制台")',
        '[role="link"]:has-text("控制台")',
    ];
    // Strategy 1: selector click
    if (await clickFirstVisible(page, consoleSelectors)) {
        steps.push("Clicked 控制台 entry.");
        await delay(1200);
        return true;
    }
    // Strategy 2: aria role locator
    try {
        const link = page.getByRole("link", { name: /控制台/ }).first();
        if (await link.isVisible({ timeout: 1200 })) {
            await link.click({ timeout: 2500 });
            steps.push("Clicked 控制台 entry via role locator.");
            await delay(1200);
            return true;
        }
    }
    catch {
        // continue
    }
    // Strategy 3: direct URL guess as fallback
    for (const url of [
        "https://console.onethingai.com/",
        "https://onethingai.com/console",
        "https://onethingai.com/dashboard",
    ]) {
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 6000 });
            steps.push(`Opened console by URL fallback: ${url}`);
            return true;
        }
        catch {
            // try next URL
        }
    }
    return false;
}
async function clickConsoleEntryWithLabel(page, steps, label) {
    const clicked = await clickConsoleEntry(page, steps);
    if (clicked) {
        steps.push(`控制台点击阶段: ${label}`);
    }
    return clicked;
}
async function switchLoginToWechatBestEffort(page, steps, label) {
    for (const selector of [
        'button:has-text("微信登录")',
        '[role="button"]:has-text("微信登录")',
        'span:has-text("微信登录")',
        'button.ant-btn:has(span:has-text("微信登录"))',
        'button:has(img) >> text=微信登录',
    ]) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 1200 })) {
                await loc.scrollIntoViewIfNeeded().catch(() => { });
                await loc.click({ timeout: 2500, force: true });
                steps.push(`Switched login method to 微信登录: ${label}`);
                await delay(900);
                return true;
            }
        }
        catch {
            // try next selector
        }
    }
    try {
        const clicked = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll("button, [role='button'], span"));
            const target = nodes.find((node) => (node.innerText || node.textContent || "").includes("微信登录"));
            if (!target)
                return false;
            const clickable = target.closest("button, [role='button']") || target;
            clickable.click();
            return true;
        });
        if (clicked) {
            steps.push(`Switched login method to 微信登录 via DOM fallback: ${label}`);
            await delay(900);
            return true;
        }
    }
    catch {
        // ignore
    }
    return false;
}
function shouldTryWechatSwitch(bodyLower) {
    const hasWechatEntry = bodyLower.includes("微信登录") || bodyLower.includes("wechat");
    const alreadyInWechatQrFlow = bodyLower.includes("微信扫码") ||
        bodyLower.includes("扫码登录") ||
        bodyLower.includes("扫码后") ||
        bodyLower.includes("二维码");
    return hasWechatEntry && !alreadyInWechatQrFlow;
}
function extractApiKey(text) {
    const patterns = [
        /\b(sk-[A-Za-z0-9_\-]{10,})\b/,
        /\b(ok-[A-Za-z0-9_\-]{10,})\b/,
        /\b(ot-[A-Za-z0-9_\-]{12,})\b/,
        /\b(ot[a-z0-9_\-]{12,})\b/i,
        /\b([A-Za-z0-9]{32,})\b/,
        /\b([A-Za-z0-9_\-]{24,})\b/,
    ];
    for (const re of patterns) {
        const match = text.match(re);
        if (match?.[1]) {
            return match[1];
        }
    }
    return "";
}
async function captureApiKeyFromRecentRow(page, keyName, steps) {
    if (!keyName)
        return "";
    try {
        const tokenFromRow = await page.evaluate(async (targetName) => {
            const extract = (text) => {
                const patterns = [
                    /\b(sk-[A-Za-z0-9_\-]{10,})\b/,
                    /\b(ok-[A-Za-z0-9_\-]{10,})\b/,
                    /\b(ot-[A-Za-z0-9_\-]{12,})\b/,
                    /\b(ot[a-z0-9_\-]{12,})\b/i,
                    /\b([A-Za-z0-9]{32,})\b/,
                    /\b([A-Za-z0-9_\-]{24,})\b/,
                ];
                for (const re of patterns) {
                    const match = text.match(re);
                    if (match?.[1])
                        return match[1];
                }
                return "";
            };
            const rows = Array.from(document.querySelectorAll("tr, .table-row, [role='row']"));
            const row = rows.find((node) => (node.innerText || node.textContent || "").includes(targetName));
            if (!row)
                return "";
            const rowText = (row.innerText || row.textContent || "").trim();
            const direct = extract(rowText);
            if (direct)
                return direct;
            const tokenEl = row.querySelector("[data-clipboard-text], [data-copy], code, input, textarea");
            if (tokenEl) {
                const attrText = tokenEl.getAttribute?.("data-clipboard-text") ||
                    tokenEl.getAttribute?.("data-copy") ||
                    ("value" in tokenEl ? tokenEl.value : "") ||
                    tokenEl.innerText ||
                    tokenEl.textContent ||
                    "";
                const extracted = extract(attrText);
                if (extracted)
                    return extracted;
            }
            const copyTargets = Array.from(row.querySelectorAll("button, a, span, div, i, svg"));
            for (const target of copyTargets) {
                const txt = (target.innerText || target.textContent || "").trim();
                const title = target.getAttribute("title") || "";
                const aria = target.getAttribute("aria-label") || "";
                const marker = `${txt} ${title} ${aria}`.toLowerCase();
                if (!marker.includes("复制") && !marker.includes("copy"))
                    continue;
                target.click();
                await new Promise((resolve) => setTimeout(resolve, 250));
                try {
                    const clip = await navigator.clipboard.readText();
                    const extracted = extract(clip || "");
                    if (extracted)
                        return extracted;
                }
                catch {
                    // continue
                }
            }
            return "";
        }, keyName);
        if (tokenFromRow) {
            steps.push("Captured API key from newly created row.");
            return tokenFromRow;
        }
    }
    catch {
        // ignore
    }
    return "";
}
async function captureApiKeyBestEffort(page, steps, keyName = "") {
    // 0) Prefer the row for the just-created key.
    const fromRecentRow = await captureApiKeyFromRecentRow(page, keyName, steps);
    if (fromRecentRow) {
        return fromRecentRow;
    }
    // 1) Fast path: visible page text
    const bodyText = await page.locator("body").innerText().catch(() => "");
    let key = extractApiKey(bodyText);
    if (key) {
        steps.push("Captured API key from page text.");
        return key;
    }
    // 2) Try input/textarea values that may hold newly generated key
    try {
        const candidate = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll("input, textarea"));
            for (const node of nodes) {
                const v = (node.value ?? "").trim();
                if (v.length >= 20)
                    return v;
            }
            return "";
        });
        key = extractApiKey(candidate);
        if (key) {
            steps.push("Captured API key from input/textarea value.");
            return key;
        }
    }
    catch {
        // ignore
    }
    // 3) Try clicking copy button then read clipboard
    const copySelectors = [
        'button:has-text("复制")',
        'button:has-text("Copy")',
        '[role="button"]:has-text("复制")',
        '[role="button"]:has-text("Copy")',
    ];
    for (const selector of copySelectors) {
        try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 1200 })) {
                await btn.click({ timeout: 2500 });
                await delay(250);
                const clip = await page.evaluate(async () => {
                    try {
                        return await navigator.clipboard.readText();
                    }
                    catch {
                        return "";
                    }
                });
                key = extractApiKey(clip || "");
                if (key) {
                    steps.push("Captured API key via copy button + clipboard.");
                    return key;
                }
            }
        }
        catch {
            // try next selector
        }
    }
    return "";
}
async function captureClipboardApiKeyBestEffort(page, steps, label) {
    try {
        const clip = await page.evaluate(async () => {
            try {
                return await navigator.clipboard.readText();
            }
            catch {
                return "";
            }
        });
        const key = extractApiKey(clip || "");
        if (key) {
            steps.push(`Captured API key from clipboard: ${label}`);
            return key;
        }
    }
    catch {
        // ignore
    }
    return "";
}
async function refreshKeyListBestEffort(page, steps) {
    for (const selector of [
        'button:has-text("刷 新")',
        'button:has-text("刷新")',
        '[role="button"]:has-text("刷新")',
    ]) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 1000 })) {
                await loc.click({ timeout: 2000, force: true });
                steps.push(`Refreshed key list via selector: ${selector}`);
                await delay(1500);
                return;
            }
        }
        catch {
            // continue
        }
    }
}
async function hasCreateKeyEditorOpen(page) {
    const selectors = [
        '[role="dialog"] input',
        '[role="dialog"] textarea',
        '.ant-modal input',
        '.ant-modal textarea',
        '.modal input',
        '.modal textarea',
        'input[placeholder*="名称"]',
        'input[placeholder*="密钥"]',
        'textarea[placeholder*="名称"]',
    ];
    for (const selector of selectors) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 500 })) {
                return true;
            }
        }
        catch {
            // ignore
        }
    }
    return false;
}
async function waitForCreateKeyEditor(page, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await hasCreateKeyEditorOpen(page)) {
            return true;
        }
        await delay(250);
    }
    return false;
}
async function clickCreateKeyPlusIconBestEffort(page, steps) {
    for (const selector of [
        'button:has(span[role="img"][aria-label="plus"]):has-text("新建密钥")',
        '[role="button"]:has(span[role="img"][aria-label="plus"]):has-text("新建密钥")',
        'button:has(.anticon-plus):has-text("新建密钥")',
        '[role="button"]:has(.anticon-plus):has-text("新建密钥")',
        'button:has(span[role="img"][aria-label="plus"])',
        '[role="button"]:has(span[role="img"][aria-label="plus"])',
        '.ant-btn:has(.anticon-plus)',
        'button:has(.anticon-plus)',
        '[role="button"]:has(.anticon-plus)',
        'span[role="img"][aria-label="plus"]',
        '.anticon.anticon-plus',
    ]) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 1800 })) {
                await loc.scrollIntoViewIfNeeded().catch(() => { });
                await loc.click({ timeout: 2500, force: true });
                if (await waitForCreateKeyEditor(page, 1800)) {
                    steps.push(`Clicked create API key via plus icon: ${selector}`);
                    return true;
                }
                steps.push(`Create key plus click did not open editor: ${selector}`);
            }
        }
        catch {
            // try next
        }
    }
    try {
        const clicked = await page.evaluate(() => {
            const icon = document.querySelector('span[role="img"][aria-label="plus"], .anticon.anticon-plus');
            if (!icon)
                return false;
            const clickable = icon.closest("button, [role='button'], a, .ant-btn") || icon;
            clickable.click();
            return true;
        });
        if (clicked) {
            if (await waitForCreateKeyEditor(page, 1800)) {
                steps.push("Clicked create API key via plus icon DOM fallback.");
                return true;
            }
            steps.push("Create key plus DOM fallback clicked but editor not opened.");
        }
    }
    catch {
        // ignore
    }
    return false;
}
async function clickCreateApiKeyExactSpanBestEffort(page, steps) {
    for (const selector of [
        'button:has(span:has-text("创建 API 密钥"))',
        '[role="button"]:has(span:has-text("创建 API 密钥"))',
        'button:has-text("创建 API 密钥")',
        '[role="button"]:has-text("创建 API 密钥")',
        'span:has-text("创建 API 密钥")',
    ]) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 1800 })) {
                await loc.scrollIntoViewIfNeeded().catch(() => { });
                await loc.click({ timeout: 2500, force: true });
                if (await waitForCreateKeyEditor(page, 1800)) {
                    steps.push(`Clicked create API key exact entry: ${selector}`);
                    return true;
                }
                steps.push(`Create API key exact entry click did not open editor: ${selector}`);
            }
        }
        catch {
            // continue
        }
    }
    return false;
}
async function clickCreateKeyNamedButtonBestEffort(page, steps) {
    for (const selector of [
        'button:has-text("新建密钥")',
        '[role="button"]:has-text("新建密钥")',
        'button:has-text("创建密钥")',
        '[role="button"]:has-text("创建密钥")',
        'button:has-text("创建 API 密钥")',
        '[role="button"]:has-text("创建 API 密钥")',
    ]) {
        try {
            const loc = page.locator(selector).first();
            if (await loc.isVisible({ timeout: 1800 })) {
                await loc.scrollIntoViewIfNeeded().catch(() => { });
                await loc.click({ timeout: 2500, force: true });
                if (await waitForCreateKeyEditor(page, 1800)) {
                    steps.push(`Clicked create API key named button: ${selector}`);
                    return true;
                }
                steps.push(`Create key named button click did not open editor: ${selector}`);
            }
        }
        catch {
            // continue
        }
    }
    return false;
}
async function clickCreateApiKeyIfVisible(page, createKeySelectors, steps) {
    try {
        const exactClicked = await clickCreateApiKeyExactSpanBestEffort(page, steps);
        if (exactClicked) {
            return true;
        }
    }
    catch {
        // ignore and continue
    }
    try {
        const plusClicked = await clickCreateKeyPlusIconBestEffort(page, steps);
        if (plusClicked) {
            return true;
        }
    }
    catch {
        // ignore and continue
    }
    try {
        const namedClicked = await clickCreateKeyNamedButtonBestEffort(page, steps);
        if (namedClicked) {
            return true;
        }
    }
    catch {
        // ignore and continue
    }
    // Primary: try a variety of known button/link selectors.
    try {
        const clicked = await clickFirstVisible(page, createKeySelectors);
        if (clicked) {
            if (await waitForCreateKeyEditor(page, 1800)) {
                steps.push("Clicked create API key control.");
                return true;
            }
            steps.push("Create API key control clicked but editor not opened.");
        }
    }
    catch {
        // ignore and fall back to text-based clicks
    }
    // Secondary: click by text (works when UI is not a plain <button>).
    try {
        const loc = page.getByText(/创建.*密钥/, { exact: false }).first();
        if (await loc.isVisible({ timeout: 2500 })) {
            await loc.click({ timeout: 3500 });
            if (await waitForCreateKeyEditor(page, 1800)) {
                steps.push("Clicked create API key by text (/创建.*密钥/).");
                return true;
            }
            steps.push("Create API key text click did not open editor.");
        }
    }
    catch {
        // ignore
    }
    // Tertiary: click by role name (if the UI maps to accessible role properly).
    try {
        const roleBtn = page.getByRole("button", { name: /创建.*密钥/, exact: false }).first();
        if (await roleBtn.isVisible({ timeout: 2500 })) {
            await roleBtn.click({ timeout: 3500 });
            if (await waitForCreateKeyEditor(page, 1800)) {
                steps.push("Clicked create API key by role button (/创建.*密钥/).");
                return true;
            }
            steps.push("Create API key role-button click did not open editor.");
        }
    }
    catch {
        // ignore
    }
    return false;
}
async function clickByTextIfVisible(page, textRegex, steps, label) {
    try {
        const loc = page.getByText(textRegex, { exact: false }).first();
        if (await loc.isVisible({ timeout: 2500 })) {
            await loc.click({ timeout: 3500 });
            steps.push(`Clicked ${label} by text: ${textRegex}`);
            await delay(900);
            return true;
        }
    }
    catch {
        // ignore
    }
    return false;
}
function isOnethingLoginPageText(bodyLower) {
    return (bodyLower.includes("密码登录") ||
        bodyLower.includes("短信登录") ||
        bodyLower.includes("忘记密码") ||
        bodyLower.includes("新用户注册") ||
        bodyLower.includes("登录即表示") ||
        bodyLower.includes("login"));
}
async function waitUntilNotLoginPage(page, timeoutMs, steps, pollMs = 2000) {
    const started = Date.now();
    let warned = false;
    while (Date.now() - started < timeoutMs) {
        try {
            const currentUrl = page.url();
            const body = (await page.locator("body").innerText({ timeout: 1000 })).toLowerCase();
            const isLogin = currentUrl.includes("/login") || isOnethingLoginPageText(body);
            if (!isLogin) {
                return true;
            }
            if (!warned) {
                steps.push("Still on OneThing login page; waiting for you to complete login...");
                warned = true;
            }
        }
        catch {
            // ignore and retry
        }
        await delay(pollMs);
    }
    return false;
}
async function waitForManualLogin(page, timeoutMs, steps) {
    steps.push("Opened OneThingAI page in one tab. Please register/login first.");
    const started = Date.now();
    let lastConsoleAttemptAt = 0;
    let lastWechatAttemptAt = 0;
    while (Date.now() - started < timeoutMs) {
        try {
            const currentUrl = page.url().toLowerCase();
            const body = (await page.locator("body").innerText({ timeout: 1000 })).toLowerCase();
            // If we are still on the login page, do NOT continue automation.
            const looksLikeLoginPage = currentUrl.includes("/login") ||
                body.includes("密码登录") ||
                body.includes("短信登录") ||
                body.includes("忘记密码") ||
                body.includes("新用户注册") ||
                body.includes("登录即表示") ||
                body.includes("login");
            if (!looksLikeLoginPage && Date.now() - lastConsoleAttemptAt > 6000) {
                await clickConsoleEntryWithLabel(page, steps, "during-login-wait");
                lastConsoleAttemptAt = Date.now();
            }
            if (looksLikeLoginPage && shouldTryWechatSwitch(body) && Date.now() - lastWechatAttemptAt > 4000) {
                await switchLoginToWechatBestEffort(page, steps, "during-login-wait");
                lastWechatAttemptAt = Date.now();
            }
            const hasConsoleUi = body.includes("控制台") ||
                body.includes("总览") ||
                body.includes("大模型api") ||
                body.includes("用量") ||
                body.includes("账单") ||
                body.includes("api 密钥") ||
                body.includes("api 密钥") ||
                body.includes("api keys") ||
                body.includes("api key");
            // Prefer more "console-only" signals to avoid false positives from landing pages.
            // Require `uid:` followed by a sufficiently long id-like string.
            const hasUid = Boolean(body.match(/\buid\s*[:：]\s*[a-z0-9\-_]{8,}/i));
            const hasVerified = body.includes("已认证");
            // Require either uid/verified; avoid triggering on marketing text containing "控制台/用量".
            const maybeLoggedIn = !looksLikeLoginPage && (Boolean(hasUid) || Boolean(hasVerified));
            if (maybeLoggedIn) {
                steps.push("Login detected; continue API key automation.");
                return true;
            }
        }
        catch {
            // continue waiting
        }
        await delay(1500);
    }
    steps.push("Login wait timed out. Browser remains open for manual continuation.");
    return false;
}
async function runOneThingApiKeySetup(options) {
    const playwright = await Promise.resolve().then(() => __importStar(require("playwright")));
    const userDataDir = node_path_1.default.join((0, node_os_1.tmpdir)(), `clawwrapper-onething-${Date.now()}-${process.pid}`);
    await (0, promises_1.mkdir)(userDataDir, { recursive: true });
    const context = await playwright.chromium.launchPersistentContext(userDataDir, {
        headless: options.headless,
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://onethingai.com" }).catch(() => { });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://console.onethingai.com" }).catch(() => { });
    const page = context.pages()[0] ?? (await context.newPage());
    const steps = [];
    await page.goto("https://onethingai.com/", { waitUntil: "domcontentloaded" });
    await closeAnnouncementPopupBestEffort(page, steps);
    await clickConsoleEntryWithLabel(page, steps, "initial-homepage");
    await switchLoginToWechatBestEffort(page, steps, "after-homepage-open");
    const loggedIn = await waitForManualLogin(page, 5 * 60 * 1000, steps);
    if (!loggedIn) {
        const timeoutResult = {
            outputPath: options.outputPath,
            captured: { apiKey: "" },
            steps,
        };
        await (0, promises_1.writeFile)(node_path_1.default.resolve(options.outputPath), `${JSON.stringify(timeoutResult, null, 2)}\n`, "utf8");
        await context.close();
        return timeoutResult;
    }
    await closeAnnouncementPopupBestEffort(page, steps);
    const openedConsole = await clickConsoleEntryWithLabel(page, steps, "post-login");
    if (!openedConsole) {
        steps.push("控制台入口未找到；请先手动点击页面右上角“控制台”，然后重试。");
    }
    // Re-check after attempting to enter console; some sessions may redirect to login.
    const okAfterConsole = await waitUntilNotLoginPage(page, 2 * 60 * 1000, steps);
    if (!okAfterConsole) {
        steps.push("Still on login page after attempting to enter console; stop automation for now.");
        const result = {
            outputPath: options.outputPath,
            captured: { apiKey: "" },
            steps,
        };
        await (0, promises_1.writeFile)(node_path_1.default.resolve(options.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
        await context.close();
        return result;
    }
    const apiKeyNavSelectors = [
        'a:has-text("总览")',
        'button:has-text("总览")',
        '[role="link"]:has-text("总览")',
        '[role="button"]:has-text("总览")',
        'a:has-text("API密钥")',
        'button:has-text("API密钥")',
        'div:has-text("API密钥")',
        'span:has-text("API密钥")',
        'a:has-text("API 密钥")',
        'button:has-text("API 密钥")',
        'div:has-text("API 密钥")',
        'span:has-text("API 密钥")',
        'a:has-text("大模型API")',
        'button:has-text("大模型API")',
        'div:has-text("大模型API")',
        'span:has-text("大模型API")',
        'a:has-text("API Key")',
        'a:has-text("API Keys")',
        'button:has-text("API Key")',
        'button:has-text("API Keys")',
        'a:has-text("密钥")',
        'button:has-text("密钥")',
    ];
    const createKeySelectors = [
        '[role="button"]:has-text("创建 API 密钥")',
        '[role="button"]:has-text("创建API密钥")',
        '[role="button"]:has-text("创建密钥")',
        '[role="button"]:has-text("+ 创建 API 密钥")',
        'button:has-text("创建 API 密钥")',
        'button:has-text("创建API密钥")',
        'a:has-text("创建密钥")',
        'a:has-text("创建 API 密钥")',
        'a:has-text("创建API密钥")',
        'button:has-text("+ 创建 API 密钥")',
        'button:has-text("+创建 API 密钥")',
        'a:has-text("+ 创建 API 密钥")',
        'a:has-text("+创建 API 密钥")',
        'button:has-text("Create API Key")',
        'button:has-text("Create Key")',
        'button:has-text("新建 API Key")',
        'button:has-text("创建 API Key")',
        'button:has-text("创建 API 密钥")',
        'button:has-text("创建密钥")',
        'button:has-text("新建密钥")',
    ];
    const keyNameInputs = [
        'input[placeholder*="API"]',
        'input[placeholder*="Key Name"]',
        'input[placeholder*="name"]',
        'input[placeholder*="名称"]',
        'input[aria-label*="name"]',
        'input[placeholder*="密钥"]',
        'textarea[placeholder*="名称"]',
    ];
    const confirmSelectors = [
        'button:has-text("创建 API 密钥")',
        'button:has-text("创建密钥")',
        'button:has-text("Create")',
        'button:has-text("Confirm")',
        'button:has-text("确认")',
        'button:has-text("保存")',
    ];
    let createdKeyName = "";
    let immediateCapturedApiKey = "";
    try {
        await closeAnnouncementPopupBestEffort(page, steps);
        // First try: the create button might be on the current console page already.
        let clickedCreate = await clickCreateApiKeyIfVisible(page, createKeySelectors, steps);
        if (!clickedCreate) {
            // Second try: open API-key related section/menu.
            const openedApiKeySection = await clickFirstVisible(page, apiKeyNavSelectors);
            if (openedApiKeySection) {
                steps.push("Opened API-key related section.");
                await delay(1200);
            }
            else {
                // Third try: click by text within the SPA (more reliable than hardcoded URL routes).
                steps.push("API key section not found by selectors; trying text clicks in SPA.");
                await clickByTextIfVisible(page, /大模型.*api/i, steps, "大模型API");
                await clickByTextIfVisible(page, /API\s*密钥/, steps, "API密钥");
                await clickByTextIfVisible(page, /密钥/, steps, "密钥");
            }
        }
        // Retry after any navigation attempts.
        if (!clickedCreate) {
            clickedCreate = await clickCreateApiKeyIfVisible(page, createKeySelectors, steps);
        }
        if (clickedCreate) {
            steps.push("Clicked create API key (start form).");
            await delay(700);
            await captureCreateKeyDebug(page, steps, "after-click-create");
            const now = new Date();
            const stamp = [
                now.getFullYear().toString().slice(-2),
                String(now.getMonth() + 1).padStart(2, "0"),
                String(now.getDate()).padStart(2, "0"),
                String(now.getHours()).padStart(2, "0"),
                String(now.getMinutes()).padStart(2, "0"),
                String(now.getSeconds()).padStart(2, "0"),
            ].join("");
            const keyName = `oc-${stamp}`;
            createdKeyName = keyName;
            if (await fillFirstVisible(page, keyNameInputs, keyName) || (await fillCreateKeyNameBestEffort(page, keyName, steps))) {
                steps.push(`Filled key name: ${keyName}`);
            }
            else {
                steps.push("Key name input not found in create dialog.");
                await captureCreateKeyDebug(page, steps, "key-name-input-missing");
            }
            const submitted = (await clickFirstVisible(page, confirmSelectors)) || (await submitCreateKeyBestEffort(page, steps));
            await delay(1500);
            if (submitted) {
                steps.push("Submitted create API key.");
            }
            else {
                steps.push("Create API key submit button not found.");
                await captureCreateKeyDebug(page, steps, "submit-missing");
            }
            immediateCapturedApiKey = await captureClipboardApiKeyBestEffort(page, steps, "after-submit");
            let created = await waitForKeyRow(page, keyName, 6000);
            if (!created) {
                await refreshKeyListBestEffort(page, steps);
                created = await waitForKeyRow(page, keyName, 8000);
            }
            if (created) {
                steps.push(`Confirmed created key row: ${keyName}`);
            }
            else {
                steps.push(`Created key row not confirmed yet: ${keyName}`);
            }
        }
        else {
            steps.push("Create API key button not found; please create manually on the current page.");
        }
    }
    catch {
        steps.push("Create API key step partially failed due to UI mismatch.");
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const apiKey = immediateCapturedApiKey || (await captureApiKeyBestEffort(page, steps, createdKeyName));
    if (apiKey) {
        steps.push("Captured API key successfully.");
    }
    else {
        steps.push("No API key captured automatically; copy it manually from page.");
        try {
            const url = page.url();
            const hasCreate = bodyText.includes("创建");
            const hasKeyWord = bodyText.includes("密钥") || bodyText.includes("API");
            steps.push(`DEBUG url=${url}`);
            steps.push(`DEBUG hasCreate=${hasCreate} hasKeyWord=${hasKeyWord}`);
            steps.push(`DEBUG textSnippet=${bodyText.slice(0, 200).replaceAll("\\n", " ")}`);
        }
        catch {
            // ignore debug capture
        }
    }
    const result = {
        outputPath: options.outputPath,
        captured: { apiKey },
        steps,
    };
    await (0, promises_1.writeFile)(node_path_1.default.resolve(options.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await context.close();
    return result;
}
