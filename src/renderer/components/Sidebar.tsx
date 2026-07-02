import React from 'react';
import FileTree from './FileTree';

interface SidebarProps {
  onFileSelect: (filePath: string) => void;
  currentPath: string;
  onFolderOpen: (path: string) => void;
  onSelectedPathsChange?: (paths: string[]) => void;
  previewedFile?: string | null;
}

const Sidebar: React.FC<SidebarProps> = ({
  onFileSelect,
  currentPath,
  onFolderOpen,
  onSelectedPathsChange,
  previewedFile
}) => {
  return (
    <div className="sidebar">
      <FileTree
        rootPath={currentPath}
        onFileSelect={onFileSelect}
        onFolderOpen={onFolderOpen}
        onSelectedPathsChange={onSelectedPathsChange}
        previewedFilePath={previewedFile}
      />
      <div className="sidebar-footer">
        <div className="current-path">
          <small>Current: {currentPath || 'No folder open'}</small>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;