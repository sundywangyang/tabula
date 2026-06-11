/**
 * 命令派发 (P7 v1 收口)
 *
 * 单一入口:把一个 commandId 转成实际动作。
 * - 命令面板(Ctrl+Shift+P)选中条目后调用本模块
 * - App.tsx 全局 keydown handler 也调用本模块
 * - 主进程 `commands:run-command` 事件推回后也调用本模块
 *
 * 设计要点:
 * - 全部 store 状态都用 `useXxxStore.getState()` 拿(不进 React selector,
 *   避免订阅变化、避免 infinite loop)。
 * - 不依赖任何 React closure / props;`activePaneId` 也是从 layout-store
 *   实时取 — 任何时候调都拿到「当前 active pane」。
 * - 失败 / 未知 id → 弹一个 toast(借助 useFileStore.showToast),
 *   返回 false;成功 → 返回 true。
 *
 * 不要碰 command-catalog.ts 的命令定义;本文件只把 catalog 里的 id
 * 映射到现有 store 动作。
 */
import type { LayoutNode, KeyCombo } from '@tabula/bridge';
import { useFileStore, makeFolderTab } from './stores/file-store';
import { useLayoutStore } from './stores/layout-store';
import { useThemeStore, type ThemeMode } from './stores/theme-store';
import { useSettingsStore } from './stores/settings-store';
import { useUiDialogsStore } from './stores/ui-dialogs-store';

/** 工具:取父路径(供 file.duplicate 用) */
function parentPath(p: string): string {
  if (!p) return '';
  if (/^[a-zA-Z]:[\\/]?$/.test(p)) return '';
  const m = p.match(/^(.*)[\\/]([^\\/]+)[\\/]?$/);
  if (m) {
    const parent = m[1];
    if (/^[a-zA-Z]:$/.test(parent)) return parent + '\\';
    return parent;
  }
  return '';
}

/** 渲染端默认 pane path(未 hydrate 时兜底) */
function defaultPath(): string {
  return navigator.platform.toLowerCase().includes('win') ? 'C:\\Users' : '/';
}

/** 取当前 active pane(若不存在返回 null) — 仅返回 node */
function findActivePane(): LayoutNode | null {
  const layout = useLayoutStore.getState().rootLayout;
  const id = useLayoutStore.getState().activePaneId;
  return findPaneInLayout(layout, id);
}

function findPaneInLayout(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  for (const c of node.children) {
    const r = findPaneInLayout(c, paneId);
    if (r) return r;
  }
  return null;
}

function containsPane(node: LayoutNode, paneId: string): boolean {
  if (node.type === 'pane') return node.id === paneId;
  return node.children.some((c) => containsPane(c, paneId));
}

function findFirstPane(node: LayoutNode): string | null {
  if (node.type === 'pane') return node.id;
  for (const c of node.children) {
    const r = findFirstPane(c);
    if (r) return r;
  }
  return null;
}

function findNeighborPane(
  root: LayoutNode,
  activePaneId: string,
  dir: 'left' | 'right' | 'up' | 'down',
): string | null {
  if (root.type === 'pane') return null;
  const idx = root.children.findIndex((c) => containsPane(c, activePaneId));
  if (idx < 0) return null;
  const isHoriz = dir === 'left' || dir === 'right';
  const wantAxis: 'horizontal' | 'vertical' = isHoriz ? 'horizontal' : 'vertical';
  if (root.dir !== wantAxis) {
    return findNeighborPane(root.children[idx]!, activePaneId, dir);
  }
  let targetIdx = -1;
  if (dir === 'left' || dir === 'up') targetIdx = idx - 1;
  else targetIdx = idx + 1;
  if (targetIdx < 0 || targetIdx >= root.children.length) return null;
  return findFirstPane(root.children[targetIdx]!);
}

function findClosestSplitAncestor(
  root: LayoutNode,
  paneId: string,
): Extract<LayoutNode, { type: 'split' }> | null {
  if (root.type === 'pane') return null;
  const directHit = root.children.some((c) => c.type === 'pane' && c.id === paneId);
  if (directHit) return root;
  for (const c of root.children) {
    if (c.type === 'pane') continue;
    const r = findClosestSplitAncestor(c, paneId);
    if (r) return r;
  }
  return null;
}

/**
 * 执行一条命令(渲染端)。返回 true 表示成功分发,false 表示命令不存在 /
 * 当前状态下无法执行(给出原因 toast)。
 *
 * 同步实现:绝大多数动作是 sync 触发 UI 状态变化;
 * `void async` 的副作用内部已经 fire-and-forget,不阻塞调用方。
 */
export function runCommandById(commandId: string): boolean {
  const file = useFileStore.getState();
  const layout = useLayoutStore.getState();
  const dialogs = useUiDialogsStore.getState();
  const activePaneId = layout.activePaneId;

  const showToast = (msg: string, kind: 'info' | 'warn' | 'error' = 'warn', ms = 1500) =>
    file.showToast(msg, kind, ms);

  switch (commandId) {
    // ============ 文件 ============
    case 'file.refresh': {
      void file.refresh(activePaneId);
      return true;
    }
    case 'file.open': {
      // 命令面板触发的「打开选中项」:取 cursor 路径,目录 → navigate,文件 → fs.openPath
      // (FileList 组件级 keydown 也处理 Enter,这里只覆盖 focus 不在 file list 的场景)
      const data = file.panes[activePaneId];
      const cursor = data?.cursorPath ?? null;
      if (!cursor) {
        showToast('未选中任何项', 'warn');
        return false;
      }
      const entry = data?.entries.find((e) => e.path === cursor);
      if (entry?.isDirectory) {
        useLayoutStore.getState().pane.navigate(activePaneId, cursor);
      } else {
        void window.tabula.fs.openPath(cursor);
      }
      return true;
    }
    case 'file.delete': {
      const data = file.panes[activePaneId];
      const selected = data?.selectedPaths ?? new Set<string>();
      if (selected.size === 0) {
        showToast('未选中任何项', 'warn');
        return false;
      }
      dialogs.setConfirmDelete({ paneId: activePaneId, count: selected.size });
      return true;
    }
    case 'file.delete-permanent': {
      const data = file.panes[activePaneId];
      const selected = data?.selectedPaths ?? new Set<string>();
      if (selected.size === 0) {
        showToast('未选中任何项', 'warn');
        return false;
      }
      dialogs.setConfirmPermanentDelete({
        paneId: activePaneId,
        count: selected.size,
        paths: Array.from(selected),
      });
      return true;
    }
    case 'file.rename': {
      const data = file.panes[activePaneId];
      const selected = data?.selectedPaths ?? new Set<string>();
      const cursor = data?.cursorPath ?? null;
      if (selected.size === 0 && !cursor) return false;
      if (selected.size > 1) {
        showToast('重命名仅支持单选', 'warn', 2000);
        return false;
      }
      const target = cursor ?? Array.from(selected)[0];
      if (target) file.beginRename(activePaneId, target);
      return true;
    }
    case 'file.new-folder': {
      dialogs.setNewFolder(true, activePaneId);
      return true;
    }
    case 'file.copy': {
      file.copySelected(activePaneId);
      return true;
    }
    case 'file.cut': {
      file.cutSelected(activePaneId);
      return true;
    }
    case 'file.paste': {
      void file.pasteToPane(activePaneId);
      return true;
    }
    case 'file.duplicate': {
      const data = file.panes[activePaneId];
      const selected = data?.selectedPaths ?? new Set<string>();
      if (selected.size === 0) {
        showToast('未选中任何项', 'warn');
        return false;
      }
      if (selected.size > 1) {
        showToast('复制到同级目录仅支持单选', 'warn');
        return false;
      }
      const srcPath = Array.from(selected)[0]!;
      const destDir = parentPath(srcPath);
      if (!destDir) {
        showToast('无法确定目标目录', 'error');
        return false;
      }
      void file.performBulk([srcPath], destDir, 'copy', activePaneId);
      return true;
    }
    case 'file.select-all': {
      file.selectAll(activePaneId);
      return true;
    }
    case 'file.path-bar': {
      file.openPathBar(activePaneId);
      return true;
    }

    // ============ 标签 ============
    case 'tab.new': {
      const tab = makeFolderTab(defaultPath(), '新标签');
      useLayoutStore.getState().pane.openTab(activePaneId, tab);
      return true;
    }
    case 'tab.close': {
      const pane = findPaneInLayout(layout.rootLayout, activePaneId);
      if (pane?.type === 'pane' && pane.activeTabId) {
        useLayoutStore.getState().pane.closeTab(activePaneId, pane.activeTabId);
      }
      return true;
    }
    case 'tab.next': {
      const pane = findPaneInLayout(layout.rootLayout, activePaneId);
      if (pane?.type === 'pane' && pane.tabs.length > 1 && pane.activeTabId) {
        const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
        const nextIdx = (idx + 1) % pane.tabs.length;
        const next = pane.tabs[nextIdx];
        if (next) useLayoutStore.getState().pane.activateTab(activePaneId, next.id);
      }
      return true;
    }
    case 'tab.prev': {
      const pane = findPaneInLayout(layout.rootLayout, activePaneId);
      if (pane?.type === 'pane' && pane.tabs.length > 1 && pane.activeTabId) {
        const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
        const prevIdx = (idx - 1 + pane.tabs.length) % pane.tabs.length;
        const prev = pane.tabs[prevIdx];
        if (prev) useLayoutStore.getState().pane.activateTab(activePaneId, prev.id);
      }
      return true;
    }
    case 'tab.switch-to-1':
    case 'tab.switch-to-2':
    case 'tab.switch-to-3':
    case 'tab.switch-to-4':
    case 'tab.switch-to-5':
    case 'tab.switch-to-6':
    case 'tab.switch-to-7':
    case 'tab.switch-to-8':
    case 'tab.switch-to-9': {
      const n = parseInt(commandId.slice(-1), 10);
      const pane = findPaneInLayout(layout.rootLayout, activePaneId);
      if (pane?.type === 'pane') {
        const target = pane.tabs[n - 1];
        if (target) useLayoutStore.getState().pane.activateTab(activePaneId, target.id);
      }
      return true;
    }

    // ============ 窗格 ============
    case 'pane.split-horizontal': {
      useLayoutStore.getState().pane.splitPane(activePaneId, 'horizontal');
      return true;
    }
    case 'pane.split-vertical': {
      useLayoutStore.getState().pane.splitPane(activePaneId, 'vertical');
      return true;
    }
    case 'pane.focus-left': {
      const nb = findNeighborPane(layout.rootLayout, activePaneId, 'left');
      if (nb) useLayoutStore.getState().pane.focusPane(nb);
      return true;
    }
    case 'pane.focus-right': {
      const nb = findNeighborPane(layout.rootLayout, activePaneId, 'right');
      if (nb) useLayoutStore.getState().pane.focusPane(nb);
      return true;
    }
    case 'pane.focus-up': {
      const nb = findNeighborPane(layout.rootLayout, activePaneId, 'up');
      if (nb) useLayoutStore.getState().pane.focusPane(nb);
      return true;
    }
    case 'pane.focus-down': {
      const nb = findNeighborPane(layout.rootLayout, activePaneId, 'down');
      if (nb) useLayoutStore.getState().pane.focusPane(nb);
      return true;
    }
    case 'pane.close': {
      useLayoutStore.getState().pane.mergePane(activePaneId);
      return true;
    }
    case 'pane.resize-left': {
      return resizeSplit(activePaneId, 'left');
    }
    case 'pane.resize-right': {
      return resizeSplit(activePaneId, 'right');
    }
    case 'pane.resize-up': {
      return resizeSplit(activePaneId, 'up');
    }
    case 'pane.resize-down': {
      return resizeSplit(activePaneId, 'down');
    }

    // ============ 视图 / 搜索 ============
    case 'search.global': {
      void file.openGlobalSearch();
      return true;
    }
    case 'search.focus': {
      // 触发 file-list 内搜索框聚焦(用 custom event,跟旧 keydown 行为一致)
      window.dispatchEvent(new CustomEvent('tabula:focus-search-input'));
      return true;
    }
    case 'preview.toggle': {
      // 旧 keydown:Space 触发 — 借用 file-store 的 togglePreview 之类
      // 简化:派发一个 custom event,FileList 自己接(旧版就是这样)
      window.dispatchEvent(new CustomEvent('tabula:toggle-preview'));
      return true;
    }
    case 'theme.toggle': {
      const modes: ThemeMode[] = ['light', 'dark', 'system'];
      const cur = useThemeStore.getState().mode;
      const next = modes[(modes.indexOf(cur) + 1) % modes.length];
      useThemeStore.getState().setMode(next);
      useSettingsStore.getState().setTheme(next);
      return true;
    }

    // ============ 设置 / 调试 ============
    case 'settings.open': {
      dialogs.setSettingsOpen(true);
      return true;
    }
    case 'app.devtools': {
      void window.tabula.app.openDevTools();
      return true;
    }

    default:
      return false;
  }
}

function resizeSplit(
  activePaneId: string,
  dir: 'left' | 'right' | 'up' | 'down',
): boolean {
  const layout = useLayoutStore.getState();
  const split = findClosestSplitAncestor(layout.rootLayout, activePaneId);
  if (!split || !split.id) return false;
  const wantAxis = dir === 'left' || dir === 'right' ? 'horizontal' : 'vertical';
  if (split.dir !== wantAxis) return false;
  const el = document.querySelector<HTMLElement>(`[data-split-id="${split.id}"]`);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const totalPx = split.dir === 'horizontal' ? rect.width : rect.height;
  const sign = dir === 'left' || dir === 'up' ? -1 : 1;
  useLayoutStore.getState().pane.setSplitSizes(split.id, sign * 20, totalPx);
  return true;
}

/**
 * 把 commandId 解析为可读文本(给命令面板 show 标题 + 绑定的快捷键)
 * 依赖 useKeymapStore 的 hydrated 数据 — 调用方应确保已 hydrate。
 */
export function formatCommandLabel(
  _commandId: string,
  title: string,
  combo: KeyCombo | null,
): string {
  if (!combo) return title;
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Meta');
  let main = combo.key;
  if (main.length === 1) {
    main = combo.shift ? main.toUpperCase() : main.toLowerCase();
  } else {
    main = main.charAt(0).toUpperCase() + main.slice(1);
  }
  parts.push(main);
  return `${title}  ${parts.join('+')}`;
}
