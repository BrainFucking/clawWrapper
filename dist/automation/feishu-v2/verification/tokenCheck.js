"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTokenCheck = runTokenCheck;
async function runTokenCheck(appId, appSecret) {
    if (!appId || !appSecret) {
        return "skipped";
    }
    try {
        const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                app_id: appId,
                app_secret: appSecret,
            }),
        });
        if (!response.ok) {
            return "fail";
        }
        const data = (await response.json());
        if (data.code === 0 && Boolean(data.tenant_access_token)) {
            return "pass";
        }
        return "fail";
    }
    catch {
        return "fail";
    }
}
