// src/shared/fileUpdater.ts
// Shared utility: applies parsed block-replacement items to the file system.

import { resolveProjectPath } from './utils';

/**
 * Check if a block replacement item has valid, actionable fields.
 * Only items inside fenced JSON code blocks (not free text) should be considered.
 */
export function isValidBlockItem(item: unknown): item is BlockReplacementItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.path === 'string' &&
    typeof i.op === 'string' &&
    ['add', 'replace', 'delete'].includes(i.op as string)
  );
}

export interface BlockReplacementItem {
  path: string;
  op: string;
  is_full_file: boolean;
  original: string | null;
  replacement: string | null;
  reason?: string;
}

export interface FileUpdateResult {
  path: string;
  success: boolean;
  error?: string;
  operation?: string;
}

/**
 * Normalize all line-ending variants (CRLF, lone CR, LF) to a single \n.
 * This guarantees consistent line splitting/joining regardless of whether the
 * source file or the LLM-provided block uses Windows, classic-Mac, or Unix
 * newline conventions.
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function createFlexiblePattern(original: string): RegExp {
  // Normalize ALL line-ending variants to \n before building the pattern.
  const lines = normalizeNewlines(original).split('\n');
  const patternParts = lines.map(line => {
    // Trim leading/trailing whitespace and collapse internal whitespace
    const cleanedLine = line.trim().replace(/\s+/g, ' ');
    if (cleanedLine === '') {
      // For empty lines, allow any amount of horizontal whitespace (or empty)
      return '[ \\t]*';
    }
    // Escape regex special characters
    const escaped = cleanedLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Tolerate multiple spaces/tabs between words by replacing literal space with [ \\t]+
    const spaceTolerant = escaped.replace(/ /g, '[ \\t]+');
    // Allow leading and trailing horizontal whitespace on the line
    return `[ \\t]*${spaceTolerant}[ \\t]*`;
  });
  // Join with \r?\n to tolerate different line endings
  const pattern = patternParts.join('\\r?\\n');
  // Do not use 'g' flag so String.match returns a match object with index
  return new RegExp(pattern, 's');
}

/**
 * Aggressively trim a single line for line-by-line comparison.
 * Removes leading/trailing whitespace (spaces, tabs) and collapses any internal
 * runs of whitespace to a single space so that indentation differences and
 * stray trailing whitespace/control characters do not defeat the match.
 */
function canonicalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * Last-resort fallback: locate the block by comparing trimmed lines.
 *
 * The LLM-provided `original` block is split into its non-empty canonicalized
 * lines. We then scan the file's canonicalized lines for a contiguous window
 * whose non-empty lines match the block's non-empty lines in order. This
 * tolerates leading tabs/whitespace, trailing whitespace, blank-line
 * differences, and stray special/whitespace characters that survive the
 * regex-based flexible matcher.
 *
 * Returns { start, end } as character offsets into the ORIGINAL (un-normalized)
 * content spanning the matched block (from the first matched line's start to
 * the last matched line's end), or null if no match is found.
 */
function findBlockByTrimmedLines(
  content: string,
  original: string
): { start: number; end: number } | null {
  const normalizedContent = normalizeNewlines(content);

  // Build an index of each content line's char offsets in normalizedContent.
  const contentLines: { text: string; start: number; end: number }[] = [];
  {
    let offset = 0;
    const rawLines = normalizedContent.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
      const text = rawLines[i];
      const start = offset;
      const end = offset + text.length;
      contentLines.push({ text, start, end });
      // +1 for the '\n' separator (except conceptually after the last line)
      offset = end + 1;
    }
  }

  // Canonicalized, non-empty target lines (with their original index preserved).
  const targetLines = normalizeNewlines(original)
    .split('\n')
    .map(canonicalizeLine)
    .filter(l => l.length > 0);

  if (targetLines.length === 0) return null;

  // Pre-canonicalize content lines, remembering which are non-empty.
  const canonContent = contentLines.map(cl => ({
    canon: canonicalizeLine(cl.text),
    start: cl.start,
    end: cl.end,
  }));

  // Scan for a window of content lines whose non-empty canonical lines match
  // the target sequence in order.
  for (let i = 0; i < canonContent.length; i++) {
    // Only start a candidate window at a line matching the first target line.
    if (canonContent[i].canon !== targetLines[0]) continue;

    let ti = 0; // target index
    let ci = i; // content index
    let firstMatchStart = -1;
    let lastMatchEnd = -1;

    while (ci < canonContent.length && ti < targetLines.length) {
      const cLine = canonContent[ci];
      if (cLine.canon.length === 0) {
        // Skip blank/whitespace-only content lines within the window.
        ci++;
        continue;
      }
      if (cLine.canon === targetLines[ti]) {
        if (firstMatchStart === -1) firstMatchStart = cLine.start;
        lastMatchEnd = cLine.end;
        ti++;
        ci++;
      } else {
        break; // mismatch — abandon this candidate window
      }
    }

    if (ti === targetLines.length && firstMatchStart !== -1) {
      // Map offsets from normalizedContent back onto the original content.
      // Because normalization only removes '\r' characters (never adds any),
      // offsets can differ. Re-derive offsets against the original content by
      // counting characters up to the matched normalized offsets.
      const start = mapNormalizedOffsetToOriginal(content, firstMatchStart);
      const end = mapNormalizedOffsetToOriginal(content, lastMatchEnd);
      return { start, end };
    }
  }

  return null;
}

/**
 * Map a character offset computed against the newline-normalized content back to
 * the corresponding offset in the original (un-normalized) content. Since
 * normalization only strips '\r' characters, we walk the original content and
 * advance a normalized-position counter, skipping '\r' bytes, until the target
 * normalized offset is reached.
 */
function mapNormalizedOffsetToOriginal(original: string, normalizedOffset: number): number {
  let normPos = 0;
  let i = 0;
  for (; i < original.length; i++) {
    if (normPos === normalizedOffset) break;
    const ch = original[i];
    if (ch === '\r') {
      // A lone '\r' or the '\r' in '\r\n' collapses to a single '\n' (or is
      // removed for lone CR). It does not advance the normalized counter here
      // because '\r\n' -> '\n' and lone '\r' -> '\n'; we count the '\n' side.
      const next = original[i + 1];
      if (next === '\n') {
        // '\r\n' pair: skip the '\r', the '\n' will advance normPos next loop.
        continue;
      } else {
        // lone '\r' became '\n' in normalized form -> advance normPos.
        normPos++;
        continue;
      }
    }
    normPos++;
  }
  return i;
}

/**
 * Attempt to find and replace (or add) a block in the content.
 * Matching strategy (in order):
 *   1. Exact substring match.
 *   2. Flexible indentation/whitespace regex match.
 *   3. Trimmed line-by-line match (tolerates leading tabs/whitespace, trailing
 *      whitespace/special characters, and blank-line differences).
 * Returns the updated content if found, or null if not found.
 */
function findAndReplaceInContent(
  content: string,
  original: string,
  replacement: string,
  op: 'replace' | 'add'
): string | null {
  // 1) Attempt exact match
  const exactIndex = content.indexOf(original);
  if (exactIndex !== -1) {
    if (op === 'add') {
      return content.slice(0, exactIndex + original.length) + '\n' + replacement + content.slice(exactIndex + original.length);
    } else {
      return content.slice(0, exactIndex) + replacement + content.slice(exactIndex + original.length);
    }
  }

  // 2) Fallback: flexible indentation matching
  const pattern = createFlexiblePattern(original);
  const match = content.match(pattern);
  if (match) {
    const foundBlock = match[0];
    const index = match.index!;
    if (op === 'add') {
      return content.slice(0, index + foundBlock.length) + '\n' + replacement + content.slice(index + foundBlock.length);
    } else {
      return content.slice(0, index) + replacement + content.slice(index + foundBlock.length);
    }
  }

  // 3) Last-resort fallback: trimmed line-by-line matching. This handles cases
  // where leading tabs/whitespace, trailing whitespace, or stray special
  // characters in the LLM-provided original block prevent the regex matcher
  // from locating the block.
  const trimmedMatch = findBlockByTrimmedLines(content, original);
  if (trimmedMatch) {
    const { start, end } = trimmedMatch;
    if (op === 'add') {
      return content.slice(0, end) + '\n' + replacement + content.slice(end);
    } else {
      return content.slice(0, start) + replacement + content.slice(end);
    }
  }

  return null;
}


/**
 * Apply a single block replacement item to the file system.
 */
async function applyItem(
  item: BlockReplacementItem,
  rootFolder: string
): Promise<FileUpdateResult> {
  const absPath = resolveProjectPath(item.path, rootFolder);
  const op = item.op.toLowerCase();

  try {
    if (op === 'delete' && item.is_full_file) {
      // No delete API exposed; write empty string as a no-op guard —
      // callers should confirm before invoking.
      // If a true delete IPC is added later, call it here.
      return { path: absPath, success: false, error: 'Full-file delete not supported via this utility.', operation: item.op };
    }

    if (op === 'add' && item.is_full_file) {
      // Create new file with replacement content
      await window.electronAPI.writeFile(absPath, item.replacement ?? '');
      return { path: absPath, success: true, operation: item.op };
    }

    if (op === 'replace' && item.is_full_file) {
      await window.electronAPI.writeFile(absPath, item.replacement ?? '');
      return { path: absPath, success: true, operation: item.op };
    }

    // Partial ops: read → mutate → write
    const fileData = await window.electronAPI.readFile(absPath);
    let content = fileData.content;

    if (op === 'delete' && item.original != null) {
      const newContent = findAndReplaceInContent(content, item.original, '', 'replace');
      if (newContent === null) {
        return { path: absPath, success: false, error: 'Original block not found in file (exact or flexible).', operation: item.op };
      }
      await window.electronAPI.writeFile(absPath, newContent);
      return { path: absPath, success: true, operation: item.op };
    }

    if ((op === 'replace' || op === 'add') && item.original != null) {
      const newContent = findAndReplaceInContent(content, item.original, item.replacement ?? '', op);
      if (newContent === null) {
        return { path: absPath, success: false, error: 'Original block not found in file (exact or flexible).', operation: item.op };
      }
      await window.electronAPI.writeFile(absPath, newContent);
      return { path: absPath, success: true, operation: item.op };
    }

    return { path: absPath, success: false, error: `Unhandled op/is_full_file combination: ${item.op}/${item.is_full_file}`, operation: item.op };
  } catch (err: any) {
    return { path: absPath, success: false, error: err?.message ?? String(err), operation: item.op };
  }
}

/**
 * Apply all block replacement items sequentially.
 * Returns per-item results.
 */
export async function applyBlockReplacements(
  items: BlockReplacementItem[],
  rootFolder: string
): Promise<FileUpdateResult[]> {
  const results: FileUpdateResult[] = [];
  for (const item of items) {
    results.push(await applyItem(item, rootFolder));
  }
  return results;
}
