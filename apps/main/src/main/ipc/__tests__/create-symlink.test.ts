/**
 * G011: create-symlink handler 单测
 *
 * 覆盖:
 * - target 是目录 → symlink 用 type='junction'
 * - target 是文件 → symlink 用 type='file'
 * - stat 抛错 → Result.error
 * - symlink 抛错 → Result.error
 * - 入参校验:空 target / 空 linkPath → Result.error
 */
import { describe, expect, it, vi } from 'vitest';
import { handleCreateSymlink } from '../handlers';
import type {
  FsCreateSymlinkRequest,
  FsError,
  Result,
} from '@tabula/bridge';
import type { StatFn, SymlinkFn } from '../handlers';

function makeReq(overrides: Partial<FsCreateSymlinkRequest> = {}): FsCreateSymlinkRequest {
  return {
    target: '/tmp/source-dir',
    linkPath: '/tmp/source-dir - Shortcut',
    ...overrides,
  };
}

function makeStat(isDir: boolean): StatFn {
  return vi.fn().mockResolvedValue({
    isDirectory: () => isDir,
    isFile: () => !isDir,
  });
}

function makeSymlink(): SymlinkFn {
  return vi.fn().mockResolvedValue(undefined);
}

describe('handleCreateSymlink (G011)', () => {
  it('target 是目录 → symlink called with type="junction"', async () => {
    const stat = makeStat(true);
    const symlink = makeSymlink();
    const res = (await handleCreateSymlink(makeReq(), stat, symlink)) as Result<string>;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe('/tmp/source-dir - Shortcut');
    expect(stat).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenCalledWith('/tmp/source-dir');
    expect(symlink).toHaveBeenCalledTimes(1);
    expect(symlink).toHaveBeenCalledWith('/tmp/source-dir', '/tmp/source-dir - Shortcut', 'junction');
  });

  it('target 是文件 → symlink called with type="file"', async () => {
    const stat = makeStat(false);
    const symlink = makeSymlink();
    const res = (await handleCreateSymlink(
      makeReq({ target: '/tmp/a.txt', linkPath: '/tmp/a.txt - Shortcut' }),
      stat,
      symlink,
    )) as Result<string>;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe('/tmp/a.txt - Shortcut');
    expect(symlink).toHaveBeenCalledWith('/tmp/a.txt', '/tmp/a.txt - Shortcut', 'file');
  });

  it('stat throws (源不存在) → Result.error (code 透传)', async () => {
    const e = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const stat = vi.fn().mockRejectedValue(e);
    const symlink = makeSymlink();
    const res = (await handleCreateSymlink(makeReq(), stat, symlink)) as Result<string>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('ENOENT');
      expect((res.error as FsError).path).toBe('/tmp/source-dir - Shortcut');
    }
    expect(symlink).not.toHaveBeenCalled();
  });

  it('stat throws 无 code → Result.error code=IO_ERROR', async () => {
    const stat = vi.fn().mockRejectedValue(new Error('boom'));
    const symlink = makeSymlink();
    const res = (await handleCreateSymlink(makeReq(), stat, symlink)) as Result<string>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('IO_ERROR');
      expect((res.error as FsError).message).toBe('boom');
    }
  });

  it('symlink throws (linkPath 已存在 EEXIST) → Result.error code=EEXIST', async () => {
    const stat = makeStat(true);
    const e = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
    const symlink = vi.fn().mockRejectedValue(e);
    const res = (await handleCreateSymlink(makeReq(), stat, symlink)) as Result<string>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('EEXIST');
      expect((res.error as FsError).path).toBe('/tmp/source-dir - Shortcut');
    }
  });

  it('symlink throws 无 code → Result.error code=IO_ERROR', async () => {
    const stat = makeStat(false);
    const symlink = vi.fn().mockRejectedValue(new Error('EPERM'));
    const res = (await handleCreateSymlink(makeReq(), stat, symlink)) as Result<string>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('IO_ERROR');
    }
  });

  it('空 target → Result.error code=UNKNOWN (不调任何 IO)', async () => {
    const stat = vi.fn();
    const symlink = vi.fn();
    const res = (await handleCreateSymlink(
      { target: '', linkPath: '/tmp/x' } as FsCreateSymlinkRequest,
      stat,
      symlink,
    )) as Result<string>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
    }
    expect(stat).not.toHaveBeenCalled();
    expect(symlink).not.toHaveBeenCalled();
  });

  it('空 linkPath → Result.error code=UNKNOWN', async () => {
    const stat = vi.fn();
    const symlink = vi.fn();
    const res = (await handleCreateSymlink(
      { target: '/tmp/x', linkPath: '' } as FsCreateSymlinkRequest,
      stat,
      symlink,
    )) as Result<string>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
    }
    expect(stat).not.toHaveBeenCalled();
    expect(symlink).not.toHaveBeenCalled();
  });
});
