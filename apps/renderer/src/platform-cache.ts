/**
 * Renderer 端平台信息缓存
 * 在 App 初始化时从主进程加载一次,之后各处同步读取。
 */
import type { PlatformType } from '@tabula/bridge';

let _cachedRootPath: string | null = null;
let _cachedPlatform: PlatformType | null = null;

export async function initPlatformCache(): Promise<void> {
  [_cachedPlatform, _cachedRootPath] = await Promise.all([
    window.tabula.platform.get(),
    window.tabula.platform.defaultRootPath(),
  ]);
}

export function getCachedRootPath(): string {
  return _cachedRootPath ?? '/';
}

export function getCachedPlatform(): PlatformType {
  return _cachedPlatform ?? 'macos';
}
