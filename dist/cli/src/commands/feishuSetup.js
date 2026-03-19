"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFeishuSetupCommand = runFeishuSetupCommand;
const setupBot_1 = require("../../../automation/feishu/setupBot");
async function runFeishuSetupCommand(options) {
    const result = await (0, setupBot_1.runGuidedFeishuSetup)({
        outputPath: options.outputPath,
        botName: options.botName,
        headless: options.headless,
    });
    console.log(`Saved Feishu setup output to ${result.outputPath}`);
    console.log("Use the values in that file for `claw-wrapper configure`.");
    return 0;
}
