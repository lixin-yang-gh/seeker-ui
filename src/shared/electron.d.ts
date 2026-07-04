// src/shared/electron.d.ts
export { };

// Mirror the interface from main process for type safety
interface FolderSpecificState {
  systemPrompt?: string;
  task?: string;
  issues?: string;
  selectedHeader?: string;
  maskedSubstrings?: string;
  inferenceModel?: string;
  temperature?: number;
}

declare global {
  interface Window {
    electronAPI: {
      // Dialog operations
      openDirectory: () => Promise<string | null>;
      openFileDialog: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      saveFileDialog: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;

      // File system operations
      readDirectory: (path: string) => Promise<Array<{
        name: string;
        path: string;
        isDirectory: boolean;
        isFile: boolean;
      }>>;

      readFile: (path: string) => Promise<{
        content: string;
        path: string;
      }>;

      getFileStats: (path: string) => Promise<{
        size: number;
        isDirectory: boolean;
        isFile: boolean;
        mtime: number;
        birthtime: number;
      }>;

      writeFile: (path: string, content: string) => Promise<{ success: boolean }>;

      // Store operations
      getLastOpenedFolder: () => Promise<string | undefined>;
      saveLastOpenedFolder: (path: string) => Promise<{ success: true }>;

      // Bulk folder state operations
      getFolderState: (folderPath: string) => Promise<FolderSpecificState | undefined>;
      saveFolderState: (folderPath: string, state: FolderSpecificState) => Promise<{ success: true }>;

      // Individual prompt persistence operations
      getSystemPrompt: (folderPath: string) => Promise<string>;
      saveSystemPrompt: (folderPath: string, value: string) => Promise<{ success: true }>;
      getTask: (folderPath: string) => Promise<string>;
      saveTask: (folderPath: string, value: string) => Promise<{ success: true }>;
      getSelectedHeader: (folderPath: string) => Promise<string>;
      saveSelectedHeader: (folderPath: string, value: string) => Promise<{ success: true }>;
      getIssues: (folderPath: string) => Promise<string>;
      saveIssues: (folderPath: string, value: string) => Promise<{ success: true }>;
      getMaskedSubstrings: (folderPath: string) => Promise<string>;
      saveMaskedSubstrings: (folderPath: string, value: string) => Promise<{ success: true }>;

      // Default System Prompt operations (global)
      getDefaultSystemPrompt: () => Promise<string>;
      saveDefaultSystemPrompt: (value: string) => Promise<{ success: true }>;

      // API Settings (global)
      getApiSettings: () => Promise<{ openRouterApiKey: string; inferenceModels: string; validationModels: string }>;
      saveApiSettings: (settings: { openRouterApiKey: string; inferenceModels: string; validationModels: string }) => Promise<{ success: true }>;

      redactText: (text: string) => Promise<string>;

      callOpenRouter: (
        systemPrompt: string,
        userPrompt: string,
        model: string,
        options?: {
          deepThinking?: { enabled: boolean; budgetTokens?: number };
          webSearch?: { enabled: boolean; maxResults?: number };
          temperature?: number;
          temperature_claude?: number;
        }
      ) => Promise<{ success: true; content: string; reasoning?: string; usage?: object }>;

      // Events
      on: (channel: string, callback: (...args: any[]) => void) => void;
      onMainLog: (callback: (data: { level: 'log' | 'warn' | 'error'; msg: string }) => void) => void;
    };
  }
}