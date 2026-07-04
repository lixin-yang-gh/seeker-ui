import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { applyBlockReplacements, BlockReplacementItem as UtilBlockReplacementItem, FileUpdateResult } from '../../../shared/file-updater';

interface InferenceTabProps {
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  inferenceResult?: string;
  inferenceReasoning?: string;
  inferenceError?: string;
  inferenceStatus?: 'idle' | 'running' | 'success' | 'error';
  onClearResult?: () => void;
  onCancelInference?: () => void;
  onRunInference?: () => void;
  inferenceLastSavedTimestamp?: number | null;
}

// ─── Block Replacement Parser ─────────────────────────────────────

interface BlockReplacementItem {
  path: string;
  op: string;
  is_full_file: boolean;
  original: string | null;
  replacement: string | null;
  reason?: string;
  raw: string;
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'code'; lang: string; content: string }
  | { type: 'block'; item: BlockReplacementItem };

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /```(\w*)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    const lang = match[1];
    const body = match[2];
    if (lang === 'json') {
      try {
        const parsed = JSON.parse(body);
        const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        let anyBlock = false;
        for (const item of items) {
          if (item && typeof item === 'object' && 'path' in item && 'op' in item) {
            const rec = item as Record<string, unknown>;
            segments.push({
              type: 'block',
              item: {
                path: String(rec.path ?? ''),
                op: String(rec.op ?? 'replace'),
                is_full_file: Boolean(rec.is_full_file ?? false),
                original: rec.original != null ? String(rec.original) : null,
                replacement: rec.replacement != null ? String(rec.replacement) : null,
                reason: rec.reason != null ? String(rec.reason) : undefined,
                raw: body,
              },
            });
            anyBlock = true;
          }
        }
        if (!anyBlock) segments.push({ type: 'code', lang, content: body });
      } catch {
        segments.push({ type: 'code', lang, content: body });
      }
    } else {
      segments.push({ type: 'code', lang, content: body });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

/** Extract all block items from parsed segments */
function extractBlockItems(segments: Segment[]): BlockReplacementItem[] {
  return segments.filter((s): s is { type: 'block'; item: BlockReplacementItem } => s.type === 'block').map(s => s.item);
}

// ─── Copy Button ──────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string; label?: string; style?: React.CSSProperties }> = ({
  text, label = 'Copy', style,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      style={{
        padding: '2px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '3px',
        background: copied ? '#2e7d32' : '#2a2d2e',
        color: copied ? '#a5d6a7' : '#ccc',
        border: '1px solid #555', ...style,
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
};

// ─── Text Renderer ────────────────────────────────────────────────

const TextSegment: React.FC<{ content: string }> = ({ content }) => (
  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#d4d4d4', fontSize: '13px', lineHeight: 1.6, padding: '4px 0' }}>
    {content}
  </div>
);

// ─── Code Block ───────────────────────────────────────────────────

const CodeSegment: React.FC<{ lang: string; content: string }> = ({ lang, content }) => (
  <div style={{ margin: '8px 0', position: 'relative' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#2a2d2e', padding: '3px 10px', borderRadius: '4px 4px 0 0', borderBottom: '1px solid #444' }}>
      <span style={{ fontSize: '11px', color: '#888' }}>{lang || 'code'}</span>
      <CopyButton text={content} />
    </div>
    <pre style={{ margin: 0, padding: '10px 12px', background: '#1a1a2e', borderRadius: '0 0 4px 4px', overflowX: 'auto', fontSize: '12px', lineHeight: 1.5, color: '#e6edf3', border: '1px solid #333', borderTop: 'none' }}>
      <code>{content}</code>
    </pre>
  </div>
);

// ─── Block Replacement View ───────────────────────────────────────

const opColors: Record<string, string> = { replace: '#58b0ff', add: '#4ec9b0', delete: '#f48771' };

const BlockSegment: React.FC<{ item: BlockReplacementItem }> = ({ item }) => {
  const color = opColors[item.op.toLowerCase()] ?? '#aaa';
  return (
    <div style={{ margin: '10px 0', border: `1px solid ${color}55`, borderRadius: '6px', overflow: 'hidden', background: '#1e2330' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px', background: '#252a38', borderBottom: `1px solid ${color}44`, flexWrap: 'wrap' }}>
        <span style={{ padding: '1px 8px', borderRadius: '3px', background: `${color}22`, color, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', border: `1px solid ${color}66` }}>
          {item.op}
        </span>
        <span style={{ fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#9cdcfe', flex: 1, wordBreak: 'break-all' }}>
          {item.path}
        </span>
        <span style={{ fontSize: '11px', color: item.is_full_file ? '#4ec9b0' : '#aaa', padding: '1px 6px', border: '1px solid #444', borderRadius: '3px' }}>
          {item.is_full_file ? 'full file' : 'block'}
        </span>
        <CopyButton text={item.replacement ?? item.original ?? item.raw} />
      </div>
      <div style={{ padding: '10px 14px' }}>
        {item.reason && (
          <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(107,0,35,0.5)', border: '1px solid rgba(219,112,147,0.25)', borderLeft: '3px solid #db7093', borderRadius: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#db7093', textTransform: 'uppercase', marginRight: '8px' }}>💡</span>
            <span style={{ fontSize: '12px', color: '#ccc' }}>{item.reason}</span>
          </div>
        )}
        {item.original != null && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#3890df', textTransform: 'uppercase' }}>
                {item.is_full_file ? '[full file — original]' : '[original]'}
              </span>
              <CopyButton text={item.original} />
            </div>
            <pre style={{ margin: `2px 0 0 0`, padding: '8px 12px', background: '#2a3040', border: '1px solid #58b0ff55', borderLeft: '3px solid #58b0ff', borderRadius: '4px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#e6edf3', overflowX: 'auto' }}>
              <code>{item.original}</code>
            </pre>
          </div>
        )}
        {item.replacement != null && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#f09210', textTransform: 'uppercase' }}>[replacement]</span>
              <CopyButton text={item.replacement} />
            </div>
            <pre style={{ margin: `2px 0 0 0`, padding: '8px 12px', background: '#4a3e2e', border: '1px solid #f0921055', borderLeft: '3px solid #f09210', borderRadius: '4px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#e6edf3', overflowX: 'auto' }}>
              <code>{item.replacement}</code>
            </pre>
          </div>
        )}
        {item.original == null && item.replacement == null && (
          <pre style={{ margin: `2px 0 0 0`, padding: '8px 12px', background: '#202020', border: '1px solid #444', borderLeft: '3px solid #666', borderRadius: '4px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#bbb', overflowX: 'auto' }}>
            <code>{item.raw}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

// ─── Result Renderer ──────────────────────────────────────────────

const ResultRenderer: React.FC<{ text: string }> = ({ text }) => {
  const segments = useMemo(() => parseSegments(text), [text]);
  return (
    <div style={{ padding: '8px 4px' }}>
      {segments.map((seg, i) =>
        seg.type === 'block' ? <BlockSegment key={i} item={seg.item} /> :
          seg.type === 'code' ? <CodeSegment key={i} lang={seg.lang} content={seg.content} /> :
            <TextSegment key={i} content={seg.content} />
      )}
    </div>
  );
};

// ─── Tab ──────────────────────────────────────────────────────────

const InferenceTab: React.FC<InferenceTabProps> = ({
  rootFolder,
  inferenceResult = '',
  inferenceReasoning = '',
  inferenceError = '',
  inferenceStatus = 'idle',
  onClearResult,
  onCancelInference,
  inferenceLastSavedTimestamp,
}) => {
  const [model, setModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Update File(s) confirm flow
  const [updateConfirming, setUpdateConfirming] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateResults, setUpdateResults] = useState<FileUpdateResult[]>([]);
  const [showUpdateSummary, setShowUpdateSummary] = useState(false);

  useEffect(() => {
    const loadState = async () => {
      if (!rootFolder) { setLoading(false); return; }
      try {
        const [folderState, apiSettings] = await Promise.all([
          window.electronAPI.getFolderState(rootFolder),
          window.electronAPI.getApiSettings(),
        ]);
        const parsedModels: string[] = [];
        const regex = /"([^"]*)"/g;
        let match;
        while ((match = regex.exec(apiSettings.inferenceModels || '')) !== null) {
          if (match[1].trim()) parsedModels.push(match[1].trim());
        }
        setModel(folderState?.inferenceModel || parsedModels[0] || '');
        setTemperature(folderState?.temperature ?? 0.7);
      } catch (e) {
        console.error('Failed to load inference state:', e);
      } finally {
        setLoading(false);
      }
    };
    loadState();
  }, [rootFolder]);

  // Reset confirm state when result changes
  useEffect(() => {
    setUpdateConfirming(false);
    setUpdateResults([]);
    setShowUpdateSummary(false);
  }, [inferenceResult]);

  const segments = useMemo(() => parseSegments(inferenceResult), [inferenceResult]);

  const blockItems = useMemo(() => extractBlockItems(segments), [segments]);

  // Group update results by file path, collecting unique operation types
  const groupedResults = useMemo(() => {
    const map = new Map<string, { operations: Set<string>; errors: string[]; overall: boolean }>();
    for (const r of updateResults) {
      if (!map.has(r.path)) {
        map.set(r.path, { operations: new Set(), errors: [], overall: r.success });
      }
      const entry = map.get(r.path)!;
      if (r.operation) entry.operations.add(r.operation);
      if (r.error) entry.errors.push(r.error);
      if (!r.success) entry.overall = false;
    }
    return Array.from(map.entries()).map(([path, data]) => ({
      path,
      operations: Array.from(data.operations),
      success: data.overall,
      error: data.errors.length > 0 ? data.errors.join('; ') : undefined,
    }));
  }, [updateResults]);

  const handleUpdateFiles = useCallback(async () => {
    if (!rootFolder || !inferenceResult) return;
    if (blockItems.length === 0) {
      setUpdateConfirming(false);
      return;
    }
    setIsUpdating(true);
    setUpdateResults([]);
    try {
      // Cast local BlockReplacementItem to the shared utility type (shapes are identical minus `raw`)
      const results = await applyBlockReplacements(
        blockItems as UtilBlockReplacementItem[],
        rootFolder
      );
      setUpdateResults(results);
      setShowUpdateSummary(true);
    } catch (err: any) {
      setUpdateResults([{ path: '(unknown)', success: false, error: err?.message ?? String(err) }]);
      setShowUpdateSummary(true);
    } finally {
      setIsUpdating(false);
      setUpdateConfirming(false);
    }
  }, [rootFolder, inferenceResult, segments]);

  const hasContent = !!(inferenceResult || inferenceReasoning || inferenceError);

  return (
    <div className="tab-panel inference-tab">
      {/* Info bar */}
      <div style={{ marginBottom: '12px', background: '#252526', border: '1px solid #444', borderRadius: '4px', padding: '8px 14px' }}>
        <div style={{ color: '#d4d4d4', fontSize: '13px', marginBottom: '4px' }}>
          {loading ? 'Loading…' : <>Model: <strong>{model || 'Not set'}</strong> | Temperature: <strong>{temperature ?? 'Not set'}</strong></>}
        </div>
        <div style={{ color: '#9cdcfe', fontSize: '12px' }}>
          ℹ️ Configure your prompt in the <strong>Prompt</strong> tab and click <strong>Start Inference</strong> there.
        </div>
      </div>

      {/* Running indicator */}
      {inferenceStatus === 'running' && (
        <div className="inference-loading" style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
          Running inference…
        </div>
      )}

      {/* Error */}
      {inferenceStatus === 'error' && (
        <div className="inference-result-area" style={{ marginBottom: '8px' }}>
          <span className="error">{inferenceError}</span>
        </div>
      )}

      {/* Model reasoning */}
      {inferenceReasoning && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Model Reasoning</label>
            <CopyButton text={inferenceReasoning} />
          </div>
          <div className="inference-result-area" style={{ maxHeight: '140px', color: '#aaa', overflowY: 'auto' }}>
            {inferenceReasoning}
          </div>
        </div>
      )}

      {/* Main result */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: '15px', color: '#aaa', fontWeight: 'bold' }}>Inference Result</label>
            {inferenceLastSavedTimestamp && (
              <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                Saved {new Date(inferenceLastSavedTimestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {inferenceStatus === 'running' && (
              <button
                className="inference-action-button"
                style={{ background: '#8b2020' }}
                onClick={() => onCancelInference?.()}
                title="Abort the current inference request"
              >
                Cancel Inference
              </button>
            )}
            <button className="inference-action-button" onClick={() => onClearResult?.()} disabled={!hasContent}>Clear</button>
            <CopyButton text={inferenceResult} label="Copy All" style={{ padding: '12px 20px', fontSize: '12px', fontWeight: '500' }} />
            {!updateConfirming ? (
              <button
                className="inference-action-button"
                disabled={!inferenceResult || !rootFolder || blockItems.length === 0}
                onClick={() => setUpdateConfirming(true)}
              >
                Update File(s)
              </button>
            ) : (
              <>
                <span style={{ fontSize: '12px', color: '#ffb300' }}>Apply changes?</span>
                <button
                  className="inference-action-button"
                  style={{ background: isUpdating ? '#555' : '#2e7d32' }}
                  onClick={handleUpdateFiles}
                  disabled={isUpdating}
                >
                  {isUpdating ? 'Updating…' : 'OK'}
                </button>
                <button
                  className="inference-action-button"
                  style={{ background: '#555' }}
                  onClick={() => { setUpdateConfirming(false); setUpdateResults([]); }}
                  disabled={isUpdating}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {/* Update results feedback inline (shown only while not showing popup) */}
        {!showUpdateSummary && updateResults.length > 0 && (
          <div style={{ marginBottom: '8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: '4px', padding: '8px 12px', fontSize: '12px' }}>
            {updateResults.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '3px' }}>
                <span style={{ color: r.success ? '#4ec9b0' : '#f48771', fontWeight: 700 }}>{r.success ? '✓' : '✗'}</span>
                <span style={{ fontFamily: 'Consolas, monospace', color: '#9cdcfe', wordBreak: 'break-all' }}>{r.path}</span>
                {r.operation && <span style={{ color: '#ccc', fontSize: '11px', marginLeft: '4px' }}>({r.operation})</span>}
                {r.error && <span style={{ color: '#f48771', fontStyle: 'italic' }}>{r.error}</span>}
              </div>
            ))}
          </div>
        )}

        

        <div
          className="inference-result-area"
          style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}
        >
          {inferenceStatus === 'success' && inferenceResult ? (
            <ResultRenderer text={inferenceResult} />
          ) : (
            <span style={{ color: '#666', fontStyle: 'italic' }}>
              {inferenceStatus === 'running' ? 'Waiting for response…' : 'No result yet. Run inference from the Prompt tab.'}
            </span>
          )}
        </div>
      </div>

      {/* Update Summary Popup Overlay — rendered at tab-panel root so fixed positioning is unobstructed */}
      {showUpdateSummary && groupedResults.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowUpdateSummary(false)}
        >
          <div
            style={{
              background: '#1e1e1e',
              border: '1px solid #555',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '720px',
              width: '90%',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: '16px', fontWeight: 500 }}>
                File Update Summary
              </h3>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ccc',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
                onClick={() => setShowUpdateSummary(false)}
              >
                ✕
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, maxHeight: '60vh' }}>
              {groupedResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid #2a2a2a',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: r.success ? '#4ec9b0' : '#f48771',
                        minWidth: '20px',
                        fontSize: '14px',
                      }}
                    >
                      {r.success ? '✓' : '✗'}
                    </span>
                    <span
                      style={{
                        fontFamily: 'Consolas, monospace',
                        color: '#9cdcfe',
                        wordBreak: 'break-all',
                        flex: 1,
                        fontSize: '13px',
                      }}
                    >
                      {r.path}
                    </span>
                  </div>
                  {r.operations.length > 0 && (
                    <div style={{ marginLeft: '30px', marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {r.operations.map((operation, j) => {
                        const opColor = opColors[operation.toLowerCase()] ?? '#aaa';
                        return (
                          <span
                            key={j}
                            style={{
                              padding: '1px 7px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              color: opColor,
                              background: `${opColor}22`,
                              border: `1px solid ${opColor}66`,
                            }}
                          >
                            {operation}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {r.error && (
                    <div style={{ marginLeft: '30px', marginTop: '4px', color: '#f48771', fontSize: '11px', fontStyle: 'italic' }}>
                      {r.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button
                style={{
                  padding: '8px 20px',
                  background: '#0e639c',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                onClick={() => setShowUpdateSummary(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InferenceTab;