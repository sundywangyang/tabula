import type { NativeImage } from 'electron';

const MAX_ICONS = 128;
const ICON_TTL_MS = 2 * 60 * 1000;

/** Prepare shell icons before dragstart; bound both memory and wait on slow paths. */
export class DragIconCache {
  private readonly entries = new Map<string, { promise: Promise<NativeImage | null>; time: number }>();

  constructor(private readonly loadIcon: (path: string) => Promise<NativeImage>) {}

  prepare(path: string): Promise<NativeImage | null> {
    if (!path || typeof path !== 'string') return Promise.resolve(null);
    const existing = this.entries.get(path);
    if (existing && Date.now() - existing.time < ICON_TTL_MS) {
      this.entries.delete(path);
      this.entries.set(path, existing);
      return existing.promise;
    }
    if (existing) this.entries.delete(path);
    const promise = Promise.resolve().then(() => this.loadIcon(path)).then(icon => icon.isEmpty() ? null : icon).catch(() => null);
    this.entries.set(path, { promise, time: Date.now() });
    while (this.entries.size > MAX_ICONS) this.entries.delete(this.entries.keys().next().value!);
    return promise;
  }

  async get(path: string, timeoutMs = 120): Promise<NativeImage | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.prepare(path),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Keep the original aspect ratio and avoid oversized drag images. */
export function fitDragIcon(image: NativeImage, maxSide = 48): NativeImage {
  if (image.isEmpty()) return image;
  const { width, height } = image.getSize();
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (!Number.isFinite(scale) || scale >= 1) return image;
  return image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
}
