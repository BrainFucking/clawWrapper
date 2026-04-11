"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSecretStore = createSecretStore;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
class MemorySecretStore {
    values = new Map();
    async put(secret) {
        const secretRef = `secret://${(0, node_crypto_1.randomUUID)()}`;
        this.values.set(secretRef, secret);
        return secretRef;
    }
    async get(secretRef) {
        return this.values.get(secretRef);
    }
}
class FileSecretStore {
    baseDir;
    constructor(baseDir) {
        this.baseDir = baseDir;
    }
    async ensureDir() {
        await (0, promises_1.mkdir)(this.baseDir, { recursive: true });
    }
    buildPath(secretRef) {
        const digest = (0, node_crypto_1.createHash)("sha256").update(secretRef).digest("hex");
        return node_path_1.default.join(this.baseDir, `${digest}.secret`);
    }
    async put(secret) {
        await this.ensureDir();
        const secretRef = `secret://file/${(0, node_crypto_1.randomUUID)()}`;
        const target = this.buildPath(secretRef);
        await (0, promises_1.writeFile)(target, secret, { encoding: "utf8", mode: 0o600 });
        return secretRef;
    }
    async get(secretRef) {
        try {
            const content = await (0, promises_1.readFile)(this.buildPath(secretRef), "utf8");
            return content.trim();
        }
        catch {
            return undefined;
        }
    }
}
function createSecretStore(options) {
    if (options.kind === "file") {
        return new FileSecretStore(options.secretsDir);
    }
    return new MemorySecretStore();
}
