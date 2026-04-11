"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RETRY_POLICY = void 0;
exports.delay = delay;
exports.withRetry = withRetry;
exports.isTransientError = isTransientError;
exports.clickFirstVisible = clickFirstVisible;
exports.fillFirstVisible = fillFirstVisible;
exports.bodyContainsAny = bodyContainsAny;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.DEFAULT_RETRY_POLICY = {
    maxAttempts: 4,
    baseDelayMs: 600,
    maxDelayMs: 5000,
};
function nextDelay(prevDelay, policy) {
    const upper = Math.min(policy.maxDelayMs, Math.max(policy.baseDelayMs, prevDelay * 3));
    const lower = policy.baseDelayMs;
    return Math.floor(lower + Math.random() * (upper - lower + 1));
}
async function withRetry(run, policy = exports.DEFAULT_RETRY_POLICY) {
    let attempt = 0;
    let backoffMs = policy.baseDelayMs;
    while (attempt < policy.maxAttempts) {
        const outcome = await run();
        if (outcome.type !== "retryable_error") {
            return outcome;
        }
        attempt += 1;
        if (attempt >= policy.maxAttempts) {
            return outcome;
        }
        backoffMs = nextDelay(backoffMs, policy);
        await delay(backoffMs);
    }
    return { type: "fatal_error", message: "Retry exhausted without terminal outcome." };
}
function isTransientError(error) {
    const msg = String(error ?? "").toLowerCase();
    return (msg.includes("timeout") ||
        msg.includes("detached") ||
        msg.includes("stale") ||
        msg.includes("navigation") ||
        msg.includes("frame"));
}
async function clickFirstVisible(page, selectors) {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        try {
            if (await locator.isVisible({ timeout: 1200 })) {
                await locator.click({ timeout: 2500 });
                return true;
            }
        }
        catch {
            // try next candidate
        }
    }
    return false;
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
            // try next candidate
        }
    }
    return false;
}
async function bodyContainsAny(page, terms) {
    try {
        const body = (await page.locator("body").innerText({ timeout: 1500 })).toLowerCase();
        return terms.some((term) => body.includes(term.toLowerCase()));
    }
    catch {
        return false;
    }
}
