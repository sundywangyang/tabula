/**
 * G010: 文件只读状态缓存(模块级 + listener + 纯函数)。
 *
 * 设计:
 * - 缓存 path → 上次读到的 POSIX mode
 * - 写入时通知所有订阅者,让 ContextMenu 触发 force re-render
 * - 提供 `resolveLockMenuLabel` 纯函数,根据 cached mode 决定「锁定/解锁」菜单文案
 * - 提供 `loadReadonlyForPath` 拉一次 stat 写缓存(走 `window.tabula.fs.stat`,
 *   因此不在测试中导入 — 测试只覆盖纯函数 + 缓存读写)
 */
import { isReadOnly } from '../utils/permissions';

/** G010: 缓存 path → 上次读到的 POSIX mode */
const readonlyCache = new Map<string, number>();

/** G010: 缓存变更订阅者(ContextMenu 订阅后 force re-render) */
const readonlyCacheListeners = new Set<() => void>();

/** 取某路径缓存的 mode(无则返回 undefined) */
export function getCachedReadonly(path: string): number | undefined {
  return readonlyCache.get(path);
}

/** 设置某路径 mode 并通知订阅者 */
export function setCachedReadonly(path: string, mode: number): void {
  readonlyCache.set(path, mode);
  readonlyCacheListeners.forEach((fn) => fn());
}

/** 订阅缓存变化(返回取消订阅的函数) */
export function subscribeReadonlyCache(fn: () => void): () => void {
  readonlyCacheListeners.add(fn);
  return () => {
    readonlyCacheListeners.delete(fn);
  };
}

/**
 * 根据 cached mode 决定「锁定/解锁」菜单文案 + icon。
 * - undefined → 乐观显示「锁定」(常见默认是可写)
 * - isReadOnly(mode) → true → 「解锁」
 * - isReadOnly(mode) → false → 「锁定」
 */
export function resolveLockMenuLabel(cachedMode: number | undefined): {
  label: string;
  icon: string;
} {
  if (cachedMode === undefined) {
    return { label: '锁定', icon: '🔒' };
  }
  return isReadOnly(cachedMode)
    ? { label: '解锁', icon: '🔓' }
    : { label: '锁定', icon: '🔒' };
}

/**
 * 拉一次 path 的 stat.mode 写入缓存并通知订阅者。
 * 失败返回 null(调用方应忽略)。
 */
export async function loadReadonlyForPath(path: string): Promise<number | null> {
  const res = await window.tabula.fs.stat(path);
  if (!res.ok) return null;
  setCachedReadonly(path, res.data.mode);
  return res.data.mode;
}
