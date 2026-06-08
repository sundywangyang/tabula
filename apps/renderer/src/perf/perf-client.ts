/**
 * 性能埋点客户端模块 (P7 v1)
 *
 * 职责:
 * - 暴露 reportFirstPaint() / markPhase() / reportListRender() 等轻量级工具
 * - 自动去抖 + 批量:同一 ms 内的多次 report 合并,避免洪水
 * - 客户端采样内存(performance.memory 当可用,作为 rendererHeapUsed 上报)
 * - FPS 采样(1s 滑窗,可订阅)
 * - 启动时首屏 paint 后自动 report 一次
 */
import type { MemorySample, PerfEvent, StartupTimings } from '@tabula/bridge';

// ============= 状态:启动时刻 =============
const rendererStart = performance.now();
let firstPaintReported = false;

// ============= 队列 / 去抖 =============
const pending: PerfEvent[] = [];
let flushTimer: number | null = null;
const FLUSH_INTERVAL_MS = 1000;
const MAX_PENDING = 50;

function enqueue(event: PerfEvent): void {
  pending.push(event);
  if (pending.length >= MAX_PENDING) {
    flush();
    return;
  }
  if (flushTimer == null && typeof window !== 'undefined') {
    flushTimer = window.setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

let flushInProgress = false;
async function flush(): Promise<void> {
  if (flushInProgress) return;
  if (pending.length === 0) return;
  flushInProgress = true;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  // 复制并清空(避免在 await 期间被改)
  const batch = pending.splice(0, pending.length);
  try {
    for (const e of batch) {
      // 静默:失败不阻塞
      await window.tabula.perf.report(e).catch(() => undefined);
    }
  } finally {
    flushInProgress = false;
  }
}

// ============= 公开 API =============

/**
 * 记录一阶段耗时(并立刻 enqueue;真正上报是 debounced)。
 */
export function reportPhase(
  phase: PerfEvent['phase'],
  name: string,
  durationMs?: number,
  meta?: PerfEvent['meta'],
): void {
  enqueue({
    phase,
    name,
    durationMs,
    meta,
    ts: Date.now(),
  });
}

/**
 * 首屏 paint 后调用一次(由 main 入口 effect 触发)。
 * 内部保证只触发一次。
 */
export function reportFirstPaint(meta?: PerfEvent['meta']): void {
  if (firstPaintReported) return;
  firstPaintReported = true;
  const duration = performance.now() - rendererStart;
  enqueue({
    phase: 'first-paint',
    name: 'renderer-first-paint',
    durationMs: Math.round(duration),
    meta: meta ?? {},
    ts: Date.now(),
  });
  // 立即 flush(不要等 debounce)
  void flush();
}

/**
 * 报告 file-list 渲染一次(从 store 拿到 entries 数量)。
 */
export function reportListRender(count: number, viewMode: string, durationMs: number): void {
  enqueue({
    phase: 'list-render',
    name: 'file-list',
    durationMs: Math.round(durationMs),
    meta: { count, viewMode },
    ts: Date.now(),
  });
}

/**
 * 报告一段同步代码耗时(简单 wrapper,塞入 report 队列)。
 */
export function timed<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const dt = performance.now() - t0;
    enqueue({
      phase: 'app',
      name,
      durationMs: Math.round(dt),
      ts: Date.now(),
    });
  }
}

export async function timedAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const dt = performance.now() - t0;
    enqueue({
      phase: 'app',
      name,
      durationMs: Math.round(dt),
      ts: Date.now(),
    });
  }
}

// ============= FPS 采样(1s 滑窗)=============

let rafHandle: number | null = null;
let frameTimes: number[] = [];

export function startFpsSampling(): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return () => undefined;
  }
  let last = performance.now();
  const tick = (now: number) => {
    frameTimes.push(now - last);
    last = now;
    // 保留 1s 内(60fps 期望 ~60 项)
    const cutoff = now - 1000;
    while (frameTimes.length > 0 && (now - frameTimes.reduce((a, b) => a + b, 0)) > 1000) {
      frameTimes.shift();
    }
    void cutoff; // 简单保留近 120 帧即可
    if (frameTimes.length > 120) frameTimes.shift();
    rafHandle = window.requestAnimationFrame(tick);
  };
  rafHandle = window.requestAnimationFrame(tick);
  return () => {
    if (rafHandle != null) window.cancelAnimationFrame(rafHandle);
    rafHandle = null;
    frameTimes = [];
  };
}

/**
 * 计算最近 1s 内的 FPS(0~60)。
 */
export function getFps(): number {
  if (frameTimes.length < 2) return 60;
  const total = frameTimes.reduce((a, b) => a + b, 0);
  if (total <= 0) return 60;
  return Math.round((frameTimes.length * 1000) / total);
}

// ============= 客户端内存采样(performance.memory 非标准,仅 Chromium) =============

export function sampleRendererMemory(): Partial<MemorySample> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perfMem = (performance as any).memory as
    | { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number }
    | undefined;
  const rendererHeapUsed = perfMem?.usedJSHeapSize
    ? Math.round((perfMem.usedJSHeapSize / 1024 / 1024) * 100) / 100
    : 0;
  return {
    rendererHeapUsed,
    ts: Date.now(),
  };
}

// ============= 拉取主进程启动时间 =============

export async function pullStartupTimings(): Promise<StartupTimings> {
  try {
    return await window.tabula.perf.getStartupTimings();
  } catch {
    return {
      whenReadyMs: 0,
      windowReadyMs: 0,
      extHostReadyMs: 0,
      firstPaintMs: 0,
      totalMs: 0,
    };
  }
}

/**
 * 强制立即 flush(测试 / 卸载时用)。
 */
export async function flushPerf(): Promise<void> {
  await flush();
}
