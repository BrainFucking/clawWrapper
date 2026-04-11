"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETUP_STEP_ORDER = void 0;
exports.nextStep = nextStep;
exports.SETUP_STEP_ORDER = [
    "OPEN_CONSOLE",
    "WAIT_MANUAL_LOGIN",
    "ENSURE_CONSOLE_READY",
    "ENSURE_APP",
    "PERMISSIONS",
    "CAPABILITIES",
    "EXTRACT_CREDENTIALS",
    "VERIFY",
    "PERSIST",
];
function nextStep(current) {
    if (!current) {
        return exports.SETUP_STEP_ORDER[0];
    }
    const idx = exports.SETUP_STEP_ORDER.indexOf(current);
    if (idx < 0 || idx + 1 >= exports.SETUP_STEP_ORDER.length) {
        return undefined;
    }
    return exports.SETUP_STEP_ORDER[idx + 1];
}
