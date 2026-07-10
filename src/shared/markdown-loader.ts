// src/renderer/utils/markdown-loader.ts
// ──────────────────────────────────────────────────────────────────
// Lazily loads the (relatively heavy) markdown rendering dependencies
// (react-markdown + remark-gfm) as a separate code-split chunk so they do
// NOT block the initial app bundle parse/execute time during startup.
//
// The app proactively calls preloadMarkdownModules() once, shortly after the
// main window has become fully visible (see renderer.tsx), so that by the
// time a user opens the Markdown preview overlay the module is already
// resolved and rendering is effectively instant. Consumers can also call
// getMarkdownModulesPromise() directly, which will trigger the load on
// first use if it hasn't already started (e.g. if the preview is opened
// before the background preload has finished).
// ──────────────────────────────────────────────────────────────────

import type { ComponentType } from 'react';

export interface MarkdownModules {
  ReactMarkdown: ComponentType<any>;
  remarkGfm: unknown;
}

let modulePromise: Promise<MarkdownModules> | null = null;

/**
 * Kick off (or reuse) the dynamic import of react-markdown + remark-gfm.
 * Safe to call multiple times — the underlying import only ever runs once.
 */
export function preloadMarkdownModules(): Promise<MarkdownModules> {
  if (!modulePromise) {
    modulePromise = Promise.all([
      import('react-markdown'),
      import('remark-gfm'),
    ]).then(([reactMarkdownModule, remarkGfmModule]) => ({
      ReactMarkdown: reactMarkdownModule.default,
      remarkGfm: remarkGfmModule.default,
    }));
  }
  return modulePromise;
}

/**
 * Returns the in-flight/resolved promise for the markdown modules, starting
 * the load if it hasn't been triggered yet.
 */
export function getMarkdownModulesPromise(): Promise<MarkdownModules> {
  return modulePromise ?? preloadMarkdownModules();
}
