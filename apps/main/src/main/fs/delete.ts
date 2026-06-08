/**
 * 删除文件/文件夹到回收站
 *
 * Windows: 使用 shell.trashItem（默认行为）。
 * 永久删除: useTrash=false。
 */
import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import type { Result } from '@tabula/bridge';

function mapError(err: unknown, path?: string): Result<never> {
  const e = err as NodeJS.ErrnoException;
  const code = (e?.code ?? 'UNKNOWN') as import('@tabula/bridge').FsErrorCode;
  return {
    ok: false,
    error: { code, message: e?.message ?? String(err), path },
  };
}

export async function deletePaths(paths: string[], useTrash = true): Promise<Result<void>> {
  if (useTrash && process.platform === 'win32') {
    for (const p of paths) {
      try {
        await shell.trashItem(p);
      } catch (err) {
        return mapError(err, p);
      }
    }
    return { ok: true, data: undefined };
  }
  // 非 Windows 或 useTrash=false: 永久删除
  for (const p of paths) {
    try {
      const stat = await fs.lstat(p);
      if (stat.isDirectory()) {
        await fs.rm(p, { recursive: true, force: true });
      } else {
        await fs.unlink(p);
      }
    } catch (err) {
      return mapError(err, p);
    }
  }
  return { ok: true, data: undefined };
}
