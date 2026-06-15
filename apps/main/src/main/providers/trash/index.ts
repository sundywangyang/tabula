/**
 * TrashProvider 工厂 — 按 process.platform 选平台实现, 缓存单例.
 */
import type { TrashProvider } from './types';
import { WindowsTrashProvider } from './windows';
import { MacosTrashProvider } from './macos';
import { LinuxTrashProvider } from './linux';

let _instance: TrashProvider | null = null;

export function getTrashProvider(): TrashProvider {
  if (_instance) return _instance;
  switch (process.platform) {
    case 'win32':
      _instance = new WindowsTrashProvider();
      break;
    case 'darwin':
      _instance = new MacosTrashProvider();
      break;
    default:
      _instance = new LinuxTrashProvider();
  }
  return _instance;
}

export function setTrashProviderForTesting(p: TrashProvider | null): void {
  _instance = p;
}

export type { TrashProvider } from './types';
