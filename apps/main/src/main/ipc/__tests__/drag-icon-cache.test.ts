import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { DragIconCache, fitDragIcon } from '../drag-icon-cache';

function icon(width: number, height: number, empty = false) {
  const resized = {} as NativeImage;
  const image = { isEmpty: () => empty, getSize: () => ({ width, height }), resize: vi.fn(() => resized) };
  return { image: image as unknown as NativeImage, resize: image.resize, resized };
}
afterEach(() => vi.useRealTimers());

describe('system drag icons', () => {
  it('reuses the preloaded icon for the same file', async () => {
    const { image } = icon(32, 32);
    const load = vi.fn(async () => image);
    const cache = new DragIconCache(load);
    await cache.prepare('C:/sample.txt');
    expect(await cache.get('C:/sample.txt')).toBe(image);
    expect(load).toHaveBeenCalledOnce();
  });

  it('times out on slow system icons, and can use the icon when it later arrives', async () => {
    vi.useFakeTimers();
    const { image } = icon(32, 32);
    let finish!: (image: NativeImage) => void;
    const cache = new DragIconCache(() => new Promise(resolve => { finish = resolve; }));
    const pending = cache.get('C:/slow.txt', 120);
    await vi.advanceTimersByTimeAsync(120);
    expect(await pending).toBeNull();
    finish(image);
    expect(await cache.get('C:/slow.txt')).toBe(image);
  });

  it('falls back when the system returns no icon or an error', async () => {
    const cache = new DragIconCache(async path => {
      if (path === 'error') throw new Error('unavailable');
      return icon(0, 0, true).image;
    });
    expect(await cache.get('empty')).toBeNull();
    expect(await cache.get('error')).toBeNull();
  });

  it('limits large images to 48 pixels without changing aspect ratio', () => {
    const { image, resize, resized } = icon(256, 128);
    expect(fitDragIcon(image)).toBe(resized);
    expect(resize).toHaveBeenCalledWith({ width: 48, height: 24, quality: 'good' });
    const small = icon(32, 32);
    expect(fitDragIcon(small.image)).toBe(small.image);
    expect(small.resize).not.toHaveBeenCalled();
  });
});
