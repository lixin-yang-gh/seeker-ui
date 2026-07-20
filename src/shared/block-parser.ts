// src/shared/block-parser.ts
// Shared block replacement parser for inference results and clipboard content.

export interface BlockReplacementItem {
  path: string;
  op: string;
  is_full_file: boolean;
  original: string | null;
  replacement: string | null;
  reason?: string;
  raw: string;
}

export type Segment =
  | { type: 'text'; content: string }
  | { type: 'code'; lang: string; content: string }
  | { type: 'block'; item: BlockReplacementItem };

/**
 * Pre-process a raw LLM response before attempting to extract fenced JSON blocks.
 *
 * The LLM is instructed to escape backticks inside JSON string values as \u0060,
 * but some models instead emit literal backtick characters.  When the "original"
 * or "replacement" field contains a fenced-code-block sequence (```) those
 * literal backticks confuse the outer fence-extraction regex and/or JSON.parse.
 *
 * Strategy:
 *   1. Walk the text character-by-character tracking fenced-block state so that
 *      overlapping or nested fence markers are handled correctly.
 *   2. For every ```json ... ``` fence found, escape bare backticks that appear
 *      inside JSON string values within the fence body.
 *   3. All other text (non-JSON fences, plain prose) is passed through verbatim.
 *
 * This approach works for both:
 *   - Normal inference results returned by the main process.
 *   - Raw text pasted from the clipboard (the "Paste" button path).
 *
 * After JSON.parse the JS runtime automatically converts \u0060 back to `,
 * so no extra unescaping is needed in the parsed objects.
 */
export function preprocessLlmResponse(text: string): string {
  const JSON_OPEN = '```json';
  const FENCE_CLOSE = '```';

  let result = '';
  let i = 0;

  while (i < text.length) {
    const openIdx = text.indexOf(JSON_OPEN, i);
    if (openIdx === -1) {
      result += text.slice(i);
      break;
    }

    result += text.slice(i, openIdx);

    const bodyStart = openIdx + JSON_OPEN.length;

    let inString = false;
    let escape = false;
    let backtickCount = 0;
    let closeIdx = -1;
    let processedBody = '';
    let j = bodyStart;

    while (j < text.length) {
      const ch = text[j];

      if (inString) {
        if (escape) {
          escape = false;
          processedBody += ch;
        } else if (ch === '\\') {
          escape = true;
          processedBody += ch;
        } else if (ch === '"') {
          inString = false;
          processedBody += ch;
        } else if (ch === '`') {
          processedBody += '\\u0060';
        } else {
          processedBody += ch;
        }
      } else {
        if (ch === '`') {
          backtickCount++;
          if (backtickCount === 3) {
            closeIdx = j - 2;
            backtickCount = 0;
            break;
          }
        } else {
          if (backtickCount > 0) {
            processedBody += '`'.repeat(backtickCount);
            backtickCount = 0;
          }
          if (ch === '"') inString = true;
          processedBody += ch;
        }
      }
      j++;
    }

    if (closeIdx === -1) {
      if (backtickCount > 0) processedBody += '`'.repeat(backtickCount);
      result += JSON_OPEN + processedBody;
      break;
    }

    result += JSON_OPEN + processedBody + FENCE_CLOSE;
    i = closeIdx + FENCE_CLOSE.length;
  }

  return result;
}

/**
 * Attempt to parse a raw JSON string (array or object) into block items.
 * Returns the array of BlockReplacementItem on success, or null on failure.
 * Also tries the tolerant recovery parser as a second pass.
 */
export function tryParseJsonBody(body: string, raw: string): BlockReplacementItem[] | null {
  try {
    const parsed = JSON.parse(body);
    const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const blocks: BlockReplacementItem[] = [];
    for (const item of items) {
      if (item && typeof item === 'object' && 'path' in item && 'op' in item) {
        const rec = item as Record<string, unknown>;
        blocks.push({
          path: String(rec.path ?? ''),
          op: String(rec.op ?? 'replace'),
          is_full_file: Boolean(rec.is_full_file ?? false),
          original: rec.original != null ? String(rec.original) : null,
          replacement: rec.replacement != null ? String(rec.replacement) : null,
          reason: rec.reason != null ? String(rec.reason) : undefined,
          raw,
        });
      }
    }
    if (blocks.length > 0) return blocks;
    return null;
  } catch {
    const recovered = recoverMalformedBlockJson(body);
    return recovered.length > 0 ? recovered : null;
  }
}

/**
 * Tolerant, schema-anchored recovery parser for a ```json fence body that
 * FAILED strict JSON.parse. This is a best-effort fallback for the common
 * failure mode where the LLM did not follow the prompt's escaping rules and
 * emitted string values containing unescaped double quotes (e.g. Terraform/HCL
 * resource labels) or literal backticks.
 *
 * IMPORTANT: This is intentionally conservative. It relies on the FIXED key
 * schema defined by the prompt in PromptOrganizerTab.tsx
 * (path, op, reason, is_full_file, original, replacement) as structural
 * anchors. It only runs when strict JSON.parse has already thrown, so it can
 * never regress well-formed responses. It cannot guarantee correctness for
 * pathological inputs and returns [] when the structure is unrecoverable.
 */
export function recoverMalformedBlockJson(body: string): BlockReplacementItem[] {
  const KEYS = ['path', 'op', 'reason', 'is_full_file', 'original', 'replacement'] as const;
  const keyAlternation = KEYS.join('|');
  const nextKeyOrEnd = new RegExp(
    '\\s*,\\s*"(?:' + keyAlternation + ')"\\s*:|\\s*\\n?\\s*\\}',
    ''
  );

  const items: BlockReplacementItem[] = [];

  const objAnchor = /"path"\s*:/g;
  const anchors: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = objAnchor.exec(body)) !== null) anchors.push(m.index);
  if (anchors.length === 0) return [];

  for (let a = 0; a < anchors.length; a++) {
    const start = anchors[a];
    const end = a + 1 < anchors.length ? anchors[a + 1] : body.length;
    const chunk = body.slice(start, end);

    const rec: Record<string, unknown> = {};

    for (const key of KEYS) {
      const keyRe = new RegExp('"' + key + '"\\s*:\\s*', 'g');
      keyRe.lastIndex = 0;
      const km = keyRe.exec(chunk);
      if (!km) continue;
      let p = km.index + km[0].length;

      while (p < chunk.length && /\s/.test(chunk[p])) p++;

      const ch = chunk[p];
      if (ch === undefined) continue;

      if (chunk.startsWith('null', p)) { rec[key] = null; continue; }
      if (chunk.startsWith('true', p)) { rec[key] = true; continue; }
      if (chunk.startsWith('false', p)) { rec[key] = false; continue; }

      if (ch !== '"') continue;

      const valueStart = p + 1;
      const rest = chunk.slice(valueStart);

      nextKeyOrEnd.lastIndex = 0;
      const boundary = nextKeyOrEnd.exec(rest);
      const searchEnd = boundary ? boundary.index : rest.length;

      const window = rest.slice(0, searchEnd);
      const lastQuote = window.lastIndexOf('"');
      if (lastQuote === -1) continue;

      const rawValue = window.slice(0, lastQuote);
      rec[key] = decodeRecoveredString(rawValue);
    }

    if (typeof rec.path === 'string' && typeof rec.op === 'string') {
      items.push({
        path: String(rec.path),
        op: String(rec.op ?? 'replace'),
        is_full_file: Boolean(rec.is_full_file ?? false),
        original: rec.original != null ? String(rec.original) : null,
        replacement: rec.replacement != null ? String(rec.replacement) : null,
        reason: rec.reason != null ? String(rec.reason) : undefined,
        raw: chunk,
      });
    }
  }

  return items;
}

/**
 * Decode a recovered JSON string value: interpret standard JSON escape
 * sequences (\n, \t, \r, \\, \", \/, \uXXXX) while leaving any unescaped inner
 * double quotes intact (they were the reason strict parsing failed).
 */
function decodeRecoveredString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\') {
      const n = raw[i + 1];
      switch (n) {
        case 'n': out += '\n'; i++; break;
        case 't': out += '\t'; i++; break;
        case 'r': out += '\r'; i++; break;
        case 'b': out += '\b'; i++; break;
        case 'f': out += '\f'; i++; break;
        case '"': out += '"'; i++; break;
        case '\\': out += '\\'; i++; break;
        case '/': out += '/'; i++; break;
        case 'u': {
          const hex = raw.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 5;
          } else {
            out += n; i++;
          }
          break;
        }
        default: out += n; i++; break;
      }
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Parse a text into segments: text, code blocks, and block items.
 */
export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const processedText = preprocessLlmResponse(text);
  const pattern = /```(\w*)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let foundAnyBlock = false;

  while ((match = pattern.exec(processedText)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    const lang = match[1];
    const body = match[2];
    if (lang === 'json') {
      const blocks = tryParseJsonBody(body, body);
      if (blocks && blocks.length > 0) {
        for (const item of blocks) segments.push({ type: 'block', item });
        foundAnyBlock = true;
      } else {
        segments.push({ type: 'code', lang, content: body });
      }
    } else {
      const blocks = tryParseJsonBody(body, body);
      if (blocks && blocks.length > 0) {
        for (const item of blocks) segments.push({ type: 'block', item });
        foundAnyBlock = true;
      } else {
        segments.push({ type: 'code', lang, content: text.slice(match.index + match[0].indexOf(body), match.index + match[0].indexOf(body) + body.length) });
      }
    }
    lastIndex = match.index + match[0].length;
  }

  const remainder = processedText.slice(lastIndex);
  if (remainder.length > 0) {
    if (!foundAnyBlock) {
      const trimmed = remainder.trim();
      const firstBracket = trimmed.search(/[\[\{]/);
      if (firstBracket !== -1) {
        const candidate = trimmed.slice(firstBracket);
        const blocks = tryParseJsonBody(candidate, candidate);
        if (blocks && blocks.length > 0) {
          const beforeJson = text.slice(lastIndex, lastIndex + remainder.indexOf(trimmed.slice(firstBracket)));
          if (beforeJson) segments.push({ type: 'text', content: beforeJson });
          for (const item of blocks) segments.push({ type: 'block', item });
          return segments;
        }
      }
    }
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

/** Extract all block items from parsed segments */
export function extractBlockItems(segments: Segment[]): BlockReplacementItem[] {
  return segments.filter((s): s is { type: 'block'; item: BlockReplacementItem } => s.type === 'block').map(s => s.item);
}
