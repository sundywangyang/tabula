/**
 * G010: set-permissions handler 单测
 *
 * 覆盖:
 * - readonly=true  → chmod called with 0o444
 * - readonly=false → chmod called with 0o644
 * - chmod throws   → Result.error (IO_ERROR / ENOENT 透传)
 * - 不存在的路径   → Result.error (chmod 抛 ENOENT)
 * - 入参校验:空 path / 非 boolean readonly → Result.error
 */
import { describe, expect, it, vi } from 'vitest';
import { handleSetPermissions } from '../handlers';
import type { FsError, FsSetPermissionsRequest, Result } from '@tabula/bridge';

function makeReq(overrides: Partial<FsSetPermissionsRequest> = {}): FsSetPermissionsRequest {
  return { path: '/tmp/file.txt', readonly: true, ...overrides };
}

describe('handleSetPermissions (G010)', () => {
  it('readonly=true → chmod called with 0o444', async () => {
    const chmod = vi.fn().mockResolvedValue(undefined);
    const res = (await handleSetPermissions(makeReq({ readonly: true }), chmod)) as Result<void>;
    expect(res.ok).toBe(true);
    expect(chmod).toHaveBeenCalledTimes(1);
    expect(chmod).toHaveBeenCalledWith('/tmp/file.txt', 0o444);
  });

  it('readonly=false → chmod called with 0o644', async () => {
    const chmod = vi.fn().mockResolvedValue(undefined);
    const res = (await handleSetPermissions(makeReq({ readonly: false }), chmod)) as Result<void>;
    expect(res.ok).toBe(true);
    expect(chmod).toHaveBeenCalledTimes(1);
    expect(chmod).toHaveBeenCalledWith('/tmp/file.txt', 0o644);
  });

  it('chmod throws (无 code) → Result.error code=IO_ERROR', async () => {
    const chmod = vi.fn().mockRejectedValue(new Error('boom'));
    const res = (await handleSetPermissions(makeReq(), chmod)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('IO_ERROR');
      expect((res.error as FsError).message).toBe('boom');
      expect((res.error as FsError).path).toBe('/tmp/file.txt');
    }
  });

  it('chmod throws ENOENT (不存在的路径) → Result.error code=ENOENT', async () => {
    const e = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const chmod = vi.fn().mockRejectedValue(e);
    const res = (await handleSetPermissions(makeReq({ path: '/nope/missing.txt', readonly: true }), chmod)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('ENOENT');
      expect((res.error as FsError).path).toBe('/nope/missing.txt');
    }
  });

  it('readonly=true + chmod throws EACCES → Result.error code=EACCES', async () => {
    const e = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const chmod = vi.fn().mockRejectedValue(e);
    const res = (await handleSetPermissions(makeReq({ readonly: true }), chmod)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('EACCES');
    }
  });

  it('空 path → Result.error code=UNKNOWN', async () => {
    const chmod = vi.fn();
    const res = (await handleSetPermissions({ path: '', readonly: true }, chmod)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
    }
    expect(chmod).not.toHaveBeenCalled();
  });

  it('非 boolean readonly → Result.error code=UNKNOWN', async () => {
    const chmod = vi.fn();
    // @ts-expect-error testing invalid input
    const res = (await handleSetPermissions({ path: '/tmp/x', readonly: 'yes' }, chmod)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
    }
    expect(chmod).not.toHaveBeenCalled();
  });
});
