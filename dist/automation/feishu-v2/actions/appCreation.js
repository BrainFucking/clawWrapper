"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureApp = ensureApp;
const actionUtils_1 = require("./actionUtils");
async function ensureApp(page, botName, selectors) {
    try {
        await (0, actionUtils_1.clickFirstVisible)(page, selectors.createAppButton);
        await (0, actionUtils_1.delay)(800);
        const filled = await (0, actionUtils_1.fillFirstVisible)(page, selectors.appNameInput, botName);
        if (!filled) {
            return {
                type: "manual_required",
                message: "App name input not found.",
                hint: "Create/select app manually and set app name, then resume.",
            };
        }
        await (0, actionUtils_1.clickFirstVisible)(page, selectors.saveButton);
        await (0, actionUtils_1.delay)(900);
        return { type: "ok", value: undefined, message: "App creation/selection completed." };
    }
    catch (error) {
        if ((0, actionUtils_1.isTransientError)(error)) {
            return { type: "retryable_error", message: "Transient app creation failure.", cause: error };
        }
        return { type: "fatal_error", message: "Failed to create/select app.", cause: error };
    }
}
