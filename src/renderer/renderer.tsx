import React, { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import Sidebar from './components/Sidebar';
import FileManager from './components/FileManager';
import './styles/main.css';
import './styles/file_tree.css';
import './styles/file_manager.css';

const App: React.FC = () => {
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const isResizingRef = useRef(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const newWidth = Math.max(180, Math.min(600, e.clientX));
    setSidebarWidth(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
  };

  const handleFileSelect = (filePath: string) => {
    setCurrentFile(filePath);
  };
  const handleSelectedPathsChange = (paths: string[]) => {
    setSelectedFilePaths(paths);
  };

  return (
    <div
      className="app-container"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <Sidebar
        onFileSelect={handleFileSelect}
        currentPath={currentPath}
        onFolderOpen={setCurrentPath}
        onSelectedPathsChange={handleSelectedPathsChange}
      />
      <div
        className="resizer"
        onMouseDown={handleMouseDown}
      />
      <div className="main-content">
        <FileManager
          filePath={currentFile}
          rootFolder={currentPath}
          selectedFilePaths={selectedFilePaths}
        />
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);