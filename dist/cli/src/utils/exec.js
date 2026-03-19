"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
const node_child_process_1 = require("node:child_process");
async function runCommand(command, args = [], options = {}) {
    if (options.dryRun) {
        const formatted = [command, ...args].join(" ");
        return {
            code: 0,
            stdout: `[dry-run] ${formatted}`,
            stderr: "",
        };
    }
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(command, args, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            shell: options.shell ?? false,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            stdout += text;
            if (options.streamOutput) {
                process.stdout.write(text);
            }
        });
        child.stderr.on("data", (chunk) => {
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
