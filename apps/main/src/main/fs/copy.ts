/**
 * 复制文件/文件夹（递归）
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

export async function copy(req: MoveOrCopyRequest): Promise<Result<void>> {
  for (const src of req.sources) {
    try {
      const dest = join(req.destination, basename(src));
      await fs.cp(src, dest, { recursive: true, force: req.overwrite ?? false });
    } catch (err) {
      return mapError(err, src);
    }
  }
  return { ok: true, data: undefined };
}
