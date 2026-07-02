import React from 'react';
import FileTree from './FileTree';

interface SidebarProps {
  onFileSelect: (filePath: string) => void;
  currentPath: string;
  onFolderOpen: (path: string) => void;
  onSelectedPathsChange?: (paths: string[]) => void; // Add this
}

const Sidebar: React.FC<SidebarProps> = ({
  onFileSelect,
  currentPath,
  onFolderOpen,
  onSelectedPathsChange
}) => {
  return (
    <div className="sidebar">
      <FileTree
        rootPath={currentPath}
        onFileSelect={onFileSelect}
        onFolderOpen={onFolderOpen}
        onSelectedPathsChange={onSelectedPathsChange} // Pass to FileTree
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