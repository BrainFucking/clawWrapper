"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointStore = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
class CheckpointStore {
    runsDir;
    constructor(runsDir) {
        this.runsDir = runsDir;
    }
    runDir(runId) {
        return node_path_1.default.join(this.runsDir, runId);
    }
    checkpointPath(runId) {
        return node_path_1.default.join(this.runDir(runId), "checkpoint.json");
    }
    async load(runId) {
        try {
            const raw = await (0, promises_1.readFile)(this.checkpointPath(runId), "utf8");
            return JSON.parse(raw);
        }
        catch {
            return undefined;
        }
    }
    async save(checkpoint) {
        const runDir = this.runDir(checkpoint.runId);
        await (0, promises_1.mkdir)(runDir, { recursive: true });
        await (0, promises_1.writeFile)(this.checkpointPath(checkpoint.runId), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    }
}
exports.CheckpointStore = CheckpointStore;
