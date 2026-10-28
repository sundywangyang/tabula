/**
 * G018: system drag-out (webContents.startDrag) 单测
 *
 * 覆盖:
 * - 多文件 paths → startDrag 用 files 发送全部选中路径
 * - 非图片文件(nativeIcon.isEmpty()=true)→ 用 fallback Icon path
 * - 图片文件(nativeIcon.isEmpty()=false)→ 用 first file 自身作为 icon
 * - startDrag throws → Result.error (IO_ERROR, message 透传)
 * - paths 是 undefined → Result.error (IO_ERROR 'No paths')
 * - paths 是 [] → Result.error (IO_ERROR 'No paths')
 * - resolveDragIconPath 单独:empty → fallback / non-empty → first file
 */
import { describe, expect, it, vi } from 'vitest';
import { handleStartDrag, resolveDragIconPath, pickPlatformFallbackIcon } from '../handlers';
import type { CreateNativeImageFn, StartDragFn } from '../handlers';
import type { FsError, Result } from '@tabula/bridge';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

function makeCtx(overrides: Partial<{
  startDrag: StartDragFn;
  createImage: CreateNativeImageFn;
  fallbackIconPath: string;
  /** G018 防御:默认视为文件存在且 isFile(),需要模拟不存在或目录的测试覆盖 */
  statSync?: (p: string) => { isFile(): boolean; isDirectory(): boolean } | null;
}> = {}) {
  return {
    startDrag: overrides.startDrag ?? vi.fn(),
    createImage: overrides.createImage ?? vi.fn(() => ({ isEmpty: () => true })),
    fallbackIconPath: overrides.fallbackIconPath ?? '/fake/build-assets/icon/Tabula.ico',
    statSync: overrides.statSync ?? vi.fn(() => ({ isFile: () => true, isDirectory: () => false })),
  };
}

describe('handleStartDrag (G018)', () => {
  it('uses the prepared system icon as the actual drag image', () => {
    const startDrag = vi.fn();
    const icon = { isEmpty: () => false } as import('electron').NativeImage;
    const res = handleStartDrag(['/data/a.txt'], { ...makeCtx({ startDrag }), dragIcon: icon });
    expect(res.ok).toBe(true);
    expect(startDrag).toHaveBeenCalledWith({ file: '/data/a.txt', icon });
  });
  it('多文件 paths → startDrag called with { file: paths[0], icon: fallback }', async () => {
    const startDrag = vi.fn();
    const ctx = makeCtx({ startDrag });
    const res = (await handleStartDrag(
      ['/data/a.png', '/data/b.txt', '/data/c.txt'],
      ctx,
    )) as Result<void>;
    expect(res.ok).toBe(true);
    expect(startDrag).toHaveBeenCalledTimes(1);
    // webContents.startDrag 只支持单文件,使用 paths[0]
    expect(startDrag).toHaveBeenCalledWith({
      file: '/data/a.png',
      files: ['/data/a.png', '/data/b.txt', '/data/c.txt'],
      icon: '/fake/build-assets/icon/Tabula.ico',
    });
  });

  it('图片文件 (nativeIcon.isEmpty()=false) → 用 first file 自身作为 icon', async () => {
    const startDrag = vi.fn();
    const createImage = vi.fn(() => ({ isEmpty: () => false }));
    const ctx = makeCtx({ startDrag, createImage });
    const res = (await handleStartDrag(['/data/a.png'], ctx)) as Result<void>;
    expect(res.ok).toBe(true);
    expect(createImage).toHaveBeenCalledWith('/data/a.png');
    expect(startDrag).toHaveBeenCalledWith({
      file: '/data/a.png',
      icon: '/data/a.png',
    });
  });

  it('非图片文件 (nativeIcon.isEmpty()=true) → 用 fallback icon path', async () => {
    const startDrag = vi.fn();
    const createImage = vi.fn(() => ({ isEmpty: () => true }));
    const ctx = makeCtx({ startDrag, createImage, fallbackIconPath: '/x/Tabula.ico' });
    const res = (await handleStartDrag(['/data/some.txt'], ctx)) as Result<void>;
    expect(res.ok).toBe(true);
    expect(startDrag).toHaveBeenCalledWith({
      file: '/data/some.txt',
      icon: '/x/Tabula.ico',
    });
  });

  it('startDrag throws → Result.error (UNKNOWN, message 透传)', async () => {
    const startDrag = vi.fn(() => {
      throw new Error('drag failed: no active session');
    });
    const ctx = makeCtx({ startDrag });
    const res = (await handleStartDrag(['/data/a.txt'], ctx)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
      expect((res.error as FsError).message).toBe('drag failed: no active session');
    }
  });

  it('startDrag throws 非 Error 对象 → message = String(err)', async () => {
    const startDrag = vi.fn(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string-error';
    });
    const ctx = makeCtx({ startDrag });
    const res = (await handleStartDrag(['/data/a.txt'], ctx)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
      expect((res.error as FsError).message).toBe('string-error');
    }
  });

  it('paths 是空数组 → Result.error (UNKNOWN "No paths"),不调 startDrag', async () => {
    const startDrag = vi.fn();
    const createImage = vi.fn();
    const ctx = makeCtx({ startDrag, createImage });
    const res = (await handleStartDrag([], ctx)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
      expect((res.error as FsError).message).toBe('No paths');
    }
    expect(startDrag).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
  });

  it('handleStartDrag 返回同步 plain object(非 Promise)— sendSync 结构化克隆需要', () => {
    const ctx = makeCtx();
    const res = handleStartDrag(['/data/a.txt'], ctx) as unknown;
    // G018: ipcRenderer.sendSync 通过 Event.returnValue 把返回值走结构化克隆;
    // Promise 对象不可克隆 → "An object could not be cloned" → app 卡死。
    // 这里直接验证返回值不是 Promise,且是 plain object。
    expect(res).not.toBeInstanceOf(Promise);
    expect(typeof res).toBe('object');
    expect(res).not.toBeNull();
  });

  it('paths 是 undefined → Result.error (UNKNOWN "No paths")', async () => {
    const startDrag = vi.fn();
    const ctx = makeCtx({ startDrag });
    // @ts-expect-error testing invalid input
    const res = (await handleStartDrag(undefined, ctx)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
    }
    expect(startDrag).not.toHaveBeenCalled();
  });

  it('first 文件不存在 (statSync 返回 null) → Result.error ENOENT, 不调 startDrag', async () => {
    const startDrag = vi.fn();
    const createImage = vi.fn();
    const ctx = makeCtx({
      startDrag,
      createImage,
      statSync: vi.fn(() => null),
    });
    const res = (await handleStartDrag(['/data/ghost.txt'], ctx)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('ENOENT');
      expect((res.error as FsError).path).toBe('/data/ghost.txt');
    }
    expect(startDrag).not.toHaveBeenCalled();
  });

  it('directories can participate in a native drag session', async () => {
    const startDrag = vi.fn();
    const createImage = vi.fn(() => ({ isEmpty: () => true }));
    const ctx = makeCtx({
      startDrag,
      createImage,
      statSync: vi.fn(() => ({ isFile: () => false, isDirectory: () => true })),
    });
    const res = (await handleStartDrag(['/data/some-folder'], ctx)) as Result<void>;
    expect(res.ok).toBe(true);
    expect(startDrag).toHaveBeenCalledWith({ file: '/data/some-folder', icon: ctx.fallbackIconPath });
  });

  it('statSync 抛错 → 视为文件不存在(ENOENT)', async () => {
    const startDrag = vi.fn();
    const ctx = makeCtx({
      startDrag,
      statSync: vi.fn(() => {
        throw new Error('EACCES');
      }),
    });
    const res = (await handleStartDrag(['/data/locked.txt'], ctx)) as Result<void>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('ENOENT');
    }
    expect(startDrag).not.toHaveBeenCalled();
  });
});
describe('pickPlatformFallbackIcon (G018 cross-platform)', () => {
  it('当前 platform 的图标存在 → 返回绝对路径', () => {
    const candidates: Record<string, string> = {
      win32: 'build-assets/icon/Tabula.ico',
      darwin: 'build-assets/icon/Tabula.icns',
      linux: 'build-assets/icon/png/16.png',
    };
    const rel = candidates[process.platform];
    if (!rel) return; // 当前 OS 不在候选里,跳过
    const root = process.cwd();
    expect(pickPlatformFallbackIcon(root)).toMatch(new RegExp(rel.replace(/\//g, '[\\\\/]')));
  });

  it('appRoot 不存在 → 返回 null(不抛)', () => {
    expect(pickPlatformFallbackIcon('/this/path/does/not/exist/anywhere')).toBe(null);
  });

  it('finds the packaged fallback in the actual extraResources layout', () => {
    const name = process.platform === 'win32' ? 'Tabula.ico' : process.platform === 'darwin' ? 'Tabula.icns' : process.platform === 'linux' ? '32.png' : null;
    if (!name) return;
    const testRoot = join(process.cwd(), 'out', 'test-fixtures');
    mkdirSync(testRoot, { recursive: true });
    const resources = mkdtempSync(join(testRoot, 'drag-icon-'));
    try {
      writeFileSync(join(resources, name), 'icon');
      expect(pickPlatformFallbackIcon(resources, true)).toBe(join(resources, name));
    } finally {
      rmSync(resources, { recursive: true, force: true });
    }
  });
});

describe('resolveDragIconPath (G018)', () => {
  it('nativeIcon empty → 返回 fallback', () => {
    const createImage: CreateNativeImageFn = vi.fn(() => ({ isEmpty: () => true }));
    expect(resolveDragIconPath('/data/x.txt', createImage, '/fallback.ico')).toBe('/fallback.ico');
  });

  it('nativeIcon non-empty → 返回 firstFile', () => {
    const createImage: CreateNativeImageFn = vi.fn(() => ({ isEmpty: () => false }));
    expect(resolveDragIconPath('/data/img.png', createImage, '/fallback.ico')).toBe('/data/img.png');
  });
});
