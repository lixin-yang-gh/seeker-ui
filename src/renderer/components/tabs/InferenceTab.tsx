import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface InferenceTabProps {
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  inferenceResult?: string;
  inferenceReasoning?: string;
  inferenceError?: string;
  inferenceStatus?: 'idle' | 'running' | 'success' | 'error';

    onClearResult?: () => void;
}

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
    <div style={{ position: 'relative', margin: '10px 0', border: '0' }}>
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

const InferenceTab: React.FC<InferenceTabProps> = ({
  rootFolder,
  inferenceResult = '',
  inferenceReasoning = '',
  inferenceError = '',
  inferenceStatus = 'idle',
}) => {
  const [model, setModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadState = async () => {
      if (!rootFolder) {
        setLoading(false);
        return;
      }
      try {
        // Load folder state and API settings in parallel
        const [folderState, apiSettings] = await Promise.all([
          window.electronAPI.getFolderState(rootFolder),
          window.electronAPI.getApiSettings(),
        ]);

        // Parse models from settings
        const modelsStr = apiSettings.inferenceModels || '';
        const parsedModels: string[] = [];
        const regex = /"([^"]*)"/g;
        let match;
        while ((match = regex.exec(modelsStr)) !== null) {
          if (match[1].trim()) parsedModels.push(match[1].trim());
        }
        setModels(parsedModels);

        // Determine default model: saved or first available
        let defaultModel = '';
        if (folderState?.inferenceModel && folderState.inferenceModel.trim() !== '') {
          defaultModel = folderState.inferenceModel;
        } else if (parsedModels.length > 0) {
          defaultModel = parsedModels[0];
        }
        setModel(defaultModel);

        // Determine default temperature: saved or 0.1
        const defaultTemp = folderState?.temperature ?? 0.1;
        setTemperature(defaultTemp);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ color: '#d4d4d4', fontSize: '13px' }}>
            {loading ? 'Loading...' : (
              <>
                Model: <strong>{model || 'Not set'}</strong> | Temperature: <strong>{temperature !== undefined ? temperature : 'Not set'}</strong>
              </>
            )}
          </div>
          
        </div>
        <div style={{ color: '#9cdcfe', fontSize: '13px' }}>
          ℹ️ To start inference, configure your prompt in the <strong>Prompt</strong> tab and click <strong>Start Inference</strong> there.
        </div>
      </div>

      {inferenceStatus === 'running' && (
        <div className="inference-loading" style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div>
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


      <div style={{ display: 'flex',  flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
            <button
              className="inference-action-button"
              disabled={!inferenceResult}
            >
              Update File(s)
            </button>
          </div>
        </div>
        <div
          className="inference-result-area"
        >
          {inferenceStatus === 'success' && inferenceResult ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock, pre: ({ children }) => <>{children}</> }}>
              {inferenceResult}
            </ReactMarkdown>
          ) : (
            <span style={{ color: '#666', fontStyle: 'italic' }}>No result yet. Run inference from the Prompt tab.</span>
          )}
        </div>
      </div>
    </div>


  );
};


export default InferenceTab;