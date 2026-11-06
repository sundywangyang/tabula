/**
 * 缩略图服务 (P7 v1)
 *
 * - macOS 用系统异步缩略图,其他平台用 nativeImage,最长边 128px
 * - 限制生成并发,同一文件版本的跨窗口请求共用任务
 * - 输出 jpeg dataURL(避免 PNG 大体积;SVG/ICO/GIF 等也强制转 jpeg)
 * - 内存 LRU 缓存(按 path|mtime 索引,200 项上限)
 *   - path 变了(文件被重命名/移动)→ 旧 key 留在缓存里,自然 LRU 淘汰
 *   - mtime 变了(文件被覆盖)→ 旧 key 失效,重新生成
 *   - 同 path 不同 mtime 会同时留在缓存里,各占一项
 *
 * 非图片格式 / 文件过大(> 50MB) / 解码失败 → 返回 Result.error。
 * 渲染端需要负责缓存命中后的展示(本服务不感知)。
 */
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { nativeImage } from 'electron';
import type { Result, ThumbnailResult } from '@tabula/bridge';

const MAX_INPUT_BYTES = 50 * 1024 * 1024; // 50MB 上限,避免一次性载入大图爆内存
const THUMB_MAX_SIDE = 128; // 缩略图最长边
const JPEG_QUALITY = 75;
const CACHE_CAPACITY = 200;
const MAX_CONCURRENT_THUMBNAILS = 2;

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.ico', '.heic', '.avif', '.tiff', '.tif', '.psd', '.raw',
]);

function isImagePath(p: string): boolean {
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTS.has(p.slice(dot).toLowerCase());
}

function err(code: 'ENOENT' | 'EACCES' | 'ENOTDIR' | 'UNKNOWN', message: string, path?: string) {
  return {
    ok: false as const,
    error: { code, message, path },
  };
}

// =================== LRU 缓存 ===================

interface CacheEntry {
  key: string;
  result: ThumbnailResult;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Result<ThumbnailResult>>>();
let activeThumbnails = 0;
const waitingThumbnails: Array<() => void> = [];

async function withThumbnailSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeThumbnails >= MAX_CONCURRENT_THUMBNAILS) {
    await new Promise<void>((resolve) => waitingThumbnails.push(resolve));
  } else {
    activeThumbnails++;
  }
  try {
    return await work();
  } finally {
    // 将当前名额直接交给排队任务,避免新请求抢占队列。
    const next = waitingThumbnails.shift();
    if (next) next();
    else activeThumbnails--;
  }
}

/** 系统缩图不携带原图尺寸;只读图片元数据,避免在主线程再次解码。 */
async function readMacImageSize(filePath: string): Promise<{ width: number; height: number }> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  const width = Number(output.match(/^\s*pixelWidth:\s*(\d+)\s*$/m)?.[1]);
  const height = Number(output.match(/^\s*pixelHeight:\s*(\d+)\s*$/m)?.[1]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('无法读取图片原始尺寸');
  }
  return { width, height };
}

function cacheGet(key: string): ThumbnailResult | null {
  const e = cache.get(key);
  if (!e) return null;
  // 命中 → 移到队尾(LRU refresh)
  cache.delete(key);
  cache.set(key, e);
  return e.result;
}

function cachePut(key: string, result: ThumbnailResult): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { key, result });
  // 超出容量 → 淘汰队首
  while (cache.size > CACHE_CAPACITY) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) break;
    cache.delete(firstKey);
  }
}

// =================== 公开 API ===================

/** 取文件缩略图,按文件版本缓存并合并正在生成的请求。 */
export async function getThumbnail(filePath: string): Promise<Result<ThumbnailResult>> {
  // 1. 快速判断:不是图片扩展名直接拒(避免无谓的 stat)
  if (!isImagePath(filePath)) {
    return err('UNKNOWN', `不支持的图片格式: ${filePath}`, filePath);
  }

  // 2. stat 拿 mtime + size(同时验证文件存在)
  let mtime: number;
  let size: number;
  try {
    const st = await fsp.stat(filePath);
    if (!st.isFile()) {
      return err('ENOTDIR', '不是文件', filePath);
    }
    if (st.size > MAX_INPUT_BYTES) {
      return err(
        'UNKNOWN',
        `文件过大 (${(st.size / 1024 / 1024).toFixed(1)}MB > ${MAX_INPUT_BYTES / 1024 / 1024}MB)`,
        filePath,
      );
    }
    mtime = st.mtimeMs;
    size = st.size;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return err('ENOENT', '文件不存在', filePath);
    if (code === 'EACCES') return err('EACCES', '无访问权限', filePath);
    return err('UNKNOWN', (e as Error).message ?? String(e), filePath);
  }

  // 3. 缓存命中
  const key = `${filePath}|${mtime}|${size}`;
  const cached = cacheGet(key);
  if (cached) {
    return { ok: true, data: cached };
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  // 4. 系统生成缩图及元数据读取都包含在并发名额内。
  const task = withThumbnailSlot(async (): Promise<Result<ThumbnailResult>> => {
    try {
      const originalSize = process.platform === 'darwin' ? await readMacImageSize(filePath) : null;
      const img = process.platform === 'darwin'
        ? await nativeImage.createThumbnailFromPath(filePath, { width: THUMB_MAX_SIDE, height: THUMB_MAX_SIDE })
        : nativeImage.createFromPath(filePath);
      if (img.isEmpty()) {
        return err('UNKNOWN', '图片解码失败(可能格式不支持或文件损坏)', filePath);
      }
      const imageSize = img.getSize();
      const { width: w0, height: h0 } = originalSize ?? imageSize;
      if (w0 <= 0 || h0 <= 0) {
        return err('UNKNOWN', '图片尺寸异常', filePath);
      }
      if (imageSize.width <= 0 || imageSize.height <= 0) {
        return err('UNKNOWN', '缩略图尺寸异常', filePath);
      }
      // 系统缩图可能经过方向校正;按实际缩图比例缩小,不放大小图。
      const maxSide = Math.min(THUMB_MAX_SIDE, Math.max(w0, h0));
      const scale = Math.min(1, maxSide / Math.max(imageSize.width, imageSize.height));
      const tw = Math.max(1, Math.round(imageSize.width * scale));
      const th = Math.max(1, Math.round(imageSize.height * scale));
      const resized = scale < 1 ? img.resize({ width: tw, height: th, quality: 'good' }) : img;
      // 此时仅编码小尺寸缩图,不会同步解码原图。
      const jpegBuf = resized.toJPEG(JPEG_QUALITY);
      if (jpegBuf.length === 0) {
        return err('UNKNOWN', '缩略图编码失败(jpeg buffer 为空)', filePath);
      }
      const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;

      const result: ThumbnailResult = {
        dataUrl,
        mime: 'image/jpeg',
        width: w0,
        height: h0,
        thumbWidth: tw,
        thumbHeight: th,
        mtime,
        size,
      };
      cachePut(key, result);
      return { ok: true, data: result };
    } catch (e) {
      return err('UNKNOWN', (e as Error).message ?? String(e), filePath);
    }
  }).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/** 调试用:导出当前缓存状态 */
export function getThumbnailCacheStats(): { size: number; capacity: number } {
  return { size: cache.size, capacity: CACHE_CAPACITY };
}

/** 清空缓存(暴露给设置页「清缓存」按钮,目前未挂 UI) */
export function clearThumbnailCache(): void {
  cache.clear();
}
