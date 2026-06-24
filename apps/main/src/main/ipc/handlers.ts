/**
 * 单独的 IPC handler 工厂,便于单测。
 *
 * 把 handler 主体抽出来(不依赖 electron 的 ipcMain),可由 registerIpcHandlers
 * 包装,也可在 vitest 中直接传 mock chmod 测试。
 */
import { chmod as realChmod } from 'node:fs/promises';
import type { FsError, FsErrorCode, FsSetPermissionsRequest, Result } from '@tabula/bridge';

/** 与 `node:fs/promises` 的 chmod 同形,便于注入 mock */
export type ChmodFn = (
  path: string,
  mode: number,
) => Promise<void>;

/**
 * G010: 设置文件 read-only 权限。
 * - readonly=true  → chmod 0o444 (Windows: FS ReadOnly bit)
 * - readonly=false → chmod 0o644 (Windows: 清除 ReadOnly bit)
 *
 * 错误返回:统一的 FsError(ENOENT/EACCES/IO_ERROR 等)。
 */
export async function handleSetPermissions(
  req: FsSetPermissionsRequest,
  chmod: ChmodFn = realChmod,
): Promise<Result<void>> {
  try {
    if (!req || typeof req.path !== 'string' || req.path.length === 0) {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: 'invalid path' } };
    }
    if (typeof req.readonly !== 'boolean') {
      return { ok: false, error: { code: 'UNKNOWN' as FsErrorCode, message: 'invalid readonly flag' } };
    }
    await chmod(req.path, req.readonly ? 0o444 : 0o644);
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const error: FsError = {
      code: (err.code as FsErrorCode) ?? 'IO_ERROR',
      message: err.message,
      path: req?.path,
    };
    return { ok: false, error };
  }
}
