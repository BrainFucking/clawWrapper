"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFLINE_PLAYWRIGHT_BROWSERS = exports.OFFLINE_PNPM_STORE = exports.OFFLINE_PNPM_TGZ = void 0;
exports.isOfflineMode = isOfflineMode;
const node_path_1 = require("node:path");
exports.OFFLINE_PNPM_TGZ = (0, node_path_1.join)(process.cwd(), "vendor", "offline", "pnpm.tgz");
exports.OFFLINE_PNPM_STORE = (0, node_path_1.join)(process.cwd(), "vendor", "offline", "pnpm-store");
exports.OFFLINE_PLAYWRIGHT_BROWSERS = (0, node_path_1.join)(process.cwd(), "vendor", "offline", "ms-playwright");
function isOfflineMode() {
    const raw = (process.env.CLAW_WRAPPER_OFFLINE ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
