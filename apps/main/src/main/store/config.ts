/**
 * 配置存储
 *
 * 用 electron-store 持久化到 userData 目录。
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

export async function loadConfig(): Promise<AppConfig> {
  if (!store) {
    store = new Store<AppConfig>({
      name: 'tabula-config',
      defaults: { ...DEFAULTS, extensionsDir: join(app.getPath('userData'), 'extensions') },
    });
  }
  return store.store;
}

export function getConfig<K extends keyof AppConfig>(key: K): AppConfig[K] {
  if (!store) {
    store = new Store<AppConfig>({
      name: 'tabula-config',
      defaults: { ...DEFAULTS, extensionsDir: join(app.getPath('userData'), 'extensions') },
    });
  }
  return store.get(key);
}

export function setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
  if (!store) {
    store = new Store<AppConfig>({
      name: 'tabula-config',
      defaults: { ...DEFAULTS, extensionsDir: join(app.getPath('userData'), 'extensions') },
    });
  }
  store.set(key, value);
}

export function getAllConfig(): AppConfig {
  if (!store) {
    store = new Store<AppConfig>({
      name: 'tabula-config',
      defaults: { ...DEFAULTS, extensionsDir: join(app.getPath('userData'), 'extensions') },
    });
  }
  return store.store;
}
