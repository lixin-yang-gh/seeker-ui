// src/shared/open-router.ts
// -------------------------------------------------------------------
// OpenRouter API client – pure function, no side effects.
// Supports standard chat, per-model deep thinking, and web search.
// -------------------------------------------------------------------

// ─── Model Capability Registry ──────────────────────────────────────────────
// Registry has moved to src/shared/model-capabilities.ts so that Venice and
// any future provider can reuse the exact same table + resolution logic.

import { getCapability, ModelCapability } from './model-capabilities';
export type { ModelCapability } from './model-capabilities';

// ─── Public Types ─────────────────────────────────────────────────────

export interface OpenRouterRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  apiKey: string;
  temperature?: number;
  temperature_claude?: number;
  maxTokens?: number;
  topP?: number;
  /** Enable deep thinking / extended reasoning when the model supports it */
  deepThinking?: boolean;
  /** Budget tokens for Anthropic-style thinking (default 10 000) */
  thinkingBudget?: number;
  /** Enable web search plugin when the model supports it */
  webSearch?: boolean;
}

export interface OpenRouterResult {
  /** Final visible assistant reply */
  text: string;
  /** Internal reasoning trace, if the model returned one */
  reasoning?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** Raw finish_reason reported by the provider (e.g. 'stop', 'length', 'content_filter') */
  finishReason?: string;
  /** True when the response was cut off before completion (finish_reason === 'length') */
  truncated?: boolean;
}

// ─── Internal Response Shape ───────────────────────────────────────────────────

interface ContentBlock {
  type: 'text' | 'thinking' | 'redacted_thinking';
  text?: string;
  thinking?: string;
}

interface OpenRouterChoice {
  message: {
    role: string;
    content: string | ContentBlock[];
    reasoning?: string;
  };
  finish_reason: string;
}

interface OpenRouterResponse {
  id: string;
  choices: OpenRouterChoice[];
  usage?: OpenRouterResult['usage'];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractContent(choice: OpenRouterChoice): Pick<OpenRouterResult, 'text' | 'reasoning'> {
  const { message } = choice;
  if (Array.isArray(message.content)) {
    const blocks = message.content as ContentBlock[];
    const text = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text!).join('\n').trim();
    const reasoning = blocks.filter(b => b.type === 'thinking' && b.thinking).map(b => b.thinking!).join('\n').trim() || undefined;
    return { text, reasoning };
  }
  return {
    text: (message.content as string) ?? '',
    reasoning: message.reasoning?.trim() || undefined,
  };
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Returns true when the response text has `path=` and `op=` markers but
 * neither a fenced code block nor a `scope=` attribute — i.e. the model
 * produced a malformed block-replacement response that must be retried.
 */
export function isMalformedBlockResponse(text: string): boolean {
  // Check for a ```json fenced block
  const jsonFenceMatch = text.match(/```json\s*\n([\s\S]*?)```/);
  if (!jsonFenceMatch) return false; // no JSON block at all → not a block response
  try {
    const parsed = JSON.parse(jsonFenceMatch[1]);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    // A valid block item needs at minimum 'path' and 'op'
    const hasValidItem = items.some(
      item => item && typeof item === 'object' && 'path' in item && 'op' in item
    );
    return !hasValidItem; // JSON present but missing required fields → malformed
  } catch {
    return true; // JSON fence present but unparseable → malformed
  }
}

/**
 * Call the OpenRouter Chat Completions API.
 * Returns an OpenRouterResult; for callers that only need the text, use `.text`.
 */
export async function callOpenRouter(params: OpenRouterRequest, signal?: AbortSignal): Promise<OpenRouterResult> {
  const {
    systemPrompt,
    userPrompt,
    model,
    apiKey,
    temperature = 0.7,
    temperature_claude = 1,
    maxTokens = 32_768,
    topP = 1.0,
    deepThinking = false,
    thinkingBudget = 10_000,
    webSearch = false,
  } = params;

  if (!apiKey) throw new Error('OpenRouter API key is required');
  if (!model) throw new Error('Model name is required');

  const cap = getCapability(model);
  const thinkingActive = deepThinking && (cap.anthropicThinking || cap.nativeReasoning);
  const searchActive = webSearch && cap.webSearch;

  const effectiveTemp = thinkingActive && cap.requiresTempOne ? temperature_claude : temperature;
  const effectiveMaxTokens = thinkingActive
    ? Math.max(maxTokens, (cap.thinkingMinTokens ?? 16_000) + thinkingBudget)
    : maxTokens;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: effectiveTemp,
    max_tokens: effectiveMaxTokens,
    top_p: topP,
    stream: false,
  };

  if (thinkingActive && cap.anthropicThinking) {
    body['thinking'] = { type: 'enabled', budget_tokens: thinkingBudget };
  }

  if (searchActive) {
    body['plugins'] = [{ id: 'web', max_results: 5 }];
  }

  const timeoutSignal = AbortSignal.timeout(600_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let dispatcher: unknown;
  try {
    const undici = await import('undici');
    dispatcher = new undici.Agent({
      headersTimeout: 620_000,
      bodyTimeout: 620_000,
      keepAliveTimeout: 620_000,
      keepAliveMaxTimeout: 620_000,
      connectTimeout: 30_000,
    });
  } catch {
    dispatcher = undefined;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'Seeker UI',
    },
    body: JSON.stringify(body),
    signal: combinedSignal,
    // @ts-expect-error - `dispatcher` is a Node/undici-specific fetch option not in the DOM lib types
    ...(dispatcher ? { dispatcher } : {}),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await response.text();
    }
    throw new Error(`OpenRouter API error (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  console.log('[OpenRouter] Raw API response:', JSON.stringify(data, null, 2));

  if (!data.choices?.length) throw new Error('No choices returned from OpenRouter');

  const choice = data.choices[0];
  const finishReason = choice.finish_reason;
  const extracted = extractContent(choice);

  const truncated = finishReason === 'length';

  if (finishReason === 'content_filter') {
    console.warn('[OpenRouter] Response stopped by content filter.');
  }
  if (truncated) {
    console.warn(
      `[OpenRouter] Response was TRUNCATED (finish_reason=length). ` +
      `Completion tokens: ${data.usage?.completion_tokens ?? 'unknown'}. ` +
      `Consider increasing max_tokens or reducing prompt/output size.`
    );
  }

  if (!extracted.text) {
    if (truncated) {
      throw new Error(
        'OpenRouter response was truncated (hit max_tokens) before any visible content was produced. Try increasing max_tokens or shortening the prompt.'
      );
    }
    throw new Error('Empty content in OpenRouter response');
  }

  return {
    text: extracted.text,
    reasoning: extracted.reasoning,
    usage: data.usage,
    finishReason,
    truncated,
  };
}
