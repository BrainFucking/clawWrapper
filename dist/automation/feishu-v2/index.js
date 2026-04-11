"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFeishuSetupEngine = createFeishuSetupEngine;
const runSetup_1 = require("./orchestrator/runSetup");
class DefaultFeishuSetupEngine {
    async run(request) {
        return (0, runSetup_1.runFeishuSetupV2)(request);
    }
    async resume(runId, request) {
        return (0, runSetup_1.runFeishuSetupV2)({ ...request, resumeFromRunId: runId });
    }
}
function createFeishuSetupEngine() {
    return new DefaultFeishuSetupEngine();
}
