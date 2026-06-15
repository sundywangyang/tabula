/**
 * 许可证 store (P-License v1 骨架)
 *
 * 集中管理当前许可证状态 + UI 用的临时态(verifying / lastError)。
 * 数据从主进程 IPC 拉取,通过 onStatusChanged 推送保持最新。
 *
 * 没有持久化:所有持久化在主进程 electron-store,这里只是 UI 缓存。
 */
import { create } from 'zustand';
import type { LicenseError, LicenseInfo } from '@tabula/bridge';

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
      } else {
        // NOT_ACTIVATED 是初始态,不当作错误
        set({
          info: { status: 'inactive', plan: 'free', expiresAt: null, maskedKey: null, daysUntilExpiry: null },
          hydrated: true,
          lastError: r.error.code === 'NOT_ACTIVATED' ? null : r.error,
        });
      }
    } catch (e) {
      // 静默:启动时不应该因为 IPC 失败阻塞
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
      return false;
    } catch (e) {
      set({
        verifying: false,
        lastError: { code: 'UNKNOWN', message: String(e) },
      });
      return false;
    }
  },

  clear: async () => {
    set({ verifying: true });
    try {
      await window.tabula.license.clear();
      set({
        info: { status: 'inactive', plan: 'free', expiresAt: null, maskedKey: null, daysUntilExpiry: null },
        verifying: false,
        lastError: null,
      });
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
