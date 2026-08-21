export const RULE_SOURCE_PRIORITIES = Object.freeze({
  adapter: 700,
  rejection: 600,
  'html-attribute': 500,
  'nearby-text': 400,
  'selected-text': 300,
  ai: 200,
  'weak-page-text': 100
});

export const RULE_SOURCE_TYPES = Object.freeze(Object.keys(RULE_SOURCE_PRIORITIES));

export function getSourcePriority(sourceType) {
  return RULE_SOURCE_PRIORITIES[sourceType] ?? 0;
}

export function createEmptyRuleSet() {
  return {
    mediaKind: null,
    formats: [],
    extensions: [],
    minBytes: null,
    maxBytes: null,
    duration: { exactMs: null, minMs: null, maxMs: null },
    audio: { sampleRates: [], channels: [], bitDepths: [] },
    width: { exact: null, min: null, max: null },
    height: { exact: null, min: null, max: null },
    aspectRatio: null,
    dpi: null,
    count: { max: null },
    background: null,
    semanticRequirements: [],
    confidence: 0,
    sources: [],
    conflicts: [],
    advisories: [],
    safetyFlags: [],
    actionable: true
  };
}

export function createRuleCandidate({
  sourceType = 'nearby-text',
  evidence = [],
  confidence = 0,
  rules = {},
  advisoryOnly = false,
  safetyFlags = []
} = {}) {
  return {
    sourceType,
    sourcePriority: getSourcePriority(sourceType),
    evidence: [...evidence],
    confidence,
    rules,
    advisoryOnly,
    safetyFlags: [...new Set(safetyFlags)]
  };
}
