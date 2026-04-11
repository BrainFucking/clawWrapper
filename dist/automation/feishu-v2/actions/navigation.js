"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureConsoleReady = ensureConsoleReady;
const actionUtils_1 = require("./actionUtils");
async function ensureConsoleReady(page, consoleSelectors) {
    try {
        if (await (0, actionUtils_1.clickFirstVisible)(page, consoleSelectors)) {
            await (0, actionUtils_1.delay)(1000);
        }
        const start = Date.now();
        while (Date.now() - start < 90_000) {
            const ready = await (0, actionUtils_1.bodyContainsAny)(page, [
                "创建企业自建应用",
                "应用管理",
                "凭证与基础信息",
                "权限管理",
            ]);
            if (ready) {
                return { type: "ok", value: undefined, message: "Console page is ready." };
            }
            await (0, actionUtils_1.delay)(1200);
        }
        return {
            type: "manual_required",
            message: "Console page not ready.",
            hint: "Please click 控制台 / Console manually, then resume.",
        };
    }
    catch (error) {
        if ((0, actionUtils_1.isTransientError)(error)) {
            return { type: "retryable_error", message: "Transient console readiness failure.", cause: error };
        }
        return { type: "fatal_error", message: "Failed to ensure console readiness.", cause: error };
    }
}
