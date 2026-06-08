/**
 * 性能埋点服务(主进程)
 *
 * 职责:
 * - 收集渲染端上报的 PerfEvent(per-channel IPC)
 * - 主进程自己采样内存(每 10s 一次)
 * - 维护启动阶段计时
 * - 聚合 IPC 调用计数
 * - 暴露报告(perf:report / perf:snapshot)
 * - 主动推 perf:memory-sample 事件
 *
 * P7 v1:不落盘,只内存缓存;数据窗口固定(events/memory 各保留最近 200 条)。
 */
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type {
  MemorySample,
  PerfEvent,
  PerfReport,
  StartupTimings,
} from '@tabula/bridge';
import type { IpcContext } from '../ipc';

// 进程启动时刻(hrtime 用于精确计时)
const processStart = Date.now();
let whenReadyMs = 0;
let windowReadyMs = 0;
let extHostReadyMs = 0;
let firstPaintMs = 0;

const events: PerfEvent[] = [];
const memory: MemorySample[] = [];
const ipcCallCount: Record<string, number> = {};

const MAX_EVENTS = 200;
const MAX_MEMORY = 200;
const MEMORY_SAMPLE_INTERVAL_MS = 10_000;

let memoryTimer: NodeJS.Timeout | null = null;
let firstMemorySample = true;

/**
 * 记录 whenReady 触发时刻(必须在 app.whenReady 之后调用)。
 */
export function markWhenReady(): void {
  whenReadyMs = Date.now() - processStart;
}

/**
 * 主窗口 ready-to-show 触发时调用。
 */
export function markWindowReady(): void {
  windowReadyMs = Date.now() - processStart;
}

/**
 * 扩展宿主初始化完成(由 ext-host 初始化流程回调)。
 */
export function markExtHostReady(): void {
  extHostReadyMs = Date.now() - processStart;
}

/**
 * 渲染端首屏 paint 完成(由渲染端首次 perf:report 上报触发)。
 */
function markFirstPaint(): void {
  if (firstPaintMs === 0) {
    firstPaintMs = Date.now() - processStart;
  }
}

/**
 * 推一条事件(主进程自己产生,例如 IPC 计数)。自动截断。
 */
export function pushEvent(event: PerfEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

/**
 * 推一条 IPC 调用记录(主进程侧包装使用)。
 */
export function bumpIpc(channel: string): void {
  ipcCallCount[channel] = (ipcCallCount[channel] ?? 0) + 1;
}

/**
 * 采一次当前进程 + 渲染进程内存。
 */
function sampleMemory(): MemorySample {
  const mem = process.memoryUsage();
  const rss = mem.rss / 1024 / 1024;
  const heapUsed = mem.heapUsed / 1024 / 1024;

  let rendererRss = 0;
  let rendererHeap = 0;
  try {
    // 拉所有 BrowserWindow 的 metrics 加和(粗略)
    for (const w of BrowserWindow.getAllWindows()) {
      const m = (w as unknown as { webContents: { getOSProcessId?: () => number } })
        .webContents;
      if (m && typeof m.getOSProcessId === 'function') {
        // 没有直接接口,跳过;保留 0 表示未知
      }
    }
  } catch {
    /* noop */
  }

  return {
    ts: Date.now(),
    mainRss: round2(rss),
    mainHeapUsed: round2(heapUsed),
    rendererRss: round2(rendererRss),
    rendererHeapUsed: round2(rendererHeap),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 启动内存采样定时器(主进程入口调用)。
 */
export function startMemorySampling(): void {
  if (memoryTimer) return;
  // 第一次立即采(冷启动 0s)
  const first = sampleMemory();
  memory.push(first);
  if (firstMemorySample) {
    firstMemorySample = false;
    // 广播给所有渲染进程(供 perf 面板)
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.webContents.send(IpcChannels.PERF_MEMORY_SAMPLE, first);
      } catch {
        /* noop */
      }
    }
  }

  memoryTimer = setInterval(() => {
    const s = sampleMemory();
    memory.push(s);
    if (memory.length > MAX_MEMORY) {
      memory.splice(0, memory.length - MAX_MEMORY);
    }
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.webContents.send(IpcChannels.PERF_MEMORY_SAMPLE, s);
      } catch {
        /* noop */
      }
    }
  }, MEMORY_SAMPLE_INTERVAL_MS);
  // unref 防止阻塞退出
  memoryTimer.unref?.();
}

export function stopMemorySampling(): void {
  if (memoryTimer) {
    clearInterval(memoryTimer);
    memoryTimer = null;
  }
}

export function getStartupTimings(): StartupTimings {
  return {
    whenReadyMs,
    windowReadyMs,
    extHostReadyMs,
    firstPaintMs,
    totalMs: firstPaintMs || windowReadyMs || Date.now() - processStart,
  };
}

export function getMemorySamples(limit = 50): MemorySample[] {
  if (limit <= 0) return [];
  return memory.slice(-limit);
}

export function getEvents(limit = 100): PerfEvent[] {
  if (limit <= 0) return [];
  return events.slice(-limit);
}

export function getIpcCallCount(): Record<string, number> {
  return { ...ipcCallCount };
}

export function getPerfReport(): PerfReport {
  return {
    startup: getStartupTimings(),
    events: getEvents(MAX_EVENTS),
    memory: getMemorySamples(MAX_MEMORY),
    ipcCallCount: getIpcCallCount(),
  };
}

/**
 * 推一条内存采样(从主进程 / 渲染端都能调,只是来源标记不同)。
 * 外部接口,主要给外部 perf:report 上报时用。
 */
export function pushMemorySample(sample: MemorySample): void {
  memory.push(sample);
  if (memory.length > MAX_MEMORY) {
    memory.splice(0, memory.length - MAX_MEMORY);
  }
}

/**
 * 注册 IPC handler(p7-perf 通道)。由 registerIpcHandlers 调一次。
 * 仅注册,不启动定时器 — `startMemorySampling()` 由主进程 bootstrap 单独调用。
 */
export function registerPerfIpcHandlers(ctx: IpcContext): void {
  // ctx 提供 windowManager 引用(目前用不到,保留接口一致以备未来扩展)
  void ctx;
  ipcMain.handle(IpcChannels.PERF_REPORT, (_e: IpcMainInvokeEvent, event: PerfEvent) => {
    if (!event || typeof event.phase !== 'string') return;
    // 首屏 paint 标记
    if (event.phase === 'first-paint' && firstPaintMs === 0) {
      markFirstPaint();
    }
    pushEvent(event);
    bumpIpc(IpcChannels.PERF_REPORT);
  });

  ipcMain.handle(IpcChannels.PERF_SNAPSHOT, () => {
    bumpIpc(IpcChannels.PERF_SNAPSHOT);
    return getPerfReport();
  });

  ipcMain.handle(IpcChannels.PERF_STARTUP_TIMES, () => {
    bumpIpc(IpcChannels.PERF_STARTUP_TIMES);
    return getStartupTimings();
  });

  ipcMain.handle(
    IpcChannels.PERF_MEMORY_SAMPLE,
    (_e: IpcMainInvokeEvent, _limit?: number, payload?: MemorySample) => {
      bumpIpc(IpcChannels.PERF_MEMORY_SAMPLE);
      if (payload && typeof payload.mainRss === 'number') {
        pushMemorySample(payload);
      }
      return getMemorySamples(50);
    },
  );
}

/** 暴露 app 退出时清理 */
export function disposePerf(): void {
  stopMemorySampling();
}

// 仅 dev 启动时打印(便于排查)
app.on('quit', () => {
  disposePerf();
});
