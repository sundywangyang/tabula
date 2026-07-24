/**
 * copy.ts 单测
 *
 * 覆盖:
 * - 正常 copy:dest = join(destination, basename(src)) 时,fs.cp 用计算出的 dest
 * - 显式 destinations[i]:destinations[i] !== undefined 时,优先用显式值
 * - destinations[i] 缺省(下标越界):回退到默认 join() 行为,向后兼容
 * - src===dest(计算后):守卫跳过,不调 fs.cp,不会触发 EINVAL
 * - fs.cp 抛错:Result.error(message + path 透传)
 * - overwrite=false:fs.cp 用 force=false
 * - overwrite=true:fs.cp 用 force=true
 *
 * 同目录复制场景(用户报告 EINVAL):
 *   src = /foo/bar.txt, destination = /foo
 *   → 默认 dest = join('/foo', 'bar.txt') === src
 *   → 守卫跳过
 *
 * 显式 destinations 场景(performBulk 修复):
 *   sources = ['/foo/bar.txt'], destinations = ['/foo/bar - 副本.txt']
 *   → dest = '/foo/bar - 副本.txt' !== src
 *   → fs.cp 调用一次
 *
 * Mock 策略: vi.spyOn 对真实 fs.promises.cp 做 stub,保留原对象引用,
 * 让 copy.ts 拿到的 fs.cp 是 spy。
 *
 * 跨平台路径: 用 path.join 计算预期 dest,避免在 Windows 上用 POSIX 路径
 * 测试与 POSIX 路径断言错位。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MockInstance } from 'vitest';
import type { MoveOrCopyRequest, Result } from '@tabula/bridge';

// 直接 import copy — 它的 fs.promises.cp 与我们 import 到的 fs.promises.cp
// 是同一个函数引用,所以下面 vi.spyOn 会替换两边都看到的那个函数。
import { copy } from '../copy';

let cpSpy: MockInstance<(...args: Parameters<typeof fs.cp>) => unknown>;

beforeEach(() => {
  cpSpy = vi.spyOn(fs, 'cp').mockImplementation(() => Promise.resolve(undefined));
});

afterEach(() => {
  cpSpy.mockRestore();
});

function req(partial: Partial<MoveOrCopyRequest> = {}): MoveOrCopyRequest {
  return {
    sources: ['/src/a.txt'],
    destination: '/dst',
    overwrite: false,
    ...partial,
  };
}

describe('fs.copy — explicit destinations + src==dest 守卫', () => {
  it('正常 copy(无显式 destinations)→ fs.cp 用 join 计算的 dest', async () => {
    const res = (await copy(req({ sources: ['/src/a.txt'], destination: '/dst' }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).toHaveBeenCalledTimes(1);
    expect(cpSpy).toHaveBeenCalledWith('/src/a.txt', join('/dst', 'a.txt'), {
      recursive: true,
      force: false,
    });
  });

  it('显式 destinations[0] → fs.cp 用 destinations[0],不用 join()', async () => {
    const res = (await copy(req({
      sources: ['/src/a.txt'],
      destination: '/dst',
      destinations: ['/dst/a - 副本.txt'],
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).toHaveBeenCalledTimes(1);
    expect(cpSpy).toHaveBeenCalledWith('/src/a.txt', '/dst/a - 副本.txt', {
      recursive: true,
      force: false,
    });
  });

  it('destinations 长度小于 sources → 越界下标回退到 join()', async () => {
    const res = (await copy(req({
      sources: ['/src/a.txt', '/src/b.txt'],
      destination: '/dst',
      // 只有第一个有显式 dest,第二个缺省
      destinations: ['/dst/a-renamed.txt'],
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).toHaveBeenCalledTimes(2);
    expect(cpSpy).toHaveBeenNthCalledWith(1, '/src/a.txt', '/dst/a-renamed.txt', {
      recursive: true,
      force: false,
    });
    expect(cpSpy).toHaveBeenNthCalledWith(2, '/src/b.txt', join('/dst', 'b.txt'), {
      recursive: true,
      force: false,
    });
  });

  it('**核心场景**:src===dest(同目录复制) → 守卫跳过,不调 fs.cp', async () => {
    // 用户报告的 bug: src=/foo/汪琼林_深圳.jpg, destination=/foo
    // → join('/foo', basename) === src
    // → 旧实现会调 fs.cp(src, src) → EINVAL
    // → 新实现:守卫跳过,返回 ok=true
    // Windows: 用带盘符的路径,确保 join(destination, basename) === src
    // (POSIX 路径 '/foo' 在 Windows 上 join 后变成 '\foo',不会触发守卫)
    const dir = process.platform === 'win32' ? 'C:\\foo' : '/foo';
    const src = process.platform === 'win32' ? 'C:\\foo\\汪琼林_深圳.jpg' : '/foo/汪琼林_深圳.jpg';
    const res = (await copy(req({
      sources: [src],
      destination: dir,
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).not.toHaveBeenCalled();
  });

  it('同目录复制 + 显式 destinations(performBulk 修复路径)→ 不被守卫跳过', async () => {
    // performBulk 检测到 src===dest 后,生成 `xxx - 副本.jpg` 透传
    // 用显式 dest 字符串确保跨平台断言正确
    const res = (await copy(req({
      sources: ['/foo/汪琼林_深圳.jpg'],
      destination: '/foo',
      destinations: ['/foo/汪琼林_深圳 - 副本.jpg'],
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).toHaveBeenCalledTimes(1);
    expect(cpSpy).toHaveBeenCalledWith(
      '/foo/汪琼林_深圳.jpg',
      '/foo/汪琼林_深圳 - 副本.jpg',
      { recursive: true, force: false },
    );
  });

  it('多 sources 中部分 src===dest → 仅跳过相等的,其余正常 copy', async () => {
    // Windows: 用带盘符的路径触发守卫
    // basename(b.txt) === 'b.txt',所以 join(destination, basename) === 'C:\\foo\\b.txt'
    const dir = process.platform === 'win32' ? 'C:\\foo' : '/foo';
    const aSrc = process.platform === 'win32' ? 'C:\\foo\\a.txt' : '/foo/a.txt';
    const bSrc = process.platform === 'win32' ? 'C:\\foo\\sub\\b.txt' : '/foo/sub/b.txt';
    const res = (await copy(req({
      sources: [
        aSrc,             // 期望被跳过(默认 dest === src)
        bSrc,             // 期望正常 copy 到 destination dir 下,文件名取 basename
      ],
      destination: dir,   // 第一个 src 在 dir 下 → dest === src
    })) as unknown) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).toHaveBeenCalledTimes(1);
    expect(cpSpy).toHaveBeenCalledWith(bSrc, join(dir, 'b.txt'), {
      recursive: true,
      force: false,
    });
  });

  it('fs.cp throws → Result.error(message 透传 + path)', async () => {
    cpSpy.mockRejectedValueOnce(new Error('disk full'));
    const res = (await copy(req({ sources: ['/src/a.txt'] }))) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toBe('disk full');
      expect(res.error.path).toBe('/src/a.txt');
    }
  });

  it('fs.cp throws with code → Result.error.code 透传', async () => {
    const err = Object.assign(new Error('EACCES denied'), { code: 'EACCES' });
    cpSpy.mockRejectedValueOnce(err);
    const res = (await copy(req({ sources: ['/src/a.txt'] }))) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('EACCES');
    }
  });

  it('overwrite=true → fs.cp 用 force=true', async () => {
    const res = (await copy(req({
      sources: ['/src/a.txt'],
      destination: '/dst',
      overwrite: true,
    }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).toHaveBeenCalledWith('/src/a.txt', join('/dst', 'a.txt'), {
      recursive: true,
      force: true,
    });
  });

  it('overwrite=undefined → force 默认 false', async () => {
    const res = (await copy({
      sources: ['/src/a.txt'],
      destination: '/dst',
      // overwrite 缺省
    })) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).toHaveBeenCalledWith('/src/a.txt', join('/dst', 'a.txt'), {
      recursive: true,
      force: false,
    });
  });

  it('空 sources → ok=true,不调 fs.cp', async () => {
    const res = (await copy(req({ sources: [] }))) as Result<void>;
    expect(res.ok).toBe(true);
    expect(cpSpy).not.toHaveBeenCalled();
  });
});