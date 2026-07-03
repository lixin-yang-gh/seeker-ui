import React, { useState, useCallback } from 'react';
import InferenceControls from '../shared/InferenceControls';
import {
  getRelativePath,
  sanitizeText,
  getErrorMessage,
} from '../../../shared/utils';

interface InferenceTabProps {
  rootFolder?: string | null;
  selectedFilePaths?: string[];
}

const InferenceTab: React.FC<InferenceTabProps> = ({
  rootFolder,
  selectedFilePaths = [],
}) => {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [inferenceStatus, setInferenceStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [inferenceResult, setInferenceResult] = useState('');
  const [inferenceReasoning, setInferenceReasoning] = useState('');
  const [inferenceError, setInferenceError] = useState('');
  const [includeFiles, setIncludeFiles] = useState(false);

  const buildFileContext = useCallback(async (): Promise<string> => {
    if (!includeFiles || selectedFilePaths.length === 0) return '';
    try {
      const filePromises = selectedFilePaths.map(async (filePath) => {
        try {
          const fileData = await window.electronAPI.readFile(filePath);
          const relPath = getRelativePath(filePath, rootFolder).replace(/\\/g, '/');
          const relativePath = '<project_root>/' + relPath;
          const sanitizedContent = sanitizeText(fileData.content);
          return `<file path="${relativePath}">\n${sanitizedContent}\n</file>`;
        } catch (error) {
          const relativePath = getRelativePath(filePath, rootFolder);
          return `<file path="${relativePath}">\nError loading file: ${getErrorMessage(error)}\n</file>`;
        }
      });
      const fileContents = await Promise.all(filePromises);
      return '\n\n<referenced_files>\n' + fileContents.join('\n\n') + '\n</referenced_files>';
    } catch {
      return '';
    }
  }, [includeFiles, selectedFilePaths, rootFolder]);

  const handleStartInference = useCallback(async (model: string, temperature: number) => {
    if (!userPrompt.trim()) return;

    setInferenceStatus('running');
    setInferenceResult('');
    setInferenceReasoning('');
    setInferenceError('');

    try {
      const fileContext = await buildFileContext();
      const fullUserPrompt = userPrompt.trim() + fileContext;
      const sysPrompt = systemPrompt.trim() || 'You are a helpful assistant.';

      const result = await window.electronAPI.callOpenRouter(
        sysPrompt,
        fullUserPrompt,
        model,
        { temperature }
      );

      setInferenceResult(result.content || result.text || '');
      if (result.reasoning) setInferenceReasoning(result.reasoning);
      setInferenceStatus('success');
    } catch (error) {
      setInferenceError(getErrorMessage(error));
      setInferenceStatus('error');
    }
  }, [systemPrompt, userPrompt, buildFileContext]);

  return (
    <div className="tab-panel inference-tab" style={{ padding: '20px', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <h3 style={{ margin: 0 }}>Inference</h3>
        <InferenceControls
          rootFolder={rootFolder ?? null}
          onStartInference={handleStartInference}
          disabled={inferenceStatus === 'running' || !userPrompt.trim()}
        />
      </div>

      <div className="prompt-input-group" style={{ marginBottom: '12px' }}>
        <label htmlFor="inf-system-prompt">System Prompt</label>
        <textarea
          id="inf-system-prompt"
          className="prompt-textarea"
          style={{ minHeight: '60px' }}
          placeholder="Optional system prompt..."
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={2}
        />
      </div>

      <div className="prompt-input-group" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label htmlFor="inf-user-prompt">
            User Prompt <span className="required-marker">*</span>
          </label>
          {selectedFilePaths.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#ccc', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={includeFiles}
                onChange={(e) => setIncludeFiles(e.target.checked)}
              />
              Include {selectedFilePaths.length} selected file{selectedFilePaths.length !== 1 ? 's' : ''}
            </label>
          )}
        </div>
        <textarea
          id="inf-user-prompt"
          className="prompt-textarea"
          style={{ minHeight: '120px' }}
          placeholder="Enter your prompt here..."
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          rows={4}
        />
      </div>

      {inferenceStatus === 'running' && (
        <div className="inference-loading" style={{ padding: '12px 0' }}>Running inference…</div>
      )}

      {inferenceStatus === 'error' && (
        <div className="inference-result-area">
          <span className="error">{inferenceError}</span>
        </div>
      )}

      {inferenceStatus === 'success' && (
        <>
          {inferenceReasoning && (
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Reasoning</label>
              <div className="inference-result-area" style={{ maxHeight: '150px', color: '#aaa' }}>
                {inferenceReasoning}
              </div>
            </div>
          )}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Result</label>
              <button
                className="toolbar-button"
                onClick={() => navigator.clipboard.writeText(inferenceResult)}
                style={{ padding: '3px 8px', fontSize: '11px' }}
              >
                Copy
              </button>
            </div>
            <div className="inference-result-area" style={{ maxHeight: '400px' }}>
              {inferenceResult}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default InferenceTab;