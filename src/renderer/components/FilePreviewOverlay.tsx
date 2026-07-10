import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/file_preview_overlay.css';
import { FileContent } from '../../shared/types';
import { getMarkdownModulesPromise, MarkdownModules } from '../../shared/markdown-loader';

interface FilePreviewOverlayProps {
  filePath: string | null;
  rootFolder?: string | null;
  content: FileContent;
  onClose: () => void;
  onSave?: (content: string) => void | Promise<void>;
}

const FilePreviewOverlay: React.FC<FilePreviewOverlayProps> = ({
  filePath,
  rootFolder,
  content,
  onClose,
  onSave,
}) => {
  const initialContent = content?.content ?? '';
  const [editedContent, setEditedContent] = useState<string>(initialContent);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isEditable, setIsEditable] = useState<boolean>(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState<boolean>(false);
  const DEFAULT_FONT_SIZE = 13;
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  // ── Markdown rendering overlay state ──
  const [showMarkdownView, setShowMarkdownView] = useState<boolean>(false);
  // Lazily-loaded react-markdown + remark-gfm modules (loaded on first use of
  // the Markdown preview, but typically already preloaded shortly after the
  // main window becomes visible — see renderer.tsx).
  const [markdownModules, setMarkdownModules] = useState<MarkdownModules | null>(null);
  // ── Markdown preview color theme (independent of the app's own dark theme) ──
  const [markdownTheme, setMarkdownTheme] = useState<'dark' | 'light'>('dark');
  // ── Substring search (telescope) state ──
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const originalContentRef = useRef<string>(initialContent);
  // Track whether the initial font size / word wrap settings have been loaded
  // from the store so we do not immediately overwrite a freshly-loaded value on
  // the first render.
  const fontSizeLoadedRef = useRef<boolean>(false);
  const wordWrapLoadedRef = useRef<boolean>(false);
  const markdownThemeLoadedRef = useRef<boolean>(false);

  // Load persisted font size AND word wrap for this root folder on mount
  // (or when rootFolder changes).
  useEffect(() => {
    if (!rootFolder) return;
    let cancelled = false;
    const load = async () => {
      try {
        const folderState = await window.electronAPI.getFolderState(rootFolder);
        if (cancelled) return;
        if (folderState?.previewFontSize && typeof folderState.previewFontSize === 'number') {
          setFontSize(folderState.previewFontSize);
        }
        if (typeof folderState?.previewWordWrap === 'boolean') {
          setWordWrap(folderState.previewWordWrap);
        }
        if (folderState?.previewMarkdownTheme === 'light' || folderState?.previewMarkdownTheme === 'dark') {
          setMarkdownTheme(folderState.previewMarkdownTheme);
        }
      } catch (err) {
        console.error('FilePreviewOverlay: failed to load preview settings', err);
      } finally {
        if (!cancelled) {
          fontSizeLoadedRef.current = true;
          wordWrapLoadedRef.current = true;
          markdownThemeLoadedRef.current = true;
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rootFolder]);

  // Debounce-persist font size changes to the folder-specific store.
  useEffect(() => {
    if (!rootFolder || !fontSizeLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          previewFontSize: fontSize,
        });
      } catch (err) {
        console.error('FilePreviewOverlay: failed to persist font size', err);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [fontSize, rootFolder]);

  // Debounce-persist word wrap changes to the folder-specific store.
  useEffect(() => {
    if (!rootFolder || !wordWrapLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          previewWordWrap: wordWrap,
        });
      } catch (err) {
        console.error('FilePreviewOverlay: failed to persist word wrap', err);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [wordWrap, rootFolder]);
  // Debounce-persist word wrap changes to the folder-specific store.
  useEffect(() => {
    if (!rootFolder || !wordWrapLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          previewWordWrap: wordWrap,
        });
      } catch (err) {
        console.error('FilePreviewOverlay: failed to persist word wrap', err);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [wordWrap, rootFolder]);

  // Debounce-persist the markdown preview theme (light/dark) toggle to the
  // folder-specific store, so the user's choice is remembered at rest for
  // this root folder the next time the markdown preview is opened.
  useEffect(() => {
    if (!rootFolder || !markdownThemeLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          previewMarkdownTheme: markdownTheme,
        });
      } catch (err) {
        console.error('FilePreviewOverlay: failed to persist markdown theme', err);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [markdownTheme, rootFolder]);

  // Reset state whenever the overlay is (re)opened with new content/file
  useEffect(() => {
    setEditedContent(initialContent);
    originalContentRef.current = initialContent;
    setIsDirty(false);
    setIsEditable(false);
    setShowUnsavedModal(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, [initialContent, filePath]);



  // ── Substring search helpers ──
  const escapeHtml = useCallback((s: string): string => {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }, []);

  // Compute all match ranges (start/end char offsets) for the current query.
  const matchRanges = React.useMemo<Array<{ start: number; end: number }>>(() => {
    if (!showSearch || !searchQuery) return [];
    const ranges: Array<{ start: number; end: number }> = [];
    const haystack = caseSensitive ? editedContent : editedContent.toLowerCase();
    const needle = caseSensitive ? searchQuery : searchQuery.toLowerCase();
    if (needle.length === 0) return [];
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + needle.length });
      from = idx + needle.length;
    }
    return ranges;
  }, [showSearch, searchQuery, caseSensitive, editedContent]);

  // Build HTML for the highlight overlay: escaped content with <mark> around matches.
  const highlightHtml = React.useMemo<string>(() => {
    if (matchRanges.length === 0) return '';
    let html = '';
    let cursor = 0;
    matchRanges.forEach((r, i) => {
      html += escapeHtml(editedContent.slice(cursor, r.start));
      const cls =
        i === activeMatchIndex
          ? 'file-preview-overlay__mark file-preview-overlay__mark--active'
          : 'file-preview-overlay__mark';
      html += '<mark class="' + cls + '">' + escapeHtml(editedContent.slice(r.start, r.end)) + '</mark>';
      cursor = r.end;
    });
    html += escapeHtml(editedContent.slice(cursor));
    return html;
  }, [matchRanges, editedContent, activeMatchIndex, escapeHtml]);

  // Keep the highlight overlay scrolled in sync with the editor textarea.
  const syncHighlightScroll = useCallback(() => {
    if (highlightLayerRef.current && editorRef.current) {
      highlightLayerRef.current.scrollTop = editorRef.current.scrollTop;
      highlightLayerRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  }, []);

  // Reset the active match when the query or results change.
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery, caseSensitive]);

  // Focus the search input when the search box is opened.
  useEffect(() => {
    if (showSearch) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [showSearch]);

  // Scroll the editor to reveal the active match.
  const scrollToActiveMatch = useCallback(() => {
    const el = editorRef.current;
    const range = matchRanges[activeMatchIndex];
    if (!el || !range) return;
    const before = editedContent.slice(0, range.start);
    const lineNumber = before.split('\n').length - 1;
    const style = window.getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.45;
    const targetTop = lineNumber * lineHeight - el.clientHeight / 2;
    el.scrollTop = Math.max(0, targetTop);
    syncHighlightScroll();
  }, [matchRanges, activeMatchIndex, editedContent, fontSize, syncHighlightScroll]);

  useEffect(() => {
    if (showSearch && matchRanges.length > 0) {
      scrollToActiveMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchIndex, matchRanges.length, showSearch]);

  const gotoNextMatch = useCallback(() => {
    if (matchRanges.length === 0) return;
    setActiveMatchIndex((i) => (i + 1) % matchRanges.length);
  }, [matchRanges.length]);

  const gotoPrevMatch = useCallback(() => {
    if (matchRanges.length === 0) return;
    setActiveMatchIndex((i) => (i - 1 + matchRanges.length) % matchRanges.length);
  }, [matchRanges.length]);

  const toggleSearch = useCallback(() => {
    setShowSearch((s) => !s);
  }, []);

  const toggleMarkdownView = useCallback(() => {
    setShowMarkdownView((s) => !s);
  }, []);

  // Ensure the markdown rendering dependencies are available whenever the
  // Markdown preview is opened. In the common case this resolves immediately
  // from the already-preloaded module cache (preloaded shortly after the main
  // window became visible); if the preview is opened before that background
  // load finishes, this triggers/reuses the same in-flight import.
  useEffect(() => {
    if (!showMarkdownView || markdownModules) return;
    let cancelled = false;
    getMarkdownModulesPromise().then((mods) => {
      if (!cancelled) setMarkdownModules(mods);
    });
    return () => {
      cancelled = true;
    };
  }, [showMarkdownView, markdownModules]);

  const toggleMarkdownTheme = useCallback(() => {
    setMarkdownTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const performSave = useCallback(
    async (newContent: string) => {
      if (onSave) {
        await onSave(newContent);
      } else if (filePath) {
        // Default behavior: write directly through the electron bridge
        await window.electronAPI.writeFile(filePath, newContent);
      }
    },
    [onSave, filePath]
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setEditedContent(newValue);
      setIsDirty(newValue !== originalContentRef.current);
    },
    []
  );

  // Clipboard shortcut handling for the editor textarea.
  //  - Read-only mode: Ctrl/Cmd+C copies the currently highlighted text.
  //  - Edit mode:      Ctrl/Cmd+C copies, Ctrl/Cmd+X cuts (removing the
  //                    selection and updating content), and Ctrl/Cmd+V pastes
  //                    clipboard text at the current caret/selection position.
  //
  // We handle these explicitly (rather than relying purely on native browser
  // behavior) so that cut/paste correctly mutate editedContent + isDirty, and
  // so copy works reliably even while the textarea is readOnly.
  const handleEditorKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();
      const el = e.currentTarget;
      const selStart = el.selectionStart ?? 0;
      const selEnd = el.selectionEnd ?? 0;
      const hasSelection = selEnd > selStart;

      // ── Copy (both read-only and edit mode) ──
      if (key === 'c') {
        if (!hasSelection) return; // nothing highlighted → let default no-op
        e.preventDefault();
        const selected = editedContent.slice(selStart, selEnd);
        try {
          await navigator.clipboard.writeText(selected);
        } catch (err) {
          console.error('FilePreviewOverlay: copy failed', err);
        }
        return;
      }

      // ── Cut (edit mode only) ──
      if (key === 'x') {
        if (!isEditable) return;
        if (!hasSelection) return; // nothing highlighted → let default no-op
        e.preventDefault();
        const selected = editedContent.slice(selStart, selEnd);
        try {
          await navigator.clipboard.writeText(selected);
        } catch (err) {
          console.error('FilePreviewOverlay: cut (copy phase) failed', err);
          return; // do not mutate content if clipboard write failed
        }
        const newValue =
          editedContent.slice(0, selStart) + editedContent.slice(selEnd);
        setEditedContent(newValue);
        setIsDirty(newValue !== originalContentRef.current);
        // Restore caret to where the removed selection started.
        requestAnimationFrame(() => {
          const node = editorRef.current;
          if (node) {
            node.selectionStart = selStart;
            node.selectionEnd = selStart;
          }
        });
        return;
      }

      // ── Paste (edit mode only) ──
      if (key === 'v') {
        if (!isEditable) return;
        e.preventDefault();
        let clip = '';
        try {
          clip = await navigator.clipboard.readText();
        } catch (err) {
          console.error('FilePreviewOverlay: paste failed', err);
          return;
        }
        if (!clip) return;
        const newValue =
          editedContent.slice(0, selStart) + clip + editedContent.slice(selEnd);
        setEditedContent(newValue);
        setIsDirty(newValue !== originalContentRef.current);
        // Place caret at the end of the inserted text.
        const caret = selStart + clip.length;
        requestAnimationFrame(() => {
          const node = editorRef.current;
          if (node) {
            node.selectionStart = caret;
            node.selectionEnd = caret;
          }
        });
        return;
      }
    },
    [editedContent, isEditable]
  );

  // Intercept close attempts to warn about unsaved changes
  const attemptClose = useCallback(() => {
    if (isDirty) {
      setShowUnsavedModal(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const handleKeepChanges = useCallback(async () => {
    try {
      await performSave(editedContent);
    } catch (err) {
      console.error('Failed to save file:', err);
      // Do not close on save failure — leave the modal open so the user knows
      return;
    }
    originalContentRef.current = editedContent;
    setIsDirty(false);
    setShowUnsavedModal(false);
    onClose();
  }, [editedContent, performSave, onClose]);

  const handleAbandonChanges = useCallback(() => {
    setEditedContent(originalContentRef.current);
    setIsDirty(false);
    setShowUnsavedModal(false);
    onClose();
  }, [onClose]);

  const handleCancelClose = useCallback(() => {
    setShowUnsavedModal(false);
  }, []);

  // Toolbar: Enter edit mode
  const handleEdit = useCallback(() => {
    setIsEditable(true);
  }, []);

  // Toolbar: Save current changes AND close the overlay
  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await performSave(editedContent);
      originalContentRef.current = editedContent;
      setIsDirty(false);
      setSaveStatus('success');
      // Close the overlay after successful save
      onClose();
    } catch (err) {
      console.error('Failed to save file:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [isDirty, editedContent, performSave, onClose]);

  // Toolbar: Revert edits back to the original file content, exit edit mode,
  // and re-hide Save/Revert All while showing Edit again.
  const handleRevert = useCallback(async () => {
    let originalFromDisk = originalContentRef.current;
    if (filePath) {
      try {
        const fileData = await window.electronAPI.readFile(filePath);
        originalFromDisk = fileData?.content ?? originalContentRef.current;
        originalContentRef.current = originalFromDisk;
      } catch (err) {
        console.error('Failed to reload file for revert:', err);
      }
    }
    setEditedContent(originalFromDisk);
    setIsDirty(false);
    setIsEditable(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, [filePath]);

  // Handle ESC key to close (also routed through attemptClose), Ctrl/Cmd+S to
  // save, and Ctrl/Cmd+F to toggle the substring search box.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (showSearch) {
          setShowSearch(false);
        } else {
          setShowSearch(true);
          searchInputRef.current?.focus();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (showUnsavedModal) {
          handleCancelClose();
        } else if (showMarkdownView) {
          setShowMarkdownView(false);
        } else if (showSearch) {
          setShowSearch(false);
        } else {
          attemptClose();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (isEditable && isDirty && saveStatus !== 'saving') {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showUnsavedModal, attemptClose, handleCancelClose, isEditable, isDirty, saveStatus, handleSave, showSearch, showMarkdownView]);

  return (
    <div className="file-preview-overlay" onClick={attemptClose}>
      <div
        className="file-preview-overlay__content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="file-preview-overlay__header">
          <span className="file-preview-overlay__path" title={filePath ?? ''}>
            {filePath ?? '(untitled)'}
            {isDirty && <span className="file-preview-overlay__dirty"> • Modified</span>}
          </span>
          <button
            type="button"
            className="file-preview-overlay__close"
            onClick={attemptClose}
            aria-label="Close preview"
          >
            ×
          </button>
        </div>

        <div className="file-preview-overlay__toolbar">
          <div className="file-preview-overlay__toolbar-status">
            {saveError && (
              <span className="file-preview-overlay__toolbar-error" title={saveError}>
                {saveError}
              </span>
            )}
            {!saveError && isEditable && isDirty && (
              <span className="file-preview-overlay__toolbar-hint">Unsaved changes</span>
            )}
            {!saveError && isEditable && !isDirty && (
              <span className="file-preview-overlay__toolbar-hint" style={{ color: '#4ec9b0', fontStyle: 'normal' }}>
                Editing enabled
              </span>
            )}
          </div>
          <div className="file-preview-overlay__toolbar-group">
            <button
              type="button"
              className={
                'file-preview-overlay__toolbar-btn' +
                (wordWrap ? ' file-preview-overlay__toolbar-btn--primary' : ' file-preview-overlay__toolbar-btn--secondary')
              }
              onClick={() => setWordWrap((w) => !w)}
              title={wordWrap ? 'Disable word wrap (show long lines on a single line with horizontal scrolling)' : 'Enable word wrap (wrap long lines to fit the editor width)'}
              aria-pressed={wordWrap}
            >
              Word {wordWrap ? 'Wrap: On' : 'Wrap: Off'}
            </button>
            <button
              type="button"
              className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--secondary"
              onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
              title={`Revert font size to the default (${DEFAULT_FONT_SIZE}px)`}
              disabled={fontSize === DEFAULT_FONT_SIZE}
            >
              Font: Reset
            </button>
            <button
              type="button"
              className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--secondary"
              onClick={() => setFontSize((s) => s + 2)}
              title="Increase font size by 2 pixels"
            >
              Font: +2 ({fontSize}px)
            </button>
            <button
              type="button"
              className={
                'file-preview-overlay__toolbar-btn' +
                (showSearch ? ' file-preview-overlay__toolbar-btn--primary' : ' file-preview-overlay__toolbar-btn--secondary')
              }
              onClick={toggleSearch}
              title="Search substrings and highlight matches (Ctrl/Cmd+F)"
              aria-pressed={showSearch}
            >
              🔍 Search
            </button>
            <button
              type="button"
              className={
                'file-preview-overlay__toolbar-btn' +
                (showSearch ? ' file-preview-overlay__toolbar-btn--primary' : ' file-preview-overlay__toolbar-btn--secondary')
              }
              onClick={toggleSearch}
              title="Search substrings and highlight matches (Ctrl/Cmd+F)"
              aria-pressed={showSearch}
            >
              🔍 Search
            </button>
            <button
              type="button"
              className={
                'file-preview-overlay__toolbar-btn' +
                (showMarkdownView ? ' file-preview-overlay__toolbar-btn--primary' : ' file-preview-overlay__toolbar-btn--secondary')
              }
              onClick={toggleMarkdownView}
              title="View this file as a rendered Markdown document in a full-screen overlay"
              aria-pressed={showMarkdownView}
            >
              📄 View MD
            </button>
            {!isEditable && (
              <button
                type="button"
                className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--primary"
                onClick={handleEdit}
                title="Enable editing of this file"
              >
                Edit
              </button>
            )}
            {isEditable && (
              <>
                <button
                  type="button"
                  className={
                    'file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--primary' +
                    (saveStatus === 'success' ? ' file-preview-overlay__toolbar-btn--success' : '') +
                    (saveStatus === 'error' ? ' file-preview-overlay__toolbar-btn--error' : '')
                  }
                  onClick={handleSave}
                  disabled={!isDirty || saveStatus === 'saving'}
                  title="Save changes and close preview (Ctrl/Cmd+S)"
                >
                  {saveStatus === 'saving'
                    ? 'Saving…'
                    : saveStatus === 'success'
                      ? '✓ Saved'
                      : saveStatus === 'error'
                        ? '✗ Save failed'
                        : 'Save'}
                </button>
                <button
                  type="button"
                  className="file-preview-overlay__toolbar-btn file-preview-overlay__toolbar-btn--secondary"
                  onClick={handleRevert}
                  disabled={saveStatus === 'saving'}
                  title="Reload the original file content and exit edit mode"
                >
                  Revert All
                </button>
              </>
            )}
          </div>
        </div>

        {showSearch && (
          <div className="file-preview-overlay__search">
            <span className="file-preview-overlay__search-icon" aria-hidden="true">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              className="file-preview-overlay__search-input"
              placeholder="Search substring…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) gotoPrevMatch();
                  else gotoNextMatch();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowSearch(false);
                }
              }}
              spellCheck={false}
            />
            <span className="file-preview-overlay__search-count">
              {searchQuery
                ? matchRanges.length > 0
                  ? `${activeMatchIndex + 1}/${matchRanges.length}`
                  : '0/0'
                : ''}
            </span>
            <button
              type="button"
              className="file-preview-overlay__search-btn"
              onClick={gotoPrevMatch}
              disabled={matchRanges.length === 0}
              title="Previous match (Shift+Enter)"
            >
              ↑
            </button>
            <button
              type="button"
              className="file-preview-overlay__search-btn"
              onClick={gotoNextMatch}
              disabled={matchRanges.length === 0}
              title="Next match (Enter)"
            >
              ↓
            </button>
            <label
              className="file-preview-overlay__search-toggle"
              title="Match case"
            >
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              Aa
            </label>
            <button
              type="button"
              className="file-preview-overlay__search-close"
              onClick={() => setShowSearch(false)}
              title="Close search (Esc)"
              aria-label="Close search"
            >
              ×
            </button>
          </div>
        )}

        <div className="file-preview-overlay__body">
          {showSearch && matchRanges.length > 0 && (
            <div
              ref={highlightLayerRef}
              className="file-preview-overlay__highlight-layer"
              aria-hidden="true"
              style={{
                whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                wordBreak: wordWrap ? 'break-word' : 'normal',
                overflowWrap: wordWrap ? 'break-word' : 'normal',
                fontSize: `${fontSize}px`,
              }}
              dangerouslySetInnerHTML={{ __html: highlightHtml }}
            />
          )}
          <textarea
            ref={editorRef}
            className="file-preview-overlay__editor"
            value={editedContent}
            onChange={handleContentChange}
            onKeyDown={handleEditorKeyDown}
            onScroll={syncHighlightScroll}
            readOnly={!isEditable}
            spellCheck={false}
            style={{
              whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
              wordBreak: wordWrap ? 'break-word' : 'normal',
              overflowWrap: wordWrap ? 'break-word' : 'normal',
              fontSize: `${fontSize}px`,
              background: showSearch && matchRanges.length > 0 ? 'transparent' : undefined,
            }}
          />
        </div>

        {showUnsavedModal && (
          <div
            className="file-preview-overlay__modal-backdrop"
            onClick={handleCancelClose}
          >
            <div
              className="file-preview-overlay__modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="unsaved-changes-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                id="unsaved-changes-title"
                className="file-preview-overlay__modal-title"
              >
                Unsaved Changes
              </h3>
              <p className="file-preview-overlay__modal-message">
                You have unsaved changes to this file. Do you want to save them
                before closing, or abandon them?
              </p>
              <div className="file-preview-overlay__modal-actions">
                <button
                  type="button"
                  className="file-preview-overlay__modal-btn file-preview-overlay__modal-btn--secondary"
                  onClick={handleCancelClose}
                  title="Cancel and return to editing"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="file-preview-overlay__modal-btn file-preview-overlay__modal-btn--danger"
                  onClick={handleAbandonChanges}
                  title="Discard all unsaved changes and close"
                >
                  Abandon Changes
                </button>
                <button
                  type="button"
                  className="file-preview-overlay__modal-btn file-preview-overlay__modal-btn--primary"
                  onClick={handleKeepChanges}
                  title="Save changes and close"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {showMarkdownView && (
          <div
            className="file-preview-overlay__markdown-modal"
            onClick={() => setShowMarkdownView(false)}
          >
            <div
              className={
                'file-preview-overlay__markdown-modal-content' +
                (markdownTheme === 'light' ? ' file-preview-overlay__markdown-modal-content--light' : '')
              }
              role="dialog"
              aria-modal="true"
              aria-labelledby="markdown-preview-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="file-preview-overlay__markdown-modal-header">
                <span
                  id="markdown-preview-title"
                  className="file-preview-overlay__markdown-modal-title"
                  title={filePath ?? ''}
                >
                  {filePath ?? '(untitled)'} — Markdown Preview
                </span>
                <div className="file-preview-overlay__markdown-modal-header-actions">
                  <button
                    type="button"
                    className="file-preview-overlay__markdown-modal-theme-btn"
                    onClick={toggleMarkdownTheme}
                    aria-pressed={markdownTheme === 'light'}
                    aria-label={
                      markdownTheme === 'dark'
                        ? 'Switch markdown preview to light mode'
                        : 'Switch markdown preview to dark mode'
                    }
                    title={markdownTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    {markdownTheme === 'dark' ? '☀️' : '🌙'}
                  </button>
                  <button
                    type="button"
                    className="file-preview-overlay__markdown-modal-close"
                    onClick={() => setShowMarkdownView(false)}
                    aria-label="Close markdown preview"
                    title="Close markdown preview (Esc)"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="file-preview-overlay__markdown-modal-body">
                <div className="file-preview-overlay__markdown-content">
                  {markdownModules ? (
                    <markdownModules.ReactMarkdown remarkPlugins={[markdownModules.remarkGfm]}>
                      {editedContent}
                    </markdownModules.ReactMarkdown>
                  ) : (
                    <div style={{ color: '#888', fontStyle: 'italic', padding: '20px' }}>
                      Loading markdown renderer…
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilePreviewOverlay;
