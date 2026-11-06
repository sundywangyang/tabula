/**
 * 配置存储
 *
 * 用 electron-store 持久化到 userData 目录;读写失败时仅在本次运行中回退到内存。
 */
import Store from 'electron-store';
import { join } from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '@tabula/bridge';

const DEFAULTS: AppConfig = {
  theme: 'system',
  language: 'zh-CN',
  showHidden: false,
  showExtensions: true,
  defaultView: 'details',
  sortBy: 'name',
  sortDir: 'asc',
  confirmDelete: true,
  openInNewTab: true,
  extensionsDir: '',  // 启动时填
};

let store: Store<AppConfig> | null = null;
let memoryConfig: AppConfig | null = null;

function defaultConfig(): AppConfig {
  return { ...DEFAULTS, extensionsDir: join(app.getPath('userData'), 'extensions') };
}

function persistentStore(): Store<AppConfig> {
  if (!store) {
    store = new Store<AppConfig>({
      name: 'tabula-config',
      defaults: defaultConfig(),
      clearInvalidConfig: false,
    });
  }
  return store;
}

function useMemoryConfig(error: unknown): AppConfig {
  if (!memoryConfig) {
    memoryConfig = defaultConfig();
    console.warn('[config] configuration unavailable; using in-memory defaults for this run, original file preserved', error);
  }
  return memoryConfig;
}

export async function loadConfig(): Promise<AppConfig> {
  return getAllConfig();
}

export function getConfig<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return getAllConfig()[key];
}

export function setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
  if (memoryConfig) {
    memoryConfig[key] = value;
    return;
  }
  try {
    persistentStore().set(key, value);
  } catch (error) {
    useMemoryConfig(error)[key] = value;
  }
}

export function getAllConfig(): AppConfig {
  if (memoryConfig) return { ...memoryConfig };
  try {
    return persistentStore().store;
  } catch (error) {
    return { ...useMemoryConfig(error) };
  }
}
