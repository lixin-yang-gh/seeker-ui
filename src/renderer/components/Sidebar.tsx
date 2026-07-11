import React, { useRef } from 'react';
import FileTree, { FileTreeHandle } from './FileTree';

interface SidebarProps {
  currentPath: string;
  onFolderOpen: (path: string) => void;
  onBeforeFolderChange?: (newPath: string) => Promise<boolean>;
  onSelectedPathsChange?: (paths: string[]) => void;
  onSingleClickFile?: (filePath: string) => void;
  onEditFile?: (filePath: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onFolderOpen,
  onBeforeFolderChange,
  onSelectedPathsChange,
  onSingleClickFile,
  onEditFile,
}) => {
  const fileTreeRef = useRef<FileTreeHandle>(null);

  return (
    <div className="sidebar">
      <FileTree
        ref={fileTreeRef}
        rootPath={currentPath}
        onFolderOpen={onFolderOpen}
        onBeforeFolderChange={onBeforeFolderChange}
        onSelectedPathsChange={onSelectedPathsChange}
        onSingleClickFile={onSingleClickFile}
        onEditFile={onEditFile}
      />
      <div className="sidebar-footer">
        <div className="current-path">
          <small>Current: {currentPath || 'No folder open'}</small>
        </div>
        <button
          className="sidebar-create-file-btn"
          onClick={() => fileTreeRef.current?.openCreateFileModal(currentPath)}
          disabled={!currentPath}
          title="Create a new file in the root folder"
        >
          📄+ New File
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
