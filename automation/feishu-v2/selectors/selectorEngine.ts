import { defaultZhEnSelectorPack, type SelectorSpec } from "./packs/default.zh-en";

export interface SelectorResolution {
  spec: SelectorSpec;
  orderedCandidates: string[];
}

export function getSelectorPack(name?: string): SelectorSpec[] {
  if (!name || name === "default.zh-en") {
    return defaultZhEnSelectorPack;
  }
  return defaultZhEnSelectorPack;
}

export function resolveSelector(spec: SelectorSpec): SelectorResolution {
  const orderedCandidates = [...spec.candidates]
    .sort((a, b) => b.confidence - a.confidence)
    .map((candidate) => candidate.value);
  return { spec, orderedCandidates };
}

export function resolveSelectorById(pack: SelectorSpec[], id: SelectorSpec["id"]): SelectorResolution {
  const spec = pack.find((entry) => entry.id === id);
  if (!spec) {
    throw new Error(`Selector spec not found: ${id}`);
  }
  return resolveSelector(spec);
}

