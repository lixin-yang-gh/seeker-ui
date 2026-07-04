import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem } from '../../shared/types';
import { checkFileExists } from '../../shared/utils';

interface FileTreeProps {
  rootPath: string;
  onFileSelect: (filePath: string) => void;
  onFolderOpen?: (path: string) => void;
  onSelectedPathsChange?: (paths: string[]) => void;
  previewedFilePath?: string | null;
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }
};

const sortFileItems = (items: FileItem[]): FileItem[] => {
  const folders = items.filter(i => i.isDirectory).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const files = items.filter(i => i.isFile).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return [...folders, ...files];
};

const FileTree: React.FC<FileTreeProps> = ({
  rootPath,
  onFileSelect,
  onFolderOpen,
  onSelectedPathsChange,
  previewedFilePath
}) => {
  const [tree, setTree] = useState<FileItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());
  const [highlightedFile, setHighlightedFile] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentlyCopied, setRecentlyCopied] = useState<string | null>(null);

  const prevSelectedPathsRef = useRef<string[]>([]);
  const selectedFilePathsRef = useRef<Set<string>>(selectedFilePaths);
  selectedFilePathsRef.current = selectedFilePaths;

  useEffect(() => {
    const loadLastOpenedFolder = async () => {
      try {
        const lastFolder = await window.electronAPI.getLastOpenedFolder();
        if (lastFolder) {
          try {
            const stats = await window.electronAPI.getFileStats(lastFolder);
            if (stats.isDirectory) {
              await loadDirectory(lastFolder);
              onFolderOpen?.(lastFolder);
            }
          } catch {
            console.warn('Last opened folder no longer exists:', lastFolder);
          }
        }
      } catch (error) {
        console.error('Error loading last opened folder:', error);
      } finally {
        setIsInitialized(true);
      }
    };
    if (!isInitialized) loadLastOpenedFolder();
  }, [isInitialized, onFolderOpen]);

  useEffect(() => {
    const currentPaths = Array.from(selectedFilePaths);
    const prevPaths = prevSelectedPathsRef.current;
    if (onSelectedPathsChange &&
      (currentPaths.length !== prevPaths.length || !currentPaths.every((p, i) => p === prevPaths[i]))) {
      onSelectedPathsChange(currentPaths);
      prevSelectedPathsRef.current = currentPaths;
    }
  }, [selectedFilePaths, onSelectedPathsChange]);

  useEffect(() => {
    if (rootPath && isInitialized) loadDirectory(rootPath);
  }, [rootPath, isInitialized]);

  const loadDirectory = async (dirPath: string) => {
    try {
      await window.electronAPI.saveLastOpenedFolder(dirPath);
      const items = await window.electronAPI.readDirectory(dirPath);
      const itemsWithState = items.map(item => ({
        ...item,
        isChecked: selectedFilePathsRef.current.has(item.path),
        isHighlighted: false
      }));
      setTree(sortFileItems(itemsWithState));
      onFolderOpen?.(dirPath);
    } catch (error) {
      console.error('Error loading directory:', error);
    }
  };

  // Recursively load all children for a folder path, returning populated FileItem[]
  const loadAllChildren = async (folderPath: string): Promise<FileItem[]> => {
    const raw = await window.electronAPI.readDirectory(folderPath);
    const sorted = sortFileItems(raw.map(item => ({ ...item, isChecked: false, isHighlighted: false })));
    const result: FileItem[] = [];
    for (const item of sorted) {
      if (item.isDirectory) {
        const children = await loadAllChildren(item.path);
        result.push({ ...item, children });
      } else {
        result.push(item);
      }
    }
    return result;
  };

  // Collect all file paths recursively from a populated FileItem subtree
  const collectAllFilePaths = (items: FileItem[]): string[] => {
    const paths: string[] = [];
    for (const item of items) {
      if (item.isFile) paths.push(item.path);
      if (item.children) paths.push(...collectAllFilePaths(item.children));
    }
    return paths;
  };

  // Collect all folder paths recursively
  const collectAllFolderPaths = (items: FileItem[]): string[] => {
    const paths: string[] = [];
    for (const item of items) {
      if (item.isDirectory) {
        paths.push(item.path);
        if (item.children) paths.push(...collectAllFolderPaths(item.children));
      }
    }
    return paths;
  };

  // Mark all items in subtree as checked
  const markAllChecked = (items: FileItem[], checked: boolean): FileItem[] =>
    items.map(item => ({
      ...item,
      isChecked: checked,
      children: item.children ? markAllChecked(item.children, checked) : undefined
    }));

  const updateTreeItem = (items: FileItem[], targetPath: string, updates: Partial<FileItem>): FileItem[] =>
    items.map(item => {
      if (item.path === targetPath) return { ...item, ...updates };
      if (item.children) return { ...item, children: updateTreeItem(item.children, targetPath, updates) };
      return item;
    });

  const updateTreeItemWithChildren = (
    items: FileItem[],
    targetPath: string,
    newItem: FileItem
  ): FileItem[] =>
    items.map(item => {
      if (item.path === targetPath) return newItem;
      if (item.children) return { ...item, children: updateTreeItemWithChildren(item.children, targetPath, newItem) };
      return item;
    });

  // Handle folder checkbox: recursively select all subfolders+files, expand entire subtree
  const handleFolderCheckboxChange = useCallback(async (item: FileItem, checked: boolean) => {
    try {
      // Load full recursive subtree
      const children = await loadAllChildren(item.path);
      const populatedFolder: FileItem = { ...item, isChecked: checked, children: markAllChecked(children, checked) };

      // Collect all folder paths to expand
      const allFolderPaths = [item.path, ...collectAllFolderPaths(children)];

      // Collect all file paths
      const allFilePaths = collectAllFilePaths(children);
      if (item.isFile) allFilePaths.push(item.path); // shouldn't happen but guard

      // Update expanded folders
      setExpandedFolders(prev => {
        const next = new Set(prev);
        if (checked) {
          allFolderPaths.forEach(p => next.add(p));
        } else {
          // keep existing expansions; optionally collapse — per spec only expand on check
        }
        return next;
      });

      // Update tree with fully populated subtree
      setTree(prev => updateTreeItemWithChildren(prev, item.path, populatedFolder));

      // Update selected file paths
      setSelectedFilePaths(prev => {
        const next = new Set(prev);
        if (checked) {
          allFilePaths.forEach(p => next.add(p));
        } else {
          allFilePaths.forEach(p => next.delete(p));
        }
        return next;
      });

    } catch (error) {
      console.error('Error handling folder checkbox:', error);
    }
  }, []);

  const handleFileCheckboxChange = useCallback((item: FileItem, checked: boolean) => {
    setSelectedFilePaths(prev => {
      const next = new Set(prev);
      checked ? next.add(item.path) : next.delete(item.path);
      return next;
    });
    setTree(prev => updateTreeItem(prev, item.path, { isChecked: checked }));
  }, []);

  // isFolderChecked: true only if all recursive files are selected
  const isFolderChecked = useCallback((folder: FileItem): boolean => {
    if (!folder.children || folder.children.length === 0) return false;
    const allFiles = collectAllFilePaths(folder.children);
    if (allFiles.length === 0) return false;
    return allFiles.every(p => selectedFilePaths.has(p));
  }, [selectedFilePaths]);

  const handleRefresh = useCallback(async () => {
    if (!rootPath || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const selectedBefore = Array.from(selectedFilePathsRef.current);
      // Validate which files still exist
      const valid: string[] = [];
      for (const fp of selectedBefore) {
        if (await checkFileExists(fp)) valid.push(fp);
      }
      // Rebuild the entire tree recursively to reflect file system changes
      const newTree = await loadAllChildren(rootPath);
      // Apply isChecked based on valid set
      const applyChecked = (items: FileItem[]): FileItem[] =>
        items.map(item => ({
          ...item,
          isChecked: valid.includes(item.path),
          children: item.children ? applyChecked(item.children) : undefined,
        }));
      setTree(applyChecked(newTree));
      setSelectedFilePaths(new Set(valid));
      await window.electronAPI.saveLastOpenedFolder(rootPath);
      onFolderOpen?.(rootPath);
    } catch (error) {
      console.error('Error during refresh:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [rootPath, isRefreshing, onFolderOpen]);

  const togglePreview = (item: FileItem) => {
    if (item.path === previewedFilePath) {
      setTree(prev => {
        const clear = (items: FileItem[]): FileItem[] =>
          items.map(i => ({ ...i, isHighlighted: false, children: i.children ? clear(i.children) : undefined }));
        return clear(prev);
      });
      setHighlightedFile(null);
      onFileSelect(null);
    } else {
      setTree(prev => {
        const clear = (items: FileItem[]): FileItem[] =>
          items.map(i => ({ ...i, isHighlighted: false, children: i.children ? clear(i.children) : undefined }));
        const highlight = (items: FileItem[], tp: string): FileItem[] =>
          items.map(i => {
            if (i.path === tp) return { ...i, isHighlighted: true };
            if (i.children) return { ...i, children: highlight(i.children, tp) };
            return i;
          });
        return highlight(clear(prev), item.path);
      });
      setHighlightedFile(item.path);
      onFileSelect(item.path);
    }
  };

  const toggleFolder = async (item: FileItem, expandOnly: boolean = false) => {
    const relativePath = item.path.replace(rootPath, '').replace(/^[\/\\]/, '').replace(/\\/g, '/');
    await copyToClipboard(`<project_root>/${relativePath}`);
    setRecentlyCopied(item.path);
    setTimeout(() => setRecentlyCopied(null), 1200);

    if (item.isDirectory) {
      const newExpanded = new Set(expandedFolders);
      if (!expandOnly && newExpanded.has(item.path)) {
        newExpanded.delete(item.path);
      } else {
        newExpanded.add(item.path);
        if (!item.children) {
          try {
            const children = await window.electronAPI.readDirectory(item.path);
            const childrenWithState = sortFileItems(children.map(c => ({
              ...c, isChecked: selectedFilePaths.has(c.path), isHighlighted: false
            })));
            setTree(prev => updateTreeItem(prev, item.path, { children: childrenWithState }));
          } catch (error) {
            console.error('Error loading folder:', error);
          }
        }
      }
      setExpandedFolders(newExpanded);
    }
    // File clicks: copy path only (preview is handled by the eye icon)
  };

  const renderTreeItem = (item: FileItem, depth: number = 0) => {
    const isExpanded = expandedFolders.has(item.path);
    const isChecked = item.isFile ? selectedFilePaths.has(item.path) : isFolderChecked(item);

    return (
      <div key={item.path}>
        <div className="tree-item" style={{ paddingLeft: `${depth * 16 + 10}px`, marginLeft: `${depth * 1}px` }}>
          <input
            type="checkbox"
            className="tree-checkbox"
            checked={isChecked}
            onChange={(e) => {
              e.stopPropagation();
              if (item.isDirectory) handleFolderCheckboxChange(item, e.target.checked);
              else handleFileCheckboxChange(item, e.target.checked);
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className={`tree-item-content ${item.isHighlighted ? 'highlighted' : ''} ${recentlyCopied === item.path ? 'copied' : ''}`}
            onClick={() => toggleFolder(item)}
            style={{ padding: '2px 4px' }}
          >
            {item.isDirectory && <span className="folder-icon">{isExpanded ? '📂' : '📁'}</span>}
            <span className="item-name">{item.name}</span>
            {item.isFile && (
              <span
                className={`file-icon eye-icon ${item.path === previewedFilePath ? 'previewed' : ''}`}
                onClick={(e) => { e.stopPropagation(); togglePreview(item); }}
                title={item.path === previewedFilePath ? "Close preview" : "Preview file"}
              >
                {item.path === previewedFilePath ? '✕' : '👁'}
              </span>
            )}
            {recentlyCopied === item.path && <span className="copied-indicator">✓ path copied</span>}
            {item.isDirectory && item.children && (
              <span className="selection-badge">{item.children.filter(c => c.isFile).length}</span>
            )}
          </div>
        </div>
        {item.isDirectory && isExpanded && item.children && (
          <div className="tree-children">
            {item.children.map(child => renderTreeItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="file-tree">
      <div className="tree-header">
        <h3>Explorer</h3>
        <div className="tree-header-actions">
          <button className="button" onClick={async () => {
            const path = await window.electronAPI.openDirectory();
            if (path) {
              loadDirectory(path);
              setSelectedFilePaths(new Set());
              setHighlightedFile(null);
              setExpandedFolders(new Set());
            }
          }} title="Open a folder to browse files">Open Folder</button>
          <button className="button" onClick={() => {
            setSelectedFilePaths(new Set());
            setHighlightedFile(null);
            setTree(prev => {
              const clear = (items: FileItem[]): FileItem[] =>
                items.map(i => ({ ...i, isChecked: false, isHighlighted: false, children: i.children ? clear(i.children) : undefined }));
              return clear(prev);
            });
          }} title="Clear all file selections">Clear</button>
          <button
            className={`button ${isRefreshing ? 'refreshing' : ''}`}
            onClick={handleRefresh}
            disabled={isRefreshing || !rootPath}
            title={isRefreshing ? 'Refreshing...' : 'Refresh folder and selection'}
          >
            {isRefreshing ? '↻ Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>
      <div className="tree-stats">
        <small>
          Selected: <strong>{selectedFilePaths.size}</strong> files |
          Highlighted: <strong>{highlightedFile ? '1' : '0'}</strong> file
          {isRefreshing && <span className="loading-indicator"> Refreshing...</span>}
        </small>
        {!isInitialized && <span className="loading-indicator">Loading last folder...</span>}
      </div>
      <div className="tree-content">
        {tree.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontStyle: 'italic' }}>
            {isInitialized ? 'No folder opened' : 'Loading...'}
          </div>
        ) : (
          tree.map(item => renderTreeItem(item))
        )}
      </div>
    </div>
  );
};

export default FileTree;