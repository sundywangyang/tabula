/**
 * DriveProvider 工厂 — 按 process.platform 选平台实现, 缓存单例。
 */
import type { DriveProvider } from './types';
import { WindowsDriveProvider } from './windows';
import { MacosDriveProvider } from './macos';
import { LinuxDriveProvider } from './linux';

let _instance: DriveProvider | null = null;

export function getDriveProvider(): DriveProvider {
  if (_instance) return _instance;
  switch (process.platform) {
    case 'win32':
      _instance = new WindowsDriveProvider();
      break;
    case 'darwin':
      _instance = new MacosDriveProvider();
      break;
    default:  // linux + 其他 unix-like
      _instance = new LinuxDriveProvider();
  }
  return _instance;
}

/** 测试/特殊场景: 强制覆盖 (例如 mock 一个 platform) */
export function setDriveProviderForTesting(p: DriveProvider | null): void {
  _instance = p;
}

export type { DriveProvider } from './types';
