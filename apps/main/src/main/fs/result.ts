/**
 * 主进程 fs 模块共享的 Result 工具函数。
 * 避免每个 fs 文件重复定义 ok() / mapError()。
 */
import type { FsError, Result } from '@tabula/bridge';

/** 成功响应 */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 将 Node.js / fs 异常映射为 FsError */
export function mapError(err: unknown, path?: string): Result<never> {
  const e = err as NodeJS.ErrnoException;
  return {
    ok: false,
    error: {
      code: (e?.code as FsError['code']) ?? 'UNKNOWN',
      message: e?.message ?? String(err),
      path,
    },
  };
}
