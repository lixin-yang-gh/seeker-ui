// src/shared/model-capabilities.ts
// -------------------------------------------------------------------
// Shared model capability registry.
//
// This module is provider-agnostic and consumed by:
//   - src/shared/open-router.ts   (OpenRouter chat completions)
//   - src/shared/venice.ts        (Venice AI OpenAI-compatible chat completions)
//
// Design goals:
//   1. Single source of truth for per-model capability flags.
//   2. Tolerant slug lookup (dots ↔ dashes, case-insensitive, common aliases).
//   3. Family-level fallback so unknown-but-related models still get sensible
//      defaults (e.g. any "anthropic/claude-*" gets anthropicThinking = true).
//   4. A final DEFAULT_CAPABILITY guarantees callers never receive `undefined`.
// -------------------------------------------------------------------

export interface ModelCapability {
  /** Inject Anthropic-style { type, budget_tokens } thinking block */
  anthropicThinking?: boolean;
  /** Model self-reasons (DeepSeek R1 / Gemini thinking / Kimi etc.); no extra config needed */
  nativeReasoning?: boolean;
  /** OpenRouter :online web-search plugin supported */
  webSearch?: boolean;
  /** Must use temperature === 1 when thinking is active */
  requiresTempOne?: boolean;
  /** Minimum safe max_tokens when thinking is active */
  thinkingMinTokens?: number;
  /** Provider this capability entry was authored for (informational only). */
  provider?: 'openrouter' | 'venice' | 'both';
}

/**
 * Exact-slug capability registry.
 *
 * Keys should be the canonical slug as accepted by the target provider.
 * When both OpenRouter and Venice accept the same underlying model, prefer the
 * OpenRouter-style "vendor/model" slug and let the fuzzy resolver handle
 * Venice's shorter aliases.
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  // ── Anthropic ──
  'anthropic/claude-sonnet-4-6': {
    anthropicThinking: true,
    requiresTempOne: true,
    webSearch: true,
    thinkingMinTokens: 16_000,
    provider: 'openrouter',
  },

  // ── DeepSeek ──
  'deepseek/deepseek-v4-pro': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 16_000,
    provider: 'both',
  },
  'deepseek/deepseek-v4-flash': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'both',
  },

  // ── Z-AI / GLM ──
  'z-ai/glm-5-2': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'openrouter',
  },

  // ── Moonshot Kimi ──
  'moonshotai/kimi-k2-7-code': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'openrouter',
  },
  'moonshotai/kimi-2-5': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'both',
  },
  'moonshotai/kimi-2-6': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'both',
  },

  // ── xAI Grok ──
  'x-ai/grok-4': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'openrouter',
  },
  'x-ai/grok-code-fast': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'openrouter',
  },

  // ── Google Gemini ──
  'google/gemini-2-5-pro': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 16_000,
    provider: 'openrouter',
  },
  'google/gemini-2-5-flash': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'openrouter',
  },

  // ── AION ──
  'aion-labs/aion-2-0': {
    nativeReasoning: true,
    webSearch: false,
    thinkingMinTokens: 8_000,
    provider: 'openrouter',
  },

  // ── Alibaba Qwen ──
  'qwen/qwen-3-7': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
    provider: 'both',
  },
};

/**
 * Default capability used as the ultimate fallback. Deliberately conservative:
 * no thinking, no web search, no temperature constraint.
 */
export const DEFAULT_CAPABILITY: ModelCapability = {
  anthropicThinking: false,
  nativeReasoning: false,
  webSearch: false,
  requiresTempOne: false,
  thinkingMinTokens: 8_000,
};

/**
 * Family-level fallbacks. Applied when the exact slug (and its dot/dash
 * normalisation) is not present in MODEL_CAPABILITIES. The first matching
 * predicate wins. Predicates receive the already-lower-cased model id.
 */
const FAMILY_FALLBACKS: Array<{ match: (id: string) => boolean; cap: ModelCapability }> = [
  {
    match: (id) => id.startsWith('anthropic/claude') || id.includes('claude'),
    cap: { anthropicThinking: true, requiresTempOne: true, webSearch: true, thinkingMinTokens: 16_000 },
  },
  {
    match: (id) => id.startsWith('deepseek/') || id.includes('deepseek'),
    cap: { nativeReasoning: true, webSearch: true, thinkingMinTokens: 12_000 },
  },
  {
    match: (id) => id.startsWith('x-ai/') || id.startsWith('xai/') || id.includes('grok'),
    cap: { nativeReasoning: true, webSearch: true, thinkingMinTokens: 8_000 },
  },
  {
    match: (id) => id.startsWith('google/') || id.includes('gemini'),
    cap: { nativeReasoning: true, webSearch: true, thinkingMinTokens: 12_000 },
  },
  {
    match: (id) => id.startsWith('moonshotai/') || id.includes('kimi'),
    cap: { nativeReasoning: true, webSearch: true, thinkingMinTokens: 8_000 },
  },
  {
    match: (id) => id.startsWith('qwen/') || id.includes('qwen'),
    cap: { nativeReasoning: true, webSearch: true, thinkingMinTokens: 8_000 },
  },
  {
    match: (id) => id.startsWith('aion-labs/') || id.includes('aion'),
    cap: { nativeReasoning: true, webSearch: false, thinkingMinTokens: 8_000 },
  },
  {
    match: (id) => id.startsWith('z-ai/') || id.includes('glm'),
    cap: { nativeReasoning: true, webSearch: true, thinkingMinTokens: 8_000 },
  },
];

/**
 * Resolve capability entry for a given model slug.
 *
 * Resolution order:
 *   1. Exact match against MODEL_CAPABILITIES.
 *   2. Case-insensitive match with dots-normalised-to-dashes.
 *   3. Family-level heuristic fallback (FAMILY_FALLBACKS).
 *   4. DEFAULT_CAPABILITY.
 *
 * This function NEVER returns undefined — callers can safely destructure.
 */
export function getCapability(model: string): ModelCapability {
  if (!model) return { ...DEFAULT_CAPABILITY };

  if (MODEL_CAPABILITIES[model]) return MODEL_CAPABILITIES[model];

  const normalised = model.replace(/\./g, '-').toLowerCase();
  for (const key of Object.keys(MODEL_CAPABILITIES)) {
    if (key.toLowerCase() === normalised) return MODEL_CAPABILITIES[key];
  }

  for (const { match, cap } of FAMILY_FALLBACKS) {
    if (match(normalised)) return { ...DEFAULT_CAPABILITY, ...cap };
  }

  return { ...DEFAULT_CAPABILITY };
}
