import { runGuidedFeishuSetup } from "../../../automation/feishu/setupBot";

export interface FeishuSetupCommandOptions {
  outputPath: string;
  botName: string;
  headless: boolean;
}

export async function runFeishuSetupCommand(
  options: FeishuSetupCommandOptions,
): Promise<number> {
  const result = await runGuidedFeishuSetup({
    outputPath: options.outputPath,
    botName: options.botName,
    headless: options.headless,
  });

  console.log(`Saved Feishu setup output to ${result.outputPath}`);
  console.log("Use the values in that file for `claw-wrapper configure`.");
  return 0;
}
