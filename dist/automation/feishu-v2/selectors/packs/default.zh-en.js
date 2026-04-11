"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultZhEnSelectorPack = void 0;
exports.defaultZhEnSelectorPack = [
    {
        id: "consoleEntry",
        required: true,
        timeoutMs: 3000,
        candidates: [
            { kind: "css", value: 'a:has-text("控制台")', locale: "zh-CN", confidence: 0.95 },
            { kind: "css", value: 'button:has-text("开发者后台")', locale: "zh-CN", confidence: 0.9 },
            { kind: "css", value: 'a:has-text("Console")', locale: "en-US", confidence: 0.8 },
        ],
    },
    {
        id: "createAppButton",
        required: false,
        timeoutMs: 3000,
        candidates: [
            { kind: "css", value: 'button:has-text("创建企业自建应用")', locale: "zh-CN", confidence: 0.95 },
            { kind: "css", value: 'button:has-text("Create App")', locale: "en-US", confidence: 0.8 },
        ],
    },
    {
        id: "appNameInput",
        required: false,
        timeoutMs: 2500,
        candidates: [
            { kind: "css", value: 'input[placeholder*="应用名称"]', locale: "zh-CN", confidence: 0.9 },
            { kind: "css", value: 'input[placeholder*="App name"]', locale: "en-US", confidence: 0.9 },
        ],
    },
    {
        id: "permissionNav",
        required: false,
        timeoutMs: 3000,
        candidates: [
            { kind: "css", value: 'a:has-text("权限管理")', locale: "zh-CN", confidence: 0.9 },
            { kind: "css", value: 'a:has-text("Permission")', locale: "en-US", confidence: 0.8 },
        ],
    },
    {
        id: "batchImportButton",
        required: false,
        timeoutMs: 3000,
        candidates: [
            { kind: "css", value: 'button:has-text("批量导入")', locale: "zh-CN", confidence: 0.9 },
            { kind: "css", value: 'button:has-text("Batch Import")', locale: "en-US", confidence: 0.8 },
        ],
    },
    {
        id: "permissionImportInput",
        required: false,
        timeoutMs: 2500,
        candidates: [
            { kind: "css", value: "textarea", locale: "any", confidence: 0.85 },
            { kind: "css", value: '[contenteditable="true"]', locale: "any", confidence: 0.7 },
        ],
    },
    {
        id: "capabilityNav",
        required: false,
        timeoutMs: 2500,
        candidates: [
            { kind: "css", value: 'a:has-text("应用能力")', locale: "zh-CN", confidence: 0.85 },
            { kind: "css", value: 'a:has-text("Capabilities")', locale: "en-US", confidence: 0.8 },
        ],
    },
    {
        id: "botCapability",
        required: false,
        timeoutMs: 2500,
        candidates: [
            { kind: "css", value: 'a:has-text("机器人")', locale: "zh-CN", confidence: 0.85 },
            { kind: "css", value: 'a:has-text("Bot")', locale: "en-US", confidence: 0.8 },
        ],
    },
    {
        id: "saveButton",
        required: false,
        timeoutMs: 2500,
        candidates: [
            { kind: "css", value: 'button:has-text("保存")', locale: "zh-CN", confidence: 0.9 },
            { kind: "css", value: 'button:has-text("Save")', locale: "en-US", confidence: 0.9 },
        ],
    },
];
