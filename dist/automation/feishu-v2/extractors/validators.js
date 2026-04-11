"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidAppId = isValidAppId;
exports.validateCapturedCredentials = validateCapturedCredentials;
function isValidAppId(value) {
    return /^cli_[a-zA-Z0-9]{8,}$/.test(value);
}
function validateCapturedCredentials(captured) {
    const errors = [];
    if (!captured.appId || !isValidAppId(captured.appId)) {
        errors.push("Missing or invalid appId.");
    }
    if (captured.webhookUrl && !captured.webhookUrl.startsWith("https://open.feishu.cn/open-apis/bot/v2/hook/")) {
        errors.push("webhookUrl has unexpected format.");
    }
    return errors;
}
