"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ask = ask;
exports.confirm = confirm;
exports.closePrompt = closePrompt;
const promises_1 = __importDefault(require("node:readline/promises"));
const node_process_1 = require("node:process");
const rl = promises_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
async function ask(question, fallback = "") {
    const suffix = fallback ? ` (${fallback})` : "";
    const answer = await rl.question(`${question}${suffix}: `);
    const value = answer.trim();
    return value.length > 0 ? value : fallback;
}
async function confirm(question, defaultYes = false) {
    const label = defaultYes ? "Y/n" : "y/N";
    const answer = await rl.question(`${question} [${label}]: `);
    const normalized = answer.trim().toLowerCase();
    if (!normalized) {
        return defaultYes;
    }
    return normalized === "y" || normalized === "yes";
}
function closePrompt() {
    rl.close();
}
