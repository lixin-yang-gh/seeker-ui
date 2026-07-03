import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { resolveProjectPath } from '../../../shared/utils';

interface InferenceTabProps {
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  inferenceResult?: string;
  inferenceReasoning?: string;
  inferenceError?: string;
  inferenceStatus?: 'idle' | 'running' | 'success' | 'error';
  onClearResult?: () => void;
}

// ─── Block Replacement Parser ─────────────────────────────────────

interface ParsedSection {
  start?: string;
  end?: string;
  replacement?: string;
}

interface BlockReplacementItem {
  path: string;
  op: string;
  scope: string;
  lang: string;
  sections: ParsedSection;
  raw: string;
}

function parseBlockReplacementContent(raw: string): ParsedSection {
  const startMatch = raw.match(/\[start\]([\s\S]*?)(?=\[end\]|\[replacement\]|$)/);
  const endMatch = raw.match(/\[end\]([\s\S]*?)(?=\[replacement\]|$)/);
  const replacementMatch = raw.match(/\[replacement\]([\s\S]*?)$/);
  return {
    start: startMatch ? startMatch[1].trim() : undefined,
    end: endMatch ? endMatch[1].trim() : undefined,
    replacement: replacementMatch ? replacementMatch[1].trim() : undefined,
  };
}

function parseInferenceResult(text: string): Array<{ type: 'markdown'; content: string } | { type: 'block'; item: BlockReplacementItem }> {
  const segments: Array<{ type: 'markdown'; content: string } | { type: 'block'; item: BlockReplacementItem }> = [];
  const pattern = /(\[path="([^"]+)",\s*op="([^"]+)"(?:,\s*scope="([^"]*)")?\])\s*\n```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'markdown', content: text.slice(lastIndex, match.index) });
    }
    const [, , filePath, op, scope, lang, body] = match;
    const sections = parseBlockReplacementContent(body);
    // If no scope attribute and no [start]/[end] anchors, treat as full-file replacement
    const resolvedScope = scope ?? (
      sections.replacement !== undefined && sections.start === undefined && sections.end === undefined
        ? 'file'
        : 'block'
    );
    segments.push({
      type: 'block',
      item: {
        path: filePath,
        op,
        scope: resolvedScope,
        lang,
        sections,
        raw: body,
      },
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'markdown', content: text.slice(lastIndex) });
  }

  return segments;
}

function extractOriginalCodeBlock(
  fileContent: string,
  startAnchor: string,
  endAnchor: string
): string | null {
  const startIdx = fileContent.indexOf(startAnchor);
  if (startIdx === -1) return null;
  let endIdx = fileContent.indexOf(endAnchor, startIdx + startAnchor.length);
  if (endIdx === -1) {
    if (endAnchor === startAnchor) endIdx = startIdx;
    else return null;
  }
  return fileContent.substring(startIdx, endIdx + endAnchor.length);
}

// ─── Copy Button ──────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        padding: '2px 8px',
        fontSize: '11px',
        background: copied ? '#2e7d32' : '#2a2d2e',
        color: copied ? '#a5d6a7' : '#ccc',
        border: '1px solid #555',
        borderRadius: '3px',
        cursor: 'pointer',
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
};

// ─── Section Block (original / replacement / anchor) ──────────────

const SectionBlock: React.FC<{
  title: string;
  content: string;
  sectionType: 'original' | 'replacement' | 'anchor';
}> = ({ title, content, sectionType }) => (
  <div className={`inference-section-block inference-section-${sectionType}`}>
    <div className="inference-section-header">
      <span className="inference-section-label">{title}</span>
      <CopyButton text={content} />
    </div>
    <div className={`inference-code-block inference-code-${sectionType}`}>
      <code>{content}</code>
    </div>
  </div>
);

// ─── Block Replacement View ───────────────────────────────────────

const BlockReplacementView: React.FC<{
  item: BlockReplacementItem;
  rootFolder?: string | null;
}> = ({ item, rootFolder }) => {
  const [originalCode, setOriginalCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!rootFolder) return;
    const absPath = resolveProjectPath(item.path, rootFolder);

    window.electronAPI.readFile(absPath)
      .then((fileData) => {
        const content = fileData.content;
        if (item.scope === 'file') {
          setOriginalCode(content);
        } else if (item.sections.start && item.sections.end) {
          const extracted = extractOriginalCodeBlock(content, item.sections.start, item.sections.end);
          if (extracted) setOriginalCode(extracted);
          else setLoadError(`Could not locate anchors in: ${item.path}`);
        } else {
          setLoadError(`Missing anchors for scope="block" in: ${item.path}`);
        }
      })
      .catch((err) => {
        setLoadError(`Failed to read: ${item.path} – ${String(err)}`);
      });
  }, [item, rootFolder]);

  const opColor: Record<string, string> = {
    replace: '#58b0ff',
    add: '#4ec9b0',
    delete: '#f48771',
  };
  const color = opColor[item.op.toLowerCase()] ?? '#aaa';
  const { replacement } = item.sections;

  return (
    <div style={{
      margin: '12px 0',
      border: `1px solid ${color}55`,
      borderRadius: '6px',
      overflow: 'hidden',
      background: '#1e2330',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 12px',
        background: '#252a38',
        borderBottom: `1px solid ${color}44`,
      }}>
        <span style={{
          padding: '1px 8px',
          borderRadius: '3px',
          background: color + '22',
          color,
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          border: `1px solid ${color}66`,
        }}>
          {item.op}
        </span>
        <span style={{ fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#9cdcfe', flex: 1 }}>
          {item.path}
        </span>
        {item.scope && (
          <span style={{ fontSize: '11px', color: item.scope === 'file' ? '#4ec9b0' : '#aaa', padding: '1px 6px', border: '1px solid #444', borderRadius: '3px' }}>
            {item.scope}
          </span>
        )}
        {item.lang && (
          <span style={{ fontSize: '11px', color: '#888' }}>{item.lang}</span>
        )}
        <CopyButton text={item.raw} label="Copy All" />
      </div>

      {/* Sections */}
      <div style={{ padding: '10px 14px' }}>
        {loadError && (
          <div style={{ color: '#f48771', fontSize: '12px', marginBottom: '8px' }}>⚠️ {loadError}</div>
        )}
        {originalCode !== null && (
          <SectionBlock title="[original]" content={originalCode} sectionType="original" />
        )}
        {replacement !== undefined && (
          <SectionBlock title="[replacement]" content={replacement} sectionType="replacement" />
        )}
        {originalCode === null && !loadError && !rootFolder && (
          <SectionBlock title="[start/end/replacement]" content={item.raw} sectionType="anchor" />
        )}
        {originalCode === null && !loadError && rootFolder && (
          <div style={{ color: '#888', fontSize: '12px' }}>Loading original…</div>
        )}
      </div>
    </div>
  );
};

// ─── Generic Code Block ───────────────────────────────────────────

const CodeBlock: React.FC<{ inline?: boolean; className?: string; children?: React.ReactNode }> = ({
  inline,
  className,
  children,
}) => {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? '').replace(/\n$/, '');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  if (inline) {
    return <code className={className}>{children}</code>;
  }

  return (
    <div style={{ position: 'relative', margin: '10px 0' }}>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          padding: '2px 8px',
          fontSize: '11px',
          background: copied ? '#2e7d32' : '#2a2d2e',
          color: copied ? '#a5d6a7' : '#ccc',
          border: '1px solid #555',
          borderRadius: '3px',
          cursor: 'pointer',
          zIndex: 1,
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre style={{ margin: 0 }}>
        <code className={className}>{text}</code>
      </pre>
    </div>
  );
};

// ─── Inference Result Renderer ────────────────────────────────────

const InferenceResultRenderer: React.FC<{ text: string; rootFolder?: string | null }> = ({ text, rootFolder }) => {
  const segments = parseInferenceResult(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'block' ? (
          <BlockReplacementView key={i} item={seg.item} rootFolder={rootFolder} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{ code: CodeBlock, pre: ({ children }) => <>{children}</> }}
          >
            {seg.content}
          </ReactMarkdown>
        )
      )}
    </>
  );
};

// ─── Tab Component ────────────────────────────────────────────────

const InferenceTab: React.FC<InferenceTabProps> = ({
  rootFolder,
  inferenceResult = '',
  inferenceReasoning = '',
  inferenceError = '',
  inferenceStatus = 'idle',
  onClearResult,
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
        const modelsStr = apiSettings.inferenceModels || '';
        const parsedModels: string[] = [];
        const regex = /"([^"]*)"/g;
        let match;
        while ((match = regex.exec(modelsStr)) !== null) {
          if (match[1].trim()) parsedModels.push(match[1].trim());
        }
        setModel(folderState?.inferenceModel || parsedModels[0] || '');
        setTemperature(folderState?.temperature ?? 0.1);
      } catch (error) {
        console.error('Failed to load inference state:', error);
      } finally {
        setLoading(false);
      }
    };
    loadState();
  }, [rootFolder]);

  return (
    <div className="tab-panel inference-tab">
      <div style={{ marginBottom: '16px', background: '#252526', border: '1px solid #444', borderRadius: '4px', padding: '10px 14px' }}>
        <div style={{ color: '#d4d4d4', fontSize: '13px', marginBottom: '6px' }}>
          {loading ? 'Loading...' : (
            <>Model: <strong>{model || 'Not set'}</strong> | Temperature: <strong>{temperature !== undefined ? temperature : 'Not set'}</strong></>
          )}
        </div>
        <div style={{ color: '#9cdcfe', fontSize: '13px' }}>
          ℹ️ To start inference, configure your prompt in the <strong>Prompt</strong> tab and click <strong>Start Inference</strong> there.
        </div>
      </div>

      {inferenceStatus === 'running' && (
        <div className="inference-loading" style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
          Running inference…
        </div>
      )}

      {inferenceStatus === 'error' && (
        <div className="inference-result-area">
          <span className="error">{inferenceError}</span>
        </div>
      )}

      {inferenceReasoning && (
        <div style={{ marginBottom: '8px' }}>
          <label style={{ fontSize: '12px', color: '#888' }}>Reasoning</label>
          <div className="inference-result-area" style={{ maxHeight: '150px', color: '#aaa' }}>
            {inferenceReasoning}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <label style={{ fontSize: '16px', color: '#aaa', fontWeight: 'bold' }}>Result</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="inference-action-button"
              onClick={() => onClearResult?.()}
              disabled={!inferenceResult && !inferenceReasoning && !inferenceError}
            >
              Clear
            </button>
            <button
              className="inference-action-button"
              onClick={() => navigator.clipboard.writeText(inferenceResult)}
              disabled={!inferenceResult}
            >
              Copy
            </button>
            <button className="inference-action-button" disabled={!inferenceResult}>
              Update File(s)
            </button>
          </div>
        </div>
        <div className="inference-result-area">
          {inferenceStatus === 'success' && inferenceResult ? (
            <InferenceResultRenderer text={inferenceResult} rootFolder={rootFolder} />
          ) : (
            <span style={{ color: '#666', fontStyle: 'italic' }}>No result yet. Run inference from the Prompt tab.</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default InferenceTab;