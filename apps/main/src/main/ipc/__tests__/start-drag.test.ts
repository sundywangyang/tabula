/**
 * G018: system drag-out (webContents.startDrag) 单测
 *
 * 覆盖:
 * - 多文件 paths → startDrag 用 paths[0] 作为 file(first-file-only 行为)
 * - 非图片文件(nativeIcon.isEmpty()=true)→ 用 fallback Icon path
 * - 图片文件(nativeIcon.isEmpty()=false)→ 用 first file 自身作为 icon
 * - startDrag throws → Result.error (IO_ERROR, message 透传)
 * - paths 是 undefined → Result.error (IO_ERROR 'No paths')
 * - paths 是 [] → Result.error (IO_ERROR 'No paths')
 * - resolveDragIconPath 单独:empty → fallback / non-empty → first file
 */
import { describe, expect, it, vi } from 'vitest';
import { handleStartDrag, resolveDragIconPath } from '../handlers';
import type { CreateNativeImageFn, StartDragFn } from '../handlers';
import type { FsError, Result } from '@tabula/bridge';

function makeCtx(overrides: Partial<{
  startDrag: StartDragFn;
  createImage: CreateNativeImageFn;
  fallbackIconPath: string;
}> = {}) {
  return {
    startDrag: overrides.startDrag ?? vi.fn(),
    createImage: overrides.createImage ?? vi.fn(() => ({ isEmpty: () => true })),
    fallbackIconPath: overrides.fallbackIconPath ?? '/fake/build-assets/icon/Tabula.ico',
  };
}

describe('handleStartDrag (G018)', () => {
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