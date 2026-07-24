/**
 * move.ts 单测
 *
 * 覆盖:
 * - 正常 move(无显式 destinations)→ 用 join 计算 dest
 * - 显式 destinations[i] → 优先用显式值
 * - src===dest → 守卫跳过,不调 fs.rename / fs.cp
 * - fs.rename 成功 → 不走 fs.cp + fs.rm
 * - fs.rename 失败 → 降级到 fs.cp + fs.rm
 * - fs.cp 失败 → Result.error
 * - fs.rm 失败 → Result.error
 *
 * Mock 策略: vi.spyOn 对真实 fs.promises.{rename,cp,rm} 做 stub。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MockInstance } from 'vitest';
import type { MoveOrCopyRequest, Result } from '@tabula/bridge';

// 直接 import move — 它的 fs.promises.{rename,cp,rm} 与我们 import 到的引用一致。
import { move } from '../move';

let renameSpy: MockInstance<(...args: Parameters<typeof fs.rename>) => unknown>;
let cpSpy: MockInstance<(...args: Parameters<typeof fs.cp>) => unknown>;
let rmSpy: MockInstance<(...args: Parameters<typeof fs.rm>) => unknown>;

beforeEach(() => {
  renameSpy = vi.spyOn(fs, 'rename').mockImplementation(() => Promise.resolve(undefined));
  cpSpy = vi.spyOn(fs, 'cp').mockImplementation(() => Promise.resolve(undefined));
  rmSpy = vi.spyOn(fs, 'rm').mockImplementation(() => Promise.resolve(undefined));
});

afterEach(() => {
  renameSpy.mockRestore();
  cpSpy.mockRestore();
  rmSpy.mockRestore();
});

function req(partial: Partial<MoveOrCopyRequest> = {}): MoveOrCopyRequest {
  return {
    sources: ['/src/a.txt'],
    destination: '/dst',
    overwrite: false,
    ...partial,
  };
}

describe('fs.move — explicit destinations + src==dest 守卫', () => {
  it('正常 move(无显式 destinations)→ fs.rename 用 join 计算的 dest', async () => {
    const res = (await move(req({ sources: ['/src/a.txt'], destination: '/dst' }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith('/src/a.txt', join('/dst', 'a.txt'));
    expect(cpSpy).not.toHaveBeenCalled();
    expect(rmSpy).not.toHaveBeenCalled();
  });

  it('显式 destinations[0] → fs.rename 用 destinations[0]', async () => {
    const res = (await move(req({
      sources: ['/src/a.txt'],
      destination: '/dst',
      destinations: ['/dst/a-renamed.txt'],
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(renameSpy).toHaveBeenCalledWith('/src/a.txt', '/dst/a-renamed.txt');
  });

  it('**核心场景**:src===dest → 守卫跳过,不调任何 fs 函数', async () => {
    // Windows: 用带盘符的路径,确保 join(destination, basename) === src
    // (POSIX 路径 '/foo' 在 Windows 上 join 后变成 '\foo',不会触发守卫)
    const dir = process.platform === 'win32' ? 'C:\\foo' : '/foo';
    const src = process.platform === 'win32' ? 'C:\\foo\\a.txt' : '/foo/a.txt';
    const res = (await move(req({
      sources: [src],
      destination: dir,
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(cpSpy).not.toHaveBeenCalled();
    expect(rmSpy).not.toHaveBeenCalled();
  });

  it('fs.rename 跨盘失败 → 降级到 fs.cp + fs.rm', async () => {
    renameSpy.mockRejectedValueOnce(new Error('EXDEV: cross-device link not permitted'));
    const res = (await move(req({ sources: ['/src/a.txt'] }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(cpSpy).toHaveBeenCalledTimes(1);
    expect(rmSpy).toHaveBeenCalledTimes(1);
    expect(cpSpy).toHaveBeenCalledWith('/src/a.txt', join('/dst', 'a.txt'), { recursive: true });
    expect(rmSpy).toHaveBeenCalledWith('/src/a.txt', { recursive: true, force: true });
  });

  it('fs.cp 失败 → Result.error', async () => {
    renameSpy.mockRejectedValueOnce(new Error('EXDEV'));
    cpSpy.mockRejectedValueOnce(new Error('EACCES denied'));
    const res = (await move(req({ sources: ['/src/a.txt'] }))) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toBe('EACCES denied');
      expect(res.error.path).toBe('/src/a.txt');
    }
    // fs.rm 不应被调用,因为 cp 已经失败
    expect(rmSpy).not.toHaveBeenCalled();
  });

  it('fs.rm 失败 → Result.error', async () => {
    renameSpy.mockRejectedValueOnce(new Error('EXDEV'));
    rmSpy.mockRejectedValueOnce(new Error('EBUSY: resource busy'));
    const res = (await move(req({ sources: ['/src/a.txt'] }))) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toBe('EBUSY: resource busy');
    }
  });

  it('destinations 长度小于 sources → 越界下标回退到 join()', async () => {
    const res = (await move(req({
      sources: ['/src/a.txt', '/src/b.txt'],
      destination: '/dst',
      destinations: ['/dst/a-renamed.txt'],
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(renameSpy).toHaveBeenNthCalledWith(1, '/src/a.txt', '/dst/a-renamed.txt');
    expect(renameSpy).toHaveBeenNthCalledWith(2, '/src/b.txt', join('/dst', 'b.txt'));
  });

  it('空 sources → ok=true,不调 fs.rename', async () => {
    const res = (await move(req({ sources: [] }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(renameSpy).not.toHaveBeenCalled();
  });
});