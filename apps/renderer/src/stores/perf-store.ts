/**
 * 性能面板 store (P7 v1)
 *
 * 维护:
 * - 最近 FPS 读数(1s 滑窗)
 * - 最近一条主进程推过来的内存采样
 * - 客户端内存采样(performance.memory,主进程没有的字段)
 * - 上次刷新时间(用于面板显示)
 */
import { create } from 'zustand';
import type { MemorySample, PerfReport, StartupTimings } from '@tabula/bridge';
import { sampleRendererMemory } from '../perf/perf-client';

interface PerfStore {
  fps: number;
  /** 主进程最新一条 */
  lastMemory: MemorySample | null;
  /** 客户端自己的 JS heap 估算(主进程没有) */
  rendererHeapMb: number;
  /** 启动时间 */
  startupTimings: StartupTimings | null;
  /** 拉取过的完整报告(可选缓存) */
  lastReport: PerfReport | null;
  /** 当前面板是否打开 */
  panelOpen: boolean;

  setFps: (fps: number) => void;
  setMemory: (sample: MemorySample) => void;
  setStartupTimings: (t: StartupTimings) => void;
  setReport: (r: PerfReport) => void;
  openPanel: () => void;
  closePanel: () => void;
  refreshRendererHeap: () => void;
}

export const usePerfStore = create<PerfStore>((set) => ({
  fps: 60,
  lastMemory: null,
  rendererHeapMb: 0,
  startupTimings: null,
  lastReport: null,
  panelOpen: false,

  setFps: (fps) => set({ fps }),
  setMemory: (sample) => set({ lastMemory: sample }),
  setStartupTimings: (t) => set({ startupTimings: t }),
  setReport: (r) => set({ lastReport: r }),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  refreshRendererHeap: () => {
    const m = sampleRendererMemory();
    set({ rendererHeapMb: m.rendererHeapUsed ?? 0 });
  },
}));
