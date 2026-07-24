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
  const explicitDests: ReadonlyArray<string | undefined> = req.destinations ?? [];
  for (let i = 0; i < req.sources.length; i++) {
    const src = req.sources[i];
    // 优先用显式 dest(透传渲染端可能生成的重命名);缺省时回退默认行为。
    const dest = explicitDests[i] ?? join(req.destination, basename(src));
    // 守卫:src===dest 时直接跳过(rename 自己到自己会抛,cp 也会 EINVAL)。
    if (dest === src) {
      // eslint-disable-next-line no-console
      console.error('[fs-move] skipping (src==dest):', JSON.stringify(src));
      continue;
    }
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
