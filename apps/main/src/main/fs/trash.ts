/**
 * 回收站服务 — 跨平台薄 facade
 *
 * 实际平台实现(Windows PowerShell COM / macOS AppleScript / Linux XDG+gio)
 * 已统一搬到 platform/{win,mac,linux}.ts,本文件只负责:
 *  - 对外暴露稳定的 API(trashList / trashRestore / trashEmpty)
 *  - 提供 `ok` / `mapError` 两个共享小工具,供平台模块和本 facade 共用
 *
 * 调用方(IPC handler)继续 import 本文件,API 签名不变,内部实现已切换。
 */
import { ok, mapError } from './result';
import { getPlatform } from '../platform';
import type { Result, TrashListResult } from '@tabula/bridge';

export { ok, mapError };

/**
 * 列出回收站内容(跨平台)
 */
export async function trashList(): Promise<Result<TrashListResult>> {
  return getPlatform().trash.list();
}

/**
 * 从回收站恢复文件(跨平台)
 */
export async function trashRestore(
  itemPath: string,
  originalPath?: string,
): Promise<Result<void>> {
  return getPlatform().trash.restore(itemPath, originalPath);
}

/**
 * 清空回收站(跨平台)
 */
export async function trashEmpty(): Promise<Result<void>> {
  return getPlatform().trash.empty();
}
