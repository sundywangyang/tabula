/**
 * 文件/文件夹重命名（原子 rename）
 */
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

export async function rename(oldPath: string, newPath: string): Promise<Result<void>> {
  try {
    await fs.rename(oldPath, newPath);
    return { ok: true, data: undefined };
  } catch (err) {
    return mapError(err, oldPath);
  }
}
