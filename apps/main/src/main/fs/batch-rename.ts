import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Result } from '@tabula/bridge';
import { assertAbsent, containsPath, fileError, pathExists, pathKey } from './path-safety';
import { mapError, ok } from './result';

export interface RenameItem { oldPath: string; newPath: string }

/** Stage every source before assigning any final name, including chains and cycles. */
export async function batchRename(items: RenameItem[]): Promise<Result<void>> {
  const tasks = items.filter((item) => item.oldPath !== item.newPath).map((item) => ({
    ...item,
    temp: join(dirname(item.oldPath), `.tabula-rename-${randomUUID()}`),
    staged: false,
    committed: false,
  }));
  try {
    const sources = new Set(tasks.map((item) => pathKey(item.oldPath)));
    const targets = new Set(tasks.map((item) => pathKey(item.newPath)));
    if (sources.size !== tasks.length || targets.size !== tasks.length) {
      throw fileError('EEXIST', '批量重命名包含重复的源或目标');
    }
    for (const item of tasks) {
      if (pathKey(dirname(item.oldPath)) !== pathKey(dirname(item.newPath)) || !basename(item.newPath)) {
        throw fileError('EINVAL', '重命名不能改变所在目录');
      }
      if (tasks.some((other) => containsPath(other.oldPath, item.oldPath))) {
        throw fileError('EINVAL', '不能同时重命名父目录和子项');
      }
      await fs.lstat(item.oldPath);
      if (!sources.has(pathKey(item.newPath)) && await pathExists(item.newPath)) {
        throw fileError('EEXIST', `目标已存在: ${item.newPath}`);
      }
    }
    for (const item of tasks) {
      await assertAbsent(item.temp);
      await fs.rename(item.oldPath, item.temp);
      item.staged = true;
    }
    for (const item of tasks) {
      await assertAbsent(item.newPath);
      await fs.rename(item.temp, item.newPath);
      item.committed = true;
    }
    return ok(undefined);
  } catch (error) {
    const rollbackErrors: string[] = [];
    // Vacate final names first; a final name can be another task's original name.
    for (const item of [...tasks].reverse()) {
      if (!item.committed) continue;
      try {
        await assertAbsent(item.temp);
        await fs.rename(item.newPath, item.temp);
        item.committed = false;
      } catch (rollbackError) {
        rollbackErrors.push(`${item.newPath}: ${String(rollbackError)}`);
      }
    }
    for (const item of [...tasks].reverse()) {
      if (!item.staged || item.committed) continue;
      try {
        await assertAbsent(item.oldPath);
        await fs.rename(item.temp, item.oldPath);
      } catch (rollbackError) {
        rollbackErrors.push(`可恢复文件 ${item.temp}: ${String(rollbackError)}`);
      }
    }
    return mapError(rollbackErrors.length
      ? new Error(`${String(error)}; 回滚未完成: ${rollbackErrors.join('; ')}`)
      : error);
  }
}
