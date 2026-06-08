/**
 * 快捷键 store (P7 v1)
 *
 * 缓存当前所有命令 + 当前生效绑定。
 * 启动时由 App.tsx 调用 hydrate() 拉取,设置页变更时由 setBinding / resetAll 触发刷新。
 *
 * 不持久化:数据本身由主进程 electron-store 负责。
 */
import { create } from 'zustand';
import type { CommandSpec, KeyCombo, ShortcutBinding } from '@tabula/bridge';

export interface KeymapState {
  commands: CommandSpec[];
  /** id -> current combo(可能为 null) */
  bindings: Map<string, KeyCombo | null>;
  /** id -> customized 标记 */
  customized: Set<string>;
  hydrated: boolean;
  loading: boolean;
  /** 一次性错误(供 UI Toast 显示) */
  lastError: string | null;

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  setBinding: (commandId: string, combo: KeyCombo | null) => Promise<boolean>;
  resetAll: () => Promise<void>;
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  commands: [],
  bindings: new Map(),
  customized: new Set(),
  hydrated: false,
  loading: false,
  lastError: null,

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [cmds, bindings] = await Promise.all([
        window.tabula.shortcuts.getAll(),
        window.tabula.shortcuts.getBindings(),
      ]);
      const bindingMap = new Map<string, KeyCombo | null>();
      const customized = new Set<string>();
      for (const b of bindings) {
        bindingMap.set(b.commandId, b.combo);
        if (b.customized) customized.add(b.commandId);
      }
      set({
        commands: cmds,
        bindings: bindingMap,
        customized,
        hydrated: true,
        loading: false,
        lastError: null,
      });
    } catch (e) {
      console.warn('[keymap-store] hydrate failed', e);
      set({ hydrated: true, loading: false });
    }
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const [cmds, bindings] = await Promise.all([
        window.tabula.shortcuts.getAll(),
        window.tabula.shortcuts.getBindings(),
      ]);
      const bindingMap = new Map<string, KeyCombo | null>();
      const customized = new Set<string>();
      for (const b of bindings) {
        bindingMap.set(b.commandId, b.combo);
        if (b.customized) customized.add(b.commandId);
      }
      set({ commands: cmds, bindings: bindingMap, customized, loading: false });
    } catch (e) {
      console.warn('[keymap-store] refresh failed', e);
      set({ loading: false });
    }
  },

  setBinding: async (commandId, combo) => {
    const result = await window.tabula.shortcuts.setBinding(commandId, combo);
    if (result.ok) {
      set((s) => {
        const next = new Map(s.bindings);
        next.set(commandId, combo);
        const customized = new Set(s.customized);
        const spec = s.commands.find((c) => c.id === commandId);
        if (spec && combo && !isSameCombo(combo, spec.defaultCombo)) {
          customized.add(commandId);
        } else {
          customized.delete(commandId);
        }
        return { bindings: next, customized, lastError: null };
      });
      return true;
    }
    // 失败:把错误存到 lastError(UI 会显示)
    const msg =
      result.error.code === 'CONFLICT' && result.error.conflict
        ? `已被「${result.error.conflict.conflictingTitle}」占用`
        : result.error.message;
    set({ lastError: msg });
    return false;
  },

  resetAll: async () => {
    await window.tabula.shortcuts.resetAll();
    await get().refresh();
    set({ lastError: null });
  },
}));

function isSameCombo(a: KeyCombo | null, b: KeyCombo | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta
  );
}
