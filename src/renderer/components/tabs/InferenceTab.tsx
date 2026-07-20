import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { applyBlockReplacements, BlockReplacementItem as UtilBlockReplacementItem, FileUpdateResult, ensureFileAndDirectory } from '../../../shared/file-updater';
import { resolveProjectPath } from '../../../shared/utils';
import InferenceControls from '../shared/InferenceControls';
import { parseSegments, extractBlockItems, BlockReplacementItem, Segment } from '../../../shared/block-parser';

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
  /** Callback to switch to the Prompt tab so user can re-run inference */
  onSwitchToPrompt?: () => void;
  /**
   * True when the cached/last-run inference was generated using the
   * "Single Block Replacement" task prompt. While true, the "Update Files"
   * button is disabled because that mode only ever targets a single block
   * and its output is not intended to be auto-applied via this flow.
   */
  isSingleBlockReplacementMode?: boolean;
  /** Called after files have been updated via the "Update Files" button */
  onFilesUpdated?: () => void;
}

// ─── Copy Button ──────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string; label?: string; style?: React.CSSProperties }> = ({
  text, label = 'Copy', style,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      title="Copy to clipboard"
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
  onSwitchToPrompt,
  inferenceLastSavedTimestamp,
  isSingleBlockReplacementMode = false,
  onFilesUpdated,
}) => {
  const [model, setModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Paste from clipboard success/failure states
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const [pasteFailure, setPasteFailure] = useState(false);

  // Update Files confirm flow
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

  // Local state to hold pasted inference result (so we can update inferenceResult locally)
  const [pastedResult, setPastedResult] = useState<string | null>(null);

  const setInferenceResultFromClipboard = useCallback((text: string) => {
    setPastedResult(text);
    // Also update the prop if possible via onClearResult or set it in the parent?
    // We cannot directly modify inferenceResult because it's a prop.
    // Instead, we store it locally and display it via the ResultRenderer.
    // We'll use a local state that overrides the prop display.
  }, []);

  // Reset confirm and paste states when result changes
  useEffect(() => {
    setUpdateConfirming(false);
    setUpdateResults([]);
    setShowUpdateSummary(false);
    setPasteSuccess(false);
    setPasteFailure(false);
  }, [inferenceResult]);

  // When pastedResult changes, also handle the display. If pastedResult is set, show that.
  const effectiveResult = pastedResult ?? inferenceResult;

  const segments = useMemo(() => parseSegments(effectiveResult), [effectiveResult]);

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
    if (!rootFolder || !effectiveResult) return;
    if (blockItems.length === 0) {
      setUpdateConfirming(false);
      return;
    }
    setIsUpdating(true);
    setUpdateResults([]);
    try {
      if (isSingleBlockReplacementMode) {
        // ─── Tagged Block Update: isolated processing branch ───
        // In this mode there is exactly one block item whose "replacement"
        // field contains the new inner text for the <block_to_update> tag.
        const item = blockItems[0];
        const absPath = resolveProjectPath(item.path, rootFolder);
        // Ensure the directory structure and target file exist before reading.
        await ensureFileAndDirectory(absPath, true);
        const fileData = await window.electronAPI.readFile(absPath);
        const content = fileData.content;

        // Match the first <block_to_update ...>...</block_to_update> tag.
        const tagPattern = /(<block_to_update[^>]*>)([\s\S]*?)(<\/block_to_update>)/;
        const match = content.match(tagPattern);

        if (!match) {
          setUpdateResults([{
            path: absPath,
            success: false,
            error: 'No <block_to_update> tag found in file.',
            operation: 'tagged-block-update'
          }]);
          setShowUpdateSummary(true);
          return;
        }

        // Replace only the inner content (between the opening and closing tags)
        // with the parsed replacement value, preserving the tag wrapper.
        const replacement = item.replacement ?? '';
        const newContent = content.replace(tagPattern, (_match, openTag, _inner, closeTag) => {
          return openTag + '\n' + replacement + '\n' + closeTag;
        });

        await window.electronAPI.writeFile(absPath, newContent);

        setUpdateResults([{
          path: absPath,
          success: true,
          operation: 'tagged-block-update'
        }]);
      } else {
        // ─── Standard block replacement flow ───
        // Cast local BlockReplacementItem to the shared utility type (shapes are identical minus `raw`)
        const results = await applyBlockReplacements(
          blockItems as UtilBlockReplacementItem[],
          rootFolder
        );
        setUpdateResults(results);
      }
      setShowUpdateSummary(true);
      onFilesUpdated?.();
    } catch (err: any) {
      setUpdateResults([{ path: '(unknown)', success: false, error: err?.message ?? String(err) }]);
      setShowUpdateSummary(true);
    } finally {
      setIsUpdating(false);
      setUpdateConfirming(false);
    }
  }, [rootFolder, effectiveResult, blockItems, isSingleBlockReplacementMode, onFilesUpdated]);

  const hasContent = !!(effectiveResult || inferenceReasoning || inferenceError);

  return (
    <div className="tab-panel inference-tab">
      {/* Main result */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', marginLeft: '3px' }}>
            <label style={{ fontSize: '15px', color: '#aaa', fontWeight: 'bold' }}>Result</label>
            {inferenceLastSavedTimestamp && (
              <div style={{ fontSize: '11px', color: '#4ec9b0' }}>
                Saved {new Date(inferenceLastSavedTimestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Running indicator */}
            {inferenceStatus === 'running' && (
              <div className="inference-loading" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '5px' }}>
                <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', position:'relative', top: '4px', marginRight: '5px' }} />
                Running …
              </div>
            )}

            {/* Error */}
            {inferenceStatus === 'error' && (
              <div className="inference-result-area" style={{ marginBottom: '8px' }}>
                <span className="error">{inferenceError}</span>
              </div>
            )}
            {inferenceStatus === 'running' && (
              <button
                className="inference-action-button"
                style={{ background: '#8b2020' }}
                onClick={() => onCancelInference?.()}
                title="Abort the current inference request"
              >
                Cancel
              </button>
            )}
            <InferenceControls
              rootFolder={rootFolder ?? null}
              onStartInference={() => {
                onSwitchToPrompt?.();
              }}
              disabled={inferenceStatus === 'running'}
              showStartButton={true}
              startButtonLabel="Run Inference Again"
            />
            <button
              className={`inference-action-button ${pasteSuccess ? 'success' : ''} ${pasteFailure ? 'failure' : ''}`}
              style={{
                background: pasteSuccess
                  ? '#2e7d32'
                  : pasteFailure
                    ? '#c62828'
                    : 'linear-gradient(135deg, #00695c 0%, #00897b 100%)',
                border: (pasteSuccess || pasteFailure) ? 'none' : '1px solid #00796b',
                color: pasteSuccess ? '#a5d6a7' : pasteFailure ? '#ff8a80' : '#e0f2f1',
                boxShadow: (pasteSuccess || pasteFailure) ? 'none' : '0 0 0 1px rgba(0, 188, 212, 0.2), 0 2px 6px rgba(0, 105, 92, 0.35)',
              }}
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  console.log('[InferenceTab] Clipboard text length:', text.length);
                  console.log('[InferenceTab] Clipboard text preview:', text.slice(0, 200));
                  // Always sanitize 3-consecutive-backtick sequences in the pasted
                  // inference result before parsing into the block update list.
                  // parseSegments() internally runs preprocessLlmResponse(), so
                  // pasted text follows the exact same sanitization path as
                  // inference results produced in-app.
                  const segments = parseSegments(text);
                  const blocks = extractBlockItems(segments);
                  console.log('[InferenceTab] Parsed segments count:', segments.length);
                  console.log('[InferenceTab] Block items found:', blocks.length);
                  // Always display the pasted text in the result area
                  setInferenceResultFromClipboard(text);
                  if (blocks.length > 0) {
                    setPasteSuccess(true);
                    setPasteFailure(false);
                    setTimeout(() => setPasteSuccess(false), 2000);
                  } else {
                    setPasteFailure(true);
                    setPasteSuccess(false);
                    setTimeout(() => setPasteFailure(false), 2000);
                  }
                } catch (err) {
                  console.error('[InferenceTab] Paste error:', err);
                  setPasteFailure(true);
                  setPasteSuccess(false);
                  setTimeout(() => setPasteFailure(false), 2000);
                }
              }}
              title="Paste from clipboard and try to parse as Open Router API response"
            >
              {pasteSuccess ? '✓ Parsed' : pasteFailure ? '✗ Parse failed' : 'Paste'}
            </button>
            <button className="inference-action-button" onClick={() => onClearResult?.()} disabled={!hasContent} title="Clear the inference result and reasoning">Clear</button>
            <CopyButton text={inferenceResult} label="Copy All" style={{ padding: '10px', fontSize: '12px', fontWeight: '500', height: '50px' }} />
            {!updateConfirming ? (
              <button
                className="inference-action-button"
                disabled={!effectiveResult || !rootFolder || blockItems.length === 0}
                onClick={() => setUpdateConfirming(true)}
                title={
                  isSingleBlockReplacementMode
                    ? 'Apply the tagged block replacement from the inference result to the file'
                    : 'Apply the block replacements from the inference result to the files'
                }
              >
                Update Files
              </button>
            ) : (
              <>
                <span style={{ fontSize: '12px', color: '#ffb300' }}>Apply changes?</span>
                <button
                  className="inference-action-button"
                  style={{ background: isUpdating ? '#555' : '#2e7d32', minWidth: '40px' }}
                  onClick={handleUpdateFiles}
                  disabled={isUpdating}
                  title="Confirm and apply the file updates"
                >
                  {isUpdating ? 'Updating…' : 'OK'}
                </button>
                <button
                  className="inference-action-button"
                  style={{ background: '#555' }}
                  onClick={() => { setUpdateConfirming(false); setUpdateResults([]); }}
                  disabled={isUpdating}
                  title="Cancel the file update operation"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {/* Model reasoning */}
        {inferenceReasoning && (
          <div style={{ margin: '10px 0 0 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Model Reasoning</label>
              <CopyButton text={inferenceReasoning} />
            </div>
            <div className="inference-result-area" style={{ maxHeight: '140px', color: '#aaa', overflowY: 'auto' }}>
              {inferenceReasoning}
            </div>
          </div>
        )}

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
          {effectiveResult ? (
            <ResultRenderer text={effectiveResult} />
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
                title="Close the update summary"
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
                title="Close the update summary"
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