import React, { useState, useEffect, useCallback } from 'react';
import { FileContent } from '../../shared/types';
import { getErrorMessage, getRelativePath } from '../../shared/utils';
import { PromptOrganizerTab, InferenceTab, SettingsTab, AboutTab, EditorTab } from './tabs';
import FilePreviewOverlay from './FilePreviewOverlay';

interface FileManagerProps {
  filePath: string | null;
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  onTabChange?: (tabIndex: number) => void;
  onPreviewChange?: (filePath: string | null) => void;
  editorFilePath?: string | null;
}

const FileManager: React.FC<FileManagerProps> = ({
  filePath,
  rootFolder,
  selectedFilePaths = [],
  onTabChange,
  onPreviewChange,
  editorFilePath,
}) => {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tab indices: 0=Editor, 1=Prompt, 2=Inference, 3=Settings, 4=About
  const [activeTab, setActiveTab] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [inferenceResult, setInferenceResult] = useState('');
  const [inferenceReasoning, setInferenceReasoning] = useState('');
  const [inferenceError, setInferenceError] = useState('');
  const [inferenceStatus, setInferenceStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [inferenceLastSaveTime, setInferenceLastSaveTime] = useState<number | null>(null);
  const [isSingleBlockReplacementMode, setIsSingleBlockReplacementMode] = useState(false);

  // Dynamic editor tab title: file name from editorFilePath or 'Editor'
  const editorTabTitle = editorFilePath
    ? (editorFilePath.split(/[\\/]/).pop() || 'Editor')
    : 'Editor';

  useEffect(() => {
    if (showPreview) closePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolder]);

  useEffect(() => {
    if (!rootFolder) return;
    const loadInferenceState = async () => {
      try {
        const folderState = await window.electronAPI.getFolderState(rootFolder);
        if (folderState) {
          setInferenceResult(folderState.inferenceResult || '');
          setInferenceReasoning(folderState.inferenceReasoning || '');
          setInferenceError(folderState.inferenceError || '');
          setInferenceStatus(folderState.inferenceStatus || 'idle');
          setIsSingleBlockReplacementMode(Boolean(folderState.lastInferenceWasSingleBlockReplacement));
        } else {
          setInferenceResult('');
          setInferenceReasoning('');
          setInferenceError('');
          setInferenceStatus('idle');
          setIsSingleBlockReplacementMode(false);
        }
      } catch (e) {
        console.error('Failed to load inference state:', e);
      }
    };
    loadInferenceState();
  }, [rootFolder]);

  useEffect(() => {
    if (!rootFolder) return;
    const timer = setTimeout(async () => {
      try {
        const now = Date.now();
        const currentState = await window.electronAPI.getFolderState(rootFolder) || {};
        await window.electronAPI.saveFolderState(rootFolder, {
          ...currentState,
          inferenceResult,
          inferenceReasoning,
          inferenceError,
          inferenceStatus,
          inferenceResultSavedAt: now,
        });
        setInferenceLastSaveTime(now);
      } catch (e) {
        console.error('Failed to save inference state:', e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [rootFolder, inferenceResult, inferenceReasoning, inferenceError, inferenceStatus, isSingleBlockReplacementMode]);

  const closePreview = useCallback(() => {
    setShowPreview(false);
    setContent(null);
    onPreviewChange?.(null);
  }, [onPreviewChange]);

  const handleClearInferenceResult = () => {
    setInferenceResult('');
    setInferenceReasoning('');
    setInferenceError('');
    setInferenceStatus('idle');
  };

  const handleCancelInference = useCallback(async () => {
    try { await window.electronAPI.cancelOpenRouter(); } catch (e) { console.error('Failed to cancel inference:', e); }
    setInferenceStatus('idle');
    setInferenceError('');
  }, []);

  // Switch to Prompt tab (index 1)
  const handleSwitchToPrompt = useCallback(() => { setActiveTab(1); }, []);

  useEffect(() => {
    if (filePath) {
      loadFile(filePath);
    } else {
      setContent(null);
      setShowPreview(false);
      onPreviewChange?.(null);
    }
  }, [filePath]);

  const handleTabChange = (tabIndex: number) => {
    setActiveTab(tabIndex);
    onTabChange?.(tabIndex);
  };

  // Switch to Inference tab (index 2)
  const handleSwitchToInference = () => { handleTabChange(2); };

  const loadFile = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const stats = await window.electronAPI.getFileStats(path);
      if (stats.isDirectory) { setError('Selected item is a directory'); setContent(null); return; }
      if (stats.size > 10 * 1024 * 1024) { setError('File is too large to display (max 10MB)'); setContent(null); return; }
      const fileData = await window.electronAPI.readFile(path);
      setContent(fileData);
      setShowPreview(true);
      onPreviewChange?.(path);
    } catch (err: unknown) {
      setError(`Error loading file: ${getErrorMessage(err)}`);
      setContent(null);
    } finally {
      setLoading(false);
    }
  };

  const headerText = `Location${rootFolder ? ` - ${rootFolder}` : ''}`;

  return (
    <div className="file-manager" style={{ position: 'relative' }}>
      <div className="header-bar">{headerText}</div>

      <div className="tabs-container">
        <div className="tab-list">
          {/* Tab 0: Editor */}
          <button
            className={`tab ${activeTab === 0 ? 'active' : ''}`}
            onClick={() => handleTabChange(0)}
            title={editorFilePath ? `Editing: ${editorFilePath}` : 'Single-click a file in Explorer to open it for editing'}
          >
            {editorTabTitle}
          </button>

          {/* Tab 1: Prompt */}
          <button
            className={`tab ${activeTab === 1 ? 'active' : ''}`}
            onClick={() => handleTabChange(1)}
            title="Open the prompt organizer tab"
          >
            Prompt
            {selectedFilePaths.length > 0 && (
              <span className="tab-badge">{selectedFilePaths.length}</span>
            )}
          </button>

          {/* Tab 2: Inference */}
          <button
            className={`tab ${activeTab === 2 ? 'active' : ''}`}
            onClick={() => handleTabChange(2)}
            title="Monitor inference process"
          >
            Inference
          </button>

          {/* Tab 3: Settings */}
          <button
            className={`tab ${activeTab === 3 ? 'active' : ''}`}
            onClick={() => handleTabChange(3)}
            title="Open settings"
          >
            Settings
          </button>

          {/* Tab 4: About */}
          <button
            className={`tab ${activeTab === 4 ? 'active' : ''}`}
            onClick={() => handleTabChange(4)}
            title="About Seeker UI"
          >
            About
          </button>
        </div>

        <div className="tab-content">
          {loading && activeTab === 1 ? (
            <div className="loading-overlay"><div className="loading-spinner">Loading...</div></div>
          ) : error && activeTab === 1 ? (
            <div className="error-message">{error}</div>
          ) : (
            <>
              {activeTab === 0 && (
                <EditorTab
                  filePath={editorFilePath ?? null}
                  rootFolder={rootFolder}
                />
              )}

              {activeTab === 1 && (
                <PromptOrganizerTab
                  selectedFilePaths={selectedFilePaths}
                  rootFolder={rootFolder}
                  onBackToOverview={() => handleTabChange(1)}
                  onSwitchToInference={handleSwitchToInference}
                  onInferenceStatusChange={(status, result, reasoning, error, isSingleBlockReplacement) => {
                    setInferenceStatus(status);
                    setInferenceResult(result ?? '');
                    setInferenceReasoning(reasoning ?? '');
                    setInferenceError(error ?? '');
                    if (isSingleBlockReplacement !== undefined) setIsSingleBlockReplacementMode(isSingleBlockReplacement);
                  }}
                />
              )}

              {activeTab === 2 && (
                <InferenceTab
                  rootFolder={rootFolder}
                  selectedFilePaths={selectedFilePaths}
                  inferenceResult={inferenceResult}
                  inferenceReasoning={inferenceReasoning}
                  inferenceError={inferenceError}
                  inferenceStatus={inferenceStatus}
                  onClearResult={handleClearInferenceResult}
                  onCancelInference={handleCancelInference}
                  onSwitchToPrompt={handleSwitchToPrompt}
                  inferenceLastSavedTimestamp={inferenceLastSaveTime}
                  isSingleBlockReplacementMode={isSingleBlockReplacementMode}
                />
              )}

              {activeTab === 3 && <SettingsTab />}

              {activeTab === 4 && <AboutTab />}
            </>
          )}
        </div>
      </div>

      {showPreview && content && (
        <FilePreviewOverlay
          filePath={filePath}
          rootFolder={rootFolder}
          content={content}
          onClose={closePreview}
        />
      )}
    </div>
  );
};

export default FileManager;
