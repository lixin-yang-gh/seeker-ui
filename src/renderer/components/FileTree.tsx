import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem } from '../../shared/types';
import { checkFileExists } from '../../shared/utils';

interface FileTreeProps {
  rootPath: string;
  onFileSelect: (filePath: string) => void;
  onFolderOpen?: (path: string) => void;
  onSelectedPathsChange?: (paths: string[]) => void;
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    console.log(`Copied to clipboard: ${text}`);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }
};

const sortFileItems = (items: FileItem[]): FileItem[] => {
  const folders = items
    .filter(item => item.isDirectory)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const files = items
    .filter(item => item.isFile)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return [...folders, ...files];
};

const FileTree: React.FC<FileTreeProps> = ({
  rootPath,
  onFileSelect,
  onFolderOpen,
  onSelectedPathsChange
}) => {
  const [tree, setTree] = useState<FileItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());
  const [highlightedFile, setHighlightedFile] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentlyCopied, setRecentlyCopied] = useState<string | null>(null);

  const prevSelectedPathsRef = useRef<string[]>([]);
  const lastSelectedFilesRef = useRef<string[]>([]); // Store selected files for refresh

  // Load last opened folder on initial mount
  useEffect(() => {
    const loadLastOpenedFolder = async () => {
      try {
        const lastFolder = await window.electronAPI.getLastOpenedFolder();
        if (lastFolder) {
          try {
            const stats = await window.electronAPI.getFileStats(lastFolder);
            if (stats.isDirectory) {
              await loadDirectory(lastFolder);
              if (onFolderOpen) {
                onFolderOpen(lastFolder);
              }
            }
          } catch (error) {
            console.warn('Last opened folder no longer exists:', lastFolder);
          }
        }
      } catch (error) {
        console.error('Error loading last opened folder:', error);
      } finally {
        setIsInitialized(true);
      }
    };

    if (!isInitialized) {
      loadLastOpenedFolder();
    }
  }, [isInitialized, onFolderOpen]);

  // Notify parent about selected paths changes
  useEffect(() => {
    const currentPaths = Array.from(selectedFilePaths);
    const prevPaths = prevSelectedPathsRef.current;

    // Store the current selection for refresh operations
    lastSelectedFilesRef.current = currentPaths;

    if (onSelectedPathsChange &&
      (currentPaths.length !== prevPaths.length ||
        !currentPaths.every((path, idx) => path === prevPaths[idx]))) {
      onSelectedPathsChange(currentPaths);
      prevSelectedPathsRef.current = currentPaths;
    }
  }, [selectedFilePaths, onSelectedPathsChange]);

  // Load directory initially
  useEffect(() => {
    if (rootPath && isInitialized) {
      loadDirectory(rootPath);
    }
  }, [rootPath, isInitialized]);

  const loadDirectory = async (dirPath: string) => {
    try {
      await window.electronAPI.saveLastOpenedFolder(dirPath);
      const items = await window.electronAPI.readDirectory(dirPath);
      const itemsWithState = items.map(item => ({
        ...item,
        isChecked: selectedFilePaths.has(item.path),
        isHighlighted: false
      }));
      const sortedItems = sortFileItems(itemsWithState);
      setTree(sortedItems);
      if (onFolderOpen) {
        onFolderOpen(dirPath);
      }
    } catch (error) {
      console.error('Error loading directory:', error);
    }
  };

  // NEW: Enhanced refresh function with the specified behavior
  const handleRefresh = useCallback(async () => {
    if (!rootPath || isRefreshing) return;

    setIsRefreshing(true);

    try {
      // Step 1: Record all selected files
      const selectedFilesBeforeRefresh = Array.from(selectedFilePaths);

      // Step 2: Reopen the selected root folder (same as "Open Folder" button)
      await loadDirectory(rootPath);

      // Step 3: Loop through recorded selected file list
      const validSelectedFiles: string[] = [];

      for (const filePath of selectedFilesBeforeRefresh) {
        try {
          // Detect file existence
          const exists = await checkFileExists(filePath);

          if (exists) {
            // File still exists, keep it in selection
            validSelectedFiles.push(filePath);

            // Parse file path and update File Tree visuals
            await updateFileTreeVisuals(filePath);
          } else {
            console.log(`File no longer exists: ${filePath}`);
          }
        } catch (error) {
          console.error(`Error checking file ${filePath}:`, error);
        }
      }

      // Step 4: Update selected files list with only existing files
      setSelectedFilePaths(new Set(validSelectedFiles));

      // Update tree checkboxes to reflect current selection
      setTree(prevTree => {
        const updateTreeWithSelection = (items: FileItem[]): FileItem[] => {
          return items.map(item => ({
            ...item,
            isChecked: validSelectedFiles.includes(item.path),
            children: item.children ? updateTreeWithSelection(item.children) : undefined
          }));
        };
        return updateTreeWithSelection(prevTree);
      });

      // Also restore expanded folders
      await restoreExpandedFolders();

    } catch (error) {
      console.error('Error during refresh:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [rootPath, isRefreshing, selectedFilePaths]);

  // Helper to restore expanded folders after refresh
  const restoreExpandedFolders = useCallback(async () => {
    const newExpanded = new Set<string>();

    // Restore previously expanded folders if they still exist
    for (const folderPath of expandedFolders) {
      try {
        const stats = await window.electronAPI.getFileStats(folderPath);
        if (stats.isDirectory) {
          newExpanded.add(folderPath);
        }
      } catch (error) {
        // Folder no longer exists, skip it
        console.log(`Folder no longer exists: ${folderPath}`);
      }
    }

    setExpandedFolders(newExpanded);

    // Load children for expanded folders
    for (const folderPath of newExpanded) {
      await loadFolderChildren(folderPath);
    }
  }, [expandedFolders]);

  // Helper to load folder children
  const loadFolderChildren = async (folderPath: string) => {
    try {
      const children = await window.electronAPI.readDirectory(folderPath);
      const childrenWithState = children.map(child => ({
        ...child,
        isChecked: selectedFilePaths.has(child.path),
        isHighlighted: false
      }));
      const sortedChildren = sortFileItems(childrenWithState);
      setTree(prevTree => updateTreeItem(prevTree, folderPath, {
        children: sortedChildren
      }));
    } catch (error) {
      console.error(`Error loading folder ${folderPath}:`, error);
    }
  };

  // Helper to update file tree visuals for a specific file path
  const updateFileTreeVisuals = async (filePath: string) => {
    try {
      // Check if the file still exists in the tree
      const fileExistsInTree = checkFileInTree(tree, filePath);

      if (!fileExistsInTree) {
        // File might have moved or been renamed
        // We could attempt to find it by name or other heuristics
        // For now, just log it
        console.log(`File ${filePath} not found in current tree`);
      }
    } catch (error) {
      console.error(`Error updating visuals for ${filePath}:`, error);
    }
  };

  // Helper to check if a file exists in the tree
  const checkFileInTree = (items: FileItem[], targetPath: string): boolean => {
    for (const item of items) {
      if (item.path === targetPath) {
        return true;
      }
      if (item.children) {
        if (checkFileInTree(item.children, targetPath)) {
          return true;
        }
      }
    }
    return false;
  };

  // Helper to get ONLY first-level files from a folder
  const getFirstLevelFilesFromFolder = useCallback((folder: FileItem): string[] => {
    const paths: string[] = [];

    // Only get immediate file children (not recursively)
    if (folder.children) {
      folder.children.forEach(child => {
        if (child.isFile) {
          paths.push(child.path);
        }
      });
    }

    return paths;
  }, []);

  // Handle file checkbox change
  const handleFileCheckboxChange = useCallback((item: FileItem, checked: boolean) => {
    setSelectedFilePaths(prev => {
      const newSelectedPaths = new Set(prev);

      if (checked) {
        newSelectedPaths.add(item.path);
      } else {
        newSelectedPaths.delete(item.path);
      }

      return newSelectedPaths;
    });

    // Update tree state
    setTree(prevTree => updateTreeItem(prevTree, item.path, { isChecked: checked }));
  }, []);

  // Handle folder checkbox change - UPDATED to only select first-level files
  const handleFolderCheckboxChange = useCallback(async (item: FileItem, checked: boolean) => {
    // Auto-expand folder when checkbox is clicked
    if (!expandedFolders.has(item.path)) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add(item.path);
      setExpandedFolders(newExpanded);

      // Load children if not already loaded
      if (!item.children) {
        try {
          const children = await window.electronAPI.readDirectory(item.path);
          const childrenWithState = children.map(child => ({
            ...child,
            isChecked: false,
            isHighlighted: false
          }));
          const sortedChildren = sortFileItems(childrenWithState);
          // Update tree with loaded children  
          setTree(prevTree => {
            const updatedTree = updateTreeItem(prevTree, item.path, {
              children: sortedChildren,
              isChecked: checked
            });
            // Update children's checked state  
            return updateChildrenCheckedState(updatedTree, item.path, checked, false);
          });
          // Get only first-level files  
          const firstLevelFiles = sortedChildren
            .filter(child => child.isFile)
            .map(file => file.path);

          // Update selected paths
          setSelectedFilePaths(prev => {
            const newSelectedPaths = new Set(prev);
            if (checked) {
              firstLevelFiles.forEach(path => newSelectedPaths.add(path));
            } else {
              firstLevelFiles.forEach(path => newSelectedPaths.delete(path));
            }
            return newSelectedPaths;
          });

          return;
        } catch (error) {
          console.error('Error loading folder:', error);
          return;
        }
      }
    }

    // If children already loaded
    let children = item.children;
    if (!children) {
      children = [];
    }

    // Get only first-level files
    const firstLevelFiles = children
      .filter(child => child.isFile)
      .map(file => file.path);

    // Update selected paths
    setSelectedFilePaths(prev => {
      const newSelectedPaths = new Set(prev);

      if (checked) {
        // Add only first-level file paths
        firstLevelFiles.forEach(path => newSelectedPaths.add(path));
      } else {
        // Remove only first-level file paths
        firstLevelFiles.forEach(path => newSelectedPaths.delete(path));
      }

      return newSelectedPaths;
    });

    // Update tree state for folder and its first-level children
    setTree(prevTree => {
      return updateFolderAndImmediateChildren(prevTree, item.path, checked);
    });
  }, [expandedFolders]);

  // Helper to update folder and its immediate children only
  const updateFolderAndImmediateChildren = (items: FileItem[], targetPath: string, isChecked: boolean): FileItem[] => {
    return items.map(treeItem => {
      if (treeItem.path === targetPath) {
        const updatedItem = { ...treeItem, isChecked };

        // Update only immediate file children
        if (updatedItem.children) {
          updatedItem.children = updatedItem.children.map(child => {
            if (child.isFile) {
              return { ...child, isChecked };
            }
            // Don't change checkbox state of subfolders
            return child;
          });
        }

        return updatedItem;
      }

      if (treeItem.children) {
        return {
          ...treeItem,
          children: updateFolderAndImmediateChildren(treeItem.children, targetPath, isChecked)
        };
      }

      return treeItem;
    });
  };

  // Helper to update children checked state (only files, not folders)
  const updateChildrenCheckedState = (items: FileItem[], targetPath: string, isChecked: boolean, isRecursive: boolean = false): FileItem[] => {
    return items.map(treeItem => {
      if (treeItem.path === targetPath || isRecursive) {
        const updatedItem = { ...treeItem, isChecked: treeItem.isFile ? isChecked : treeItem.isChecked };

        if (updatedItem.children) {
          updatedItem.children = updatedItem.children.map(child => ({
            ...child,
            isChecked: child.isFile ? isChecked : child.isChecked, // Only check files, not folders
            children: child.children ? updateChildrenCheckedState(child.children, targetPath, isChecked, true) : undefined
          }));
        }

        return updatedItem;
      }

      if (treeItem.children) {
        return {
          ...treeItem,
          children: updateChildrenCheckedState(treeItem.children, targetPath, isChecked, isRecursive)
        };
      }

      return treeItem;
    });
  };

  // Helper to update tree item
  const updateTreeItem = (items: FileItem[], targetPath: string, updates: Partial<FileItem>): FileItem[] => {
    return items.map(item => {
      if (item.path === targetPath) {
        return { ...item, ...updates };
      }
      if (item.children) {
        return { ...item, children: updateTreeItem(item.children, targetPath, updates) };
      }
      return item;
    });
  };

  const toggleFolder = async (item: FileItem, expandOnly: boolean = false) => {
    // Copy the relative path to clipboard when clicked
    // Get relative path by removing the rootPath from the full path
    const relativePath = item.path.replace(rootPath, '').replace(/^[\/\\]/, '').replace(/\\/g, '/');
    const fullCopiedPath = `<project_root>/${relativePath}`;
    await copyToClipboard(fullCopiedPath);
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
            const childrenWithState = children.map(child => ({
              ...child,
              isChecked: selectedFilePaths.has(child.path),
              isHighlighted: false
            }));
            const sortedChildren = sortFileItems(childrenWithState);
            setTree(prevTree => updateTreeItem(prevTree, item.path, { children: sortedChildren }));
          } catch (error) {
            console.error('Error loading folder:', error);
          }
        }
      }
      setExpandedFolders(newExpanded);
    } else {
      // Highlight file on click (for preview)
      setTree(prevTree => {
        const clearHighlights = (items: FileItem[]): FileItem[] => {
          return items.map(treeItem => ({
            ...treeItem,
            isHighlighted: false,
            children: treeItem.children ? clearHighlights(treeItem.children) : undefined
          }));
        };

        const clearedTree = clearHighlights(prevTree);

        const updateHighlight = (items: FileItem[], targetPath: string): FileItem[] => {
          return items.map(treeItem => {
            if (treeItem.path === targetPath) {
              return { ...treeItem, isHighlighted: true };
            }
            if (treeItem.children) {
              return { ...treeItem, children: updateHighlight(treeItem.children, targetPath) };
            }
            return treeItem;
          });
        };

        return updateHighlight(clearedTree, item.path);
      });

      setHighlightedFile(item.path);
      onFileSelect(item.path);
    }
  };

  // Check if folder should appear checked based on its FIRST-LEVEL file children only
  const isFolderChecked = useCallback((folder: FileItem): boolean => {
    if (!folder.children || folder.children.length === 0) {
      return false;
    }

    // Get only first-level file children
    const firstLevelFiles = folder.children.filter(child => child.isFile);
    if (firstLevelFiles.length === 0) return false;

    // Check if ALL first-level files are selected
    return firstLevelFiles.every(file => selectedFilePaths.has(file.path));
  }, [selectedFilePaths]);

  const renderTreeItem = (item: FileItem, depth: number = 0) => {
    const isExpanded = expandedFolders.has(item.path);
    const isChecked = item.isFile
      ? selectedFilePaths.has(item.path)
      : isFolderChecked(item);

    return (
      <div key={item.path}>
        <div
          className="tree-item"
          style={{
            paddingLeft: `${depth * 16 + 10}px`, // Slightly reduced indentation
            marginLeft: `${depth * 1}px` // Subtle visual indentation
          }}
        >
          {/* Checkbox */}
          <input
            type="checkbox"
            className="tree-checkbox"
            checked={isChecked}
            onChange={(e) => {
              e.stopPropagation();
              if (item.isDirectory) {
                handleFolderCheckboxChange(item, e.target.checked);
              } else {
                handleFileCheckboxChange(item, e.target.checked);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />

          {/* Folder/File icon and name */}
          <div
            className={`tree-item-content ${item.isHighlighted ? 'highlighted' : ''} ${recentlyCopied === item.path ? 'copied' : ''}`}
            onClick={() => toggleFolder(item)}
            style={{ padding: '2px 4px' }}
          >
            {item.isDirectory ? (
              <span className="folder-icon">
                {isExpanded ? '📂' : '📁'}
              </span>
            ) : (
              <span className="file-icon">📄</span>
            )}
            <span className="item-name">{item.name}</span>
            {recentlyCopied === item.path && (
              <span className="copied-indicator">✓ path copied</span>
            )}
            {item.isDirectory && item.children && (
              <span className="selection-badge">
                {item.children.filter(child => child.isFile).length}
              </span>
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
          <button
            className="button"
            onClick={async () => {
              const path = await window.electronAPI.openDirectory();
              if (path) {
                loadDirectory(path);
                setSelectedFilePaths(new Set());
                setHighlightedFile(null);
                setExpandedFolders(new Set());
              }
            }}
          >
            Open Folder
          </button>
          <button
            className="button"
            onClick={() => {
              setSelectedFilePaths(new Set());
              setHighlightedFile(null);
              setTree(prevTree => {
                const clearStates = (items: FileItem[]): FileItem[] => {
                  return items.map(item => ({
                    ...item,
                    isChecked: false,
                    isHighlighted: false,
                    children: item.children ? clearStates(item.children) : undefined
                  }));
                };
                return clearStates(prevTree);
              });
            }}
          >
            Clear
          </button>
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
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#888',
            fontStyle: 'italic'
          }}>
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