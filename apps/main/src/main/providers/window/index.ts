/**
 * WindowProvider 工厂 — 按 process.platform 选实现, 缓存单例.
 */
import type { WindowProvider } from './types';
import { MacosWindowProvider } from './macos';
import { WindowsWindowProvider } from './windows';
import { LinuxWindowProvider } from './linux';

let _instance: WindowProvider | null = null;

export function getWindowProvider(): WindowProvider {
  if (_instance) return _instance;
  switch (process.platform) {
    case 'darwin':
      _instance = new MacosWindowProvider();
      break;
    case 'win32':
      _instance = new WindowsWindowProvider();
      break;
    default:
      _instance = new LinuxWindowProvider();
  }
  return _instance;
}

export function setWindowProviderForTesting(p: WindowProvider | null): void {
  _instance = p;
}

export type { WindowProvider, TitleBarStyle } from './types';
