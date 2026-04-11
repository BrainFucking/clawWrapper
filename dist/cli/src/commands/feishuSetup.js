"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFeishuSetupCommand = runFeishuSetupCommand;
const setupBot_1 = require("../../../automation/feishu/setupBot");
const feishu_v2_1 = require("../../../automation/feishu-v2");
async function runFeishuSetupCommand(options) {
    if (options.engine === "v2") {
        const engine = (0, feishu_v2_1.createFeishuSetupEngine)();
        const result = options.resumeRunId
            ? await engine.resume(options.resumeRunId, {
                outputPath: options.outputPath,
                botName: options.botName,
                headless: options.headless,
                secretStore: options.secretStore,
                selectorPack: "default.zh-en",
                webhookProbe: options.webhookProbe,
            })
            : await engine.run({
                outputPath: options.outputPath,
                botName: options.botName,
                headless: options.headless,
                secretStore: options.secretStore,
                selectorPack: "default.zh-en",
                webhookProbe: options.webhookProbe,
            });
        console.log(`Saved Feishu v2 setup output to ${result.outputPath}`);
        console.log(`Run ID: ${result.runId}`);
        console.log(`Status: ${result.status}`);
        if (result.nextAction) {
            console.log(`Next action: ${result.nextAction}`);
        }
        return result.status === "failed" ? 1 : 0;
    }
    const result = await (0, setupBot_1.runGuidedFeishuSetup)({
        outputPath: options.outputPath,
        botName: options.botName,
        headless: options.headless,
    });
    console.log(`Saved Feishu setup output to ${result.outputPath}`);
    console.log("Use the values in that file for `claw-wrapper configure`.");
    return 0;
}
