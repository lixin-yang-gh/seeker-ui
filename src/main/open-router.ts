// src/main/open-router.ts
// -------------------------------------------------------------------
// OpenRouter API client – pure function, no side effects.
// Supports standard chat, per-model deep thinking, and web search.
// -------------------------------------------------------------------

// ─── Model Capability Registry ──────────────────────────────────

interface ModelCapability {
  /** Inject Anthropic-style { type, budget_tokens } thinking block */
  anthropicThinking?: boolean;
  /** Model self-reasons (DeepSeek R1 style); no extra config needed */
  nativeReasoning?: boolean;
  /** OpenRouter :online web-search plugin supported */
  webSearch?: boolean;
  /** Must use temperature === 1 when thinking is active */
  requiresTempOne?: boolean;
  /** Minimum safe max_tokens when thinking is active */
  thinkingMinTokens?: number;
}

const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'anthropic/claude-sonnet-4-6': {
    anthropicThinking: true,
    requiresTempOne: true,
    webSearch: true,
    thinkingMinTokens: 16_000,
  },
  'deepseek/deepseek-v4-pro': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 16_000,
  },
  'z-ai/glm-5-2': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
  },
  'moonshotai/kimi-k2-7-code': {
    nativeReasoning: true,
    webSearch: true,
    thinkingMinTokens: 8_000,
  },
};

/** Resolve capability entry, tolerating minor slug variations (dots↔dashes). */
function getCapability(model: string): ModelCapability {
  if (MODEL_CAPABILITIES[model]) return MODEL_CAPABILITIES[model];
  // Normalise: replace dots with dashes for lookup
  const normalised = model.replace(/\./g, '-');
  return MODEL_CAPABILITIES[normalised] ?? {};
}

// ─── Public Types ────────────────────────────────────────────────

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
}

// ─── Internal Response Shape ─────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────

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

// ─── Main Export ─────────────────────────────────────────────────

/**
 * Call the OpenRouter Chat Completions API.
 * Returns an OpenRouterResult; for callers that only need the text, use `.text`.
 */
export async function callOpenRouter(params: OpenRouterRequest): Promise<OpenRouterResult> {
  const {
    systemPrompt,
    userPrompt,
    model,
    apiKey,
    temperature = 0.1,
    temperature_claude = 1,
    maxTokens = 8_192,
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

  const effectiveTemp = thinkingActive && cap.requiresTempOne ? temperature_claude  : temperature;
  const effectiveMaxTokens = thinkingActive
    ? Math.max(maxTokens, cap.thinkingMinTokens ?? 16_000)
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

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'Seeker UI',
    },
    body: JSON.stringify(body),
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

  if (!data.choices?.length) throw new Error('No choices returned from OpenRouter');

  const extracted = extractContent(data.choices[0]);
  if (!extracted.text) throw new Error('Empty content in OpenRouter response');

  return { text: extracted.text, reasoning: extracted.reasoning, usage: data.usage };
}