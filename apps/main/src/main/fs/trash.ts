/**
/**
 * 回收站服务 (P7: 委托给 TrashProvider)
 *
 * 平台特定实现见 providers/trash/{macos,windows,linux}.ts
 * 工厂 getTrashProvider() 按 process.platform 选实现.
 */
import type { Result, TrashListResult } from '@tabula/bridge';
import { getTrashProvider } from '../providers/trash';

/** 列出回收站内容 (跨平台) */
export async function trashList(): Promise<Result<TrashListResult>> {
  return getTrashProvider().list();
}

/** 从回收站恢复文件 (跨平台) */
export async function trashRestore(
  itemPath: string,
  originalPath?: string,
): Promise<Result<void>> {
  return getTrashProvider().restore(itemPath, originalPath);
}

/** 清空回收站 (跨平台) */
export async function trashEmpty(): Promise<Result<void>> {
  return getTrashProvider().empty();
}
