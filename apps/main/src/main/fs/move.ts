/**
 * 移动文件/文件夹
 *
 * 优先尝试原子 rename，跨盘失败时降级到 copy + delete。
 */
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import type { MoveOrCopyRequest, Result } from '@tabula/bridge';

function mapError(err: unknown, path?: string): Result<never> {
  const e = err as NodeJS.ErrnoException;
  const code = (e?.code ?? 'UNKNOWN') as import('@tabula/bridge').FsErrorCode;
  return {
    ok: false,
    error: { code, message: e?.message ?? String(err), path },
  };
}

export async function move(req: MoveOrCopyRequest): Promise<Result<void>> {
  for (const src of req.sources) {
    const dest = join(req.destination, basename(src));
    let renamed = false;
    try {
      await fs.rename(src, dest);
      renamed = true;
    } catch {
      // rename 跨盘失败，降级到 copy + delete
    }
    if (!renamed) {
      try {
        await fs.cp(src, dest, { recursive: true });
        await fs.rm(src, { recursive: true, force: true });
      } catch (err) {
        return mapError(err, src);
      }
    }
  }
  return { ok: true, data: undefined };
}
