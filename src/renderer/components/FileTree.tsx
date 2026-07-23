import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileItem } from '../../shared/types';
import { checkFileExists } from '../../shared/utils';

interface FileTreeProps {
  rootPath: string;
  onFolderOpen?: (path: string) => void;
  onBeforeFolderChange?: (newPath: string) => Promise<boolean>;
  onSelectedPathsChange?: (paths: string[]) => void;
  onSingleClickFile?: (filePath: string) => void;
  onEditFile?: (filePath: string) => void;
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

const getFileNameFromPath = (filePath: string): string =>
  filePath.split(/[\\/]/).pop() || filePath;

export interface FileTreeHandle {
  openCreateFileModal: (parentPath: string) => void;
  openCreateSubfolderModal: (parentPath: string) => void;
}

const FileTree = React.forwardRef<FileTreeHandle, FileTreeProps>(({ 
  rootPath,
  onFolderOpen,
  onBeforeFolderChange,
  onSelectedPathsChange,
  onSingleClickFile,
  onEditFile,
}, ref) => {
  const [tree, setTree] = useState<FileItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());
  // Tracks the last single-clicked file so its label can use the outstanding
  // opened-file highlight color across both the main tree and the Favorite
  // Files list.
  const [openedFilePath, setOpenedFilePath] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentlyCopied, setRecentlyCopied] = useState<string | null>(null);
  const [showOpenFolderModal, setShowOpenFolderModal] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileItem } | null>(null);
  // Absolute paths of favorited files for the current root folder (insertion order preserved)
  const [favoriteFiles, setFavoriteFiles] = useState<string[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  // Transient notice shown when a binary file is blocked from selection/opening.
  const [binaryNotice, setBinaryNotice] = useState<{ path: string; message: string } | null>(null);
  const binaryNoticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const prevSelectedPathsRef = useRef<string[]>([]);
  const selectedFilePathsRef = useRef<Set<string>>(selectedFilePaths);
  selectedFilePathsRef.current = selectedFilePaths;
  const favoriteFilesRef = useRef<string[]>(favoriteFiles);
  favoriteFilesRef.current = favoriteFiles;

  // Create New File modal state
  const [createFileModal, setCreateFileModal] = useState<{ parentPath: string } | null>(null);
  const [newFileName, setNewFileName] = useState('');

  // Create Subfolder modal state
  const [createSubfolderModal, setCreateSubfolderModal] = useState<{ parentPath: string } | null>(null);
  const [newSubfolderName, setNewSubfolderName] = useState('');

  // Expose imperative handle for parent components (e.g. Sidebar footer button)
  React.useImperativeHandle(ref, () => ({
    openCreateFileModal: (parentPath: string) => {
      setCreateFileModal({ parentPath });
      setNewFileName('');
    },
    openCreateSubfolderModal: (parentPath: string) => {
      setCreateSubfolderModal({ parentPath });
      setNewSubfolderName('');
    },
  }));

  // Show a short-lived notice (auto-dismisses) when a binary file is blocked.
  const showBinaryNotice = useCallback((filePath: string) => {
    const name = getFileNameFromPath(filePath);
    setBinaryNotice({ path: filePath, message: `"${name}" is a binary file and cannot be referenced or opened.` });
    if (binaryNoticeTimerRef.current) clearTimeout(binaryNoticeTimerRef.current);
    binaryNoticeTimerRef.current = setTimeout(() => setBinaryNotice(null), 3000);
  }, []);

  // Clean up the notice timer on unmount.
  useEffect(() => {
    return () => {
      if (binaryNoticeTimerRef.current) clearTimeout(binaryNoticeTimerRef.current);
    };
  }, []);

  // Returns true when the file's content is binary. On any lookup error we
  // fail open (return false) so normal text handling proceeds unimpeded.
  const isBinaryFilePath = useCallback(async (filePath: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.isBinaryFile(filePath);
      return Boolean(result?.isBinary);
    } catch (err) {
      console.error('Failed to check binary status:', err);
      return false;
    }
  }, []);

  const getProjectRootRelativePath = useCallback((filePath: string): string => {
    if (!rootPath) return filePath;
    const relativePath = filePath.replace(rootPath, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
    return `<project_root>/${relativePath}`;
  }, [rootPath]);

  const toFileItem = useCallback((filePath: string): FileItem => ({
    name: getFileNameFromPath(filePath),
    path: filePath,
    isDirectory: false,
    isFile: true,
    isChecked: selectedFilePaths.has(filePath),
  }), [selectedFilePaths]);

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

  // Load per-folder favorite files whenever the root folder changes
  useEffect(() => {
    let cancelled = false;
    setFavoritesLoaded(false);
    const loadFavorites = async () => {
      if (!rootPath) {
        if (!cancelled) {
          setFavoriteFiles([]);
          setFavoritesLoaded(true);
        }
        return;
      }
      try {
        const folderState = await window.electronAPI.getFolderState(rootPath);
        if (cancelled) return;
        const saved = Array.isArray(folderState?.favoriteFiles)
          ? folderState!.favoriteFiles!.filter((p): p is string => typeof p === 'string')
          : [];
        setFavoriteFiles(saved);
      } catch (err) {
        console.error('Failed to load favorite files:', err);
        if (!cancelled) setFavoriteFiles([]);
      } finally {
        if (!cancelled) setFavoritesLoaded(true);
      }
    };
    loadFavorites();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  // Persist favorite files for the current folder (debounced)
  useEffect(() => {
    if (!rootPath || !favoritesLoaded) return;
    const timer = setTimeout(async () => {
      try {
        const currentState = (await window.electronAPI.getFolderState(rootPath)) || {};
        await window.electronAPI.saveFolderState(rootPath, {
          ...currentState,
          favoriteFiles,
        });
      } catch (err) {
        console.error('Failed to save favorite files:', err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [favoriteFiles, rootPath, favoritesLoaded]);

  const loadDirectory = async (dirPath: string) => {
    try {
      await window.electronAPI.saveLastOpenedFolder(dirPath);
      const items = await window.electronAPI.readDirectory(dirPath);
      const itemsWithState = items.map(item => ({
        ...item,
        isChecked: selectedFilePathsRef.current.has(item.path),
      }));
      setTree(sortFileItems(itemsWithState));
    } catch (error) {
      console.error('Error loading directory:', error);
      setTree([]);
    }
    // Always propagate the folder path to the parent, even on error,
    // so the UI reflects the attempted folder open.
    onFolderOpen?.(dirPath);
  };

  // Recursively load all children for a folder path, returning populated FileItem[]
  const loadAllChildren = async (folderPath: string): Promise<FileItem[]> => {
    const raw = await window.electronAPI.readDirectory(folderPath);
    const sorted = sortFileItems(raw.map(item => ({ ...item, isChecked: false })));
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

  const toggleFavorite = useCallback((filePath: string) => {
    setFavoriteFiles(prev => {
      if (prev.includes(filePath)) {
        return prev.filter(p => p !== filePath);
      }
      return [...prev, filePath];
    });
  }, []);

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

  const handleFileCheckboxChange = useCallback(async (item: FileItem, checked: boolean) => {
    // When checking a file, stop prematurely if its content is binary so it is
    // never added to the Referenced Files list.
    if (checked) {
      const binary = await isBinaryFilePath(item.path);
      if (binary) {
        showBinaryNotice(item.path);
        // Ensure the checkbox reflects the unchecked (blocked) state.
        setTree(prev => updateTreeItem(prev, item.path, { isChecked: false }));
        return;
      }
    }
    setSelectedFilePaths(prev => {
      const next = new Set(prev);
      checked ? next.add(item.path) : next.delete(item.path);
      return next;
    });
    setTree(prev => updateTreeItem(prev, item.path, { isChecked: checked }));
  }, [isBinaryFilePath, showBinaryNotice]);

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
      // Drop favorites that no longer exist on disk
      const validFavorites: string[] = [];
      for (const fp of favoriteFilesRef.current) {
        if (await checkFileExists(fp)) validFavorites.push(fp);
      }
      setFavoriteFiles(validFavorites);
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

  // Keep a ref to the latest handleRefresh so the file-watching effect can
  // call it without re-subscribing whenever isRefreshing toggles.
  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;

  // ─── File Watching ────────────────────────────────────────────────────
  // Watch the root folder for file/folder changes and debounce-refresh the
  // tree. The watcher is managed by the main process (fs.watch with
  // recursive: true) and communicates via the 'fs:watchEvent' IPC channel.
  useEffect(() => {
    if (!rootPath) return;

    let debounceTimer: NodeJS.Timeout | null = null;
    let cancelled = false;

    const handleWatchEvent = (data: { eventType?: string; filename?: string | null; error?: string }) => {
      if (data.error) {
        console.error('Folder watch error:', data.error);
        return;
      }
      // Debounce: wait 500ms after the last event before refreshing to
      // coalesce rapid bursts of file system notifications.
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!cancelled) {
          handleRefreshRef.current();
        }
      }, 500);
    };

    // Subscribe to watch events (returns a cleanup function)
    const removeListener = window.electronAPI.onWatchEvent(handleWatchEvent);

    // Start watching the root folder
    window.electronAPI.watchFolder(rootPath).catch((err: unknown) => {
      console.error('Failed to start folder watching:', err);
    });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      removeListener();
      window.electronAPI.stopWatchingFolder().catch(() => {});
    };
  }, [rootPath]);

  const openFolderPath = useCallback(async (path: string) => {
    if (!path) return;
    if (onBeforeFolderChange) {
      const canProceed = await onBeforeFolderChange(path);
      if (!canProceed) return;
    }
    try {
      await window.electronAPI.addRecentFolder(path);
    } catch (err) {
      console.error('Failed to record recent folder:', err);
    }
    await loadDirectory(path);
    setSelectedFilePaths(new Set());
    setOpenedFilePath(null);
    setExpandedFolders(new Set());
  }, [onBeforeFolderChange]);

  const handleOpenFolderClick = useCallback(async () => {
    try {
      const folders = await window.electronAPI.getRecentFolders();
      setRecentFolders(Array.isArray(folders) ? folders.slice(0, 10) : []);
    } catch (err) {
      console.error('Failed to load recent folders:', err);
      setRecentFolders([]);
    }
    setShowOpenFolderModal(true);
  }, []);

  const handleBrowseFolder = useCallback(async () => {
    setShowOpenFolderModal(false);
    const path = await window.electronAPI.openDirectory();
    if (path) {
      await openFolderPath(path);
    }
  }, [openFolderPath]);

  const handleSelectRecentFolder = useCallback(async (path: string) => {
    setShowOpenFolderModal(false);
    await openFolderPath(path);
  }, [openFolderPath]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  const handleOpenContainingFolder = useCallback(async (item: FileItem) => {
    setContextMenu(null);
    try {
      await window.electronAPI.openContainingFolder(item.path);
    } catch (err) {
      console.error('Failed to open containing folder:', err);
    }
  }, []);

  // Reuse the single-click path-copy behavior from toggleFolder for the
  // right-click context menu (Copy File/Folder Path).
  const handleCopyPath = useCallback(async (item: FileItem) => {
    setContextMenu(null);
    await copyToClipboard(getProjectRootRelativePath(item.path));
    setRecentlyCopied(item.path);
    setTimeout(() => setRecentlyCopied(null), 1200);
  }, [getProjectRootRelativePath]);

  const handleCreateNewFile = useCallback((parentPath: string) => {
    setCreateFileModal({ parentPath });
    setNewFileName('');
  }, []);

  const handleCreateFileSubmit = useCallback(async () => {
    if (!createFileModal || !newFileName.trim()) return;
    const fileName = newFileName.trim();
    const sep = createFileModal.parentPath.includes('\\') ? '\\' : '/';
    const filePath = createFileModal.parentPath + sep + fileName;
    try {
      await window.electronAPI.writeFile(filePath, '');
      const parentPath = createFileModal.parentPath;
      setCreateFileModal(null);
      setNewFileName('');
      // Refresh the parent folder in the tree
      try {
        if (parentPath === rootPath) {
          const newTree = await loadAllChildren(rootPath);
          const applyChecked = (items: FileItem[]): FileItem[] =>
            items.map(item => ({
              ...item,
              isChecked: selectedFilePaths.has(item.path),
              children: item.children ? applyChecked(item.children) : undefined,
            }));
          setTree(applyChecked(newTree));
        } else {
          const children = await window.electronAPI.readDirectory(parentPath);
          const childrenWithState = sortFileItems(children.map(c => ({
            ...c, isChecked: selectedFilePaths.has(c.path)
          })));
          setTree(prev => updateTreeItem(prev, parentPath, { children: childrenWithState }));
        }
        // Ensure the parent folder is expanded
        setExpandedFolders(prev => {
          const next = new Set(prev);
          next.add(parentPath);
          return next;
        });
      } catch (refreshError) {
        console.error('Error refreshing after file creation:', refreshError);
      }
    } catch (err: any) {
      console.error('Failed to create file:', err);
      alert('Failed to create file: ' + (err?.message || err));
    }
  }, [createFileModal, newFileName, rootPath, selectedFilePaths]);

  const handleDeleteFile = useCallback(async (item: FileItem) => {
    setContextMenu(null);
    alert('To delete "' + item.name + '", please remove it in File Explorer, Finder, or other file manager.');
    try {
      await window.electronAPI.openContainingFolder(item.path);
    } catch (err) {
      console.error('Failed to open containing folder:', err);
    }
  }, []);

  const handleCreateSubfolder = useCallback((parentPath: string) => {
    setCreateSubfolderModal({ parentPath });
    setNewSubfolderName('');
  }, []);

  const handleCreateSubfolderSubmit = useCallback(async () => {
    if (!createSubfolderModal || !newSubfolderName.trim()) return;
    const folderName = newSubfolderName.trim();
    const sep = createSubfolderModal.parentPath.includes('\\') ? '\\' : '/';
    const folderPath = createSubfolderModal.parentPath + sep + folderName;
    try {
      await window.electronAPI.mkdir(folderPath);
      const parentPath = createSubfolderModal.parentPath;
      setCreateSubfolderModal(null);
      setNewSubfolderName('');
      // Refresh the parent folder
      try {
        const children = await window.electronAPI.readDirectory(parentPath);
        const childrenWithState = sortFileItems(children.map(c => ({
          ...c, isChecked: selectedFilePaths.has(c.path)
        })));
        if (parentPath === rootPath) {
          const newTree = await loadAllChildren(rootPath);
          const applyChecked = (items: FileItem[]): FileItem[] =>
            items.map(item => ({
              ...item,
              isChecked: selectedFilePaths.has(item.path),
              children: item.children ? applyChecked(item.children) : undefined,
            }));
          setTree(applyChecked(newTree));
        } else {
          setTree(prev => updateTreeItem(prev, parentPath, { children: childrenWithState }));
        }
        setExpandedFolders(prev => {
          const next = new Set(prev);
          next.add(parentPath);
          next.add(folderPath);
          return next;
        });
      } catch (refreshError) {
        console.error('Error refreshing after subfolder creation:', refreshError);
      }
    } catch (err: any) {
      console.error('Failed to create subfolder:', err);
      alert('Failed to create subfolder: ' + (err?.message || err));
    }
  }, [createSubfolderModal, newSubfolderName, rootPath, selectedFilePaths]);

  const handleDeleteFolder = useCallback(async (item: FileItem) => {
    setContextMenu(null);
    alert('Deleting folders is not supported within the app. Please delete "' + item.name + '" manually in File Explorer, Finder, or your OS file manager.');
    // Open the parent folder so the user can delete the target folder directly.
    const parentPath = item.path.replace(/[\\/][^\\/]+$/, '') || item.path;
    try {
      await window.electronAPI.openContainingFolder(parentPath);
    } catch (err) {
      console.error('Failed to open parent folder:', err);
    }
  }, []);

  const toggleFolder = async (item: FileItem, expandOnly: boolean = false) => {
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
              ...c, isChecked: selectedFilePaths.has(c.path)
            })));
            setTree(prev => updateTreeItem(prev, item.path, { children: childrenWithState }));
          } catch (error) {
            console.error('Error loading folder:', error);
          }
        }
      }
      setExpandedFolders(newExpanded);
    }
    // File clicks: copy path only; open in Editor tab via single-click.
    // Stop prematurely and warn if the file content is binary so it is never
    // opened in the Editor tab. Instantly highlight the file name with the
    // outstanding opened-file color and switch to the Editor tab.
    if (item.isFile) {
      const binary = await isBinaryFilePath(item.path);
      if (binary) {
        showBinaryNotice(item.path);
        return;
      }
      setOpenedFilePath(item.path);
      onSingleClickFile?.(item.path);
    }
  };

  const renderFileActionIcons = (item: FileItem) => {
    if (!item.isFile) return null;
    const isFavorite = favoriteFiles.includes(item.path);
    return (
      <>
        <span
          className={`file-icon star-icon ${isFavorite ? 'favorited' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(item.path);
          }}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isFavorite ? '★' : '☆'}
        </span>
        <span
          className="file-icon copy-path-icon"
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(getProjectRootRelativePath(item.path));
            setRecentlyCopied(item.path);
            setTimeout(() => setRecentlyCopied(null), 1200);
          }}
          title="Copy file path to clipboard"
        >
          📋
        </span>
        <span
          className="file-icon copy-path-icon"
          onClick={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setContextMenu({ x: rect.left, y: rect.top, item });
          }}
          onMouseEnter={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setContextMenu({ x: rect.left, y: rect.top, item });
          }}
          title="More actions"
        >
          ☰
        </span>
      </>
    );
  };

  const renderTreeItem = (item: FileItem, depth: number = 0) => {
    const isExpanded = expandedFolders.has(item.path);
    const isChecked = item.isFile ? selectedFilePaths.has(item.path) : isFolderChecked(item);
    const isOpened = item.isFile && item.path === openedFilePath;

    return (
      <div key={item.path}>
        <div className="tree-item" style={{ paddingLeft: `${depth * 16 + 10}px`, marginLeft: `${depth * 1}px` }} onContextMenu={(e) => handleContextMenu(e, item)}>
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
            className={`tree-item-content ${isOpened ? 'opened-file' : ''} ${recentlyCopied === item.path ? 'copied' : ''}`}
            onClick={() => toggleFolder(item)}
            style={{ padding: '2px 4px' }}
          >
            {item.isDirectory && <span className="folder-icon">{isExpanded ? '📂' : '📁'}</span>}
            <span className={`item-name${isOpened ? ' opened-file-name' : ''}`} title={item.isFile ? getProjectRootRelativePath(item.path) : undefined}>{item.name}</span>
            {renderFileActionIcons(item)}
            {recentlyCopied === item.path && <span className="copied-indicator">✓ path copied</span>}
            {item.isDirectory && item.children && (
              <span className="selection-badge">{item.children.filter(c => c.isFile).length}</span>
            )}
            {item.isDirectory && (
              <span
                className="file-icon copy-path-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyPath(item);
                }}
                title="Copy folder path to clipboard"
              >
                📋
              </span>
            )}
            {item.isDirectory && (
              <span
                className="file-icon create-file-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateNewFile(item.path);
                }}
                title="Create new file in this folder"
              >
                📄+
              </span>
            )}
            {item.isDirectory && (
              <span
                className="file-icon create-file-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateSubfolder(item.path);
                }}
                title="Create new subfolder in this folder"
              >
                📁+
              </span>
            )}
            {item.isDirectory && (
              <span
                className="file-icon copy-path-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setContextMenu({ x: rect.left, y: rect.top, item });
                }}
                onMouseEnter={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setContextMenu({ x: rect.left, y: rect.top, item });
                }}
                title="More actions"
              >
                ☰
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

  // Favorite list rows mirror tree file-name behavior (copy path, star, context menu)
  // Selection checkboxes are intentionally omitted from favorites; select files in the main tree.
  const renderFavoriteItem = (filePath: string) => {
    const item = toFileItem(filePath);
    const relTitle = getProjectRootRelativePath(filePath);

    return (
      <div key={`fav-${filePath}`}>
        <div
          className="tree-item favorite-files-item"
          style={{ paddingLeft: '10px' }}
          onContextMenu={(e) => handleContextMenu(e, item)}
        >
          <div
            className={`tree-item-content ${recentlyCopied === item.path ? 'copied' : ''}`}
            onClick={() => toggleFolder(item)}
            style={{ padding: '2px 4px' }}
          >
            <span className="item-name" title={relTitle}>{item.name}</span>
            {renderFileActionIcons(item)}
            {recentlyCopied === item.path && <span className="copied-indicator">✓ path copied</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="file-tree">
      <div className="tree-header">
        <h3>Explorer</h3>
        <div className="tree-header-actions">
          <button className="button" onClick={handleOpenFolderClick} title="Open a folder to browse files">Open Folder</button>
          <button className="button" onClick={() => {
            setSelectedFilePaths(new Set());
            setTree(prev => {
              const clear = (items: FileItem[]): FileItem[] =>
                items.map(i => ({ ...i, isChecked: false, children: i.children ? clear(i.children) : undefined }));
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
          Selected: <strong>{selectedFilePaths.size}</strong> files
          {isRefreshing && <span className="loading-indicator"> Refreshing...</span>}
        </small>
        {!isInitialized && <span className="loading-indicator">Loading last folder...</span>}
      </div>

      {/* Favorite Files — invisible when empty; grows until max-height 200px then scrolls */}
      {favoriteFiles.length > 0 && (
        <div className="favorite-files">
          <div className="favorite-files-header">
            Favorite Files
            <span className="favorite-files-count">{favoriteFiles.length}</span>
            <button
              className="favorite-files-clear-btn"
              onClick={() => {
                setFavoriteFiles([]);
              }}
              title="Remove all files from favorites"
            >
              Clear
            </button>
          </div>
          <div className="favorite-files-list">
            {favoriteFiles.map(renderFavoriteItem)}
          </div>
        </div>
      )}

      {binaryNotice && (
        <div
          role="alert"
          style={{
            margin: '6px 10px',
            padding: '8px 10px',
            background: 'rgba(180, 60, 60, 0.15)',
            border: '1px solid rgba(219, 112, 112, 0.4)',
            borderLeft: '3px solid #db7070',
            borderRadius: '4px',
            color: '#ff9c9c',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
            flexShrink: 0,
          }}
          title={binaryNotice.path}
        >
          <span aria-hidden="true">⚠️</span>
          <span>{binaryNotice.message}</span>
        </div>
      )}

      <div className="tree-content">
        {tree.length === 0 ? (
          isInitialized ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontStyle: 'italic' }}>
              No folder opened
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', color: '#888' }}>
              <div className="initial-loading-spinner" />
              <span style={{ marginTop: '12px', fontSize: '12px', fontStyle: 'italic' }}>Loading files...</span>
            </div>
          )
        ) : (
          tree.map(item => renderTreeItem(item))
        )}
      </div>

      {/* Footer bar — Create New File in root folder */}
      {/* <div className="file-tree-footer">
        <button
          className="create-file-footer-btn"
          onClick={() => handleCreateNewFile(rootPath)}
          disabled={!rootPath}
          title="Create a new file in the root folder"
        >
          📄+
        </button>
      </div> */}

      {showOpenFolderModal && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowOpenFolderModal(false)}
        >
          <div
            style={{
              background: '#1e1e1e',
              border: '1px solid #555',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '620px',
              width: '90%',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: '16px', fontWeight: 500 }}>
                Open Folder
              </h3>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ccc',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
                onClick={() => setShowOpenFolderModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ color: '#9cdcfe', fontSize: '12px', marginBottom: '10px' }}>
              Recent Folders
            </div>
            <div style={{ overflowY: 'auto', flex: 1, maxHeight: '50vh', border: '1px solid #333', borderRadius: '4px' }}>
              {recentFolders.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#888', fontStyle: 'italic', fontSize: '13px' }}>
                  No recent folders yet
                </div>
              ) : (
                recentFolders.map((folder, i) => {
                  const isCurrent = folder === rootPath;
                  return (
                    <div
                      key={folder + i}
                      onClick={() => { if (!isCurrent) handleSelectRecentFolder(folder); }}
                      title={isCurrent ? `${folder} (currently open)` : folder}
                      aria-disabled={isCurrent}
                      style={{
                        padding: '10px 12px',
                        borderBottom: i < recentFolders.length - 1 ? '1px solid #2a2a2a' : 'none',
                        cursor: isCurrent ? 'not-allowed' : 'pointer',
                        color: isCurrent ? '#666' : '#d4d4d4',
                        opacity: isCurrent ? 0.6 : 1,
                        fontFamily: 'Consolas, monospace',
                        fontSize: '13px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        pointerEvents: isCurrent ? 'none' : 'auto',
                      }}
                      onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = '#2a2d2e'; }}
                      onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                    >
                      📁 {folder}{isCurrent ? '  (currently open)' : ''}
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                style={{
                  padding: '8px 20px',
                  background: '#2a2d2e',
                  color: '#ccc',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                onClick={() => setShowOpenFolderModal(false)}
                title="Cancel and close this dialog"
              >
                Cancel
              </button>
              <button
                style={{
                  padding: '8px 20px',
                  background: '#0e639c',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                onClick={handleBrowseFolder}
                title="Open the system file picker to browse for a folder"
              >
                Browse…
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="context-menu-backdrop"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
            onMouseLeave={() => setContextMenu(null)}
          >
            {/* Quick-icon row: one icon per action, no labels */}
            <div style={{ display: 'flex', gap: '2px', padding: '4px 8px', borderBottom: '1px solid #454545', flexWrap: 'nowrap', overflow: 'visible' }}>
              <button
                className="context-menu-item"
                style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                onClick={() => handleCopyPath(contextMenu.item)}
                title={contextMenu.item.isDirectory ? 'Copy Folder Path' : 'Copy File Path'}
              >📋</button>
              {contextMenu.item.isDirectory && (
                <button
                  className="context-menu-item"
                  style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                  onClick={() => { setContextMenu(null); handleCreateNewFile(contextMenu.item.path); }}
                  title="Create New File"
                >📄+</button>
              )}
              {contextMenu.item.isDirectory && (
                <button
                  className="context-menu-item"
                  style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                  onClick={() => { setContextMenu(null); handleCreateSubfolder(contextMenu.item.path); }}
                  title="Create Subfolder"
                >📁+</button>
              )}
              {contextMenu.item.isDirectory && (
                <button
                  className="context-menu-item"
                  style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                  onClick={() => handleDeleteFolder(contextMenu.item)}
                  title="Delete Folder"
                >🗑️</button>
              )}
              {contextMenu.item.isFile && (
                <button
                  className="context-menu-item"
                  style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                  onClick={async () => {
                    setContextMenu(null);
                    try {
                      const fileData = await window.electronAPI.readFile(contextMenu.item.path);
                      await window.electronAPI.openMarkdownPreview(fileData.content);
                    } catch (err) {
                      console.error('Failed to open preview:', err);
                    }
                  }}
                  title="Preview"
                >👁️</button>
              )}
              {contextMenu.item.isFile && (
                <button
                  className="context-menu-item"
                  style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                  onClick={() => { setContextMenu(null); onEditFile?.(contextMenu.item.path); }}
                  title="Edit"
                >✒️</button>
              )}
              {contextMenu.item.isFile && (
                <button
                  className="context-menu-item"
                  style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                  onClick={() => { setContextMenu(null); toggleFavorite(contextMenu.item.path); }}
                  title={favoriteFiles.includes(contextMenu.item.path) ? 'Remove Favorite' : 'Add Favorite'}
                >{favoriteFiles.includes(contextMenu.item.path) ? '★' : '☆'}</button>
              )}
              {contextMenu.item.isFile && (
                <button
                  className="context-menu-item"
                  style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                  onClick={() => handleDeleteFile(contextMenu.item)}
                  title="Delete File"
                >🗑️</button>
              )}
              <button
                className="context-menu-item"
                style={{ padding: '4px 6px', fontSize: '15px', minWidth: 0, width: 'auto', flexShrink: 0 }}
                onClick={() => handleOpenContainingFolder(contextMenu.item)}
                title="Open Containing Folder"
              >📂</button>
            </div>
            <button
              className="context-menu-item"
              onClick={() => handleCopyPath(contextMenu.item)}
              title={contextMenu.item.isDirectory ? 'Copy the folder path to the clipboard' : 'Copy the file path to the clipboard'}
            >
              📋 {contextMenu.item.isDirectory ? 'Copy Folder Path' : 'Copy File Path'}
            </button>
            {contextMenu.item.isDirectory && (
              <button
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  handleCreateNewFile(contextMenu.item.path);
                }}
                title="Create a new file in this folder"
              >
                📄+ Create New File
              </button>
            )}
            {contextMenu.item.isDirectory && (
              <button
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  handleCreateSubfolder(contextMenu.item.path);
                }}
                title="Create a new subfolder inside this folder"
              >
                📁+ Create Subfolder
              </button>
            )}
            {contextMenu.item.isDirectory && (
              <button
                className="context-menu-item"
                onClick={() => handleDeleteFolder(contextMenu.item)}
                title="Delete this folder (opens file manager)"
              >
                🗑️ Delete Folder
              </button>
            )}
            {contextMenu.item.isFile && (
              <button
                className="context-menu-item"
                onClick={async () => {
                  setContextMenu(null);
                  try {
                    const fileData = await window.electronAPI.readFile(contextMenu.item.path);
                    await window.electronAPI.openMarkdownPreview(fileData.content);
                  } catch (err) {
                    console.error('Failed to open preview:', err);
                  }
                }}
                title="Preview this file in the Markdown Preview window"
              >
                👁️ Preview
              </button>
            )}
            {contextMenu.item.isFile && (
              <button
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  onEditFile?.(contextMenu.item.path);
                }}
                title="Open this file in the Editor tab"
              >
                ✒️ Edit
              </button>
            )}
            {contextMenu.item.isFile && (
              <button
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  toggleFavorite(contextMenu.item.path);
                }}
                title={favoriteFiles.includes(contextMenu.item.path) ? 'Remove from favorites' : 'Add to favorites'}
              >
                {favoriteFiles.includes(contextMenu.item.path) ? '★ Remove Favorite' : '☆ Add Favorite'}
              </button>
            )}
            {contextMenu.item.isFile && (
              <button
                className="context-menu-item"
                onClick={() => handleDeleteFile(contextMenu.item)}
                title="Delete this file"
              >
                🗑️ Delete File
              </button>
            )}
            <button
              className="context-menu-item"
              onClick={() => handleOpenContainingFolder(contextMenu.item)}
              title="Open the containing folder in the system file manager"
            >
              📂 Open Containing Folder
            </button>
          </div>
        </div>
      )}

      {/* Create Subfolder modal */}
      {createSubfolderModal && (
        <div
          className="create-file-modal-backdrop"
          onClick={() => setCreateSubfolderModal(null)}
        >
          <div
            className="create-file-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: '16px', fontWeight: 500 }}>
                Create New Subfolder
              </h3>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ccc',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
                onClick={() => setCreateSubfolderModal(null)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div style={{ color: '#9cdcfe', fontSize: '12px', marginBottom: '10px', fontFamily: 'Consolas, monospace', wordBreak: 'break-all' }}>
              {createSubfolderModal.parentPath}
            </div>
            <input
              type="text"
              value={newSubfolderName}
              onChange={(e) => setNewSubfolderName(e.target.value)}
              placeholder="Enter subfolder name..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSubfolderSubmit();
                if (e.key === 'Escape') setCreateSubfolderModal(null);
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#252526',
                border: '1px solid #3c3c3c',
                borderRadius: '4px',
                color: '#d4d4d4',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                style={{
                  padding: '8px 20px',
                  background: '#2a2d2e',
                  color: '#ccc',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                onClick={() => setCreateSubfolderModal(null)}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: '8px 20px',
                  background: newSubfolderName.trim() ? '#0e639c' : '#2a2d2e',
                  color: newSubfolderName.trim() ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: newSubfolderName.trim() ? 'pointer' : 'not-allowed',
                }}
                onClick={handleCreateSubfolderSubmit}
                disabled={!newSubfolderName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create New File modal */}
      {createFileModal && (
        <div
          className="create-file-modal-backdrop"
          onClick={() => setCreateFileModal(null)}
        >
          <div
            className="create-file-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: '16px', fontWeight: 500 }}>
                Create New File
              </h3>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ccc',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
                onClick={() => setCreateFileModal(null)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div style={{ color: '#9cdcfe', fontSize: '12px', marginBottom: '10px', fontFamily: 'Consolas, monospace', wordBreak: 'break-all' }}>
              {createFileModal.parentPath}
            </div>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="Enter file name..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFileSubmit();
                if (e.key === 'Escape') setCreateFileModal(null);
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#252526',
                border: '1px solid #3c3c3c',
                borderRadius: '4px',
                color: '#d4d4d4',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                style={{
                  padding: '8px 20px',
                  background: '#2a2d2e',
                  color: '#ccc',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
                onClick={() => setCreateFileModal(null)}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: '8px 20px',
                  background: newFileName.trim() ? '#0e639c' : '#2a2d2e',
                  color: newFileName.trim() ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: newFileName.trim() ? 'pointer' : 'not-allowed',
                }}
                onClick={handleCreateFileSubmit}
                disabled={!newFileName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default FileTree;