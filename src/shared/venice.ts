// src/shared/venice.ts
// -------------------------------------------------------------------
// Venice AI API client — mirrors the shape and behaviour of open-router.ts.
//
// Venice exposes an OpenAI-compatible Chat Completions endpoint at
//   https://api.venice.ai/api/v1/chat/completions
// so the wire protocol is intentionally identical to OpenRouter's, minus a
// few provider-specific extensions (no `plugins` block, no `X-Title` header).
//
// The shared MODEL_CAPABILITIES registry is used for per-model handling of:
//   - Anthropic-style thinking blocks
//   - native reasoning (DeepSeek / Gemini / Kimi / Grok / Qwen / AION)
//   - temperature=1 requirement
//   - max_tokens floor when thinking is active
//
// Fallback: any model not explicitly listed still receives sane defaults via
// the family-level heuristics inside getCapability(), so new Venice models
// work without code changes.
// -------------------------------------------------------------------

import { getCapability } from './model-capabilities';
export type { ModelCapability } from './model-capabilities';

// ─── Public Types ──────────────────────────────────────

export interface VeniceRequest {
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
  /** Enable web search (only honoured when Venice exposes it for the model) */
  webSearch?: boolean;
  /** Override base URL if Venice ever changes it or a proxy is required */
  baseUrl?: string;
}

export interface VeniceResult {
  /** Final visible assistant reply */
  text: string;
  /** Internal reasoning trace, if the model returned one */
  reasoning?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** Raw finish_reason reported by the provider */
  finishReason?: string;
  /** True when the response was cut off before completion (finish_reason === 'length') */
  truncated?: boolean;
}

// ─── Internal Response Shape ────────────────────────────────────

interface ContentBlock {
  type: 'text' | 'thinking' | 'redacted_thinking';
  text?: string;
  thinking?: string;
}

interface VeniceChoice {
  message: {
    role: string;
    content: string | ContentBlock[];
    reasoning?: string;
    reasoning_content?: string;
  };
  finish_reason: string;
}

interface VeniceResponse {
  id: string;
  choices: VeniceChoice[];
  usage?: VeniceResult['usage'];
}

// ─── Helpers ──────────────────────────────────────────────

function extractContent(choice: VeniceChoice): Pick<VeniceResult, 'text' | 'reasoning'> {
  const { message } = choice;
  if (Array.isArray(message.content)) {
    const blocks = message.content as ContentBlock[];
    const text = blocks
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n')
      .trim();
    const reasoning =
      blocks
        .filter(b => b.type === 'thinking' && b.thinking)
        .map(b => b.thinking!)
        .join('\n')
        .trim() || undefined;
    return { text, reasoning };
  }
  return {
    text: (message.content as string) ?? '',
    // Venice may return reasoning under either `reasoning` (OpenAI-compat) or
    // `reasoning_content` (DeepSeek-style). Accept either.
    reasoning:
      (message.reasoning?.trim() || message.reasoning_content?.trim()) || undefined,
  };
}

// ─── Main Export ────────────────────────────────────────────

/**
 * Call the Venice AI Chat Completions API.
 *
 * The signature and return type deliberately mirror callOpenRouter() so the
 * main-process IPC layer can swap implementations based on a settings flag
 * with minimal glue code.
 */
export async function callVenice(params: VeniceRequest, signal?: AbortSignal): Promise<VeniceResult> {
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
    baseUrl = 'https://api.venice.ai/api/v1',
  } = params;

  if (!apiKey) throw new Error('Venice API key is required');
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

  // Anthropic-style thinking block (Venice mirrors OpenRouter's shape for
  // Claude-family models routed via its gateway).
  if (thinkingActive && cap.anthropicThinking) {
    body['thinking'] = { type: 'enabled', budget_tokens: thinkingBudget };
  }

  // Venice-specific web-search hint. If Venice does not honour this field it
  // will be silently ignored; if it does, we pass a modest result cap that
  // matches the OpenRouter plugin configuration.
  if (searchActive) {
    body['venice_parameters'] = { enable_web_search: 'auto' };
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

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
      detail = err?.error?.message || err?.message || JSON.stringify(err);
    } catch {
      detail = await response.text();
    }
    throw new Error(`Venice API error (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as VeniceResponse;
  console.log('[Venice] Raw API response:', JSON.stringify(data, null, 2));

  if (!data.choices?.length) throw new Error('No choices returned from Venice');

  const choice = data.choices[0];
  const finishReason = choice.finish_reason;
  const extracted = extractContent(choice);

  const truncated = finishReason === 'length';

  if (finishReason === 'content_filter') {
    console.warn('[Venice] Response stopped by content filter.');
  }
  if (truncated) {
    console.warn(
      `[Venice] Response was TRUNCATED (finish_reason=length). ` +
      `Completion tokens: ${data.usage?.completion_tokens ?? 'unknown'}. ` +
      `Consider increasing max_tokens or reducing prompt/output size.`
    );
  }

  if (!extracted.text) {
    if (truncated) {
      throw new Error(
        'Venice response was truncated (hit max_tokens) before any visible content was produced. Try increasing max_tokens or shortening the prompt.'
      );
    }
    throw new Error('Empty content in Venice response');
  }

  return {
    text: extracted.text,
    reasoning: extracted.reasoning,
    usage: data.usage,
    finishReason,
    truncated,
  };
}
