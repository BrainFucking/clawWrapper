"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPlatform = detectPlatform;
exports.commandExists = commandExists;
exports.isNodeVersionSupported = isNodeVersionSupported;
exports.getDefaultConfigPath = getDefaultConfigPath;
exports.getDefaultStateDir = getDefaultStateDir;
const exec_1 = require("./exec");
function detectPlatform() {
    if (process.platform === "darwin") {
        return "macos";
    }
    if (process.platform === "win32") {
        return "windows";
    }
    return "linux";
}
async function commandExists(command) {
    const checkCommand = process.platform === "win32" ? "where" : "which";
    const result = await (0, exec_1.runCommand)(checkCommand, [command]);
    return result.code === 0;
}
function isNodeVersionSupported() {
    const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    return major >= 22;
}
function getDefaultConfigPath() {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    return `${home}/.openclaw/config.json`;
}
function getDefaultStateDir() {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    return `${home}/.openclaw/state`;
}
