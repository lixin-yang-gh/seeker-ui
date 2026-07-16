import { app, BrowserWindow, ipcMain, dialog, screen, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { redactContent } from './redaction-config';
import { callOpenRouter, isMalformedBlockResponse } from '../shared/open-router';
import { callVenice } from '../shared/venice';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// Set to false to disable logging of system/user prompts before API calls
const PROMPT_LOGGING_ENABLED = false;

// Define the state structure for a specific folder
interface FolderSpecificState {
  systemPrompt?: string;
  task?: string;
  issues?: string;
  inferenceContext?: string;
  selectedHeader?: string;
  maskedSubstrings?: string;
  inferenceModel?: string;
  temperature?: number;
  apiTarget?: string;
  maxTokenChoice?: string;
  inferenceResultRaw?: string;
  inferenceResult?: string;
  inferenceReasoning?: string;
  inferenceError?: string;
  inferenceStatus?: 'idle' | 'running' | 'success' | 'error';
  inferenceResultSavedAt?: number;
  lastSystemPrompt?: string;
  lastUserPrompt?: string;
  lastInferenceWasSingleBlockReplacement?: boolean;
  previewFontSize?: number;
  previewWordWrap?: boolean;
  previewMarkdownTheme?: 'dark' | 'light';
  favoriteFiles?: string[];
}

// Define the store schema
interface StoreSchema {
  lastOpenedFolder?: string;
  recentFolders?: string[];
  windowBounds?: { x: number; y: number; width: number; height: number };
  // Map of absolute folder paths to their specific state
  folderStates?: Record<string, FolderSpecificState>;
  // Global default system prompt
  defaultSystemPrompt?: string;
  // API settings (global)
  apiSettings?: {
    openRouterApiKey: string;
    inferenceModels: string;
    validationModels: string;
    veniceApiKey: string;
    veniceInferenceModels: string;
  };
  previewWindowBounds?: { x: number; y: number; width: number; height: number };
  previewTheme?: 'dark' | 'light';
  previewMode?: 'text' | 'markdown';
  previewZoom?: number;
}

// Initialize electron-store
const store = new Store<StoreSchema>({
  defaults: {
    lastOpenedFolder: undefined,
    recentFolders: [],
    windowBounds: { width: 1200, height: 800, x: 100, y: 100 },
    folderStates: {}
  },
  name: 'app-settings'
});

let mainWindow: BrowserWindow | null = null;

// Active folder watcher for file tree auto-refresh
let activeFolderWatcher: FSWatcher | null = null;

async function createWindow() {
  const bounds = getValidatedWindowBounds();

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
  });

  console.log(`env=${process.env.NODE_ENV}`);

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    console.log(`Trying to load: ${indexPath}`);
    if (await fs.access(indexPath).then(() => true).catch(() => false)) {
      mainWindow.loadFile(indexPath);
    } else {
      console.error('index.html not found at:', indexPath);
      console.log('Current __dirname:', __dirname);
      try {
        console.log('Files in dist/renderer:', await fs.readdir(path.join(__dirname, '../renderer')));
      } catch (e) {
        console.error('Cannot read dist/renderer:', e);
      }
      mainWindow.loadURL(
        'data:text/html,<h1 style="color:red">index.html not found!<br>Run: npm run build<br>Check console for details</h1>'
      );
    }
  }

  const saveBounds = () => {
    if (mainWindow && !mainWindow.isMinimized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('close', saveBounds);

  console.log(`__dirname=${__dirname}`);
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('close', saveBounds);
  mainWindow.on('closed', () => {
    if (markdownPreviewWindow && !markdownPreviewWindow.isDestroyed()) {
      markdownPreviewWindow.close();
      markdownPreviewWindow = null;
    }
  });

  console.log(`__dirname=${__dirname}`);
}

const getValidatedWindowBounds = () => {
  const saved = store.get('windowBounds') as { x?: number; y?: number; width?: number; height?: number } || {};
  let { width = 1200, height = 800, x = 100, y = 100 } = saved;

  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  // If bigger than screen > resize to fill screen and move to top-left
  if (width > screenW || height > screenH) {
    width = screenW;
    height = screenH;
    x = 0;
    y = 0;
  } else {
    // Ensure fully visible (clamp position)
    x = Math.max(0, Math.min(x, screenW - width));
    y = Math.max(0, Math.min(y, screenH - height));
  }

  return { width, height, x, y };
};

const getValidatedPreviewWindowBounds = () => {
  const saved = store.get('previewWindowBounds') as { x?: number; y?: number; width?: number; height?: number } || {};
  let { width = 800, height = 600, x = 100, y = 100 } = saved;

  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  // If the intended size or position exceed the current screen resolution,
  // reset to top-left and spread to 60% of the screen height. The width is
  // restricted to 60% of the screen width or 800px, whichever is smaller,
  // so the preview never becomes excessively wide on large monitors.
  if (
    width > screenW ||
    height > screenH ||
    x < 0 ||
    y < 0 ||
    x + width > screenW ||
    y + height > screenH
  ) {
    width = Math.min(Math.round(screenW * 0.6), 800);
    height = Math.round(screenH * 0.6);
    x = 0;
    y = 0;
  }

  return { width, height, x, y };
};

// IPC Handlers
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('fs:readDirectory', async (_, dirPath: string) => {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    return items.map((item) => ({
      name: item.name,
      path: path.join(dirPath, item.name),
      isDirectory: item.isDirectory(),
      isFile: item.isFile(),
    }));
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('read-file', async (_, filePath: string) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { path: filePath, content };
  } catch (err: any) {
    throw new Error(`Cannot read file ${filePath}: ${err.message}`);
  }
});

ipcMain.handle('get-file-stats', async (_, filePath: string) => {
  try {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      mtime: stats.mtime.getTime(),
      birthtime: stats.birthtime.getTime(),
    };
  } catch (err: any) {
    console.error(`Failed to stat ${filePath}:`, err);
    throw new Error(`Cannot get stats for ${filePath}: ${err.message}`);
  }
});

// Detect whether a file's content is binary by inspecting the first 512 bytes.
// A null byte (0x00) is a strong binary signal; likewise low control chars
// other than tab (9), LF (10), CR (13) indicate non-text content. Directories
// are never considered binary. On read errors we conservatively report false
// so the caller can fall back to its normal (text) handling path.
ipcMain.handle('fs:isBinaryFile', async (_, filePath: string) => {
  let fileHandle: fs.FileHandle | null = null;
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      return { isBinary: false, isDirectory: true };
    }

    const SAMPLE_SIZE = 512;
    const buffer = Buffer.alloc(SAMPLE_SIZE);
    fileHandle = await fs.open(filePath, 'r');
    const { bytesRead } = await fileHandle.read(buffer, 0, SAMPLE_SIZE, 0);

    for (let i = 0; i < bytesRead; i++) {
      const byte = buffer[i];
      // 0x00 => definite binary. Other control chars (except \t, \n, \r) => binary.
      if (byte === 0x00 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
        return { isBinary: true, isDirectory: false };
      }
    }
    return { isBinary: false, isDirectory: false };
  } catch (err: any) {
    console.error(`Failed to inspect binary status for ${filePath}:`, err);
    // Fail open (treat as text) so normal handling proceeds; surface no error.
    return { isBinary: false, isDirectory: false };
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch (closeErr) {
        console.error(`Failed to close file handle for ${filePath}:`, closeErr);
      }
    }
  }
});

ipcMain.handle('write-file', async (_, { path: filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err: any) {
    throw new Error(`Cannot write file ${filePath}: ${err.message}`);
  }
});

ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (err: any) {
    throw new Error(`Cannot create directory ${dirPath}: ${err.message}`);
  }
});

// ─── Folder Watching (file tree auto-refresh) ──────────────────────────
// Watches the root folder recursively for file/folder changes and notifies
// the renderer via the 'fs:watchEvent' channel so the FileTree component
// can debounce-refresh its display.
ipcMain.handle('fs:watchFolder', async (_, folderPath: string) => {
  // Close any previously active watcher
  if (activeFolderWatcher) {
    activeFolderWatcher.close();
    activeFolderWatcher = null;
  }

  if (!folderPath) {
    return { success: false, error: 'No folder path provided' };
  }

  try {
    activeFolderWatcher = watch(folderPath, { recursive: true }, (eventType, filename) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fs:watchEvent', {
          eventType,
          filename: filename ?? undefined,
          folderPath,
        });
      }
    });

    activeFolderWatcher.on('error', (err: Error) => {
      console.error('Folder watcher error:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fs:watchEvent', {
          error: err.message,
          folderPath,
        });
      }
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fs:stopWatchingFolder', async () => {
  if (activeFolderWatcher) {
    activeFolderWatcher.close();
    activeFolderWatcher = null;
  }
  return { success: true };
});

// Store-related IPC handlers
ipcMain.handle('store:getLastOpenedFolder', () => {
  return store.get('lastOpenedFolder');
});

ipcMain.handle('store:saveLastOpenedFolder', (_, folderPath: string) => {
  store.set('lastOpenedFolder', folderPath);
  return { success: true };
});

// Recent folders (last 10 memorized opened folder paths)
ipcMain.handle('store:getRecentFolders', () => {
  return store.get('recentFolders') || [];
});

ipcMain.handle('store:addRecentFolder', (_, folderPath: string) => {
  if (!folderPath) return { success: false };
  const existing = (store.get('recentFolders') || []) as string[];
  // Remove any existing occurrence, then prepend the new path
  const filtered = existing.filter((p) => p !== folderPath);
  const updated = [folderPath, ...filtered].slice(0, 10);
  store.set('recentFolders', updated);
  return { success: true };
});

// Updated IPC handlers for folder-specific state
ipcMain.handle('store:getSystemPrompt', (_, folderPath: string) => {
  return getFolderState(folderPath).systemPrompt || '';
});

ipcMain.handle('store:saveSystemPrompt', (_, folderPath: string, value: string) => {
  saveFolderState(folderPath, { systemPrompt: value });
  return { success: true };
});

ipcMain.handle('store:getTask', (_, folderPath: string) => {
  return getFolderState(folderPath).task || '';
});

ipcMain.handle('store:saveTask', (_, folderPath: string, value: string) => {
  saveFolderState(folderPath, { task: value });
  return { success: true };
});

ipcMain.handle('store:getSelectedHeader', (_, folderPath: string) => {
  return getFolderState(folderPath).selectedHeader || 'issues';
});

ipcMain.handle('store:saveSelectedHeader', (_, folderPath: string, value: string) => {
  saveFolderState(folderPath, { selectedHeader: value });
  return { success: true };
});

ipcMain.handle('store:getInferenceContext', (_, folderPath: string) => {
  const state = getFolderState(folderPath);
  return state.inferenceContext ?? state.issues ?? '';
});

ipcMain.handle('store:saveInferenceContext', (_, folderPath: string, value: string) => {
  saveFolderState(folderPath, { inferenceContext: value });
  return { success: true };
});

ipcMain.handle('redact-text', async (_, text: string) => {
  try {
    // const clean = redactum(text).redactedText;
    // return clean;
    return redactContent(text);
  } catch (error) {
    console.error('Redaction failed:', error);
    return text; // Fallback to original text on error
  }
});

ipcMain.handle('store:getMaskedSubstrings', (_, folderPath: string) => {
  return getFolderState(folderPath).maskedSubstrings || '';
});

ipcMain.handle('store:saveMaskedSubstrings', (_, folderPath: string, value: string) => {
  saveFolderState(folderPath, { maskedSubstrings: value });
  return { success: true };
});

// Helper to get folder state
const getFolderState = (folderPath: string): FolderSpecificState => {
  const states = store.get('folderStates') || {};
  return states[folderPath] || {};
};

// Helper to save folder state
const saveFolderState = (folderPath: string, newState: Partial<FolderSpecificState>) => {
  const states = store.get('folderStates') || {};
  states[folderPath] = { ...states[folderPath], ...newState };
  store.set('folderStates', states);
};

// Bulk operations for efficient folder switching
ipcMain.handle('store:getFolderState', (_, folderPath: string): FolderSpecificState | undefined => {
  const states = store.get('folderStates') || {};
  return states[folderPath]; // Returns undefined if key doesn't exist
});

ipcMain.handle('store:saveFolderState', (_, folderPath: string, state: FolderSpecificState) => {
  const states = store.get('folderStates') || {};
  // Overwrite or create the entry for this folder
  states[folderPath] = state;
  store.set('folderStates', states);
  return { success: true };
});

// Default System Prompt handlers (global, not per-folder)
ipcMain.handle('store:getDefaultSystemPrompt', () => {
  return store.get('defaultSystemPrompt') || '';
});

ipcMain.handle('store:saveDefaultSystemPrompt', (_, value: string) => {
  store.set('defaultSystemPrompt', value);
  return { success: true };
});

// API Settings handlers
ipcMain.handle('store:getApiSettings', () => {
  return store.get('apiSettings') || { openRouterApiKey: '', inferenceModels: '', validationModels: '', veniceApiKey: '', veniceInferenceModels: '' };
});

ipcMain.handle('store:saveApiSettings', (_, settings: { openRouterApiKey: string; inferenceModels: string; validationModels: string; veniceApiKey: string; veniceInferenceModels: string }) => {
  store.set('apiSettings', settings);
  return { success: true };
});

// File dialog handlers for import/export
ipcMain.handle('dialog:openFile', async (_, options?: { filters?: { name: string; extensions: string[] }[] }) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options?.filters || [{ name: 'JSON', extensions: ['json'] }]
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('dialog:saveFile', async (_, options?: { filters?: { name: string; extensions: string[] }[] }) => {
  const result = await dialog.showSaveDialog({
    filters: options?.filters || [{ name: 'JSON', extensions: ['json'] }]
  });
  return result.filePath || null;
});

// Open containing folder in system file manager (Windows Explorer, macOS Finder, Linux file manager)
ipcMain.handle('shell:openContainingFolder', async (_, filePath: string) => {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await shell.openPath(filePath);
    } else {
      shell.showItemInFolder(filePath);
    }
    return { success: true };
  } catch (err: any) {
    throw new Error(`Cannot open containing folder for ${filePath}: ${err.message}`);
  }
});

// Active inference abort controller (one at a time)
let activeInferenceAbortController: AbortController | null = null;

// Inference API call — dispatches to OpenRouter or Venice based on apiTarget.
ipcMain.handle('openRouter:call', async (_, { systemPrompt, userPrompt, model, deepThinking, webSearch, temperature, temperature_claude, apiTarget, maxTokens }) => {
  if (PROMPT_LOGGING_ENABLED) {
    console.log('[Prompt Log] System Prompt:', systemPrompt);
    console.log('[Prompt Log] User Prompt:', userPrompt);
  }
  const apiSettings = store.get('apiSettings');
  const target: 'OpenRouter' | 'Venice' = apiTarget === 'Venice' ? 'Venice' : 'OpenRouter';

  const apiKey = target === 'Venice' ? apiSettings?.veniceApiKey : apiSettings?.openRouterApiKey;
  if (!apiKey) throw new Error(`${target} API key not configured. Please set it in Settings.`);
  if (!model) throw new Error('Model name is required');

  const callParams: any = {
    systemPrompt,
    userPrompt,
    model,
    apiKey,
    deepThinking,
    webSearch,
    ...(temperature !== undefined && { temperature }),
    ...(temperature_claude !== undefined && { temperature_claude }),
    ...(maxTokens !== undefined && { maxTokens }),
  };

  const logTag = target === 'Venice' ? '[venice]' : '[openRouter]';
  const sendLog = (level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
    console[level](msg);
    mainWindow?.webContents.send('main:log', { level, msg });
  };

  sendLog('log', `${logTag} dispatch → apiTarget=${target}, model=${model}, maxTokens=${maxTokens ?? 'default'}, temperature=${temperature ?? 'default'}`);

  // Abort any previous in-flight call
  if (activeInferenceAbortController) {
    activeInferenceAbortController.abort();
  }
  const abortController = new AbortController();
  activeInferenceAbortController = abortController;

  let result;
  try {
    if (abortController.signal.aborted) throw new Error('Inference cancelled.');
    if (target === 'Venice') {
      result = await callVenice(callParams, abortController.signal);
    } else {
      result = await callOpenRouter(callParams, abortController.signal);
    }
    sendLog('log', `${logTag} raw response:`, result);
  } catch (err: any) {
    if (activeInferenceAbortController === abortController) {
      activeInferenceAbortController = null;
    }
    return { success: false, content: err?.message ?? String(err), reasoning: undefined, usage: undefined };
  } finally {
    if (activeInferenceAbortController === abortController) {
      activeInferenceAbortController = null;
    }
  }

  if (result!.truncated) {
    sendLog('warn', `${logTag} Response truncated by token limit (finish_reason=length). The returned content may be incomplete.`);
  }

  return {
    success: true,
    content: result!.text,
    reasoning: result!.reasoning,
    usage: result!.usage,
    finishReason: result!.finishReason,
    truncated: result!.truncated,
    apiTarget: target,
  };
});

// Cancel ongoing inference
ipcMain.handle('openRouter:cancel', async () => {
  if (activeInferenceAbortController) {
    activeInferenceAbortController.abort();
    activeInferenceAbortController = null;
    return { cancelled: true };
  }
  return { cancelled: false };
});

// ─── EULA Agreement IPC ─────────────────────────────────────────────
ipcMain.handle('store:getEulaAgreed', () => {
  return store.get('eulaAgreed', false);
});

ipcMain.handle('store:setEulaAgreed', (_, value: boolean) => {
  store.set('eulaAgreed', value);
  return { success: true };
});

// ─── App Quit IPC ────────────────────────────────────────────────
ipcMain.handle('app:quit', () => {
  app.quit();
  return { success: true };
});

// ─── App Info IPC ────────────────────────────────────────────────
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

let markdownPreviewWindow: BrowserWindow | null = null;

// Preview settings (theme + view mode) persistence
ipcMain.handle('store:getPreviewSettings', () => {
  return {
    theme: store.get('previewTheme') || 'dark',
    mode: store.get('previewMode') || 'markdown',
    zoom: store.get('previewZoom') || 100,
  };
});

ipcMain.handle('store:savePreviewSettings', (_, settings: { theme: 'dark' | 'light'; mode: 'text' | 'markdown'; zoom: number }) => {
  store.set('previewTheme', settings.theme);
  store.set('previewMode', settings.mode);
  store.set('previewZoom', settings.zoom);
  return { success: true };
});

ipcMain.handle('markdown-preview:open', async (_, content: string) => {
  if (markdownPreviewWindow && !markdownPreviewWindow.isDestroyed()) {
    markdownPreviewWindow.focus();
    markdownPreviewWindow.webContents.send('markdown-preview:content', content);
    return;
  }

  const bounds = getValidatedPreviewWindowBounds();

  markdownPreviewWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    title: 'Markdown Preview',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    markdownPreviewWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?window=markdown-preview');
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    markdownPreviewWindow.loadFile(indexPath, { query: { window: 'markdown-preview' } });
  }

  markdownPreviewWindow.webContents.on('did-finish-load', () => {
    if (markdownPreviewWindow && !markdownPreviewWindow.isDestroyed()) {
      markdownPreviewWindow.webContents.send('markdown-preview:content', content, Date.now());
    }
  });

  const savePreviewBounds = () => {
    if (markdownPreviewWindow && !markdownPreviewWindow.isMinimized() && !markdownPreviewWindow.isDestroyed()) {
      store.set('previewWindowBounds', markdownPreviewWindow.getBounds());
    }
  };
  markdownPreviewWindow.on('resize', savePreviewBounds);
  markdownPreviewWindow.on('move', savePreviewBounds);
  markdownPreviewWindow.on('close', savePreviewBounds);

  markdownPreviewWindow.on('closed', () => {
    markdownPreviewWindow = null;
  });
});

ipcMain.handle('markdown-preview:update', (_, content: string, ts?: number) => {
  if (markdownPreviewWindow && !markdownPreviewWindow.isDestroyed()) {
    markdownPreviewWindow.webContents.send('markdown-preview:content', content, ts ?? Date.now());
  }
});

// Content pushed from preview window back to main window (2-way sync)
ipcMain.handle('markdown-preview:content-from-preview', (_, content: string, ts?: number) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('markdown-preview:content-from-preview', content, ts ?? Date.now());
  }
});

// App lifecycle
app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});