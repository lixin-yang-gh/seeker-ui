import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import Sidebar from './components/Sidebar';
import FileManager from './components/FileManager';
import EulaModal from './components/EulaModal';
import { preloadMarkdownModules } from '../shared/markdown-loader';
import './styles/main.css';
import './styles/file_tree.css';
// Forward main-process logs to the renderer DevTools console
if (window.electronAPI?.onMainLog) {
  window.electronAPI.onMainLog(({ level, msg }: { level: 'log' | 'warn' | 'error'; msg: string }) => {
    console[level]('[main]', msg);
  });
}

const App: React.FC = () => {
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [previewedFile, setPreviewedFile] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [eulaAgreed, setEulaAgreed] = useState(false);
  const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
  const fileManagerTabRef = useRef<{ setActiveTab?: (i: number) => void }>(null);
  const isResizingRef = useRef(false);

  // Preload the markdown rendering dependencies (react-markdown + remark-gfm)
  // shortly after the main window has painted and become visible, without
  // blocking initial app startup. This keeps FilePreviewOverlay's Markdown
  // preview feature snappy on first use while avoiding any impact on
  // cold-start time, since the chunk is fetched/executed in the background
  // rather than as part of the initial bundle.
  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | undefined;
    const win = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const schedulePreload = () => {
      if (cancelled) return;
      if (win.requestIdleCallback) {
        idleHandle = win.requestIdleCallback(() => {
          if (!cancelled) preloadMarkdownModules();
        });
      } else {
        setTimeout(() => {
          if (!cancelled) preloadMarkdownModules();
        }, 200);
      }
    };
    // Defer by two animation frames to ensure the main window's initial UI has
    // painted (i.e. is fully visible) before starting the background load.
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(schedulePreload);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (idleHandle !== undefined && win.cancelIdleCallback) {
        win.cancelIdleCallback(idleHandle);
      }
    };
  }, []);

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
  const handlePreviewChange = useCallback((filePath: string | null) => {
    setPreviewedFile(filePath);
  }, []);
  const handleSingleClickFile = useCallback((filePath: string) => {
    setEditorFilePath(filePath);
  }, []);

  return (
    <>
      <EulaModal onAgreed={() => setEulaAgreed(true)} />
      {eulaAgreed && (
        <div
          className="app-container"
          style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
        >
          <Sidebar
            onFileSelect={handleFileSelect}
            currentPath={currentPath}
            onFolderOpen={setCurrentPath}
            onSelectedPathsChange={handleSelectedPathsChange}
            previewedFile={previewedFile}
            onSingleClickFile={handleSingleClickFile}
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
              onPreviewChange={handlePreviewChange}
              editorFilePath={editorFilePath}
            />
          </div>
        </div>
      )}
    </>
  );
};
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);