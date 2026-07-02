// FileManager.tsx - UPDATED
import React, { useState, useEffect } from 'react';
import { FileContent } from '../../shared/types';
import { getErrorMessage, getRelativePath } from '../../shared/utils';
import { OverviewTab, PromptOrganizerTab, FileEditorTab } from './tabs';

interface FileManagerProps {
  filePath: string | null;
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  onTabChange?: (tabIndex: number) => void;
}

const FileManager: React.FC<FileManagerProps> = ({
  filePath,
  rootFolder,
  selectedFilePaths = [],
  onTabChange,
}) => {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    if (filePath) {
      loadFile(filePath);
    } else {
      setContent(null);
    }
  }, [filePath]);

  const handleTabChange = (tabIndex: number) => {
    setActiveTab(tabIndex);
    onTabChange?.(tabIndex);
  };

  const loadFile = async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const stats = await window.electronAPI.getFileStats(path);

      if (stats.isDirectory) {
        setError('Selected item is a directory');
        setContent(null);
        return;
      }

      if (stats.size > 10 * 1024 * 1024) {
        setError('File is too large to display (max 10MB)');
        setContent(null);
        return;
      }

      const fileData = await window.electronAPI.readFile(path);
      setContent(fileData);
    } catch (err: unknown) {
      setError(`Error loading file: ${getErrorMessage(err)}`);
      setContent(null);
    } finally {
      setLoading(false);
    }
  };

  const headerText = `File Manager${rootFolder ? ` - ${rootFolder}` : ''}`;

  // Tab titles
  const overviewTabName = selectedFilePaths.length === 0
    ? 'Overview'
    : `Overview (${selectedFilePaths.length} selected)`;

  const promptOrganizerTabName = 'Prompt Organizer';

  const fileEditorTabName = filePath ? getRelativePath(filePath, rootFolder) : 'No file selected';

  return (
    <div className="file-manager">
      <div className="header-bar">{headerText}</div>

      <div className="tabs-container">
        <div className="tab-list">
          <button
            className={`tab ${activeTab === 0 ? 'active' : ''}`}
            onClick={() => handleTabChange(0)}
          >
            {overviewTabName}
          </button>

          <button
            className={`tab ${activeTab === 1 ? 'active' : ''}`}
            onClick={() => handleTabChange(1)}
            disabled={selectedFilePaths.length === 0} // Disable if no files selected
            title={selectedFilePaths.length === 0 ? "Select files to enable this tab" : promptOrganizerTabName}
          >
            {promptOrganizerTabName}
            {selectedFilePaths.length > 0 && (
              <span className="tab-badge">{selectedFilePaths.length}</span>
            )}
          </button>

          <button
            className={`tab ${activeTab === 2 ? 'active' : ''}`}
            onClick={() => handleTabChange(2)}
            disabled={!filePath}
            title={filePath ?? undefined}
          >
            {fileEditorTabName}
          </button>
        </div>

        <div className="tab-content">
          {loading && activeTab === 1 ? (
            <div className="loading-overlay">
              <div className="loading-spinner">Loading...</div>
            </div>
          ) : error && activeTab === 1 ? (
            <div className="error-message">{error}</div>
          ) : (
            <>
              {activeTab === 0 && (
                <OverviewTab
                  selectedFilePaths={selectedFilePaths}
                  rootFolder={rootFolder}
                />
              )}

              {activeTab === 1 && (
                <PromptOrganizerTab
                  selectedFilePaths={selectedFilePaths}
                  rootFolder={rootFolder}
                  onBackToOverview={() => handleTabChange(0)}
                />
              )}


              {activeTab === 2 && filePath && (
                <FileEditorTab
                  filePath={filePath}
                  relativePath={getRelativePath(filePath, rootFolder)}
                  fileName={fileEditorTabName.split(/[\\/]/).pop() || 'Untitled'}
                  content={content?.content}
                  onBackToOverview={() => handleTabChange(0)}
                  selectedCount={selectedFilePaths.length}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileManager;