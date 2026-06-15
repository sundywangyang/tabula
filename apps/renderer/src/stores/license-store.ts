/**
 * 许可证 store (P-License v1 骨架)
 *
 * 集中管理当前许可证状态 + UI 用的临时态(verifying / lastError)。
 * 数据从主进程 IPC 拉取,通过 onStatusChanged 推送保持最新。
 *
 * 没有持久化:所有持久化在主进程 electron-store,这里只是 UI 缓存。
 *
 * 错误反馈: 与 file-store 等其他 store 保持一致 — IPC 失败时调
 * useFileStore.getState().showToast(...) 弹 toast, console.warn 仅做开发态日志。
 * lastError 仍保留给 UI 字段级展示(等 Settings 加 license tab 时用)。
 */
import { create } from 'zustand';
import type { LicenseError, LicenseInfo } from '@tabula/bridge';
import { useFileStore } from './file-store';

const EMPTY_LICENSE_INFO: LicenseInfo = {
  status: 'inactive',
  plan: 'free',
  expiresAt: null,
  maskedKey: null,
  daysUntilExpiry: null,
};

/** 失败时弹 toast, 同时保留 lastError 给 Settings 等 UI 字段级展示 */
function reportError(err: LicenseError, fallback: string): void {
  useFileStore.getState().showToast(err.message || fallback, 'error', 3000);
}

export interface LicenseState {
  /** 当前许可证信息;null = 还在 hydrate */
  info: LicenseInfo | null;
  /** 是否完成首次 hydrate(无论成功失败) */
  hydrated: boolean;
  /** UI 临时态:正在 verify */
  verifying: boolean;
  /** UI 临时态:最近一次 verify 失败原因 */
  lastError: LicenseError | null;

  /** 启动时调用:拉一次主进程缓存,设置 hydrated */
  hydrate: () => Promise<void>;
  /** 用户输入 key,返回 true=成功,UI 据此决定是否跳转/刷新 */
  verify: (key: string) => Promise<boolean>;
  /** 注销本地许可证 */
  clear: () => Promise<void>;
  /** 订阅主进程推送;返回 unsubscribe */
  subscribe: () => () => void;
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  info: null,
  hydrated: false,
  verifying: false,
  lastError: null,

  hydrate: async () => {
    try {
      const r = await window.tabula.license.getStatus();
      if (r.ok) {
        set({ info: r.data, hydrated: true, lastError: null });
        return;
      }
      // NOT_ACTIVATED 是初始态, 不弹 toast(没错误可言)
      if (r.error.code === 'NOT_ACTIVATED') {
        set({ info: EMPTY_LICENSE_INFO, hydrated: true, lastError: null });
        return;
      }
      // 其他错误(理论上不发生, 但 IPC 仍可能返 NETWORK_ERROR 等)→ toast
      reportError(r.error, '拉取许可证状态失败');
      set({ info: EMPTY_LICENSE_INFO, hydrated: true, lastError: r.error });
    } catch (e) {
      // 启动期 IPC 故障: 静默 console.warn, 不阻塞启动
      console.warn('[license-store] hydrate failed', e);
      set({ hydrated: true });
    }
  },

  verify: async (key) => {
    set({ verifying: true, lastError: null });
    try {
      const r = await window.tabula.license.verify(key);
      if (r.ok) {
        set({ info: r.data, verifying: false, lastError: null });
        return true;
      }
      set({ verifying: false, lastError: r.error });
      reportError(r.error, '许可证验证失败');
      return false;
    } catch (e) {
      const err: LicenseError = { code: 'UNKNOWN', message: String(e) };
      set({ verifying: false, lastError: err });
      useFileStore.getState().showToast(err.message, 'error', 3000);
      return false;
    }
  },

  clear: async () => {
    set({ verifying: true });
    try {
      const r = await window.tabula.license.clear();
      if (r.ok) {
        set({ info: EMPTY_LICENSE_INFO, verifying: false, lastError: null });
        useFileStore.getState().showToast('已注销许可证', 'info', 2000);
        return;
      }
      // clear 失败的 contract: 当前 service 不会返 ok:false, 但防御性处理
      set({ verifying: false });
      reportError(r.error, '注销失败');
    } catch (e) {
      console.warn('[license-store] clear failed', e);
      set({ verifying: false });
    }
  },

  subscribe: () => {
    const off = window.tabula.license.onStatusChanged((info) => {
      // 主进程推送的状态变化 → 同步本地
      set({ info, lastError: info.status === 'inactive' ? null : get().lastError });
    });
    return off;
  },
}));
