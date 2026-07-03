// FileManager.tsx - UPDATED
import React, { useState, useEffect, useCallback } from 'react';
import { FileContent } from '../../shared/types';
import { getErrorMessage, getRelativePath } from '../../shared/utils';
import { OverviewTab, PromptOrganizerTab, InferenceTab, SettingsTab, AboutTab } from './tabs';

interface FileManagerProps {
  filePath: string | null;
  rootFolder?: string | null;
  selectedFilePaths?: string[];
  onTabChange?: (tabIndex: number) => void;
  onPreviewChange?: (filePath: string | null) => void;
}

const FileManager: React.FC<FileManagerProps> = ({
  filePath,
  rootFolder,
  selectedFilePaths = [],
  onTabChange,
  onPreviewChange,
}) => {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const closePreview = useCallback(() => {
    setShowPreview(false);
    onPreviewChange?.(null);
  }, [onPreviewChange]);

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
      setShowPreview(true);
      onPreviewChange?.(path);
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

  const promptOrganizerTabName = 'Prompt';

  return (
    <div className="file-manager" style={{ position: 'relative' }}>
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
          >
            {promptOrganizerTabName}
            {selectedFilePaths.length > 0 && (
              <span className="tab-badge">{selectedFilePaths.length}</span>
            )}
          </button>

          <button
            className={`tab ${activeTab === 2 ? 'active' : ''}`}
            onClick={() => handleTabChange(2)}
          >
            Inference
          </button>

          <button
            className={`tab ${activeTab === 3 ? 'active' : ''}`}
            onClick={() => handleTabChange(3)}
          >
            Settings
          </button>

          <button
            className={`tab ${activeTab === 4 ? 'active' : ''}`}
            onClick={() => handleTabChange(4)}
          >
            About
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

              {activeTab === 2 && (
                <InferenceTab
                  rootFolder={rootFolder}
                  selectedFilePaths={selectedFilePaths}
                />
              )}

              {activeTab === 3 && <SettingsTab />}

              {activeTab === 4 && <AboutTab />}
            </>
          )}
        </div>
      </div>
      {showPreview && content && (
        <div className="file-preview-overlay" onClick={closePreview}>
          <div className="file-preview-popup" onClick={(e) => e.stopPropagation()}>
            <div className="file-preview-header">
              <span className="file-preview-title">
                {getRelativePath(filePath, rootFolder)}
              </span>
              <button
                className="file-preview-close"
                onClick={closePreview}
                title="Close preview"
              >
                ✕
              </button>
            </div>
            <textarea
              className="file-preview-textarea"
              value={content.content}
              readOnly
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default FileManager;