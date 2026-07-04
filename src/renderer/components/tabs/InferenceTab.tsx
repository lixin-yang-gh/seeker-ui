import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface InferenceTabProps {
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  inferenceResult?: string;
  inferenceReasoning?: string;
  inferenceError?: string;
  inferenceStatus?: 'idle' | 'running' | 'success' | 'error';
  onClearResult?: () => void;
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

// ─── Text Renderer (simple, no external deps) ─────────────────────

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
      {/* Header */}
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
        {item.reason && (
          <span style={{ fontSize: '11px', color: '#888', fontStyle: 'italic', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.reason}>
            {item.reason}
          </span>
        )}
        <CopyButton text={item.replacement ?? item.original ?? item.raw} />
      </div>
      {/* Body */}
      <div style={{ padding: '10px 14px' }}>
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
  inferenceLastSavedTimestamp,
}) => {
  const [model, setModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

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
        setTemperature(folderState?.temperature ?? 0.1);
      } catch (e) {
        console.error('Failed to load inference state:', e);
      } finally {
        setLoading(false);
      }
    };
    loadState();
  }, [rootFolder]);

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

      {/* Model reasoning (from thinking block) */}
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="inference-action-button" onClick={() => onClearResult?.()} disabled={!hasContent}>Clear</button>
            <CopyButton text={inferenceResult} label="Copy All" style={{ padding: '6px 10px', fontSize: '12px' }} />
            <button className="inference-action-button" disabled={!inferenceResult}>Update File(s)</button>
          </div>
        </div>
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
    </div>
  );
};

export default InferenceTab;