import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  shell?: boolean;
  streamOutput?: boolean;
}

export async function runCommand(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<CommandResult> {
  if (options.dryRun) {
    const formatted = [command, ...args].join(" ");
    return {
      code: 0,
      stdout: `[dry-run] ${formatted}`,
      stderr: "",
    };
  }

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: options.shell ?? false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (options.streamOutput) {
        process.stdout.write(text);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (options.streamOutput) {
        process.stderr.write(text);
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
