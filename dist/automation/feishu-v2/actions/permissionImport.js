"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importPermissions = importPermissions;
const actionUtils_1 = require("./actionUtils");
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
async function importPermissions(page, selectors) {
    try {
        const openedPerm = await (0, actionUtils_1.clickFirstVisible)(page, selectors.permissionNav);
        if (!openedPerm) {
            return {
                type: "manual_required",
                message: "Permission page entry not found.",
                hint: "Open 权限管理 / Permission page manually and resume.",
            };
        }
        await (0, actionUtils_1.delay)(800);
        const openedBatchImport = await (0, actionUtils_1.clickFirstVisible)(page, selectors.batchImportButton);
        if (!openedBatchImport) {
            return {
                type: "manual_required",
                message: "Batch import button not found.",
                hint: "Configure permissions manually, then resume.",
            };
        }
        await (0, actionUtils_1.delay)(500);
        const filled = await (0, actionUtils_1.fillFirstVisible)(page, selectors.permissionImportInput, FEISHU_PERMISSION_IMPORT_JSON);
        if (!filled) {
            return {
                type: "manual_required",
                message: "Permission import input not found.",
                hint: "Paste permission JSON manually and continue.",
            };
        }
        await (0, actionUtils_1.clickFirstVisible)(page, selectors.saveButton);
        await (0, actionUtils_1.delay)(1200);
        return { type: "ok", value: undefined, message: "Permission import submitted." };
    }
    catch (error) {
        if ((0, actionUtils_1.isTransientError)(error)) {
            return { type: "retryable_error", message: "Transient permission import failure.", cause: error };
        }
        return { type: "fatal_error", message: "Permission import failed.", cause: error };
    }
}
