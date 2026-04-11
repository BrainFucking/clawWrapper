"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureCapability = ensureCapability;
const actionUtils_1 = require("./actionUtils");
async function ensureCapability(page, botName, selectors) {
    try {
        const openedCapability = await (0, actionUtils_1.clickFirstVisible)(page, selectors.capabilityNav);
        if (!openedCapability) {
            return {
                type: "manual_required",
                message: "Capability page entry not found.",
                hint: "Open 应用能力 / Capabilities manually and continue.",
            };
        }
        await (0, actionUtils_1.delay)(700);
        await (0, actionUtils_1.clickFirstVisible)(page, selectors.botCapability);
        await (0, actionUtils_1.delay)(700);
        await (0, actionUtils_1.fillFirstVisible)(page, selectors.appNameInput, botName);
        await (0, actionUtils_1.clickFirstVisible)(page, selectors.saveButton);
        await (0, actionUtils_1.delay)(800);
        return { type: "ok", value: undefined, message: "Bot capability setup attempted." };
    }
    catch (error) {
        if ((0, actionUtils_1.isTransientError)(error)) {
            return { type: "retryable_error", message: "Transient capability setup failure.", cause: error };
        }
        return { type: "fatal_error", message: "Capability setup failed.", cause: error };
    }
}
