/**
 * ShellProvider 工厂 — 按 process.platform 选平台实现, 缓存单例.
 */
import type { ShellProvider } from './types';
import { WindowsShellProvider } from './windows';
import { MacosShellProvider } from './macos';
import { LinuxShellProvider } from './linux';

let _instance: ShellProvider | null = null;

export function getShellProvider(): ShellProvider {
  if (_instance) return _instance;
  switch (process.platform) {
    case 'win32':
      _instance = new WindowsShellProvider();
      break;
    case 'darwin':
      _instance = new MacosShellProvider();
      break;
    default:
      _instance = new LinuxShellProvider();
  }
  return _instance;
}

/** 测试 / 特殊场景: 强制覆盖 */
export function setShellProviderForTesting(p: ShellProvider | null): void {
  _instance = p;
}

export type { ShellProvider } from './types';
