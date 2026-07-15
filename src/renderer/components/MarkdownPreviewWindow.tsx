import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getMarkdownModulesPromise, MarkdownModules } from '../../shared/markdown-loader';

const MAX_UNDO_HISTORY = 200;

function normalizeContent(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\0/g, '\uFFFD');
}

function snapStart(s: string, o: number): number {
  if (o <= 0 || o >= s.length) return o;
  const c = s.charCodeAt(o);
  return (c >= 0xDC00 && c <= 0xDFFF) ? o - 1 : o;
}

function snapEnd(s: string, o: number): number {
  if (o <= 0 || o >= s.length) return o;
  const c = s.charCodeAt(o);
  return (c >= 0xDC00 && c <= 0xDFFF) ? o + 1 : o;
}

const MarkdownPreviewWindow: React.FC = () => {
  const [editedContent, setEditedContent] = useState('');
  const [markdownModules, setMarkdownModules] = useState<MarkdownModules | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [viewMode, setViewMode] = useState<'text' | 'markdown'>('markdown');
  const [zoom, setZoom] = useState<number>(100);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [replaceQuery, setReplaceQuery] = useState('');

  // Refs
  const editedContentRef = useRef('');
  const lastWriteTs = useRef(0);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const pendingUndoSnapshotRef = useRef<string | null>(null);
  const historyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const markdownBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { editedContentRef.current = editedContent; }, [editedContent]);

  useEffect(() => {
    getMarkdownModulesPromise().then(setMarkdownModules);
  }, []);

  useEffect(() => {
    window.electronAPI.getPreviewSettings().then((settings) => {
      setTheme(settings.theme);
      setViewMode(settings.mode);
      setZoom(settings.zoom ?? 100);
      setSettingsLoaded(true);
    });
  }, []);

  // Receive content updates — always apply if newer (last-write-wins, no prompt)
  useEffect(() => {
    const handler = (incomingRaw: string, incomingTs?: number) => {
      const ts = incomingTs ?? Date.now();
      if (ts <= lastWriteTs.current) return;
      const incoming = normalizeContent(incomingRaw);
      lastWriteTs.current = ts;
      setEditedContent(incoming);
      clearHistory();
    };
    window.electronAPI.on('markdown-preview:content', handler);
  }, []);

  // Save settings whenever they change
  useEffect(() => {
    if (!settingsLoaded) return;
    window.electronAPI.savePreviewSettings({ theme, mode: viewMode, zoom });
  }, [theme, viewMode, zoom, settingsLoaded]);

  // ── History helpers ──
  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    pendingUndoSnapshotRef.current = null;
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
  }, []);

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

  // ── Content change — broadcast to EditorTab with timestamp ──
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
    const ts = Date.now();
    lastWriteTs.current = ts;
    setEditedContent(newValue);
    window.electronAPI.updateMarkdownPreviewContent(newValue, ts);
  }, [pushUndoSnapshot]);

  // ── Undo / Redo ──
  const handleUndo = useCallback(() => {
    commitPendingUndoBatch();
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const previous = stack.pop()!;
    redoStackRef.current.push(editedContentRef.current);
    const ts = Date.now();
    lastWriteTs.current = ts;
    setEditedContent(previous);
    window.electronAPI.updateMarkdownPreviewContent(previous, ts);
  }, [commitPendingUndoBatch]);

  const handleRedo = useCallback(() => {
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
    pendingUndoSnapshotRef.current = null;
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack.pop()!;
    undoStackRef.current.push(editedContentRef.current);
    const ts = Date.now();
    lastWriteTs.current = ts;
    setEditedContent(next);
    window.electronAPI.updateMarkdownPreviewContent(next, ts);
  }, []);

  // ── Clipboard ──
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
      const s = snapStart(editedContent, selStart);
      const en = snapEnd(editedContent, selEnd);
      try { await navigator.clipboard.writeText(editedContent.slice(s, en)); } catch {}
      return;
    }
    if (key === 'x') {
      if (!hasSelection) return;
      e.preventDefault();
      const s = snapStart(editedContent, selStart);
      const en = snapEnd(editedContent, selEnd);
      try { await navigator.clipboard.writeText(editedContent.slice(s, en)); } catch { return; }
      commitPendingUndoBatch();
      pushUndoSnapshot(editedContent);
      redoStackRef.current = [];
      const nv = editedContent.slice(0, s) + editedContent.slice(en);
      const ts = Date.now();
      lastWriteTs.current = ts;
      setEditedContent(nv);
      window.electronAPI.updateMarkdownPreviewContent(nv, ts);
      return;
    }
    if (key === 'v') {
      e.preventDefault();
      let clip = '';
      try { clip = await navigator.clipboard.readText(); } catch { return; }
      if (!clip) return;
      commitPendingUndoBatch();
      pushUndoSnapshot(editedContent);
      redoStackRef.current = [];
      const nc = normalizeContent(clip);
      const nv = editedContent.slice(0, selStart) + nc + editedContent.slice(selEnd);
      const ts = Date.now();
      lastWriteTs.current = ts;
      setEditedContent(nv);
      window.electronAPI.updateMarkdownPreviewContent(nv, ts);
      const caret = selStart + nc.length;
      requestAnimationFrame(() => { if (editorRef.current) { editorRef.current.selectionStart = caret; editorRef.current.selectionEnd = caret; } });
      return;
    }
    if (key === 'z') {
      e.preventDefault();
      handleUndo();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }
  }, [editedContent, commitPendingUndoBatch, pushUndoSnapshot, handleUndo, handleRedo]);

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Search ──
  const escapeHtml = useCallback((s: string) =>
    s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
     .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), []);

  const matchRanges = useMemo<Array<{ start: number; end: number }>>(() => {
    if (!searchQuery) return [];
    const ranges: Array<{ start: number; end: number }> = [];
    try {
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = caseSensitive ? 'gu' : 'giu';
      const re = new RegExp(escaped, flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(editedContent)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        ranges.push({ start, end });
        // Prevent infinite loop on zero-length matches
        if (m[0].length === 0) re.lastIndex++;
      }
    } catch {}
    return ranges;
  }, [searchQuery, caseSensitive, editedContent]);

  useEffect(() => { setActiveMatchIndex(0); }, [searchQuery, caseSensitive]);
  useEffect(() => {
    if (matchRanges.length === 0) setActiveMatchIndex(0);
    else if (activeMatchIndex >= matchRanges.length) setActiveMatchIndex(matchRanges.length - 1);
  }, [matchRanges.length, activeMatchIndex]);

  const gotoNextMatch = useCallback(() => {
    if (matchRanges.length === 0) return;
    setActiveMatchIndex(i => (i + 1) % matchRanges.length);
  }, [matchRanges.length]);

  const gotoPrevMatch = useCallback(() => {
    if (matchRanges.length === 0) return;
    setActiveMatchIndex(i => (i - 1 + matchRanges.length) % matchRanges.length);
  }, [matchRanges.length]);

  const scrollToActiveMatchInEditor = useCallback(() => {
    const el = editorRef.current;
    const range = matchRanges[activeMatchIndex];
    if (!el || !range) return;
    const before = editedContent.slice(0, range.start);
    const lineNumber = before.split('\n').length - 1;
    const style = window.getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 15 * 1.45;
    el.scrollTop = Math.max(0, lineNumber * lineHeight - el.clientHeight / 2);
    if (highlightLayerRef.current) highlightLayerRef.current.scrollTop = el.scrollTop;
  }, [matchRanges, activeMatchIndex, editedContent]);

  const scrollToActiveMatchInMarkdown = useCallback(() => {
    if (!markdownBodyRef.current) return;
    const marks = markdownBodyRef.current.querySelectorAll('.mpw-mark');
    const mark = marks[activeMatchIndex] as HTMLElement | undefined;
    if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeMatchIndex]);

  useEffect(() => {
    if (viewMode === 'text' && matchRanges.length > 0) scrollToActiveMatchInEditor();
    if (viewMode === 'markdown' && matchRanges.length > 0) scrollToActiveMatchInMarkdown();
  }, [activeMatchIndex, matchRanges.length, viewMode, scrollToActiveMatchInEditor, scrollToActiveMatchInMarkdown]);

  const highlightHtml = useMemo<string>(() => {
    if (viewMode !== 'text' || matchRanges.length === 0) return '';
    let html = '';
    let cursor = 0;
    matchRanges.forEach((r, i) => {
      html += escapeHtml(editedContent.slice(cursor, r.start));
      const cls = i === activeMatchIndex ? 'file-editor__mark file-editor__mark--active' : 'file-editor__mark';
      html += `<mark class="${cls}">${escapeHtml(editedContent.slice(r.start, r.end))}</mark>`;
      cursor = r.end;
    });
    html += escapeHtml(editedContent.slice(cursor));
    return html;
  }, [viewMode, matchRanges, editedContent, activeMatchIndex, escapeHtml]);

  const syncHighlightScroll = useCallback(() => {
    if (highlightLayerRef.current && editorRef.current) {
      highlightLayerRef.current.scrollTop = editorRef.current.scrollTop;
      highlightLayerRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  }, []);

  const handleReplace = useCallback(() => {
    const range = matchRanges[activeMatchIndex];
    if (!range) return;
    commitPendingUndoBatch();
    pushUndoSnapshot(editedContent);
    redoStackRef.current = [];
    const nv = editedContent.slice(0, range.start) + replaceQuery + editedContent.slice(range.end);
    const ts = Date.now();
    lastWriteTs.current = ts;
    setEditedContent(nv);
    window.electronAPI.updateMarkdownPreviewContent(nv, ts);
  }, [matchRanges, activeMatchIndex, editedContent, replaceQuery, commitPendingUndoBatch, pushUndoSnapshot]);

  const handleReplaceAll = useCallback(() => {
    if (matchRanges.length === 0) return;
    commitPendingUndoBatch();
    pushUndoSnapshot(editedContent);
    redoStackRef.current = [];
    let nv = editedContent;
    for (let i = matchRanges.length - 1; i >= 0; i--) {
      const r = matchRanges[i];
      nv = nv.slice(0, r.start) + replaceQuery + nv.slice(r.end);
    }
    const ts = Date.now();
    lastWriteTs.current = ts;
    setEditedContent(nv);
    window.electronAPI.updateMarkdownPreviewContent(nv, ts);
    setActiveMatchIndex(0);
  }, [matchRanges, editedContent, replaceQuery, commitPendingUndoBatch, pushUndoSnapshot]);

  // ── Markdown search highlight via DOM Range API ──
  useEffect(() => {
    if (viewMode !== 'markdown' || !markdownBodyRef.current) return;
    const container = markdownBodyRef.current;
    container.querySelectorAll('.mpw-mark').forEach(el => {
      const parent = el.parentNode;
      if (parent) { parent.replaceChild(document.createTextNode(el.textContent ?? ''), el); parent.normalize(); }
    });
    if (!searchQuery || matchRanges.length === 0) return;
    const applyMarks = () => {
      if (!searchQuery) return;
      const flags = caseSensitive ? 'gu' : 'giu';
      let escaped = '';
      try { escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } catch { return; }
      let re: RegExp;
      try { re = new RegExp(escaped, flags); } catch { return; }
      const textNodes: Text[] = [];
      const tw = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = tw.nextNode())) textNodes.push(node as Text);
      let combined = '';
      const offsets: Array<{ node: Text; start: number; end: number }> = [];
      textNodes.forEach(tn => {
        const start = combined.length;
        combined += tn.textContent ?? '';
        offsets.push({ node: tn, start, end: combined.length });
      });
      const matches: Array<{ start: number; end: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(combined)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }
      if (matches.length === 0) return;
      for (let mi = matches.length - 1; mi >= 0; mi--) {
        const match = matches[mi];
        for (let oi = offsets.length - 1; oi >= 0; oi--) {
          const o = offsets[oi];
          if (o.end <= match.start || o.start >= match.end) continue;
          const localStart = Math.max(match.start - o.start, 0);
          const localEnd = Math.min(match.end - o.start, o.end - o.start);
          try {
            const range = document.createRange();
            range.setStart(o.node, localStart);
            range.setEnd(o.node, localEnd);
            const mark = document.createElement('mark');
            mark.className = mi === activeMatchIndex
              ? 'mpw-mark file-editor__mark file-editor__mark--active'
              : 'mpw-mark file-editor__mark';
            range.surroundContents(mark);
            offsets[oi] = { node: mark.nextSibling as Text ?? o.node, start: o.start, end: o.end };
          } catch { /* skip complex DOM ranges */ }
        }
      }
    };
    requestAnimationFrame(applyMarks);
  }, [viewMode, searchQuery, caseSensitive, editedContent, activeMatchIndex, matchRanges.length]);

  // ── Render ──
  const isTextMode = viewMode === 'text';
  const showHighlight = isTextMode && matchRanges.length > 0;

  return (
    <div
      className={'file-editor__markdown-modal-content' + (theme === 'light' ? ' file-editor__markdown-modal-content--light' : '')}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5000, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}
    >
      {/* ── Header ── */}
      <div className="file-editor__markdown-modal-header" style={{ position: 'relative', flexShrink: 0 }}>
        <span className="file-editor__markdown-modal-title">Preview</span>
        <div className="file-editor__markdown-modal-header-actions">
          <button
            type="button"
            className="file-editor__markdown-modal-theme-btn"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
          </button>
          <button
            type="button"
            className={'file-editor__display-format ' + (viewMode === 'text' ? 'file-editor__display-format-selected' : 'file-editor__display-format-unselected')}
            onClick={() => setViewMode('text')}
            title="Edit as plain text"
          >
            As Text
          </button>
          <button
            type="button"
            className={'file-editor__display-format ' + (viewMode === 'markdown' ? 'file-editor__display-format-selected' : 'file-editor__display-format-unselected')}
            onClick={() => setViewMode('markdown')}
            title="Display as rendered markdown (read-only)"
          >
            As Markdown
          </button>
          <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)', display: 'inline-block', margin: '0 4px' }} />
          {[100, 110, 120, 150].map(z => (
            <button
              key={z}
              type="button"
              className={'file-editor__display-format ' + (zoom === z ? 'file-editor__display-format-selected' : 'file-editor__display-format-unselected')}
              onClick={() => setZoom(z)}
              title={`Zoom ${z}%`}
            >
              {z}%
            </button>
          ))}
        </div>
      </div>

      {/* ── Search bar ── */}
      <div className="file-editor__search-container" style={{ flexShrink: 0 }}>
        <div className="file-editor__search">
          <span className="file-editor__search-icon" aria-hidden="true">&#128269;</span>
          <input
            ref={searchInputRef}
            type="text"
            className="file-editor__search-input"
            placeholder="Search\u2026"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) gotoPrevMatch(); else gotoNextMatch(); }
            }}
            spellCheck={false}
          />
          <span className="file-editor__search-count">
            {searchQuery ? (matchRanges.length > 0 ? `${activeMatchIndex + 1}/${matchRanges.length}` : '0/0') : ''}
          </span>
          <button type="button" className="file-editor__search-btn" onClick={gotoPrevMatch} disabled={matchRanges.length === 0} title="Previous (Shift+Enter)">&#8593;</button>
          <button type="button" className="file-editor__search-btn" onClick={gotoNextMatch} disabled={matchRanges.length === 0} title="Next (Enter)">&#8595;</button>
          <label className="file-editor__search-toggle" title="Match case">
            <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
            Aa
          </label>
        </div>
        {isTextMode && (
          <div className="file-editor__replace">
            <input
              type="text"
              className="file-editor__replace-input"
              placeholder="Replace with\u2026"
              value={replaceQuery}
              onChange={e => setReplaceQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleReplace(); } }}
              spellCheck={false}
            />
            <button type="button" className="file-editor__replace-btn" onClick={handleReplace} disabled={matchRanges.length === 0} title="Replace current (Enter)">Replace</button>
            <button type="button" className="file-editor__replace-btn" onClick={handleReplaceAll} disabled={matchRanges.length === 0} title="Replace all">Replace All</button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {isTextMode ? (
          <div className="file-editor__body" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            {showHighlight && (
              <div
                ref={highlightLayerRef}
                className="file-editor__highlight-layer"
                aria-hidden="true"
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  fontSize: `${Math.round(15 * zoom / 100)}px`,
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
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
                fontSize: `${Math.round(15 * zoom / 100)}px`,
                background: showHighlight ? 'transparent' : undefined,
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                width: '100%',
                height: '100%',
                resize: 'none',
              }}
            />
          </div>
        ) : (
          <div className="file-editor__markdown-modal-body" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto' }}>
            <div
              ref={markdownBodyRef}
              className="file-editor__markdown-content"
              style={{ zoom: zoom / 100 }}
            >
              {markdownModules ? (
                <markdownModules.ReactMarkdown remarkPlugins={[markdownModules.remarkGfm]}>
                  {editedContent}
                </markdownModules.ReactMarkdown>
              ) : (
                <div style={{ color: '#888', fontStyle: 'italic', padding: 20 }}>Loading markdown renderer\u2026</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownPreviewWindow;
