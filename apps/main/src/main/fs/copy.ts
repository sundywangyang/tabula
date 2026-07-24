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
  const explicitDests: ReadonlyArray<string | undefined> = req.destinations ?? [];
  for (let i = 0; i < req.sources.length; i++) {
    const src = req.sources[i];
    try {
      // 优先用显式 dest(渲染端 paste 时若已生成 `- 副本` 重命名,会通过这里透传);
      // 缺省时回退到「destination + basename(src)」,保持向后兼容。
      const dest = explicitDests[i] ?? join(req.destination, basename(src));
      // 守卫:如果 dest 与 src 完全相同,跳过(否则 fs.cp 抛 EINVAL)。
      // 这覆盖了同目录粘贴的边界情况。
      if (dest === src) {
        // eslint-disable-next-line no-console
        console.error('[fs-copy] skipping (src==dest):', JSON.stringify(src));
        continue;
      }
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
