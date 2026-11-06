// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  execFile: vi.fn(),
  createFromPath: vi.fn(),
  createThumbnailFromPath: vi.fn(),
}));
vi.mock('node:fs', () => ({ promises: { stat: mocks.stat } }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('electron', () => ({ nativeImage: {
  createFromPath: mocks.createFromPath,
  createThumbnailFromPath: mocks.createThumbnailFromPath,
} }));

import { clearThumbnailCache, getThumbnail } from '../thumbnail';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const image = (width = 128, height = 64) => ({
  isEmpty: () => false,
  getSize: () => ({ width, height }),
  resize: vi.fn((size: { width: number; height: number }) => image(size.width, size.height)),
  toJPEG: vi.fn(() => Buffer.from('thumbnail')),
});
const metadata = '/pictures/photo.jpg\n  pixelWidth: 4096\n  pixelHeight: 2048\n';
const setMetadata = (output = metadata, error: Error | null = null) => {
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(error, output));
};

beforeEach(() => {
  vi.resetAllMocks();
  clearThumbnailCache();
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'darwin' });
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 1024, mtimeMs: 1000.125 });
  mocks.createThumbnailFromPath.mockResolvedValue(image());
  mocks.createFromPath.mockReturnValue(image(4096, 2048));
  setMetadata();
});
afterEach(() => Object.defineProperty(process, 'platform', platformDescriptor));

describe('thumbnail generation', () => {
  it('uses asynchronous macOS thumbnails while preserving original dimensions and cache hits', async () => {
    const result = await getThumbnail('/pictures/photo.jpg');
    expect(result).toMatchObject({ ok: true, data: {
      width: 4096, height: 2048, thumbWidth: 128, thumbHeight: 64,
      size: 1024, mtime: 1000.125, mime: 'image/jpeg',
    } });
    expect(mocks.createFromPath).not.toHaveBeenCalled();
    expect(mocks.createThumbnailFromPath).toHaveBeenCalledWith('/pictures/photo.jpg', { width: 128, height: 128 });
    expect(mocks.execFile).toHaveBeenCalledWith('/usr/bin/sips',
      ['-g', 'pixelWidth', '-g', 'pixelHeight', '/pictures/photo.jpg'],
      expect.objectContaining({ timeout: 10_000, maxBuffer: 64 * 1024 }), expect.any(Function));
    expect(await getThumbnail('/pictures/photo.jpg')).toEqual(result);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it('shares an unresolved generation across simultaneous window requests', async () => {
    let release!: (value: ReturnType<typeof image>) => void;
    mocks.createThumbnailFromPath.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = getThumbnail('/pictures/photo.jpg');
    const second = getThumbnail('/pictures/photo.jpg');
    await vi.waitFor(() => expect(mocks.createThumbnailFromPath).toHaveBeenCalledTimes(1));
    release(image());
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(a).toBe(b);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it('keeps at most two distinct thumbnail jobs active and drains the queue', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let peak = 0;
    mocks.createThumbnailFromPath.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await gate;
      active--;
      return image();
    });
    const tasks = Array.from({ length: 5 }, (_, index) => getThumbnail(`/pictures/${index}.jpg`));
    await vi.waitFor(() => expect(mocks.createThumbnailFromPath).toHaveBeenCalledTimes(2));
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
    release();
    expect((await Promise.all(tasks)).every((result) => result.ok)).toBe(true);
    expect(mocks.createThumbnailFromPath).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });

  it('releases a failed job slot and retries the same file without a cached failure', async () => {
    mocks.createThumbnailFromPath.mockRejectedValueOnce(new Error('system thumbnail failed'));
    const results = await Promise.all([0, 1, 2].map((index) => getThumbnail(`/pictures/${index}.jpg`)));
    expect(results[0]).toMatchObject({ ok: false, error: { path: '/pictures/0.jpg', message: 'system thumbnail failed' } });
    expect(results[1].ok && results[2].ok).toBe(true);
    expect((await getThumbnail('/pictures/0.jpg')).ok).toBe(true);
    expect(mocks.createThumbnailFromPath).toHaveBeenCalledTimes(4);
  });

  it.each([
    'pixelWidth: <nil>\npixelHeight: <nil>',
    'pixelWidth: 0\npixelHeight: 12',
    'pixelWidth: 20\npixelHeight: 9007199254740992',
  ])('returns a normal error for invalid metadata: %s', async (output) => {
    setMetadata(output);
    expect(await getThumbnail('/pictures/photo.jpg')).toMatchObject({
      ok: false, error: { code: 'UNKNOWN', path: '/pictures/photo.jpg' },
    });
    expect(mocks.createFromPath).not.toHaveBeenCalled();
    expect(mocks.createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it('returns metadata process failures without synchronously decoding and permits retry', async () => {
    setMetadata('', new Error('sips timed out'));
    expect(await getThumbnail('/pictures/photo.jpg')).toMatchObject({ ok: false, error: { message: 'sips timed out' } });
    expect(mocks.createFromPath).not.toHaveBeenCalled();
    setMetadata();
    expect((await getThumbnail('/pictures/photo.jpg')).ok).toBe(true);
  });

  it('invalidates cached files when the sub-millisecond mtime or size changes', async () => {
    await getThumbnail('/pictures/photo.jpg');
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 1024, mtimeMs: 1000.875 });
    await getThumbnail('/pictures/photo.jpg');
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 2048, mtimeMs: 1000.875 });
    const result = await getThumbnail('/pictures/photo.jpg');
    expect(result).toMatchObject({ ok: true, data: { mtime: 1000.875, size: 2048 } });
    expect(mocks.createThumbnailFromPath).toHaveBeenCalledTimes(3);
  });

  it('keeps small sources small even when the system supplies an enlarged thumbnail', async () => {
    setMetadata('pixelWidth: 32\npixelHeight: 16\n');
    expect(await getThumbnail('/pictures/photo.jpg')).toMatchObject({ ok: true, data: {
      width: 32, height: 16, thumbWidth: 32, thumbHeight: 16,
    } });
  });

  it('reports actual thumbnail orientation separately from source pixel dimensions', async () => {
    mocks.createThumbnailFromPath.mockResolvedValue(image(64, 128));
    expect(await getThumbnail('/pictures/photo.jpg')).toMatchObject({ ok: true, data: {
      width: 4096, height: 2048, thumbWidth: 64, thumbHeight: 128,
    } });
  });

  it('preserves the Linux decoder and original image dimensions', async () => {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
    expect(await getThumbnail('/pictures/photo.jpg')).toMatchObject({ ok: true, data: {
      width: 4096, height: 2048, thumbWidth: 128, thumbHeight: 64,
    } });
    expect(mocks.createFromPath).toHaveBeenCalledTimes(1);
    expect(mocks.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('rejects unsupported and oversized input before invoking system tools', async () => {
    expect((await getThumbnail('/pictures/photo.txt')).ok).toBe(false);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 50 * 1024 * 1024 + 1, mtimeMs: 1000 });
    expect((await getThumbnail('/pictures/photo.jpg')).ok).toBe(false);
    expect(mocks.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
