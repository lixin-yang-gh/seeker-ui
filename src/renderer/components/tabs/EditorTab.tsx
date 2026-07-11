import React, { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import ReactDOM from 'react-dom';
import { FileContent } from '../../../shared/types';
import { getMarkdownModulesPromise, MarkdownModules } from '../../../shared/markdown-loader';

const scrollPositionMap = new Map<string, number>();
const MAX_UNDO_HISTORY = 200;

interface EditorTabProps {
  filePath: string | null;
  rootFolder?: string | null;
}

export interface EditorTabRef {
  getIsDirty: () => boolean;
  requestTabSwitch: (callback: () => void) => void;
  requestFolderSwitch: () => Promise<boolean>;
  reloadFile: () => void;
}

const EditorTab = forwardRef(({ filePath, rootFolder }: EditorTabProps, ref: React.ForwardedRef<EditorTabRef>) => {
  const [content, setContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState<boolean>(false);
  const DEFAULT_FONT_SIZE = 13;
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [showMarkdownView, setShowMarkdownView] = useState<boolean>(false);
  const [markdownModules, setMarkdownModules] = useState<MarkdownModules | null>(null);
  const [markdownTheme, setMarkdownTheme] = useState<'dark' | 'light'>('dark');
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);

  // ── Unsaved-changes guard state ──
  // One pending action at a time: either a file switch, a tab switch, or a folder switch.
  const [pendingAction, setPendingAction] = useState<{ type: 'file'; filePath: string } | { type: 'tab'; callback: () => void } | { type: 'folder' } | null>(null);
  // Resolve function for the folder-switch Promise; called with true (proceed) or false (cancel).
  const folderSwitchResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  // Path currently loaded/displayed in the editor
  const loadedFilePathRef = useRef<string | null>(null);
  const isDirtyRef = useRef<boolean>(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const originalContentRef = useRef<string>('');
  const fontSizeLoadedRef = useRef<boolean>(false);
  const wordWrapLoadedRef = useRef<boolean>(false);
  const markdownThemeLoadedRef = useRef<boolean>(false);
  const editedContentRef = useRef<string>('');
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const pendingUndoSnapshotRef = useRef<string | null>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const historyTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    editedContentRef.current = editedContent;
  }, [editedContent]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Load per-folder settings
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
        console.error('EditorTab: failed to load preview settings', err);
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

  useEffect(() => {
    if (!rootFolder || !fontSizeLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, { ...currentState, previewFontSize: fontSize });
      } catch (err) { console.error('EditorTab: failed to persist font size', err); }
    }, 400);
    return () => clearTimeout(t);
  }, [fontSize, rootFolder]);

  useEffect(() => {
    if (!rootFolder || !wordWrapLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, { ...currentState, previewWordWrap: wordWrap });
      } catch (err) { console.error('EditorTab: failed to persist word wrap', err); }
    }, 400);
    return () => clearTimeout(t);
  }, [wordWrap, rootFolder]);

  useEffect(() => {
    if (!rootFolder || !markdownThemeLoadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootFolder)) || {};
        await window.electronAPI.saveFolderState(rootFolder, { ...currentState, previewMarkdownTheme: markdownTheme });
      } catch (err) { console.error('EditorTab: failed to persist markdown theme', err); }
    }, 400);
    return () => clearTimeout(t);
  }, [markdownTheme, rootFolder]);

  // Core loader — actually reads a file from disk and populates the editor.
  // Extracted so it can be invoked both by the filePath effect and by the
  // unsaved-changes modal after the user resolves the prompt.
  const loadFileFromDisk = useCallback((targetPath: string | null) => {
    if (!targetPath) {
      setContent('');
      setEditedContent('');
      originalContentRef.current = '';
      editedContentRef.current = '';
      setIsDirty(false);
      setLoadError(null);
      loadedFilePathRef.current = null;
      undoStackRef.current = [];
      redoStackRef.current = [];
      pendingUndoSnapshotRef.current = null;
      if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
      return () => { /* nothing to cancel */ };
    }

    let cancelled = false;
    const loadFile = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const stats = await window.electronAPI.getFileStats(targetPath);
        if (stats.isDirectory) { setLoadError('Selected item is a directory'); setLoading(false); return; }
        if (stats.size > 10 * 1024 * 1024) { setLoadError('File is too large (max 10MB)'); setLoading(false); return; }
        const fileData = await window.electronAPI.readFile(targetPath);
        if (cancelled) return;
        const c = fileData.content;
        setContent(c);
        setEditedContent(c);
        originalContentRef.current = c;
        editedContentRef.current = c;
        setIsDirty(false);
        setSaveStatus('idle');
        setSaveError(null);
        loadedFilePathRef.current = targetPath;
        undoStackRef.current = [];
        redoStackRef.current = [];
        pendingUndoSnapshotRef.current = null;
        if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
        const savedScrollTop = scrollPositionMap.get(targetPath) ?? 0;
        pendingScrollRestoreRef.current = savedScrollTop;
      } catch (err: any) {
        if (!cancelled) setLoadError('Error loading file: ' + (err?.message ?? String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadFile();
    return () => { cancelled = true; };
  }, []);

  // React to filePath prop changes. If the editor currently holds unsaved
  // changes and the requested path differs from the loaded one, defer loading
  // and pop up the save/abandon confirmation modal. Otherwise load immediately.
  useEffect(() => {
    // Same file already loaded — nothing to do.
    if (filePath === loadedFilePathRef.current) return;

    // Unsaved changes present and switching to a genuinely different file:
    // intercept and prompt instead of discarding silently.
    if (isDirtyRef.current && loadedFilePathRef.current !== null) {
      setPendingAction({ type: 'file', filePath: filePath });
      return;
    }

    // Clean state (or first load) — load the file right away.
    const cleanup = loadFileFromDisk(filePath);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, loadFileFromDisk]);

  // Restore pending scroll position whenever the editor becomes visible.
  // This handles both the initial load (when loading flips to false) and the
  // case where the editor was hidden during load and becomes visible later
  // (e.g. when the user switches back to the Editor tab after a file update).
  useEffect(() => {
    if (pendingScrollRestoreRef.current !== null) {
      const scrollTop = pendingScrollRestoreRef.current;
      if (editorRef.current && editorRef.current.offsetParent !== null) {
        pendingScrollRestoreRef.current = null;
        requestAnimationFrame(() => {
          if (editorRef.current) editorRef.current.scrollTop = scrollTop;
          if (highlightLayerRef.current) highlightLayerRef.current.scrollTop = scrollTop;
        });
      }
    }
  });

  // Markdown modules
  useEffect(() => {
    if (!showMarkdownView || markdownModules) return;
    let cancelled = false;
    getMarkdownModulesPromise().then((mods) => { if (!cancelled) setMarkdownModules(mods); });
    return () => { cancelled = true; };
  }, [showMarkdownView, markdownModules]);

  // Search
  const escapeHtml = useCallback((s: string): string =>
    s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>'), []);

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

  const highlightHtml = React.useMemo<string>(() => {
    if (matchRanges.length === 0) return '';
    let html = '';
    let cursor = 0;
    matchRanges.forEach((r, i) => {
      html += escapeHtml(editedContent.slice(cursor, r.start));
      const cls = i === activeMatchIndex
        ? 'file-editor__mark file-editor__mark--active'
        : 'file-editor__mark';
      html += '<mark class="' + cls + '">' + escapeHtml(editedContent.slice(r.start, r.end)) + '</mark>';
      cursor = r.end;
    });
    html += escapeHtml(editedContent.slice(cursor));
    return html;
  }, [matchRanges, editedContent, activeMatchIndex, escapeHtml]);

  const syncHighlightScroll = useCallback(() => {
    if (highlightLayerRef.current && editorRef.current) {
      highlightLayerRef.current.scrollTop = editorRef.current.scrollTop;
      highlightLayerRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
    if (loadedFilePathRef.current && editorRef.current) {
      scrollPositionMap.set(loadedFilePathRef.current, editorRef.current.scrollTop);
    }
  }, []);

  useEffect(() => { setActiveMatchIndex(0); }, [searchQuery, caseSensitive]);

  useEffect(() => {
    if (showSearch) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [showSearch]);

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
    if (showSearch && matchRanges.length > 0) scrollToActiveMatch();
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

  // Undo/redo
  const pushUndoSnapshot = useCallback((snapshot: string) => {
    const stack = undoStackRef.current;
    if (stack.length > 0 && stack[stack.length - 1] === snapshot) return;
    stack.push(snapshot);
    if (stack.length > MAX_UNDO_HISTORY) stack.shift();
  }, []);

  const commitPendingUndoBatch = useCallback(() => {
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
    if (pendingUndoSnapshotRef.current !== null) {
      pushUndoSnapshot(pendingUndoSnapshotRef.current);
      pendingUndoSnapshotRef.current = null;
    }
  }, [pushUndoSnapshot]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (pendingUndoSnapshotRef.current === null) {
      pendingUndoSnapshotRef.current = editedContentRef.current;
      redoStackRef.current = [];
    }
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      if (pendingUndoSnapshotRef.current !== null) pushUndoSnapshot(pendingUndoSnapshotRef.current);
      pendingUndoSnapshotRef.current = null;
      historyTimerRef.current = null;
    }, 600);
    setEditedContent(newValue);
    setIsDirty(newValue !== originalContentRef.current);
  }, [pushUndoSnapshot]);

  const handleUndo = useCallback(() => {
    commitPendingUndoBatch();
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const previous = stack.pop()!;
    redoStackRef.current.push(editedContentRef.current);
    setEditedContent(previous);
    setIsDirty(previous !== originalContentRef.current);
  }, [commitPendingUndoBatch]);

  const handleRedo = useCallback(() => {
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
    pendingUndoSnapshotRef.current = null;
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack.pop()!;
    undoStackRef.current.push(editedContentRef.current);
    setEditedContent(next);
    setIsDirty(next !== originalContentRef.current);
  }, []);

  const handleEditorKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;
    const key = e.key.toLowerCase();
    const el = e.currentTarget;
    const selStart = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? 0;
    const hasSelection = selEnd > selStart;
    if (key === 'c') {
      if (!hasSelection) return;
      e.preventDefault();
      try { await navigator.clipboard.writeText(editedContent.slice(selStart, selEnd)); } catch (err) { console.error('EditorTab: copy failed', err); }
      return;
    }
    if (key === 'x') {
      if (!hasSelection) return;
      e.preventDefault();
      try { await navigator.clipboard.writeText(editedContent.slice(selStart, selEnd)); } catch (err) { console.error('EditorTab: cut failed', err); return; }
      commitPendingUndoBatch();
      pushUndoSnapshot(editedContent);
      redoStackRef.current = [];
      const newValue = editedContent.slice(0, selStart) + editedContent.slice(selEnd);
      setEditedContent(newValue);
      setIsDirty(newValue !== originalContentRef.current);
      requestAnimationFrame(() => { const node = editorRef.current; if (node) { node.selectionStart = selStart; node.selectionEnd = selStart; } });
      return;
    }
    if (key === 'v') {
      e.preventDefault();
      let clip = '';
      try { clip = await navigator.clipboard.readText(); } catch (err) { console.error('EditorTab: paste failed', err); return; }
      if (!clip) return;
      commitPendingUndoBatch();
      pushUndoSnapshot(editedContent);
      redoStackRef.current = [];
      const newValue = editedContent.slice(0, selStart) + clip + editedContent.slice(selEnd);
      setEditedContent(newValue);
      setIsDirty(newValue !== originalContentRef.current);
      const caret = selStart + clip.length;
      requestAnimationFrame(() => { const node = editorRef.current; if (node) { node.selectionStart = caret; node.selectionEnd = caret; } });
      return;
    }
  }, [editedContent, commitPendingUndoBatch, pushUndoSnapshot]);

  const handleSave = useCallback(async () => {
    const targetPath = loadedFilePathRef.current;
    if (!targetPath || !isDirty) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await window.electronAPI.writeFile(targetPath, editedContent);
      originalContentRef.current = editedContent;
      setIsDirty(false);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: any) {
      setSaveError(err?.message ?? String(err));
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
      throw err;
    }
  }, [isDirty, editedContent]);

  const handleRevert = useCallback(async () => {
    const targetPath = loadedFilePathRef.current;
    let original = originalContentRef.current;
    if (targetPath) {
      try {
        const fileData = await window.electronAPI.readFile(targetPath);
        original = fileData?.content ?? original;
        originalContentRef.current = original;
      } catch (err) { console.error('EditorTab: revert failed', err); }
    }
    setEditedContent(original);
    setIsDirty(false);
    setSaveStatus('idle');
    setSaveError(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    pendingUndoSnapshotRef.current = null;
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
  }, []);

  // ── Unsaved-changes modal handlers ──

  // Proceed to load the pending file (used after Save or Discard).
  const proceedToPendingFile = useCallback((targetPath: string) => {
    setPendingAction(null);
    // Clear dirty flag so the load effect does not re-trigger the guard.
    setIsDirty(false);
    isDirtyRef.current = false;
    loadFileFromDisk(targetPath);
  }, [loadFileFromDisk]);

  // Save current edits, then execute the pending action.
  const handleSaveAndProceed = useCallback(async () => {
    const action = pendingAction;
    if (!action) return;

    // Save current file
    try {
      await handleSave();
    } catch (err) {
      // Save failed: keep modal open and show error
      return;
    }

    // Save succeeded: execute pending action
    if (action.type === 'file') {
      proceedToPendingFile(action.filePath);
    } else if (action.type === 'folder') {
      setPendingAction(null);
      if (folderSwitchResolveRef.current) {
        folderSwitchResolveRef.current(true);
        folderSwitchResolveRef.current = null;
      }
    } else {
      // tab switch
      setPendingAction(null);
      action.callback();
    }
  }, [pendingAction, handleSave, proceedToPendingFile]);

  // Abandon current edits and execute pending action.
  const handleAbandonAndProceed = useCallback(() => {
    const action = pendingAction;
    if (!action) return;

    if (action.type === 'file') {
      proceedToPendingFile(action.filePath);
    } else if (action.type === 'folder') {
      // Folder switch: discard changes and revert
      setEditedContent(originalContentRef.current);
      setIsDirty(false);
      undoStackRef.current = [];
      redoStackRef.current = [];
      pendingUndoSnapshotRef.current = null;
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      setPendingAction(null);
      if (folderSwitchResolveRef.current) {
        folderSwitchResolveRef.current(true);
        folderSwitchResolveRef.current = null;
      }
    } else {
      // Tab switch: discard changes and revert to last saved/original content
      setEditedContent(originalContentRef.current);
      setIsDirty(false);
      undoStackRef.current = [];
      redoStackRef.current = [];
      pendingUndoSnapshotRef.current = null;
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      setPendingAction(null);
      action.callback();
    }
  }, [pendingAction, proceedToPendingFile]);

  // Cancel the switch — stay on the current (dirty) file.
  const handleModalCancel = useCallback(() => {
    setPendingAction(null);
    if (folderSwitchResolveRef.current) {
      folderSwitchResolveRef.current(false);
      folderSwitchResolveRef.current = null;
    }
  }, []);

  // ── Expose methods to parent ──
  useImperativeHandle(ref, () => ({
    getIsDirty: () => isDirtyRef.current,
    requestTabSwitch: (callback: () => void) => {
      if (isDirtyRef.current) {
        setPendingAction({ type: 'tab', callback });
      } else {
        // Not dirty: execute immediately
        callback();
      }
    },
    requestFolderSwitch: (): Promise<boolean> => {
      if (!isDirtyRef.current) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        folderSwitchResolveRef.current = resolve;
        setPendingAction({ type: 'folder' });
      });
    },
    reloadFile: () => {
      if (!loadedFilePathRef.current) return;
      // Save scroll position before reloading (use editor value when visible,
      // otherwise preserve the existing scrollPositionMap entry)
      const editorEl = editorRef.current;
      if (editorEl && editorEl.offsetParent !== null) {
        scrollPositionMap.set(loadedFilePathRef.current, editorEl.scrollTop);
      }
      loadFileFromDisk(loadedFilePathRef.current);
    },
  }), [isDirtyRef, setPendingAction, loadFileFromDisk]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // When the unsaved-changes modal is open, only allow Escape to cancel.
      if (pendingAction) {
        if (e.key === 'Escape') { e.preventDefault(); handleModalCancel(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setShowSearch((s) => !s);
        if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (isDirty && saveStatus !== 'saving') handleSave();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, saveStatus, handleSave, handleUndo, handleRedo, showSearch, pendingAction, handleModalCancel]);

  // Derive the display name of the pending file for the modal message.
  const pendingFileName = pendingAction && pendingAction.type === 'file'
    ? (pendingAction.filePath.split(/[\\/]/).pop() || pendingAction.filePath)
    : '';
  const currentFileName = loadedFilePathRef.current
    ? (loadedFilePathRef.current.split(/[\\/]/).pop() || loadedFilePathRef.current)
    : '';

  // ── Unsaved-changes modal (rendered via portal) ──
  const unsavedModal = pendingAction ? ReactDOM.createPortal(
    <div className="file-editor__modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 6000 }}>
      <div className="file-editor__modal" role="dialog" aria-modal="true">
        <h3 className="file-editor__modal-title">Unsaved Changes</h3>
        <p className="file-editor__modal-message">
          {currentFileName ? `"${currentFileName}" has unsaved changes.` : 'The current file has unsaved changes.'}
          {pendingAction && pendingAction.type === 'file'
            ? ` Do you want to save them before opening "${pendingFileName}"?`
            : pendingAction.type === 'folder'
            ? ' Do you want to save them before changing the project folder?'
            : ' Do you want to save them before switching tabs?'}
        </p>
        {saveError && (
          <p className="file-editor__modal-message" style={{ color: '#ff8a80' }}>
            Save failed: {saveError}
          </p>
        )}
        <div className="file-editor__modal-actions">
          <button
            type="button"
            className="file-editor__modal-btn file-editor__modal-btn--primary"
            onClick={handleSaveAndProceed}
            disabled={saveStatus === 'saving'}
            title="Save the current changes, then continue"
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            type="button"
            className="file-editor__modal-btn file-editor__modal-btn--danger"
            onClick={handleAbandonAndProceed}
            disabled={saveStatus === 'saving'}
            title="Discard the current changes and continue"
          >
            Abandon Changes
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  // ── Render ──
  if (!filePath && !loadedFilePathRef.current) {
    return (
      <div className="tab-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontStyle: 'italic', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 32 }}>📝</div>
        <div>Single-click a file in the Explorer to open it here for editing.</div>
        {unsavedModal}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tab-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
        <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3, marginRight: 10 }} />
        Loading…
        {unsavedModal}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="tab-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f48771' }}>
        {loadError}
        {unsavedModal}
      </div>
    );
  }

  return (
    <div className="tab-panel" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div className="file-editor__toolbar" style={{ position: 'relative' }}>
        <div className="file-editor__toolbar-status">
          {saveError && <span className="file-editor__toolbar-error" title={saveError}>{saveError}</span>}
          {!saveError && isDirty && <span className="file-editor__toolbar-hint">Unsaved changes</span>}
          {!saveError && !isDirty && <span className="file-editor__toolbar-hint" style={{ color: '#4ec9b0', fontStyle: 'normal' }}>No Changes</span>}
        </div>
        <div className="file-editor__toolbar-group">
          <button
            type="button"
            className={'file-editor__toolbar-btn' + (wordWrap ? ' file-editor__toolbar-btn--primary' : ' file-editor__toolbar-btn--secondary')}
            onClick={() => setWordWrap((w) => !w)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          >
            Word {wordWrap ? 'Wrap: On' : 'Wrap: Off'}
          </button>
          <button
            type="button"
            className="file-editor__toolbar-btn file-editor__toolbar-btn--secondary"
            onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
            disabled={fontSize === DEFAULT_FONT_SIZE}
            title={`Reset font size to ${DEFAULT_FONT_SIZE}px`}
          >
            Font: Reset
          </button>
          <button
            type="button"
            className="file-editor__toolbar-btn file-editor__toolbar-btn--secondary"
            onClick={() => setFontSize((s) => s + 2)}
            title="Increase font size by 2px"
          >
            Font: +2 ({fontSize}px)
          </button>
          <button
            type="button"
            className={'file-editor__toolbar-btn' + (showSearch ? ' file-editor__toolbar-btn--primary' : ' file-editor__toolbar-btn--secondary')}
            onClick={() => setShowSearch((s) => !s)}
            title="Search (Ctrl/Cmd+F)"
          >
            🔍 Search
          </button>
          <button
            type="button"
            className={'file-editor__toolbar-btn' + (showMarkdownView ? ' file-editor__toolbar-btn--primary' : ' file-editor__toolbar-btn--secondary')}
            onClick={() => setShowMarkdownView((s) => !s)}
            title="View as rendered Markdown"
          >
            📄 View MD
          </button>
          <button
            type="button"
            className="file-editor__toolbar-btn file-editor__toolbar-btn--secondary"
            onClick={() => navigator.clipboard.writeText(editedContent).then(() => { setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500); })}
            title="Copy all content"
          >
            {copiedAll ? '✓ Copied' : 'Copy All'}
          </button>
          <button
            type="button"
            className={'file-editor__toolbar-btn file-editor__toolbar-btn--primary' +
              (saveStatus === 'success' ? ' file-editor__toolbar-btn--success' : '') +
              (saveStatus === 'error' ? ' file-editor__toolbar-btn--error' : '')}
            onClick={handleSave}
            disabled={!isDirty || saveStatus === 'saving'}
            title="Save (Ctrl/Cmd+S)"
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'success' ? '✓ Saved' : saveStatus === 'error' ? '✗ Failed' : 'Save'}
          </button>
          <button
            type="button"
            className="file-editor__toolbar-btn file-editor__toolbar-btn--secondary"
            onClick={handleRevert}
            disabled={saveStatus === 'saving'}
            title="Reload file from disk"
          >
            Revert All
          </button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="file-editor__search">
          <span className="file-editor__search-icon" aria-hidden="true">🔍</span>
          <input
            ref={searchInputRef}
            type="text"
            className="file-editor__search-input"
            placeholder="Search substring…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) gotoPrevMatch(); else gotoNextMatch(); }
              else if (e.key === 'Escape') { e.preventDefault(); setShowSearch(false); }
            }}
            spellCheck={false}
          />
          <span className="file-editor__search-count">
            {searchQuery ? (matchRanges.length > 0 ? `${activeMatchIndex + 1}/${matchRanges.length}` : '0/0') : ''}
          </span>
          <button type="button" className="file-editor__search-btn" onClick={gotoPrevMatch} disabled={matchRanges.length === 0} title="Previous (Shift+Enter)">↑</button>
          <button type="button" className="file-editor__search-btn" onClick={gotoNextMatch} disabled={matchRanges.length === 0} title="Next (Enter)">↓</button>
          <label className="file-editor__search-toggle" title="Match case">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            Aa
          </label>
          <button type="button" className="file-editor__search-close" onClick={() => setShowSearch(false)} title="Close (Esc)">×</button>
        </div>
      )}

      {/* Editor body */}
      <div className="file-editor__body" style={{ flex: 1, position: 'relative' }}>
        {showSearch && matchRanges.length > 0 && (
          <div
            ref={highlightLayerRef}
            className="file-editor__highlight-layer"
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
          className="file-editor__editor"
          value={editedContent}
          onChange={handleContentChange}
          onKeyDown={handleEditorKeyDown}
          onScroll={syncHighlightScroll}
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

      {/* Markdown preview modal */}
      {showMarkdownView && (
        <div
          className="file-editor__markdown-modal"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5000 }}
          onClick={() => setShowMarkdownView(false)}
        >
          <div
            className={'file-editor__markdown-modal-content' + (markdownTheme === 'light' ? ' file-editor__markdown-modal-content--light' : '')}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="file-editor__markdown-modal-header">
              <span className="file-editor__markdown-modal-title" title={loadedFilePathRef.current ?? ''}>
                {loadedFilePathRef.current ?? '(untitled)'} — Markdown Preview
              </span>
              <div className="file-editor__markdown-modal-header-actions">
                <button
                  type="button"
                  className="file-editor__markdown-modal-theme-btn"
                  onClick={() => setMarkdownTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                  title={markdownTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {markdownTheme === 'dark' ? '☀️' : '🌙'}
                </button>
                <button
                  type="button"
                  className="file-editor__markdown-modal-close"
                  onClick={() => setShowMarkdownView(false)}
                  title="Close (Esc)"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="file-editor__markdown-modal-body">
              <div className="file-editor__markdown-content">
                {markdownModules ? (
                  <markdownModules.ReactMarkdown remarkPlugins={[markdownModules.remarkGfm]}>
                    {editedContent}
                  </markdownModules.ReactMarkdown>
                ) : (
                  <div style={{ color: '#888', fontStyle: 'italic', padding: 20 }}>Loading markdown renderer…</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved-changes confirmation modal (portal) */}
      {unsavedModal}
    </div>
  );
});

EditorTab.displayName = 'EditorTab';

export default EditorTab;
