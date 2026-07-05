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
* Normalize indentation in a source string by replacing leading whitespace 
* at the start of each line with a flexible regex that matches any whitespace.
* This allows matching even when the LLM-provided block has mismatched indentation.
* Returns a RegExp object with 'gs' flags (global, dotall) to match across lines.
*/
function createFlexiblePattern(original: string): RegExp {
  const lines = original.split('\n');
  const patternParts = lines.map(line => {
    // Capture leading whitespace and the rest
    const match = line.match(/^(\s*)(.*)$/);
    if (!match) return ''; // should not happen
    const [, leading, rest] = match;
    // Escape regex special characters in the rest
    const escapedRest = rest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // If line is blank (leading empty and rest empty), just represent as optional whitespace
    if (leading === '' && rest === '') {
      return '\\s*';
    }
    // Use [ \t]* to match any combination of spaces and tabs (but not newlines)
    return `[ \\t]*${escapedRest}`;
  });
  // Join with newline (must match newline in content)
  const pattern = patternParts.join('\n');
  return new RegExp(pattern, 'gs');
}

/**
 * Attempt to find and replace (or add) a block in the content.
 * First tries exact match. If that fails, falls back to flexible indentation matching.
 * Returns the updated content if found, or null if not found.
 */
function findAndReplaceInContent(
  content: string,
  original: string,
  replacement: string,
  op: 'replace' | 'add'
): string | null {
  // Attempt exact match
  const exactIndex = content.indexOf(original);
  if (exactIndex !== -1) {
    if (op === 'add') {
      return content.slice(0, exactIndex + original.length) + '\n' + replacement + content.slice(exactIndex + original.length);
    } else {
      return content.slice(0, exactIndex) + replacement + content.slice(exactIndex + original.length);
    }
  }

  // Fallback: flexible indentation matching
  const pattern = createFlexiblePattern(original);
  const match = content.match(pattern);
  if (match) {
    const foundBlock = match[0];
    if (op === 'add') {
      const index = match.index!;
      return content.slice(0, index + foundBlock.length) + '\n' + replacement + content.slice(index + foundBlock.length);
    } else {
      const index = match.index!;
      return content.slice(0, index) + replacement + content.slice(index + foundBlock.length);
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
