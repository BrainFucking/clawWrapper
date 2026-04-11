"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSelectorPack = getSelectorPack;
exports.resolveSelector = resolveSelector;
exports.resolveSelectorById = resolveSelectorById;
const default_zh_en_1 = require("./packs/default.zh-en");
function getSelectorPack(name) {
    if (!name || name === "default.zh-en") {
        return default_zh_en_1.defaultZhEnSelectorPack;
    }
    return default_zh_en_1.defaultZhEnSelectorPack;
}
function resolveSelector(spec) {
    const orderedCandidates = [...spec.candidates]
        .sort((a, b) => b.confidence - a.confidence)
        .map((candidate) => candidate.value);
    return { spec, orderedCandidates };
}
function resolveSelectorById(pack, id) {
    const spec = pack.find((entry) => entry.id === id);
    if (!spec) {
        throw new Error(`Selector spec not found: ${id}`);
    }
    return resolveSelector(spec);
}
