"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveHtmlArtifact = saveHtmlArtifact;
exports.capturePageArtifacts = capturePageArtifacts;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function saveHtmlArtifact(artifactsDir, name, html) {
    await (0, promises_1.mkdir)(artifactsDir, { recursive: true });
    const filePath = node_path_1.default.join(artifactsDir, `${name}.html`);
    await (0, promises_1.writeFile)(filePath, html, "utf8");
    return filePath;
}
async function capturePageArtifacts(page, artifactsDir, name) {
    await (0, promises_1.mkdir)(artifactsDir, { recursive: true });
    const screenshotTarget = node_path_1.default.join(artifactsDir, `${name}.png`);
    let screenshotPath;
    let htmlPath;
    try {
        await page.screenshot({ path: screenshotTarget, fullPage: true });
        screenshotPath = screenshotTarget;
    }
    catch {
        // best effort
    }
    try {
        const html = await page.content();
        htmlPath = await saveHtmlArtifact(artifactsDir, name, html);
    }
    catch {
        // best effort
    }
    return {
        screenshotPath,
        htmlPath,
    };
}
