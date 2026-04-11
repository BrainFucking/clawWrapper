import { runGuidedFeishuSetup } from "../../../automation/feishu/setupBot";
import { createFeishuSetupEngine } from "../../../automation/feishu-v2";

export interface FeishuSetupCommandOptions {
  outputPath: string;
  botName: string;
  headless: boolean;
  engine?: "v1" | "v2";
  resumeRunId?: string;
  secretStore?: "memory" | "file";
  webhookProbe?: boolean;
}

export async function runFeishuSetupCommand(
  options: FeishuSetupCommandOptions,
): Promise<number> {
  if (options.engine === "v2") {
    const engine = createFeishuSetupEngine();
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

  const result = await runGuidedFeishuSetup({
    outputPath: options.outputPath,
    botName: options.botName,
    headless: options.headless,
  });

  console.log(`Saved Feishu setup output to ${result.outputPath}`);
  console.log("Use the values in that file for `claw-wrapper configure`.");
  return 0;
}
