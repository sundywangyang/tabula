/**
 * 布局 store(P2 v1 + P2 v2)
 *
 * 持有:
 * - rootLayout: LayoutNode 树(split / pane 递归)
 * - activePaneId: 当前焦点 pane
 * - tabDrag: P2 v2 tab 拖动瞬时状态(不持久化)
 *
 * 不持久化的字段(运行时):
 * - tabDrag
 *
 * 持久化:走 electron-store,key = `layoutV1`,debounce 200ms
 *
 * 数据流:
 * - 启动:App.tsx 调用 hydrateFromConfig() → 拉 cfg:get('layoutV1') → 还原树
 * - 变更:任何 mutator 都触发 _schedulePersist(),200ms 后 cfg:set('layoutV1', ...)
 * - 切换 activeTab:外部(在 PaneView 用 useEffect)调 file-store.loadDir
 *
 * 操作 API:
 *   pane.openTab / closeTab / activateTab / focusPane
 *   pane.splitPane / mergePane / closeActivePane
 *   pane.goBack / goForward
 *   pane.navigate(paneId, path)  — 切到新路径,推 history
 *   pane.replaceTabPath(paneId, tabId, path)  — 改 tab.path/title(用于双击进入)
 *   pane.reorderTabs(paneId, fromIndex, toIndex)  — P2 v2 同 pane 内重排
 *   pane.moveTab(fromPaneId, fromTabId, toPaneId, toIndex)  — P2 v2 跨 pane 移动
 *   tabDrag.start / setDropTarget / setDropEdge / end
 */
import { create } from 'zustand';
import type { LayoutNode, SplitDirection, Tab } from '@tabula/bridge';
import { useFileStore, makeFolderTab } from './file-store';

const PERSIST_KEY = 'layoutV1';
const PERSIST_DEBOUNCE_MS = 200;

interface PersistedLayout {
  rootLayout: LayoutNode;
  activePaneId: string;
}

/** P2 v2: 拖动中的 tab,描述源和当前 drop 指示位置(都不持久化) */
export interface TabDragState {
  /** 被拖动的 tab id */
  tabId: string;
  /** 源 pane */
  sourcePaneId: string;
  /** 源 pane 里的索引 */
  sourceIndex: number;
  /** drop 目标:在哪个 pane 的哪个位置之前/之后 */
  dropTarget: { paneId: string; index: number; side: 'left' | 'right' } | null;
  /** drop 边缘:「拖出新建窗口」虚线占位 */
  dropEdge: 'right' | 'bottom' | null;
}

interface LayoutStore {
  rootLayout: LayoutNode;
  activePaneId: string;
  /** 是否已从持久化恢复完成 */
  hydrated: boolean;

  /** P2 v2: tab 拖动瞬时状态(不持久化) */
  tabDrag: TabDragState | null;

  // 生命周期
  hydrateFromConfig: () => Promise<void>;
  persistImmediate: () => Promise<void>;

  // Tab / Pane 操作(对外 namespace)
  pane: {
    openTab(paneId: string, tab: Tab): void;
    closeTab(paneId: string, tabId: string): void;
    activateTab(paneId: string, tabId: string): void;
    focusPane(paneId: string): void;
    splitPane(paneId: string, dir: SplitDirection): string; // 返回新 paneId
    mergePane(paneId: string): void;
    closeActivePane(): void;
    goBack(paneId: string): void;
    goForward(paneId: string): void;
    navigate(paneId: string, path: string): void; // 当前 active tab 跳路径
    replaceTabPath(paneId: string, tabId: string, path: string): void;
    /** P2 v2: 同 pane 内重排 tab(从 fromIndex 移到 toIndex) */
    reorderTabs(paneId: string, fromIndex: number, toIndex: number): void;
    /**
     * P2 v2: 跨 pane 移动 tab。
     *  - 内部做:从源 pane 移除(空 pane 自动加 placeholder)→ 插入目标 pane 的 toIndex → 目标 pane 激活并聚焦这个 tab。
     *  - 同 pane 时退化为 reorder(toIndex 自动修正)。
     */
    moveTab(
      fromPaneId: string,
      fromTabId: string,
      toPaneId: string,
      toIndex: number,
    ): void;
  };

  /** P2 v2: tab 拖动状态机 */
  tabDragOps: {
    start(paneId: string, tabId: string, index: number): void;
    setDropTarget(target: TabDragState['dropTarget']): void;
    setDropEdge(edge: TabDragState['dropEdge']): void;
    end(): void;
  };

  // 工具
  getActivePane: () => LayoutNode | null;
  getAllPaneIds: () => string[];
  countPanes: () => number;
  /** 找 pane 在树里的父节点引用(返回 { parent, index } 或 null) */
  findPaneContext: (
    node: LayoutNode,
    paneId: string,
    parent: LayoutNode | null,
    index: number,
  ) => { parent: LayoutNode; index: number } | null;
}

// =================== 工具函数 ===================

let idCounter = 0;
function makePaneId(): string {
  idCounter += 1;
  return `pane-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultPath(): string {
  if (typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')) {
    return 'C:\\Users';
  }
  return '/';
}

function makeDefaultLayout(): { root: LayoutNode; activePaneId: string } {
  const paneId = makePaneId();
  const initPath = defaultPath();
  const tab = makeFolderTab(initPath, '主页');
  return {
    root: {
      type: 'pane',
      id: paneId,
      tabs: [tab],
      activeTabId: tab.id,
    },
    activePaneId: paneId,
  };
}

/** 浅克隆 LayoutNode(用于 immutable 更新) */
function cloneLayout(node: LayoutNode): LayoutNode {
  if (node.type === 'pane') {
    return {
      type: 'pane',
      id: node.id,
      tabs: node.tabs.map((t) => ({ ...t })),
      activeTabId: node.activeTabId,
    };
  }
  return {
    type: 'split',
    dir: node.dir,
    sizes: [...node.sizes],
    children: node.children.map(cloneLayout),
  };
}

/** 在树里找 pane 节点 */
function findPane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const c of node.children) {
    const hit = findPane(c, paneId);
    if (hit) return hit;
  }
  return null;
}

/** 在树里 immutable 替换 pane 节点 */
function mapPane(
  node: LayoutNode,
  paneId: string,
  fn: (p: Extract<LayoutNode, { type: 'pane' }>) => LayoutNode,
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id === paneId) return fn(node);
    return node;
  }
  return {
    type: 'split',
    dir: node.dir,
    sizes: [...node.sizes],
    children: node.children.map((c) => mapPane(c, paneId, fn)),
  };
}

/** 在树里数 pane */
function countPanesInTree(node: LayoutNode): number {
  if (node.type === 'pane') return 1;
  return node.children.reduce((sum, c) => sum + countPanesInTree(c), 0);
}

/** 找相邻 pane(在 split 下,同方向的位置)
 *  - 水平 split(左 | 右),active 在左 → 找右侧第一个 pane 作为右邻居
 *  - active 在右 → 左侧第一个 pane
 *  - 垂直 split(上 | 下)同理
 *  - 嵌套 split:从根开始,沿 active 一侧走到尽头,另一侧的最近 pane 为邻居
 */
function findNeighborPane(
  root: LayoutNode,
  activePaneId: string,
  dir: 'left' | 'right' | 'up' | 'down',
): string | null {
  if (root.type === 'pane') return null;
  // 在 children 数组里找 active 所在位置
  const idx = root.children.findIndex((c) => containsPane(c, activePaneId));
  if (idx < 0) return null;
  const isHoriz = dir === 'left' || dir === 'right';
  // 判断 activePane 是在水平 split 还是垂直 split 的对应方向
  // 简化:对于水平 split,左右方向有邻居;垂直 split,上下方向有邻居
  const wantAxis: 'horizontal' | 'vertical' = isHoriz ? 'horizontal' : 'vertical';
  if (root.dir !== wantAxis) {
    // 不是我们想要的方向的 split,沿 children 一层层往里找
    return findNeighborPane(root.children[idx], activePaneId, dir);
  }
  // 同一 split 下,找方向另一侧的 pane
  let targetIdx = -1;
  if (dir === 'left' || dir === 'up') targetIdx = idx - 1;
  else targetIdx = idx + 1;
  if (targetIdx < 0 || targetIdx >= root.children.length) return null;
  // 在目标 children 里找最近的 pane
  return findFirstPane(root.children[targetIdx]);
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

// =================== Store ===================

export const useLayoutStore = create<LayoutStore>((set, get) => {
  const init = makeDefaultLayout();

  /** 立即 set 状态(不带持久化) */
  const setState = (partial: Partial<Pick<LayoutStore, 'rootLayout' | 'activePaneId'>>) => {
    set((s) => ({ ...partial }));
    schedulePersist();
  };

  /** 200ms 防抖持久化 */
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistInFlight = false;
  let pendingPersist: PersistedLayout | null = null;

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    const snap: PersistedLayout = {
      rootLayout: get().rootLayout,
      activePaneId: get().activePaneId,
    };
    pendingPersist = snap;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  };

  const flushPersist = async () => {
    if (persistInFlight) {
      // 等当前结束再调度一次
      setTimeout(() => void flushPersist(), 50);
      return;
    }
    if (!pendingPersist) return;
    const data = pendingPersist;
    pendingPersist = null;
    persistInFlight = true;
    try {
      // 走 electron-store(config:cfg:set,key 写在 AppConfig 之外需要 store 接受任意 key)
      // 我们这里借用 config.set 接受任意键
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window.tabula.config.set as any)(PERSIST_KEY, data);
    } catch (e) {
      console.warn('[layout-store] persist failed', e);
    } finally {
      persistInFlight = false;
    }
  };

  return {
    rootLayout: init.root,
    activePaneId: init.activePaneId,
    hydrated: false,
    tabDrag: null,

    hydrateFromConfig: async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all = (await (window.tabula.config.all as any)()) as Record<string, unknown>;
        const data = all[PERSIST_KEY] as PersistedLayout | undefined;
        if (data && data.rootLayout && data.activePaneId) {
          set({ rootLayout: data.rootLayout, activePaneId: data.activePaneId, hydrated: true });
        } else {
          set({ hydrated: true });
        }
      } catch (e) {
        console.warn('[layout-store] hydrate failed', e);
        set({ hydrated: true });
      }
    },

    persistImmediate: async () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      pendingPersist = {
        rootLayout: get().rootLayout,
        activePaneId: get().activePaneId,
      };
      await flushPersist();
    },

    pane: {
      openTab: (paneId, tab) => {
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          // 同 pane 同 path 不重复加
          if (tab.path) {
            const dup = p.tabs.find((t) => t.type === 'folder' && t.path === tab.path);
            if (dup) {
              return { ...p, activeTabId: dup.id };
            }
          }
          return {
            ...p,
            tabs: [...p.tabs, tab],
            activeTabId: tab.id,
          };
        });
        setState({ rootLayout: newRoot, activePaneId: paneId });
      },

      closeTab: (paneId, tabId) => {
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          const idx = p.tabs.findIndex((t) => t.id === tabId);
          if (idx < 0) return p;
          const tab = p.tabs[idx];
          if (!tab.closable) return p; // 不可关
          const newTabs = p.tabs.filter((t) => t.id !== tabId);
          if (newTabs.length === 0) {
            // 空 pane:保留一个 placeholder tab(closable=false)
            const placeholder: Tab = {
              id: `tab-placeholder-${paneId}`,
              type: 'folder',
              title: '空',
              pinned: true,
              closable: false,
              history: [],
              historyIndex: -1,
            };
            return { ...p, tabs: [placeholder], activeTabId: placeholder.id };
          }
          // 激活相邻 tab(优先选右边的)
          let nextActive = p.activeTabId;
          if (p.activeTabId === tabId) {
            const newIdx = Math.min(idx, newTabs.length - 1);
            nextActive = newTabs[newIdx].id;
          }
          return { ...p, tabs: newTabs, activeTabId: nextActive };
        });
        setState({ rootLayout: newRoot });
      },

      activateTab: (paneId, tabId) => {
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          if (!p.tabs.some((t) => t.id === tabId)) return p;
          return { ...p, activeTabId: tabId };
        });
        setState({ rootLayout: newRoot, activePaneId: paneId });
      },

      focusPane: (paneId) => {
        if (findPane(get().rootLayout, paneId)) {
          setState({ activePaneId: paneId });
        }
      },

      splitPane: (paneId, dir) => {
        const oldPane = findPane(get().rootLayout, paneId);
        if (!oldPane || oldPane.type !== 'pane') return paneId;
        const freshPaneId = makePaneId();
        const newPane: LayoutNode = {
          type: 'pane',
          id: freshPaneId,
          tabs: [
            {
              id: `tab-${freshPaneId}`,
              type: 'folder',
              title: '新窗格',
              pinned: false,
              closable: true,
              history: [],
              historyIndex: -1,
            },
          ],
          activeTabId: `tab-${freshPaneId}`,
        };

        // 新 split 节点,等分
        const splitNode: LayoutNode = {
          type: 'split',
          dir,
          sizes: [50, 50],
          children:
            dir === 'horizontal'
              ? [oldPane, newPane] // horizontal: 旧在左,新在右
              : [oldPane, newPane], // vertical: 旧在上,新在下
        };

        const newRoot = mapPane(get().rootLayout, paneId, () => splitNode);
        setState({ rootLayout: newRoot, activePaneId: freshPaneId });

        // 确保新 pane 在 file-store 里有数据空壳(下次操作会触发 loadDir)
        useFileStore.getState().ensurePane(freshPaneId);
        return freshPaneId;
      },

      mergePane: (paneId) => {
        // 简单实现:把 pane 内的 tabs 全部移到兄弟 pane(同 split 下另一个 pane),
        // 然后从父 split 移除。
        // 找到包含 paneId 的 split 父节点
        const root = get().rootLayout;
        const ctx = get().findPaneContext(root, paneId, null, 0);
        if (!ctx) return;
        if (ctx.parent.type !== 'split') {
          // 顶层就是单个 pane,merge 无效
          return;
        }
        const split = ctx.parent;
        const idxInSplit = ctx.index;
        const sibIdx = idxInSplit === 0 ? 1 : 0;
        if (sibIdx >= split.children.length) return;
        const sib = split.children[sibIdx];
        if (!sib) return;
        if (sib.type !== 'pane') {
          // 兄弟不是 pane(嵌套 split) — 用兄弟的 first pane 替代
          const firstPaneId = findFirstPane(sib);
          if (!firstPaneId) return;
          // 把 paneId 的 tabs 移到 firstPaneId
          const paneNode = findPane(root, paneId);
          if (paneNode?.type !== 'pane') return;
          const newRoot = mapPane(root, firstPaneId, (p) => ({
            ...p,
            tabs: [...p.tabs, ...paneNode.tabs],
            activeTabId: p.activeTabId ?? paneNode.tabs[0]?.id ?? null,
          }));
          // 删除 paneId 节点
          const pruned = removePaneFromTree(newRoot, paneId);
          // 同步 activePaneId
          const nextActive = paneId === get().activePaneId ? firstPaneId : get().activePaneId;
          setState({ rootLayout: pruned, activePaneId: nextActive });
          useFileStore.getState().removePaneData(paneId);
          return;
        }
        // 兄弟是 pane — 合并 tabs
        const paneNode = findPane(root, paneId);
        if (paneNode?.type !== 'pane') return;
        const newRoot = mapPane(root, sib.id, (p) => ({
          ...p,
          tabs: [...p.tabs, ...paneNode.tabs],
          activeTabId: p.activeTabId ?? paneNode.tabs[0]?.id ?? null,
        }));
        const pruned = removePaneFromTree(newRoot, paneId);
        const nextActive = paneId === get().activePaneId ? sib.id : get().activePaneId;
        setState({ rootLayout: pruned, activePaneId: nextActive });
        useFileStore.getState().removePaneData(paneId);
      },

      closeActivePane: () => {
        const cur = get().activePaneId;
        if (!cur) return;
        // 如果是最后一个 pane,退化成"单个 pane + 单个 placeholder"
        if (countPanesInTree(get().rootLayout) <= 1) {
          const root = get().rootLayout;
          if (root.type === 'pane') {
            // 关掉最后一个 pane:清空 tabs,放 placeholder
            const placeholder: Tab = {
              id: `tab-placeholder-${root.id}`,
              type: 'folder',
              title: '空',
              pinned: true,
              closable: false,
              history: [],
              historyIndex: -1,
            };
            const newRoot: LayoutNode = { ...root, tabs: [placeholder], activeTabId: placeholder.id };
            setState({ rootLayout: newRoot });
          }
          return;
        }
        get().pane.mergePane(cur);
      },

      goBack: (paneId) => {
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          if (!p.activeTabId) return p;
          const idx = p.tabs.findIndex((t) => t.id === p.activeTabId);
          if (idx < 0) return p;
          const tab = p.tabs[idx];
          if (tab.historyIndex <= 0) return p;
          const newIndex = tab.historyIndex - 1;
          const newPath = tab.history[newIndex];
          if (!newPath) return p;
          const newTabs = [...p.tabs];
          newTabs[idx] = { ...tab, path: newPath, historyIndex: newIndex, title: basenameOf(newPath) };
          return { ...p, tabs: newTabs };
        });
        setState({ rootLayout: newRoot });
        // 通知 file-store 重新加载
        const pane = findPane(newRoot, paneId);
        if (pane?.type === 'pane' && pane.activeTabId) {
          const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
          if (tab?.path) void useFileStore.getState().loadDir(paneId, tab.path);
        }
      },

      goForward: (paneId) => {
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          if (!p.activeTabId) return p;
          const idx = p.tabs.findIndex((t) => t.id === p.activeTabId);
          if (idx < 0) return p;
          const tab = p.tabs[idx];
          if (tab.historyIndex >= tab.history.length - 1) return p;
          const newIndex = tab.historyIndex + 1;
          const newPath = tab.history[newIndex];
          if (!newPath) return p;
          const newTabs = [...p.tabs];
          newTabs[idx] = { ...tab, path: newPath, historyIndex: newIndex, title: basenameOf(newPath) };
          return { ...p, tabs: newTabs };
        });
        setState({ rootLayout: newRoot });
        const pane = findPane(newRoot, paneId);
        if (pane?.type === 'pane' && pane.activeTabId) {
          const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
          if (tab?.path) void useFileStore.getState().loadDir(paneId, tab.path);
        }
      },

      navigate: (paneId, path) => {
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          if (!p.activeTabId) return p;
          const idx = p.tabs.findIndex((t) => t.id === p.activeTabId);
          if (idx < 0) return p;
          const tab = p.tabs[idx];
          // history:截断后续,推入新 path
          const truncated = tab.history.slice(0, tab.historyIndex + 1);
          truncated.push(path);
          const newTabs = [...p.tabs];
          newTabs[idx] = {
            ...tab,
            path,
            title: basenameOf(path),
            history: truncated,
            historyIndex: truncated.length - 1,
          };
          return { ...p, tabs: newTabs };
        });
        setState({ rootLayout: newRoot });
        void useFileStore.getState().loadDir(paneId, path);
      },

      replaceTabPath: (paneId, tabId, path) => {
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          const idx = p.tabs.findIndex((t) => t.id === tabId);
          if (idx < 0) return p;
          const tab = p.tabs[idx];
          const truncated = tab.history.slice(0, tab.historyIndex + 1);
          truncated.push(path);
          const newTabs = [...p.tabs];
          newTabs[idx] = {
            ...tab,
            path,
            title: basenameOf(path),
            history: truncated,
            historyIndex: truncated.length - 1,
          };
          return { ...p, tabs: newTabs };
        });
        setState({ rootLayout: newRoot });
      },

      // ============ P2 v2: tab 重排(同 pane)============

      reorderTabs: (paneId, fromIndex, toIndex) => {
        if (fromIndex === toIndex) return;
        if (fromIndex < 0 || toIndex < 0) return;
        const newRoot = mapPane(get().rootLayout, paneId, (p) => {
          if (fromIndex >= p.tabs.length) return p;
          const next = [...p.tabs];
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return p;
          // P2 v2 fix (verifier 抓出的 bug):toIndex 由调用方按「原始数组的预期位置」传入;
          // splice 之后,toIndex 之后的所有元素前移 1 位,因此向前移动时 (fromIndex < toIndex)
          // 需要 -1 修正,否则 tab 会被插到目标位置之后,而不是目标位置。
          const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
          const target = Math.max(0, Math.min(adjustedToIndex, next.length));
          next.splice(target, 0, moved);
          return { ...p, tabs: next };
        });
        setState({ rootLayout: newRoot });
      },

      // ============ P2 v2: 跨 pane tab 移动(同 pane 也走这个)============

      moveTab: (fromPaneId, fromTabId, toPaneId, toIndex) => {
        const root = get().rootLayout;
        const fromPane = findPane(root, fromPaneId);
        const toPane = findPane(root, toPaneId);
        if (!fromPane || fromPane.type !== 'pane') return;
        if (!toPane || toPane.type !== 'pane') return;
        const fromIdx = fromPane.tabs.findIndex((t) => t.id === fromTabId);
        if (fromIdx < 0) return;
        const tab = fromPane.tabs[fromIdx];
        if (!tab) return;

        // 同 pane 重排:toIndex 要在 splice 后重新算
        if (fromPaneId === toPaneId) {
          get().pane.reorderTabs(fromPaneId, fromIdx, toIndex);
          // 激活这个 tab
          const newRoot = mapPane(get().rootLayout, fromPaneId, (p) => {
            if (!p.tabs.some((t) => t.id === fromTabId)) return p;
            return { ...p, activeTabId: fromTabId };
          });
          setState({ rootLayout: newRoot, activePaneId: toPaneId });
          return;
        }

        // 跨 pane:从源 pane 抽出 tab,空 pane 加 placeholder
        const sourceWithout = (() => {
          const newTabs = fromPane.tabs.filter((t) => t.id !== fromTabId);
          if (newTabs.length === 0) {
            const placeholder: Tab = {
              id: `tab-placeholder-${fromPaneId}`,
              type: 'folder',
              title: '空',
              pinned: true,
              closable: false,
              history: [],
              historyIndex: -1,
            };
            return { tabs: [placeholder], activeTabId: placeholder.id };
          }
          let nextActive = fromPane.activeTabId;
          if (fromPane.activeTabId === fromTabId) {
            // 选原位置右侧第一个,没有就选最后一个
            const newIdx = Math.min(fromIdx, newTabs.length - 1);
            nextActive = newTabs[newIdx]?.id ?? newTabs[0]?.id ?? null;
          }
          return { tabs: newTabs, activeTabId: nextActive };
        })();

        // 插入到目标 pane
        const targetTabs = (() => {
          const t = [...toPane.tabs];
          const target = Math.max(0, Math.min(toIndex, t.length));
          t.splice(target, 0, tab);
          return t;
        })();

        // 一次性更新两 pane
        const newRoot = mapPane(root, fromPaneId, (p) => ({
          ...p,
          tabs: sourceWithout.tabs,
          activeTabId: sourceWithout.activeTabId,
        }));
        const finalRoot = mapPane(newRoot, toPaneId, (p) => ({
          ...p,
          tabs: targetTabs,
          activeTabId: fromTabId,
        }));

        // 焦点切到目标 pane(同 pane 时不切)
        setState({ rootLayout: finalRoot, activePaneId: toPaneId });

        // 目标 pane 新激活的 tab.path 触发 file-store.loadDir
        const inserted = targetTabs.find((t) => t.id === fromTabId);
        if (inserted?.path) {
          // 跨 pane 时,目标 pane 未必在 file-store 注册(虽然 splitPane 会 ensure)
          // 防御性 ensure 一下
          useFileStore.getState().ensurePane(toPaneId);
          void useFileStore.getState().loadDir(toPaneId, inserted.path);
        }
      },
    },

    // ============ P2 v2: tab 拖动状态机 ============
    tabDragOps: {
      start: (paneId, tabId, index) => {
        set({
          tabDrag: {
            tabId,
            sourcePaneId: paneId,
            sourceIndex: index,
            dropTarget: null,
            dropEdge: null,
          },
        });
      },
      setDropTarget: (target) => {
        const cur = get().tabDrag;
        if (!cur) return;
        // 清掉边缘占位(普通 drop 互斥)
        set({ tabDrag: { ...cur, dropTarget: target, dropEdge: null } });
      },
      setDropEdge: (edge) => {
        const cur = get().tabDrag;
        if (!cur) return;
        // 清掉普通 drop 指示(边缘占位互斥)
        set({ tabDrag: { ...cur, dropEdge: edge, dropTarget: null } });
      },
      end: () => {
        set({ tabDrag: null });
      },
    },

    // ============ 工具 ============
    getActivePane: () => {
      return findPane(get().rootLayout, get().activePaneId);
    },

    getAllPaneIds: () => {
      const out: string[] = [];
      const walk = (n: LayoutNode) => {
        if (n.type === 'pane') out.push(n.id);
        else n.children.forEach(walk);
      };
      walk(get().rootLayout);
      return out;
    },

    countPanes: () => countPanesInTree(get().rootLayout),

    findPaneContext: (node, paneId, parent, index) => {
      if (node.type === 'pane') {
        if (node.id === paneId && parent) return { parent, index };
        return null;
      }
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (!child) continue;
        const r = get().findPaneContext(child, paneId, node, i);
        if (r) return r;
      }
      return null;
    },
  };
});

// =================== 辅助:从树中删除指定 pane ===================

function removePaneFromTree(node: LayoutNode, paneId: string): LayoutNode {
  if (node.type === 'pane') {
    if (node.id === paneId) {
      // 不应该走到这(顶层 pane 不直接删,而是 mergePane 处理)
      return node;
    }
    return node;
  }
  // 找到包含 paneId 的 child 索引
  const idx = node.children.findIndex((c) => containsPane(c, paneId));
  if (idx < 0) return node;
  if (node.children.length === 1) {
    // 父 split 只有一个 child,上提 child 取代 split
    const only = node.children[0]!;
    return only;
  }
  // 移除该 child,其他保留,sizes 重新均分
  const newChildren = node.children.filter((_, i) => i !== idx);
  const newSizes = newChildren.map(() => 100 / newChildren.length);
  // 如果父 split 变 1 个 child,上提(否则 UI 留个 1 元素 split 难看)
  if (newChildren.length === 1) {
    return newChildren[0]!;
  }
  return {
    type: 'split',
    dir: node.dir,
    sizes: newSizes,
    children: newChildren.map((c) => removePaneFromTree(c, paneId)),
  };
}

function basenameOf(p: string): string {
  if (!p) return '';
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : '';
}
