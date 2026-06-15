/**
 * TrashProvider — 平台特定的"回收站 list / restore / empty"能力抽象。
 *
 * 为什么不直接 if/else: 三个平台 Shell 调用完全不同 (Win SHFileOperation / Recycle
 * Bin, macOS AppleScript / Finder, Linux gio trash-cli). 同文件 3 个 API × 3 平台
 * 共 9 个函数, if 链维护难, 也不利于单平台单元测试.
 *
 * 工厂按 process.platform 选实现, 调用方拿 TrashProvider 接口就能 list/restore/empty.
 */
import type { FsErrorCode, Result, TrashListResult } from '@tabula/bridge';

export interface TrashProvider {
  list(): Promise<Result<TrashListResult>>;
  /** 把 itemPath 标识的回收站项目恢复到 originalPath(可选) */
  restore(itemPath: string, originalPath?: string): Promise<Result<void>>;
  /** 清空整个回收站 */
  empty(): Promise<Result<void>>;
}

/**
 * 把 NodeJS.ErrnoException.code (string) 收窄到 FsErrorCode union.
 * 未知 code 降级为 'UNKNOWN'.
 */
export function toFsErrorCode(code: string | undefined): FsErrorCode {
  switch (code) {
    case 'ENOENT': return 'ENOENT';
    case 'EACCES': return 'EACCES';
    case 'EEXIST': return 'EEXIST';
    case 'ENOTDIR': return 'ENOTDIR';
    case 'EISDIR': return 'EISDIR';
    case 'EBUSY': return 'EBUSY';
    default: return 'UNKNOWN';
  }
}

