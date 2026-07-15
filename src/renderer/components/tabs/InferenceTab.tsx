import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { applyBlockReplacements, BlockReplacementItem as UtilBlockReplacementItem, FileUpdateResult } from '../../../shared/file-updater';
import { resolveProjectPath } from '../../../shared/utils';
import InferenceControls from '../shared/InferenceControls';

interface InferenceTabProps {
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  inferenceResult?: string;
  inferenceReasoning?: string;
  inferenceError?: string;
  inferenceStatus?: 'idle' | 'running' | 'success' | 'error';
  onClearResult?: () => void;
  onCancelInference?: () => void;
  onRunInference?: () => void;
  inferenceLastSavedTimestamp?: number | null;
  /** Callback to switch to the Prompt tab so user can re-run inference */
  onSwitchToPrompt?: () => void;
  /**
   * True when the cached/last-run inference was generated using the
   * "Single Block Replacement" task prompt. While true, the "Update Files"
   * button is disabled because that mode only ever targets a single block
   * and its output is not intended to be auto-applied via this flow.
   */
  isSingleBlockReplacementMode?: boolean;
  /** Called after files have been updated via the "Update Files" button */
  onFilesUpdated?: () => void;
}

// ─── Block Replacement Parser ─────────────────────────────────────

interface BlockReplacementItem {
  path: string;
  op: string;
  is_full_file: boolean;
  original: string | null;
  replacement: string | null;
  reason?: string;
  raw: string;
}

type Segment =
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
function preprocessLlmResponse(text: string): string {
  // We need to find every ```json ... ``` fence and process its body.
  // A naive global regex can be confused when the fence body itself contains
  // backtick triplets (which is exactly the problem we are solving), so we use
  // a state-machine approach that scans for the opening tag and then finds the
  // matching closing ``` by counting backtick runs.

  const JSON_OPEN = '```json';
  const FENCE_CLOSE = '```';

  let result = '';
  let i = 0;

  while (i < text.length) {
    // Look for the next ```json opening
    const openIdx = text.indexOf(JSON_OPEN, i);
    if (openIdx === -1) {
      // No more json fences – copy the rest verbatim
      result += text.slice(i);
      break;
    }

    // Copy text before the opening fence verbatim
    result += text.slice(i, openIdx);

    // Advance past the opening tag
    const bodyStart = openIdx + JSON_OPEN.length;

    // Scan from bodyStart to find the REAL closing fence, while escaping backticks
    // inside JSON string values. A naive text.indexOf('```') is wrong when the
    // fence body contains a literal ``` inside a string value (exactly what we
    // sanitize). We therefore track JSON-string state: a triple backtick that
    // appears while NOT inside a string is the closing fence; any backtick inside
    // a string is escaped to \u0060.
    let inString = false;
    let escape = false;
    let backtickCount = 0; // pending backtick run while OUTSIDE a string
    let closeIdx = -1;
    let processedBody = '';
    let j = bodyStart;

    while (j < text.length) {
      const ch = text[j];

      if (inString) {
        if (escape) {
          // Backslash-escaped character: copy verbatim, clear escape flag.
          escape = false;
          processedBody += ch;
        } else if (ch === '\\') {
          escape = true;
          processedBody += ch;
        } else if (ch === '"') {
          inString = false;
          processedBody += ch;
        } else if (ch === '`') {
          // Bare backtick inside a string (single or part of a triple) → escape.
          // This absorbs literal ``` sequences so they are never mistaken for
          // the closing fence.
          processedBody += '\\u0060';
        } else {
          processedBody += ch;
        }
      } else {
        // Outside a JSON string value.
        if (ch === '`') {
          backtickCount++;
          if (backtickCount === 3) {
            // Real closing fence — first backtick of the triple is at j - 2.
            closeIdx = j - 2;
            backtickCount = 0;
            break;
          }
        } else {
          // Flush any accumulated (incomplete) backtick run as literal chars.
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
      // No closing fence found — flush any trailing partial backtick run and
      // append the sanitized body (best-effort), then stop.
      if (backtickCount > 0) processedBody += '`'.repeat(backtickCount);
      result += JSON_OPEN + processedBody;
      break;
    }

    result += JSON_OPEN + processedBody + FENCE_CLOSE;

    // Continue scanning after the closing fence.
    i = closeIdx + FENCE_CLOSE.length;
  }

  return result;
}

/**
 * Attempt to parse a raw JSON string (array or object) into block items.
 * Returns the array of BlockReplacementItem on success, or null on failure.
 * Also tries the tolerant recovery parser as a second pass.
 */
function tryParseJsonBody(body: string, raw: string): BlockReplacementItem[] | null {
  // Pass 1: strict JSON.parse
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
    // Pass 2: tolerant recovery
    const recovered = recoverMalformedBlockJson(body);
    return recovered.length > 0 ? recovered : null;
  }
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  // Pre-process the full response to escape backticks inside JSON string values
  // before the fence-extraction regex runs.
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
      // For non-JSON fences, also try parsing the body as block JSON (tolerates
      // LLMs that omit the "json" language tag on the fence).
      const blocks = tryParseJsonBody(body, body);
      if (blocks && blocks.length > 0) {
        for (const item of blocks) segments.push({ type: 'block', item });
        foundAnyBlock = true;
      } else {
        // Use the original (unprocessed) text slice so display is unchanged.
        segments.push({ type: 'code', lang, content: text.slice(match.index + match[0].indexOf(body), match.index + match[0].indexOf(body) + body.length) });
      }
    }
    lastIndex = match.index + match[0].length;
  }

  const remainder = processedText.slice(lastIndex);
  if (remainder.length > 0) {
    // If no fenced block produced any block items, attempt to parse the
    // entire remaining text (or the whole response when there were no fences)
    // as a bare JSON array — tolerating LLM outputs that omit fencing entirely.
    if (!foundAnyBlock) {
      // Find the first '[' or '{' and last ']' or '}' in the remainder to
      // extract a candidate JSON substring robustly.
      const trimmed = remainder.trim();
      const firstBracket = trimmed.search(/[\[{]/);
      if (firstBracket !== -1) {
        // Use the entire trimmed string from the first bracket as the candidate.
        const candidate = trimmed.slice(firstBracket);
        const blocks = tryParseJsonBody(candidate, candidate);
        if (blocks && blocks.length > 0) {
          // Emit any text before the JSON as a text segment.
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
function extractBlockItems(segments: Segment[]): BlockReplacementItem[] {
  return segments.filter((s): s is { type: 'block'; item: BlockReplacementItem } => s.type === 'block').map(s => s.item);
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
function recoverMalformedBlockJson(body: string): BlockReplacementItem[] {
  const KEYS = ['path', 'op', 'reason', 'is_full_file', 'original', 'replacement'] as const;
  // Boundary lookahead: a comma/brace followed by a known key, OR the end of the
  // object. Used to decide where a mis-escaped string value really ends.
  const keyAlternation = KEYS.join('|');
  const nextKeyOrEnd = new RegExp(
    '\\s*,\\s*"(?:' + keyAlternation + ')"\\s*:|\\s*\\n?\\s*\\}',
    ''
  );

  // Split the fence body into candidate object chunks by locating each
  // top-level '{' ... '}' that contains a "path" key. We scan for object starts
  // heuristically rather than via brace-matching (brace-matching is unreliable
  // once quotes are broken).
  const items: BlockReplacementItem[] = [];

  // Find each occurrence of a "path" key as the start-of-object anchor.
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

      // Skip whitespace.
      while (p < chunk.length && /\s/.test(chunk[p])) p++;

      const ch = chunk[p];
      if (ch === undefined) continue;

      // Non-string literals: null / true / false.
      if (chunk.startsWith('null', p)) { rec[key] = null; continue; }
      if (chunk.startsWith('true', p)) { rec[key] = true; continue; }
      if (chunk.startsWith('false', p)) { rec[key] = false; continue; }

      if (ch !== '"') continue; // unexpected shape for this key; skip.

      // String value: opening quote at p. Find the true closing quote as the
      // LAST '"' that occurs immediately before the next key boundary or the
      // object end. This tolerates unescaped inner double quotes.
      const valueStart = p + 1;
      const rest = chunk.slice(valueStart);

      nextKeyOrEnd.lastIndex = 0;
      const boundary = nextKeyOrEnd.exec(rest);
      const searchEnd = boundary ? boundary.index : rest.length;

      // Within rest[0..searchEnd], the value's terminating quote is the last '"'
      // in that window (the boundary regex begins at a comma or brace, so the
      // closing quote precedes it).
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

// ─── Copy Button ──────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string; label?: string; style?: React.CSSProperties }> = ({
  text, label = 'Copy', style,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      title="Copy to clipboard"
      style={{
        padding: '2px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '3px',
        background: copied ? '#2e7d32' : '#2a2d2e',
        color: copied ? '#a5d6a7' : '#ccc',
        border: '1px solid #555', ...style,
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
};

// ─── Text Renderer ────────────────────────────────────────────────

const TextSegment: React.FC<{ content: string }> = ({ content }) => (
  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d4d4d4', fontSize: '13px', lineHeight: 1.6, padding: '4px 0' }}>
    {content}
  </div>
);

// ─── Code Block ───────────────────────────────────────────────────

const CodeSegment: React.FC<{ lang: string; content: string }> = ({ lang, content }) => (
  <div style={{ margin: '8px 0', position: 'relative' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#2a2d2e', padding: '3px 10px', borderRadius: '4px 4px 0 0', borderBottom: '1px solid #444' }}>
      <span style={{ fontSize: '11px', color: '#888' }}>{lang || 'code'}</span>
      <CopyButton text={content} />
    </div>
    <pre style={{ margin: 0, padding: '10px 12px', background: '#1a1a2e', borderRadius: '0 0 4px 4px', overflowX: 'auto', fontSize: '12px', lineHeight: 1.5, color: '#e6edf3', border: '1px solid #333', borderTop: 'none' }}>
      <code>{content}</code>
    </pre>
  </div>
);

// ─── Block Replacement View ───────────────────────────────────────

const opColors: Record<string, string> = { replace: '#58b0ff', add: '#4ec9b0', delete: '#f48771' };

const BlockSegment: React.FC<{ item: BlockReplacementItem }> = ({ item }) => {
  const color = opColors[item.op.toLowerCase()] ?? '#aaa';
  return (
    <div style={{ margin: '10px 0', border: `1px solid ${color}55`, borderRadius: '6px', overflow: 'hidden', background: '#1e2330' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px', background: '#252a38', borderBottom: `1px solid ${color}44`, flexWrap: 'wrap' }}>
        <span style={{ padding: '1px 8px', borderRadius: '3px', background: `${color}22`, color, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', border: `1px solid ${color}66` }}>
          {item.op}
        </span>
        <span style={{ fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#9cdcfe', flex: 1, wordBreak: 'break-all' }}>
          {item.path}
        </span>
        <span style={{ fontSize: '11px', color: item.is_full_file ? '#4ec9b0' : '#aaa', padding: '1px 6px', border: '1px solid #444', borderRadius: '3px' }}>
          {item.is_full_file ? 'full file' : 'block'}
        </span>
        <CopyButton text={item.replacement ?? item.original ?? item.raw} />
      </div>
      <div style={{ padding: '10px 14px' }}>
        {item.reason && (
          <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(107,0,35,0.5)', border: '1px solid rgba(219,112,147,0.25)', borderLeft: '3px solid #db7093', borderRadius: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#db7093', textTransform: 'uppercase', marginRight: '8px' }}>💡</span>
            <span style={{ fontSize: '12px', color: '#ccc' }}>{item.reason}</span>
          </div>
        )}
        {item.original != null && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#3890df', textTransform: 'uppercase' }}>
                {item.is_full_file ? '[full file — original]' : '[original]'}
              </span>
              <CopyButton text={item.original} />
            </div>
            <pre style={{ margin: `2px 0 0 0`, padding: '8px 12px', background: '#2a3040', border: '1px solid #58b0ff55', borderLeft: '3px solid #58b0ff', borderRadius: '4px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#e6edf3', overflowX: 'auto' }}>
              <code>{item.original}</code>
            </pre>
          </div>
        )}
        {item.replacement != null && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#f09210', textTransform: 'uppercase' }}>[replacement]</span>
              <CopyButton text={item.replacement} />
            </div>
            <pre style={{ margin: `2px 0 0 0`, padding: '8px 12px', background: '#4a3e2e', border: '1px solid #f0921055', borderLeft: '3px solid #f09210', borderRadius: '4px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#e6edf3', overflowX: 'auto' }}>
              <code>{item.replacement}</code>
            </pre>
          </div>
        )}
        {item.original == null && item.replacement == null && (
          <pre style={{ margin: `2px 0 0 0`, padding: '8px 12px', background: '#202020', border: '1px solid #444', borderLeft: '3px solid #666', borderRadius: '4px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#bbb', overflowX: 'auto' }}>
            <code>{item.raw}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

// ─── Result Renderer ──────────────────────────────────────────────

const ResultRenderer: React.FC<{ text: string }> = ({ text }) => {
  const segments = useMemo(() => parseSegments(text), [text]);
  return (
    <div style={{ padding: '8px 4px' }}>
      {segments.map((seg, i) =>
        seg.type === 'block' ? <BlockSegment key={i} item={seg.item} /> :
          seg.type === 'code' ? <CodeSegment key={i} lang={seg.lang} content={seg.content} /> :
            <TextSegment key={i} content={seg.content} />
      )}
    </div>
  );
};

// ─── Tab ──────────────────────────────────────────────────────────

const InferenceTab: React.FC<InferenceTabProps> = ({
  rootFolder,
  inferenceResult = '',
  inferenceReasoning = '',
  inferenceError = '',
  inferenceStatus = 'idle',
  onClearResult,
  onCancelInference,
  onSwitchToPrompt,
  inferenceLastSavedTimestamp,
  isSingleBlockReplacementMode = false,
  onFilesUpdated,
}) => {
  const [model, setModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Paste from clipboard success/failure states
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const [pasteFailure, setPasteFailure] = useState(false);

  // Update Files confirm flow
  const [updateConfirming, setUpdateConfirming] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateResults, setUpdateResults] = useState<FileUpdateResult[]>([]);
  const [showUpdateSummary, setShowUpdateSummary] = useState(false);

  useEffect(() => {
    const loadState = async () => {
      if (!rootFolder) { setLoading(false); return; }
      try {
        const [folderState, apiSettings] = await Promise.all([
          window.electronAPI.getFolderState(rootFolder),
          window.electronAPI.getApiSettings(),
        ]);
        const parsedModels: string[] = [];
        const regex = /"([^"]*)"/g;
        let match;
        while ((match = regex.exec(apiSettings.inferenceModels || '')) !== null) {
          if (match[1].trim()) parsedModels.push(match[1].trim());
        }
        setModel(folderState?.inferenceModel || parsedModels[0] || '');
        setTemperature(folderState?.temperature ?? 0.7);
      } catch (e) {
        console.error('Failed to load inference state:', e);
      } finally {
        setLoading(false);
      }
    };
    loadState();
  }, [rootFolder]);

  // Local state to hold pasted inference result (so we can update inferenceResult locally)
  const [pastedResult, setPastedResult] = useState<string | null>(null);

  const setInferenceResultFromClipboard = useCallback((text: string) => {
    setPastedResult(text);
    // Also update the prop if possible via onClearResult or set it in the parent?
    // We cannot directly modify inferenceResult because it's a prop.
    // Instead, we store it locally and display it via the ResultRenderer.
    // We'll use a local state that overrides the prop display.
  }, []);

  // Reset confirm and paste states when result changes
  useEffect(() => {
    setUpdateConfirming(false);
    setUpdateResults([]);
    setShowUpdateSummary(false);
    setPasteSuccess(false);
    setPasteFailure(false);
  }, [inferenceResult]);

  // When pastedResult changes, also handle the display. If pastedResult is set, show that.
  const effectiveResult = pastedResult ?? inferenceResult;

  const segments = useMemo(() => parseSegments(effectiveResult), [effectiveResult]);

  const blockItems = useMemo(() => extractBlockItems(segments), [segments]);

  // Group update results by file path, collecting unique operation types
  const groupedResults = useMemo(() => {
    const map = new Map<string, { operations: Set<string>; errors: string[]; overall: boolean }>();
    for (const r of updateResults) {
      if (!map.has(r.path)) {
        map.set(r.path, { operations: new Set(), errors: [], overall: r.success });
      }
      const entry = map.get(r.path)!;
      if (r.operation) entry.operations.add(r.operation);
      if (r.error) entry.errors.push(r.error);
      if (!r.success) entry.overall = false;
    }
    return Array.from(map.entries()).map(([path, data]) => ({
      path,
      operations: Array.from(data.operations),
      success: data.overall,
      error: data.errors.length > 0 ? data.errors.join('; ') : undefined,
    }));
  }, [updateResults]);

  const handleUpdateFiles = useCallback(async () => {
    if (!rootFolder || !effectiveResult) return;
    if (blockItems.length === 0) {
      setUpdateConfirming(false);
      return;
    }
    setIsUpdating(true);
    setUpdateResults([]);
    try {
      if (isSingleBlockReplacementMode) {
        // ─── Tagged Block Update: isolated processing branch ───
        // In this mode there is exactly one block item whose "replacement"
        // field contains the new inner text for the <block_to_update> tag.
        const item = blockItems[0];
        const absPath = resolveProjectPath(item.path, rootFolder);
        const fileData = await window.electronAPI.readFile(absPath);
        const content = fileData.content;

        // Match the first <block_to_update ...>...</block_to_update> tag.
        const tagPattern = /(<block_to_update[^>]*>)([\s\S]*?)(<\/block_to_update>)/;
        const match = content.match(tagPattern);

        if (!match) {
          setUpdateResults([{
            path: absPath,
            success: false,
            error: 'No <block_to_update> tag found in file.',
            operation: 'tagged-block-update'
          }]);
          setShowUpdateSummary(true);
          return;
        }

        // Replace only the inner content (between the opening and closing tags)
        // with the parsed replacement value, preserving the tag wrapper.
        const replacement = item.replacement ?? '';
        const newContent = content.replace(tagPattern, (_match, openTag, _inner, closeTag) => {
          return openTag + '\n' + replacement + '\n' + closeTag;
        });

        await window.electronAPI.writeFile(absPath, newContent);

        setUpdateResults([{
          path: absPath,
          success: true,
          operation: 'tagged-block-update'
        }]);
      } else {
        // ─── Standard block replacement flow ───
        // Cast local BlockReplacementItem to the shared utility type (shapes are identical minus `raw`)
        const results = await applyBlockReplacements(
          blockItems as UtilBlockReplacementItem[],
          rootFolder
        );
        setUpdateResults(results);
      }
      setShowUpdateSummary(true);
      onFilesUpdated?.();
    } catch (err: any) {
      setUpdateResults([{ path: '(unknown)', success: false, error: err?.message ?? String(err) }]);
      setShowUpdateSummary(true);
    } finally {
      setIsUpdating(false);
      setUpdateConfirming(false);
    }
  }, [rootFolder, effectiveResult, blockItems, isSingleBlockReplacementMode, onFilesUpdated]);

  const hasContent = !!(effectiveResult || inferenceReasoning || inferenceError);

  return (
    <div className="tab-panel inference-tab">
      {/* Main result */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', marginLeft: '3px' }}>
            <label style={{ fontSize: '15px', color: '#aaa', fontWeight: 'bold' }}>Result</label>
            {inferenceLastSavedTimestamp && (
              <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                Saved {new Date(inferenceLastSavedTimestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Running indicator */}
            {inferenceStatus === 'running' && (
              <div className="inference-loading" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '5px' }}>
                <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', position:'relative', top: '4px', marginRight: '5px' }} />
                Running …
              </div>
            )}

            {/* Error */}
            {inferenceStatus === 'error' && (
              <div className="inference-result-area" style={{ marginBottom: '8px' }}>
                <span className="error">{inferenceError}</span>
              </div>
            )}
            {inferenceStatus === 'running' && (
              <button
                className="inference-action-button"
                style={{ background: '#8b2020' }}
                onClick={() => onCancelInference?.()}
                title="Abort the current inference request"
              >
                Cancel
              </button>
            )}
            <InferenceControls
              rootFolder={rootFolder ?? null}
              onStartInference={() => {
                onSwitchToPrompt?.();
              }}
              disabled={inferenceStatus === 'running'}
              showStartButton={true}
              startButtonLabel="Run Inference Again"
            />
            <button
              className={`inference-action-button ${pasteSuccess ? 'success' : ''} ${pasteFailure ? 'failure' : ''}`}
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  console.log('[InferenceTab] Clipboard text length:', text.length);
                  console.log('[InferenceTab] Clipboard text preview:', text.slice(0, 200));
                  // Always sanitize 3-consecutive-backtick sequences in the pasted
                  // inference result before parsing into the block update list.
                  // parseSegments() internally runs preprocessLlmResponse(), so
                  // pasted text follows the exact same sanitization path as
                  // inference results produced in-app.
                  const segments = parseSegments(text);
                  const blocks = extractBlockItems(segments);
                  console.log('[InferenceTab] Parsed segments count:', segments.length);
                  console.log('[InferenceTab] Block items found:', blocks.length);
                  // Always display the pasted text in the result area
                  setInferenceResultFromClipboard(text);
                  if (blocks.length > 0) {
                    setPasteSuccess(true);
                    setPasteFailure(false);
                    setTimeout(() => setPasteSuccess(false), 2000);
                  } else {
                    setPasteFailure(true);
                    setPasteSuccess(false);
                    setTimeout(() => setPasteFailure(false), 2000);
                  }
                } catch (err) {
                  console.error('[InferenceTab] Paste error:', err);
                  setPasteFailure(true);
                  setPasteSuccess(false);
                  setTimeout(() => setPasteFailure(false), 2000);
                }
              }}
              title="Paste from clipboard and try to parse as Open Router API response"
            >
              {pasteSuccess ? '✓ Parsed' : pasteFailure ? '✗ Parse failed' : 'Paste'}
            </button>
            <button className="inference-action-button" onClick={() => onClearResult?.()} disabled={!hasContent} title="Clear the inference result and reasoning">Clear</button>
            <CopyButton text={inferenceResult} label="Copy All" style={{ padding: '10px', fontSize: '12px', fontWeight: '500', height: '50px' }} />
            {!updateConfirming ? (
              <button
                className="inference-action-button"
                disabled={!effectiveResult || !rootFolder || blockItems.length === 0}
                onClick={() => setUpdateConfirming(true)}
                title={
                  isSingleBlockReplacementMode
                    ? 'Apply the tagged block replacement from the inference result to the file'
                    : 'Apply the block replacements from the inference result to the files'
                }
              >
                Update Files
              </button>
            ) : (
              <>
                <span style={{ fontSize: '12px', color: '#ffb300' }}>Apply changes?</span>
                <button
                  className="inference-action-button"
                  style={{ background: isUpdating ? '#555' : '#2e7d32', minWidth: '40px' }}
                  onClick={handleUpdateFiles}
                  disabled={isUpdating}
                  title="Confirm and apply the file updates"
                >
                  {isUpdating ? 'Updating…' : 'OK'}
                </button>
                <button
                  className="inference-action-button"
                  style={{ background: '#555' }}
                  onClick={() => { setUpdateConfirming(false); setUpdateResults([]); }}
                  disabled={isUpdating}
                  title="Cancel the file update operation"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {/* Model reasoning */}
        {inferenceReasoning && (
          <div style={{ margin: '10px 0 0 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Model Reasoning</label>
              <CopyButton text={inferenceReasoning} />
            </div>
            <div className="inference-result-area" style={{ maxHeight: '140px', color: '#aaa', overflowY: 'auto' }}>
              {inferenceReasoning}
            </div>
          </div>
        )}

        {/* Update results feedback inline (shown only while not showing popup) */}
        {!showUpdateSummary && updateResults.length > 0 && (
          <div style={{ marginBottom: '8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: '4px', padding: '8px 12px', fontSize: '12px' }}>
            {updateResults.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '3px' }}>
                <span style={{ color: r.success ? '#4ec9b0' : '#f48771', fontWeight: 700 }}>{r.success ? '✓' : '✗'}</span>
                <span style={{ fontFamily: 'Consolas, monospace', color: '#9cdcfe', wordBreak: 'break-all' }}>{r.path}</span>
                {r.operation && <span style={{ color: '#ccc', fontSize: '11px', marginLeft: '4px' }}>({r.operation})</span>}
                {r.error && <span style={{ color: '#f48771', fontStyle: 'italic' }}>{r.error}</span>}
              </div>
            ))}
          </div>
        )}

        <div
          className="inference-result-area"
          style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}
        >
          {effectiveResult ? (
            <ResultRenderer text={effectiveResult} />
          ) : (
            <span style={{ color: '#666', fontStyle: 'italic' }}>
              {inferenceStatus === 'running' ? 'Waiting for response…' : 'No result yet. Run inference from the Prompt tab.'}
            </span>
          )}
        </div>
      </div>

      {/* Update Summary Popup Overlay — rendered at tab-panel root so fixed positioning is unobstructed */}
      {showUpdateSummary && groupedResults.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: '#1e1e1e',
              border: '1px solid #555',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '720px',
              width: '90%',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: '16px', fontWeight: 500 }}>
                File Update Summary
              </h3>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ccc',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
                onClick={() => setShowUpdateSummary(false)}
                title="Close the update summary"
              >
                ✕
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, maxHeight: '60vh' }}>
              {groupedResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid #2a2a2a',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: r.success ? '#4ec9b0' : '#f48771',
                        minWidth: '20px',
                        fontSize: '14px',
                      }}
                    >
                      {r.success ? '✓' : '✗'}
                    </span>
                    <span
                      style={{
                        fontFamily: 'Consolas, monospace',
                        color: '#9cdcfe',
                        wordBreak: 'break-all',
                        flex: 1,
                        fontSize: '13px',
                      }}
                    >
                      {r.path}
                    </span>
                  </div>
                  {r.operations.length > 0 && (
                    <div style={{ marginLeft: '30px', marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {r.operations.map((operation, j) => {
                        const opColor = opColors[operation.toLowerCase()] ?? '#aaa';
                        return (
                          <span
                            key={j}
                            style={{
                              padding: '1px 7px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              color: opColor,
                              background: `${opColor}22`,
                              border: `1px solid ${opColor}66`,
                            }}
                          >
                            {operation}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {r.error && (
                    <div style={{ marginLeft: '30px', marginTop: '4px', color: '#f48771', fontSize: '11px', fontStyle: 'italic' }}>
                      {r.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button
                style={{
                  padding: '8px 20px',
                  background: '#0e639c',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                onClick={() => setShowUpdateSummary(false)}
                title="Close the update summary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InferenceTab;