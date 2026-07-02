// tabs/FileEditorTab.tsx
import React, { useState, useEffect } from 'react';

interface FileEditorTabProps {
  filePath: string;
  relativePath: string;
  fileName: string;
  content?: string;           // initial content from load
  onBackToOverview: () => void;
  selectedCount: number;
}

const FileEditorTab: React.FC<FileEditorTabProps> = ({
  filePath,
  relativePath,
  fileName,
  content: initialContent = '',
  onBackToOverview,
  selectedCount,
}) => {
  const [text, setText] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset editor when file changes
  useEffect(() => {
    setText(initialContent);
    setIsDirty(false);
    setSaveStatus('idle');
    setErrorMsg(null);
  }, [filePath, initialContent]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setIsDirty(e.target.value !== initialContent);
  };

  const handleSave = async () => {
    if (!isDirty) return;

    setSaveStatus('saving');
    setErrorMsg(null);

    try {
      const result = await window.electronAPI.writeFile(filePath, text);
      setIsDirty(false);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: any) {
      setSaveStatus('error');
      setErrorMsg(err.message || 'Failed to save file');
    }
  };

  return (
    <div className="tab-panel file-editor">
      <div className="file-header">
        <div className="file-title-group">
          <h3>{fileName}</h3>
          <div className="file-path" title={filePath}>
            {relativePath}
          </div>
        </div>

        <div className="file-actions">
          {selectedCount > 0 && (
            <button className="back-btn" onClick={onBackToOverview}>
              ← Back to Selected ({selectedCount})
            </button>
          )}

          <button
            className={`save-btn ${isDirty ? 'dirty' : ''} ${saveStatus}`}
            onClick={handleSave}
            disabled={!isDirty || saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving...' :
             saveStatus === 'success' ? 'Saved ✓' :
             saveStatus === 'error' ? 'Save failed' :
             'Save'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="save-error-banner">
          {errorMsg}
        </div>
      )}

      <div className="file-editor-area">
        <textarea
          className="text-editor"
          value={text}
          onChange={handleTextChange}
          spellCheck={false}
          autoFocus
        />
      </div>
    </div>
  );
};

export default FileEditorTab;