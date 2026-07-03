// utils.ts

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  } else if (typeof error === 'string') {
    return error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  } else {
    return 'An unknown error occurred';
  }
}

/**
 * Computes a clean relative path from rootFolder to filePath.
 * Returns full path if rootFolder is missing or computation fails.
 */
export function getRelativePath(filePath: string | null, rootFolder: string | null | undefined): string {
  return (filePath ?? '').replace(rootFolder ?? '', '').replace(/^[\/\\]+/, '')
}

/**
 * Check if a file or directory exists
 */
export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await window.electronAPI.getFileStats(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

// Re-export sanitization functions from sanitize.ts
export {
  decodeHtmlEntities,
  sanitizeText,
} from './sanitize';

// <project_root>/src/shared/substring-parser.ts
/**
 * Parses a string containing quoted substrings separated by commas, whitespace, or semicolons
 * Returns an array of non-empty strings
 */
export function parseMaskedSubstrings(input: string): string[] {
  if (!input || typeof input !== 'string') return [];

  // Match content inside double or single quotes
  // This regex matches:
  // - Double quoted strings: "content"
  // - Single quoted strings: 'content'
  // - Unquoted strings (but we'll filter these out for now as per requirement)
  const quotedRegex = /"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g;

  const matches: string[] = [];
  let match;

  while ((match = quotedRegex.exec(input)) !== null) {
    // The captured content is either in group 1 (double quoted) or group 3 (single quoted)
    const content = match[1] || match[3];
    if (content && content.trim()) {
      // Unescape escaped quotes
      matches.push(content.replace(/\\"/g, '"').replace(/\\'/g, "'"));
    }
  }

  return matches;
}

/**
 * Applies custom masking to text based on provided substrings
 */
export function applyCustomMasking(text: string, substrings: string[]): string {
  if (!text || substrings.length === 0) return text;

  let result = text;

  // Sort by length (longest first) to prevent partial masking issues
  // e.g., if we have "abc" and "abcd", we want to mask "abcd" first
  const sortedSubstrings = [...substrings].sort((a, b) => b.length - a.length);

  for (const substring of sortedSubstrings) {
    if (!substring.trim()) continue;

    // Escape special regex characters
    const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Create a regex that matches the substring as a whole word or part of text
    // Using word boundaries to avoid matching inside larger words
    // But since we want to match anywhere in the text (including inside words),
    // we'll use a simple global replace
    const regex = new RegExp(escaped, 'gi');
    result = result.replace(regex, '[SENSITIVE]');
  }

  return result;
}

/**
 * Resolve a path that may start with "<project_root>/" to an absolute path
 * relative to the given rootFolder.
 * If the path does not start with the prefix, it is returned unchanged.
 */
export function resolveProjectPath(projectPath: string, rootFolder: string): string {
  const prefix = '<project_root>/';
  if (projectPath.startsWith(prefix)) {
    const rel = projectPath.slice(prefix.length).replace(/\\/g, '/');
    const normalizedRoot = rootFolder.replace(/\\/g, '/');
    const root = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/';
    return root + rel;
  }
  return projectPath;
}