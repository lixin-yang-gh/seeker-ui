const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  readDirectory: (path) => ipcRenderer.invoke('fs:readDirectory', path),

  getFileStats: (path) => ipcRenderer.invoke('get-file-stats', path),

  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', { path, content }),

  getLastOpenedFolder: () => ipcRenderer.invoke('store:getLastOpenedFolder'),
  saveLastOpenedFolder: (path) => ipcRenderer.invoke('store:saveLastOpenedFolder', path),

  // Bulk folder state operations
  getFolderState: (folderPath) => ipcRenderer.invoke('store:getFolderState', folderPath),
  saveFolderState: (folderPath, state) => ipcRenderer.invoke('store:saveFolderState', folderPath, state),

  // Individual operations (for granular auto-saving)
  getSystemPrompt: (folderPath) => ipcRenderer.invoke('store:getSystemPrompt', folderPath),
  saveSystemPrompt: (folderPath, value) => ipcRenderer.invoke('store:saveSystemPrompt', folderPath, value),

  getTask: (folderPath) => ipcRenderer.invoke('store:getTask', folderPath),
  saveTask: (folderPath, value) => ipcRenderer.invoke('store:saveTask', folderPath, value),

  getSelectedHeader: (folderPath) => ipcRenderer.invoke('store:getSelectedHeader', folderPath),
  saveSelectedHeader: (folderPath, value) => ipcRenderer.invoke('store:saveSelectedHeader', folderPath, value),

  getIssues: (folderPath) => ipcRenderer.invoke('store:getIssues', folderPath),
  saveIssues: (folderPath, value) => ipcRenderer.invoke('store:saveIssues', folderPath, value),

  getMaskedSubstrings: (folderPath) => ipcRenderer.invoke('store:getMaskedSubstrings', folderPath),
  saveMaskedSubstrings: (folderPath, value) => ipcRenderer.invoke('store:saveMaskedSubstrings', folderPath, value),

  // Default System Prompt operations (global)
  getDefaultSystemPrompt: () => ipcRenderer.invoke('store:getDefaultSystemPrompt'),
  saveDefaultSystemPrompt: (value) => ipcRenderer.invoke('store:saveDefaultSystemPrompt', value),

  // API Settings (global)
  getApiSettings: () => ipcRenderer.invoke('store:getApiSettings'),
  saveApiSettings: (settings) => ipcRenderer.invoke('store:saveApiSettings', settings),

  // File dialogs for import/export
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),

  redactText: (text) => ipcRenderer.invoke('redact-text', text),

  callOpenRouter: (systemPrompt, userPrompt, model, options) =>
    ipcRenderer.invoke('openRouter:call', { systemPrompt, userPrompt, model, ...options }),

  cancelOpenRouter: () => ipcRenderer.invoke('openRouter:cancel'),

  on: (channel, callback) => {
    ipcRenderer.on(channel, (_, ...args) => callback(...args));
  },
  onMainLog: (callback) => {
    ipcRenderer.on('main:log', (_, data) => callback(data));
  },

  // EULA agreement
  getEulaAgreed: () => ipcRenderer.invoke('store:getEulaAgreed'),
  setEulaAgreed: (value) => ipcRenderer.invoke('store:setEulaAgreed', value),

  // Quit application
  quitApp: () => ipcRenderer.invoke('app:quit'),
});