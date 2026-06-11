/**
 * UI dialogs 状态 (P7 v1 收口 — 命令面板)
 *
 * 把 App.tsx 里那一堆散落的 dialog 状态(新建文件夹 / 新建文件 /
 * 确认删除 / 永久删除确认 / 设置页)集中到一个小 store,这样:
 * 1. 命令面板(command-palette)执行 `file.new-folder` / `settings.open` 等命令
 *    时不用走 custom event 绕一圈;
 * 2. App.tsx 的 keydown handler 也能调同一份「打开 dialog」动作,
 *    后续若想统一抽 command dispatcher,门槛更低。
 *
 * 不持久化:dialog 状态本身就是 session-scoped,关闭应用 = 全关。
 */
import { create } from 'zustand';
import type { FsEntry } from '@tabula/bridge';

export interface PropertiesPanelState {
  /** 属性面板开关 */
  open: boolean;
  /** 所属 pane */
  paneId: string | null;
  /** 当前查看的条目 */
  entry: FsEntry | null;
}

export interface BatchRenameState {
  /** 批量重命名对话框开关 */
  open: boolean;
  /** 所属 pane */
  paneId: string | null;
  /** 要重命名的路径列表 */
  paths: string[];
  /** 对应的显示名列表 */
  names: string[];
}

export interface UiDialogsState {
  /** 新建文件夹对话框 */
  newFolderOpen: boolean;
  /** 触发该 dialog 的目标 pane(若 null,后续用 active pane) */
  newFolderTargetPane: string | null;
  /** 新建文件对话框 */
  newFileOpen: boolean;
  newFileTargetPane: string | null;
  /** 移到回收站确认对话框 */
  confirmDeleteOpen: boolean;
  confirmDeleteData: { paneId: string; count: number } | null;
  /** 永久删除确认对话框 */
  confirmPermanentDeleteOpen: boolean;
  confirmPermanentDeleteData: { paneId: string; count: number; paths: string[] } | null;
  /** 设置页 */
  settingsOpen: boolean;

  /** 属性详情面板 (P3) */
  propertiesPanel: PropertiesPanelState;

  /** 批量重命名对话框 (P3) */
  batchRename: BatchRenameState;

  // setters
  setNewFolder: (open: boolean, paneId?: string | null) => void;
  setNewFile: (open: boolean, paneId?: string | null) => void;
  setConfirmDelete: (data: { paneId: string; count: number } | null) => void;
  setConfirmPermanentDelete: (
    data: { paneId: string; count: number; paths: string[] } | null,
  ) => void;
  setSettingsOpen: (open: boolean) => void;
  /** 打开属性面板 */
  openPropertiesPanel: (paneId: string, entry: FsEntry) => void;
  /** 关闭属性面板 */
  closePropertiesPanel: () => void;
  /** 打开批量重命名对话框 */
  openBatchRename: (paneId: string, paths: string[], names: string[]) => void;
  /** 关闭批量重命名对话框 */
  closeBatchRename: () => void;
}

export const useUiDialogsStore = create<UiDialogsState>((set) => ({
  newFolderOpen: false,
  newFolderTargetPane: null,
  newFileOpen: false,
  newFileTargetPane: null,
  confirmDeleteOpen: false,
  confirmDeleteData: null,
  confirmPermanentDeleteOpen: false,
  confirmPermanentDeleteData: null,
  settingsOpen: false,

  // 属性详情面板
  propertiesPanel: {
    open: false,
    paneId: null,
    entry: null,
  },

  // 批量重命名对话框
  batchRename: {
    open: false,
    paneId: null,
    paths: [],
    names: [],
  },

  setNewFolder: (open, paneId) =>
    set({ newFolderOpen: open, newFolderTargetPane: paneId ?? null }),
  setNewFile: (open, paneId) =>
    set({ newFileOpen: open, newFileTargetPane: paneId ?? null }),
  setConfirmDelete: (data) =>
    set({ confirmDeleteOpen: data !== null, confirmDeleteData: data }),
  setConfirmPermanentDelete: (data) =>
    set({
      confirmPermanentDeleteOpen: data !== null,
      confirmPermanentDeleteData: data,
    }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  openPropertiesPanel: (paneId, entry) =>
    set({ propertiesPanel: { open: true, paneId, entry } }),

  closePropertiesPanel: () =>
    set({ propertiesPanel: { open: false, paneId: null, entry: null } }),

  openBatchRename: (paneId, paths, names) =>
    set({ batchRename: { open: true, paneId, paths, names } }),

  closeBatchRename: () =>
    set({ batchRename: { open: false, paneId: null, paths: [], names: [] } }),
}));
