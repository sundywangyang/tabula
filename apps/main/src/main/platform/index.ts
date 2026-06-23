/**
 * 平台抽象层 — 公共 API
 *
 * 业务模块通过 `getPlatform()` 拿到当前平台的 adapter,再访问具体能力:
 *   getPlatform().trash.list()
 *   getPlatform().window.getIconPath(ctx)
 *   getPlatform().shell.openTerminal(p)
 *
 * 平台检测在模块加载时一次性完成(进程内不变),后续调用零开销。
 */
import type { PlatformAdapter, PlatformId, PlatformName } from './types';
import { winAdapter } from './win';
import { macAdapter } from './mac';
import { linuxAdapter } from './linux';

export type { PlatformAdapter, PlatformId, PlatformName, ResolvePathContext } from './types';
export { winAdapter, macAdapter, linuxAdapter };

/** 进程级单例:启动时按 process.platform 选定,后续不可变 */
const _platform: PlatformAdapter = (() => {
  switch (process.platform) {
    case 'win32': return winAdapter;
    case 'darwin': return macAdapter;
    case 'linux': return linuxAdapter;
    default:
      // 不支持的平台(理论上 Electron 不会运行到这):fallback 到 linux
      console.warn(`[platform] unsupported platform: ${process.platform}, falling back to linux adapter`);
      return linuxAdapter;
  }
})();

/** 取当前平台 adapter(主入口) */
export function getPlatform(): PlatformAdapter {
  return _platform;
}

/** 平台 id(win32 / darwin / linux) */
export function getPlatformId(): PlatformId {
  return _platform.id;
}

/** 业务侧平台名(windows / macos / linux,给 UI / IPC 用) */
export function getPlatformName(): PlatformName {
  return _platform.name;
}

export const isWindows = (): boolean => _platform.id === 'win32';
export const isMacOS = (): boolean => _platform.id === 'darwin';
export const isLinux = (): boolean => _platform.id === 'linux';
