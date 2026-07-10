import React from 'react';
import FileTree from './FileTree';

interface SidebarProps {
  currentPath: string;
  onFolderOpen: (path: string) => void;
  onSelectedPathsChange?: (paths: string[]) => void;
  onSingleClickFile?: (filePath: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onFolderOpen,
  onSelectedPathsChange,
  onSingleClickFile,
}) => {
  return (
    <div className="sidebar">
      <FileTree
        rootPath={currentPath}
        onFolderOpen={onFolderOpen}
        onSelectedPathsChange={onSelectedPathsChange}
        onSingleClickFile={onSingleClickFile}
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