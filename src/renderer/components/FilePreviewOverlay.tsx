import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/file_preview_overlay.css';
import { FileContent } from '../../shared/types';

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
  // ── Substring search (telescope) state ──
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const originalContentRef = useRef<string>(initialContent);
  // Track whether the initial font size has been loaded from the store so we
  // do not immediately overwrite a freshly-loaded value on the first render.
  const fontSizeLoadedRef = useRef<boolean>(false);

  // Load persisted font size for this root folder on mount (or when rootFolder changes).
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
      } catch (err) {
        console.error('FilePreviewOverlay: failed to load font size', err);
      } finally {
        if (!cancelled) fontSizeLoadedRef.current = true;
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
  }, [showUnsavedModal, attemptClose, handleCancelClose, isEditable, isDirty, saveStatus, handleSave, showSearch]);

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
      </div>
    </div>
  );
};

export default FilePreviewOverlay;
