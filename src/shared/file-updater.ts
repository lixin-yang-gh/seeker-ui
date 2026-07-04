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
  operation?: string;  // <-- added so that UI can display the operation type
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
      if (!content.includes(item.original)) {
        return { path: absPath, success: false, error: 'Original block not found in file.', operation: item.op };
      }
      content = content.replace(item.original, '');
      await window.electronAPI.writeFile(absPath, content);
      return { path: absPath, success: true, operation: item.op };
    }

    if ((op === 'replace' || op === 'add') && item.original != null) {
      if (!content.includes(item.original)) {
        return { path: absPath, success: false, error: 'Original block not found in file.', operation: item.op };
      }
      const newContent = op === 'add'
        ? content.replace(item.original, item.original + (item.replacement ?? ''))
        : content.replace(item.original, item.replacement ?? '');
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
