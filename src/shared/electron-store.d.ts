declare module 'electron-store' {
  interface Options<T> {
    defaults?: T;
    name?: string;
    fileExtension?: string;
    clearInvalidConfig?: boolean;
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
    encryptionKey?: string | Buffer | NodeJS.TypedArray | DataView;
  }

  class Store<T extends Record<string, any> = Record<string, any>> {
    constructor(options?: Options<T>);
    get<K extends keyof T>(key: K): T[K];
    get<K extends keyof T>(key: K, defaultValue: T[K]): T[K];
    set<K extends keyof T>(key: K, value: T[K]): void;
    has(key: keyof T): boolean;
    delete(key: keyof T): void;
    clear(): void;
    size: number;
    store: T;
    path: string;
    openInEditor(): void;
  }

  export = Store;
}