export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  children?: FileItem[];
  isChecked?: boolean;
  isHighlighted?: boolean;
}

export interface FileContent {
  content: string;
  path: string;
}

export interface StoreConfig {
  lastOpenedFolder?: string;
}