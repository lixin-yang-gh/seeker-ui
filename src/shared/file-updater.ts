// src/shared/fileUpdater.ts
// Shared utility: applies parsed block-replacement items to the file system.

import { resolveProjectPath } from './utils';

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
      return { path: absPath, success: false, error: 'Full-file delete not supported via this utility.' };
    }

    if (op === 'add' && item.is_full_file) {
      // Create new file with replacement content
      await window.electronAPI.writeFile(absPath, item.replacement ?? '');
      return { path: absPath, success: true };
    }

    if (op === 'replace' && item.is_full_file) {
      await window.electronAPI.writeFile(absPath, item.replacement ?? '');
      return { path: absPath, success: true };
    }

    // Partial ops: read → mutate → write
    const fileData = await window.electronAPI.readFile(absPath);
    let content = fileData.content;

    if (op === 'delete' && item.original != null) {
      if (!content.includes(item.original)) {
        return { path: absPath, success: false, error: 'Original block not found in file.' };
      }
      content = content.replace(item.original, '');
      await window.electronAPI.writeFile(absPath, content);
      return { path: absPath, success: true };
    }

    if ((op === 'replace' || op === 'add') && item.original != null) {
      if (!content.includes(item.original)) {
        return { path: absPath, success: false, error: 'Original block not found in file.' };
      }
      const newContent = op === 'add'
        ? content.replace(item.original, item.original + (item.replacement ?? ''))
        : content.replace(item.original, item.replacement ?? '');
      await window.electronAPI.writeFile(absPath, newContent);
      return { path: absPath, success: true };
    }

    return { path: absPath, success: false, error: `Unhandled op/is_full_file combination: ${item.op}/${item.is_full_file}` };
  } catch (err: any) {
    return { path: absPath, success: false, error: err?.message ?? String(err) };
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