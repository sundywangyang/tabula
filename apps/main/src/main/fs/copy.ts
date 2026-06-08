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
      // eslint-disable-next-line no-console
      console.error('[fs-copy] copying', JSON.stringify(src), '->', JSON.stringify(dest));
      await fs.cp(src, dest, { recursive: true, force: req.overwrite ?? false });
      // eslint-disable-next-line no-console
      console.error('[fs-copy] success:', dest);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // eslint-disable-next-line no-console
      console.error('[fs-copy] ERROR code=', e.code, 'msg=', e.message);
      return mapError(err, src);
    }
  }
  return { ok: true, data: undefined };
}
