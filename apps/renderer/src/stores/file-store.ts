/**
 * 全局文件状态(P2: 按 paneId 分片)
 *
 * P0 简版:单文件 store
 * P1: 视图模式 + 排序 + 多选 + 键盘导航 + 显示选项 + 重命名 + 路径补全
 * P2: 数据按 paneId 区分;layout-store 持有 LayoutNode 树 + activePaneId
 * P3: 剪贴板(copy/cut/paste)、拖放状态、toast、进度、新建/批量删除/重名冲突
 *
 * 共享(view / sort / 隐藏选项 / clipboard / dragState / toast / progress)
 * 走全局;每 pane 独立的数据
 * (currentPath / entries / selectedPaths / cursorPath / renameTarget / pathBar*)
 * 走 panes[paneId] 分片。
 */
import { create } from 'zustand';
import type {
  ArchiveProgress,
  CompressRequest,
  ExtractRequest,
  FsEntry,
  TrashEntry,
} from '@tabula/bridge';
import { useLayoutStore } from './layout-store';
import { getCachedRootPath } from '../platform-cache';

export interface BreadcrumbSegment {
  name: string;
  path: string;
}

export type ViewMode = 'list' | 'grid' | 'details';
export type SortField = 'name' | 'size' | 'mtime' | 'type';
export type SortDir = 'asc' | 'desc' | null;

// =================== G007: Group By (分组) ===================

/** G007: 分组模式。'none' = 不分组(单段),其余按指定维度分组。 */
export type GroupByMode = 'none' | 'type' | 'date' | 'size';

/** G007: 分组后的一段(header 是组的可读标签,如 ".js" / "Today" / "Large (>10 MB)") */
export interface GroupSection {
  header: string;
  entries: FsEntry[];
}

// =================== P3:剪贴板 / 拖放 / 通知 ===================

/** 全局剪贴板状态(copy / cut + 路径列表) */
export interface ClipboardState {
  mode: 'copy' | 'cut';
  paths: string[];
  /** cut 模式时,标出每个 source 来自哪个 pane(用于粘贴后高亮?目前 v1 不需要) */
  sourcePaneId: string | null;
}

/** 拖放状态(渲染进程内部状态,不走系统 dataTransfer) */
export interface DragState {
  paths: string[];
  sourcePaneId: string | null;
  /** 当前 dragover 时,目标位置是 move 还是 copy(ctrl 键切换) */
  effect: 'move' | 'copy';
  /** 拖到目标 dir 的视觉反馈 */
  targetPath: string | null;
  targetKind: 'pane' | 'sidebar' | 'breadcrumb' | 'tab' | null;
}

/** 单条 toast */
export interface ToastItem {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'warn' | 'error';
  /** ms,0 表示不自动消失 */
  duration: number;
  createdAt: number;
}

/** 长时间操作的进度提示 */
export interface ProgressInfo {
  operation: 'copy' | 'move' | 'delete' | 'mkdir' | 'createFile';
  count: number;
  message: string;
}

/** 冲突项:粘贴时若目标已存在 */
export interface ConflictItem {
  sourcePath: string;
  sourceName: string;
  destPath: string;
  destDir: string;
  destName: string;
  isDirectory: boolean;
}

/** 冲突解决动作 */
export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'cancelAll';

/** 等待用户逐个解决的冲突队列 */
export interface PendingConflicts {
  /** 发起粘贴的 paneId（用于完成后刷新） */
  paneId: string;
  /** 整批 paste / drop 的参数 */
  sources: string[];
  destinationDir: string;
  mode: 'copy' | 'move';
  /** 已确认的覆盖/重命名目标(可能含 newName) */
  resolved: { source: string; dest: string; overwrite: boolean }[];
  /** 待处理的冲突(队列头一个会显示) */
  queue: ConflictItem[];
  /** 跳过/已处理不冲突的源(sourcePath -> destPath) */
  autoResolved: { source: string; dest: string; overwrite: boolean }[];
}

/** 单个 pane 持有的文件系统数据(独立于 layout 结构) */
export interface PaneFileData {
  currentPath: string;
  breadcrumb: BreadcrumbSegment[];
  entries: FsEntry[];
  loading: boolean;
  error: string | null;

  selectedPaths: Set<string>;
  cursorPath: string | null;
  lastClickedPath: string | null;

  renameTarget: string | null;

  // P4: 当前目录文件名过滤(Ctrl+F)
  searchQuery: string;
  searchOpen: boolean;

  /** 视图模式(list/grid/details)，每个 pane 独立 */
  viewMode: ViewMode;

  // G007: 当前 pane 的分组模式(per-pane)
  groupBy: GroupByMode;
}

function emptyPaneData(): PaneFileData {
  return {
    currentPath: '',
    breadcrumb: [],
    entries: [],
    loading: false,
    error: null,
    selectedPaths: new Set(),
    cursorPath: null,
    lastClickedPath: null,
    renameTarget: null,
    searchQuery: '',
    searchOpen: false,
    viewMode: 'details',
    groupBy: 'none',
  };
}

// =================== P4: 预览 / 全局搜索 ===================

/** 预览状态(全局,单实例) */
export interface PreviewState {
  entry: FsEntry;
  /** 已加载的 data URL / 文本 / null=loading */
  blobUrl: string | null;
  text: string | null;
  loading: boolean;
  error: string | null;
  /** 截断标记:文件 >1MB,只显示前 N 行 */
  truncated: boolean;
  /** 总行数(仅 text / code / md 适用) */
  totalLines: number;
}

/** 全局搜索结果项(单条) */
export interface GlobalSearchHit {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  /** 命中驱动器的根路径(用于 UI 分组) */
  driveRoot: string;
  /** 匹配分数 */
  score?: number;
  /** 匹配类型 */
  matchType?: 'exact' | 'prefix' | 'substring' | 'fuzzy';
}

/** 全局搜索状态(全局,单实例) */
export interface GlobalSearchState {
  open: boolean;
  query: string;
  /** 文件类型过滤 */
  fileType: FileTypeFilter;
  /** 搜索根目录(默认为当前 pane 路径) */
  rootPath: string;
  /** 扫描过的驱动器根 */
  scannedDrives: string[];
  scanning: boolean;
  scanError: string | null;
  /** 全量条目缓存(原始) */
  entries: GlobalSearchHit[];
  /** 过滤后展示 */
  results: GlobalSearchHit[];
  /** 选中的索引(键盘↑↓) */
  selectedIndex: number;
  /** 分页:当前页 */
  page: number;
  /** 分页:每页条数 */
  pageSize: number;
  /** 搜索用时(ms) */
  elapsedMs: number;
}

/** P4: 文件类型过滤 */
export type FileTypeFilter = 'all' | 'image' | 'document' | 'code' | 'archive';

// =================== P7: 缩略图缓存 ===================

/** 缩略图缓存项(key = path) */
export interface ThumbnailEntry {
  /** base64 data URL(已 resize) */
  dataUrl: string;
  /** 文件 mtime(用于失效判定) */
  mtime: number;
  /** 加载时间戳(用于 LRU 淘汰 — 后续 v2 可加) */
  loadedAt: number;
}

/** 支持缩略图的图片扩展名(与主进程 thumbnail.ts 的 IMAGE_EXTS 保持一致) */
export const THUMBNAIL_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.ico', '.heic', '.avif', '.tiff', '.tif', '.psd', '.raw',
]);

export function isThumbnailable(ext: string): boolean {
  return THUMBNAIL_EXTS.has(ext.toLowerCase());
}

interface FileStore {
  // ===== 共享视图设置(全局)=====
  sortBy: SortField;
  sortDir: SortDir;
  showHidden: boolean;
  showExtensions: boolean;

  // ===== 路径栏(全局模态,操作 targetPaneId)=====
  pathBarOpen: boolean;
  pathBarTargetPaneId: string | null;
  pathBarValue: string;
  pathBarError: string | null;
  pathBarCompletions: string[];

  // ===== P3: 剪贴板 / 拖放 / 通知 / 进度 =====
  clipboard: ClipboardState | null;
  dragState: DragState | null;
  toasts: ToastItem[];
  progress: ProgressInfo | null;
  /** 待解决的冲突队列(逐个弹窗) */
  pendingConflicts: PendingConflicts | null;

  // ===== P4: 预览 / 全局搜索 =====
  /** 全局预览状态(单实例 overlay) */
  previewState: PreviewState | null;
  /** 全局搜索状态(单实例 overlay) */
  globalSearch: GlobalSearchState;

  // ===== P3: 回收站 =====
  /** 回收站条目列表 */
  trashItems: TrashEntry[];
  trashLoading: boolean;
  trashError: string | null;
  /** 回收站选中项(itemPath 集合) */
  trashSelectedPaths: Set<string>;

  // ===== P7: 缩略图缓存 =====
  /** path → 缩略图 dataURL(mtime 一起记,用于后续判定失效) */
  thumbnails: Map<string, ThumbnailEntry>;
  /** 正在加载的 path 集合(去重 + UI 状态) */
  thumbnailLoading: Set<string>;

  // ===== Archive (压缩 / 解压) =====
  /** 活跃的归档任务(jobId → 最新进度),包含已完成/失败(用于查询历史) */
  archiveJobs: Map<string, ArchiveProgress & { sourcePaneId?: string }>;
  /** jobId → 显示该进度的 toast id(取消/完成后 dismiss) */
  archiveToasts: Map<string, string>;
  /** jobId → 触发该任务的 paneId(用于完成后刷新) */
  archivePaneIds: Map<string, string>;

  // ===== 每 pane 数据分片 =====
  panes: Record<string, PaneFileData>;

  // ============ Per-pane: 目录 ============
  ensurePane: (paneId: string) => Promise<void>;
  removePaneData: (paneId: string) => void;
  loadDir: (paneId: string, path: string) => Promise<void>;
  refresh: (paneId: string) => Promise<void>;

  // ============ Per-pane: 视图设置(每个 pane 独立)===========
  setViewMode: (paneId: string, mode: ViewMode) => void;
  // G007: 设置 pane 的分组模式
  setGroupBy: (paneId: string, mode: GroupByMode) => void;
  cycleSort: (field: SortField) => void;
  toggleShowHidden: () => void;
  toggleShowExtensions: () => void;
  hydrateFromConfig: () => Promise<void>;

  // ============ Per-pane: 选择 ============
  selectOne: (paneId: string, path: string) => void;
  toggleSelect: (paneId: string, path: string) => void;
  rangeSelect: (paneId: string, path: string) => void;
  clearSelection: (paneId: string) => void;
  selectAll: (paneId: string) => void;
  selectInvert: (paneId: string) => void;
  /**
   * G004: 橡皮筋拖框选择 — 直接把 selection 设为传入的路径集合。
   * - 行为是「替换」,而不是「合并」:这与原生 Finder / Explorer 的
   *   rubber-band 体验一致 — 拖框就是一次明确的 selection 重新声明。
   * - 传空数组等价于 clearSelection。
   * - 未知 paneId:安全 no-op(不抛错)。
   */
  selectRect: (paneId: string, paths: string[]) => void;
  setCursor: (paneId: string, path: string | null) => void;
  moveCursor: (paneId: string, delta: number, viewportSize: number) => void;
  cursorToEdge: (paneId: string, edge: 'start' | 'end') => void;

  // ============ Per-pane: 重命名 ============
  beginRename: (paneId: string, path: string) => void;
  endRename: (paneId: string) => void;
  renameEntry: (
    paneId: string,
    oldPath: string,
    newName: string,
  ) => Promise<{ ok: boolean; error?: string }>;

  // ============ Per-pane: 删除(走回收站)============
  deleteSelected: (paneId: string) => Promise<{ ok: boolean; error?: string; count: number }>;

  // ============ P3: 永久删除(不走回收站)============
  permanentDelete: (paneId: string, paths: string[]) => Promise<{ ok: boolean; error?: string; count: number }>;

  // ============ 路径栏(全局模态)============
  openPathBar: (paneId: string, initial?: string) => void;
  closePathBar: () => void;
  setPathBarValue: (value: string) => void;
  completePathBar: () => void;
  submitPathBar: () => Promise<void>;

  // ============ P3: 剪贴板(全局)============
  copySelected: (paneId: string) => void;
  cutSelected: (paneId: string) => void;
  pasteToPane: (paneId: string) => Promise<void>;
  clearClipboard: () => void;

  // ============ P3: 拖放(全局)============
  startDrag: (paths: string[], sourcePaneId: string) => void;
  setDragTarget: (
    targetPath: string | null,
    targetKind: DragState['targetKind'],
    effect: DragState['effect'],
  ) => void;
  updateDragEffect: (effect: 'move' | 'copy') => void;
  endDrag: () => void;

  // ============ P3: 新建 / 批量打开 ============
  createFolder: (paneId: string, name: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
  createFile: (paneId: string, name: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
  openSelected: (paneId: string) => Promise<void>;

  // ============ P3: Toast / Progress ============
  showToast: (message: string, kind?: ToastItem['kind'], durationMs?: number) => string;
  dismissToast: (id: string) => void;
  setProgress: (p: ProgressInfo | null) => void;

  // ============ Archive (压缩 / 解压) ============
  /**
   * 启动压缩任务。先弹目录选择框让用户选目标位置,
   * 然后调主进程压缩,订阅进度通过 toast 显示。
   * 失败返回错误信息(已通过 toast 提示)。
   */
  startCompress: (sources: string[], sourcePaneId?: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * 启动解压任务。弹目录选择框让用户选解压目标,
   * 然后调主进程解压,订阅进度通过 toast 显示。
   */
  startExtract: (archive: string, destination?: string, sourcePaneId?: string) => Promise<{ ok: boolean; error?: string }>;
  /** 取消正在执行的归档任务 */
  cancelArchive: (jobId: string) => Promise<void>;
  /** 由 ARCHIVE_JOB_UPDATE 事件触发,更新 archiveJobs + 关联 toast 文案 */
  updateArchiveJob: (progress: ArchiveProgress) => void;

  // ============ P3: 冲突解决 ============
  resolveConflict: (resolution: ConflictResolution, newName?: string) => Promise<void>;

  // ============ P3: 回收站 ============
  loadTrash: () => Promise<void>;
  restoreTrashItems: (itemPaths: string[]) => Promise<{ ok: boolean; error?: string }>;
  permanentDeleteItems: (itemPaths: string[]) => Promise<{ ok: boolean; error?: string }>;
  emptyTrash: () => Promise<{ ok: boolean; error?: string }>;
  trashSelectOne: (itemPath: string) => void;
  trashToggleSelect: (itemPath: string) => void;
  trashRangeSelect: (itemPath: string) => void;
  trashClearSelection: () => void;
  trashSelectAll: () => void;
  getTrashCount: () => number;

  // ============ P4: 当前目录过滤(Ctrl+F)===========
  openSearch: (paneId: string) => void;
  closeSearch: (paneId: string) => void;
  setSearchQuery: (paneId: string, q: string) => void;
  clearSearch: (paneId: string) => void;

  // ============ P4: 预览(Space)============
  openPreview: (entry: FsEntry) => void;
  closePreview: () => void;
  /** 由 PreviewPanel 在 mount 后调用以加载内容 */
  setPreviewLoading: (loading: boolean) => void;
  setPreviewData: (data: { blobUrl?: string | null; text?: string | null; truncated?: boolean; totalLines?: number }) => void;
  setPreviewError: (msg: string | null) => void;
  /**
   * 在当前 active pane 的 entry 列表里左右切换预览目标(方向:-1=上一项,1=下一项)
   * 跳过目录;在边界停住(不循环);无 preview 时为 no-op。
   * 返回:切换成功 true / 无可切换目标 false
   */
  previewNavigate: (delta: -1 | 1) => boolean;

  // ============ P4: 全局搜索(Ctrl+P / Ctrl+Shift+F)============
  openGlobalSearch: () => Promise<void>;
  /** P4 v1: 执行递归搜索 */
  runGlobalSearch: (query: string, rootPath: string, fileType: FileTypeFilter) => Promise<void>;
  closeGlobalSearch: () => void;
  setGlobalSearchQuery: (q: string) => void;
  setGlobalSearchFileType: (fileType: FileTypeFilter) => void;
  setGlobalSearchSelectedIndex: (idx: number) => void;
  setGlobalSearchPage: (page: number) => void;
  /** 内部:扫描完驱动器后,根据 query 重新过滤 */
  recomputeGlobalResults: () => void;

  // ============ 工具:解析 pane 路径 ==============
  getPanePath: (paneId: string) => string;

  // ============ 工具:解析 paneId -> 当前路径(从 layout-store)=====
  getPanePathByLayout: (paneId: string) => string | null;

  // ============ 工具:把 source list 复制 / 移动到 destDir ============
  performBulk: (
    sources: string[],
    destDir: string,
    mode: 'copy' | 'move',
    paneId?: string | null,
  ) => Promise<{ ok: boolean; moved: number; error?: string }>;

  // ============ P7: 缩略图 =============
  /**
   * 取某路径的缩略图。命中本地缓存直接返回;未命中走 IPC。
   * 同 path 并发请求会去重(共享一个 Promise)。
   * mtime 变了会重新加载。
   */
  loadThumbnail: (filePath: string, mtime: number) => Promise<ThumbnailEntry | null>;
  /** 清空缩略图缓存(目录切换 / 用户主动) */
  clearThumbnails: () => void;

  // ============ 选择性订阅工具 ============
  getFilteredSortedEntries: (paneId: string) => FsEntry[];
}

// =================== 工具函数 ===================

/** 模块级 in-flight Promise 池(同 path 并发请求去重) */
const inflightThumbnails = new Map<string, Promise<ThumbnailEntry | null>>();

function pathToBreadcrumb(p: string): BreadcrumbSegment[] {
  if (!p) return [];
  const segments: BreadcrumbSegment[] = [];

  const isWindows = /^[a-zA-Z]:[\\/]?/.test(p);
  const isPosixAbs = p.startsWith('/');

  if (isWindows) {
    // Windows: C:\Users\foo
    const parts = p.split(/[\\/]/).filter(Boolean);
    const drive = parts.shift()!;
    let acc = drive + '\\';
    segments.push({ name: drive, path: acc });
    for (const part of parts) {
      acc = acc + '\\' + part;
      segments.push({ name: part, path: acc });
    }
    return segments;
  }

  if (isPosixAbs) {
    // POSIX: /Users/fafa
    // 根目录 `/` 作为一个独立段
    if (p === '/') {
      segments.push({ name: '/', path: '/' });
      return segments;
    }
    segments.push({ name: '/', path: '/' });
    const parts = p.slice(1).split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc = acc + '/' + part;
      segments.push({ name: part, path: acc });
    }
    return segments;
  }

  // 相对路径(兜底,理论上不该出现)
  const parts = p.split(/[\\/]/).filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? acc + '/' + part : part;
    segments.push({ name: part, path: acc });
  }
  return segments;
}

function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  const sep = parent.includes('\\') ? '\\' : '/';
  if (parent.endsWith('\\') || parent.endsWith('/')) return parent + name;
  return parent + sep + name;
}

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

function basename(p: string): string {
  if (!p) return '';
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : '';
}

function compareEntries(a: FsEntry, b: FsEntry, field: SortField, dir: SortDir): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  let cmp = 0;
  switch (field) {
    case 'name':
      cmp = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
      break;
    case 'size':
      cmp = a.size - b.size;
      break;
    case 'mtime':
      cmp = a.mtime - b.mtime;
      break;
    case 'type':
      cmp = (a.ext || '').localeCompare(b.ext || '', 'en', { sensitivity: 'base' });
      if (cmp === 0) cmp = a.name.localeCompare(b.name, 'zh-CN');
      break;
  }
  return dir === 'desc' ? -cmp : cmp;
}

function computeFilteredSorted(
  entries: FsEntry[],
  opts: { sortBy: SortField; sortDir: SortDir; showHidden: boolean; searchQuery?: string },
): FsEntry[] {
  let list = entries;
  if (!opts.showHidden) {
    list = list.filter((e) => !e.name.startsWith('.'));
  }
  if (opts.searchQuery) {
    const q = opts.searchQuery.toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(q));
  }
  if (opts.sortDir === null) {
    return [...list].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return 0;
    });
  }
  return [...list].sort((a, b) => compareEntries(a, b, opts.sortBy, opts.sortDir));
}

// =================== P4: 全局搜索过滤 ===================

/**
 * 模糊匹配:query 中所有字符按顺序在 name 中出现即命中(大小写不敏感)。
 * 也支持子串匹配(更宽松,作为 fallback)。
 * 评分:子串匹配优先,模糊匹配次之。
 */
function scoreMatch(name: string, q: string): number {
  if (!q) return 0;
  const n = name.toLowerCase();
  const ql = q.toLowerCase();
  if (n === ql) return 1000;
  if (n.startsWith(ql)) return 500;
  if (n.includes(ql)) return 100;
  // 模糊:ql 字符按顺序在 n 中全部出现
  let i = 0;
  for (const ch of n) {
    if (ch === ql[i]) i++;
    if (i === ql.length) return 10;
  }
  return -1;
}

function filterGlobalHits(entries: GlobalSearchHit[], query: string): GlobalSearchHit[] {
  if (!query) {
    // 没输入:返回前 200 项
    return entries.slice(0, 200);
  }
  const scored = entries
    .map((e) => ({ e, s: scoreMatch(e.name, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, 200).map((x) => x.e);
}

const VIEW_KEY = 'defaultView';
const SORTBY_KEY = 'sortBy';
const SORTDIR_KEY = 'sortDir';
const HIDDEN_KEY = 'showHidden';
const EXT_KEY = 'showExtensions';

async function persistConfig(key: string, value: unknown): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window.tabula.config.set as any)(key, value);
  } catch (e) {
    console.warn('[file-store] persist failed', key, e);
  }
}

// =================== G007: 分组 helper ===================

/** G007: 大小桶阈值(字节)。包含顺序:逐桶往上,落到第一个命中区间。 */
const SIZE_BUCKETS: ReadonlyArray<{ header: string; min: number; max: number }> = [
  { header: 'Tiny (< 1 KB)', min: 0, max: 1024 },
  { header: 'Small (1 KB – 1 MB)', min: 1024, max: 1024 * 1024 },
  { header: 'Medium (1 MB – 100 MB)', min: 1024 * 1024, max: 100 * 1024 * 1024 },
  { header: 'Large (100 MB – 1 GB)', min: 100 * 1024 * 1024, max: 1024 * 1024 * 1024 },
  { header: 'Huge (> 1 GB)', min: 1024 * 1024 * 1024, max: Number.POSITIVE_INFINITY },
];

/** G007: 日期桶 — 给一个 mtime 返回可读 bucket header。 */
function dateBucketLabel(mtime: number, now: number): string {
  if (!mtime) return 'Unknown';
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((now - mtime) / ONE_DAY);
  if (diffDays < 1) return 'Today';
  if (diffDays < 2) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  if (diffDays < 30) return 'This Month';
  if (diffDays < 365) return 'This Year';
  return 'Older';
}

/**
 * G007: 把 entries 按 mode 分组。
 *
 * - 'none'  → 单段(空 header + 全部 entries)
 * - 'type'  → 目录先一段('Folders'),然后按 ext(.js/.ts/...)分组,无 ext 一段('No Extension')
 * - 'date'  → 按 mtime 相对今天的 bucket 分组(Today / Yesterday / This Week / ...)
 * - 'size'  → 按 SIZE_BUCKETS 分组
 *
 * 各组内 entries 保持输入顺序(已排好序再传入更佳)。
 */
export function groupEntries(entries: FsEntry[], mode: GroupByMode): GroupSection[] {
  if (mode === 'none') return [{ header: '', entries: [...entries] }];

  // 用 Map 维持首次插入顺序,这样组顺序确定且稳定
  const groups = new Map<string, FsEntry[]>();
  const dirs: FsEntry[] = [];

  if (mode === 'type') {
    for (const e of entries) {
      if (e.isDirectory) {
        dirs.push(e);
      } else {
        const key = e.ext ? e.ext : '(no extension)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(e);
      }
    }
  } else if (mode === 'date') {
    const now = Date.now();
    for (const e of entries) {
      if (e.isDirectory) {
        dirs.push(e);
        continue;
      }
      const key = dateBucketLabel(e.mtime, now);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
  } else if (mode === 'size') {
    for (const e of entries) {
      if (e.isDirectory) {
        dirs.push(e);
        continue;
      }
      const bucket = SIZE_BUCKETS.find((b) => e.size >= b.min && e.size < b.max);
      const key = bucket ? bucket.header : 'Unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
  }

  const sections: GroupSection[] = [];
  if (dirs.length > 0) sections.push({ header: 'Folders', entries: dirs });
  for (const [header, items] of groups) {
    sections.push({ header, entries: items });
  }
  return sections;
}

// =================== Store ===================

export const useFileStore = create<FileStore>((set, get) => {

  return {
    // 视图(共享)
    sortBy: 'name',
    sortDir: 'asc',
    showHidden: false,
    showExtensions: true,

    // 路径栏
    pathBarOpen: false,
    pathBarTargetPaneId: null,
    pathBarValue: '',
    pathBarError: null,
    pathBarCompletions: [],

    // P3
    clipboard: null,
    dragState: null,
    toasts: [],
    progress: null,
    pendingConflicts: null,

    // P4
    previewState: null,
    globalSearch: {
      open: false,
      query: '',
      fileType: 'all',
      rootPath: '',
      scannedDrives: [],
      scanning: false,
      scanError: null,
      entries: [],
      results: [],
      selectedIndex: 0,
      page: 0,
      pageSize: 100,
      elapsedMs: 0,
    },

    // P3: 回收站
    trashItems: [],
    trashLoading: false,
    trashError: null,
    trashSelectedPaths: new Set(),

    // P7: 缩略图缓存
    thumbnails: new Map(),
    thumbnailLoading: new Set(),

    // Archive (压缩 / 解压)
    archiveJobs: new Map(),
    archiveToasts: new Map(),
    archivePaneIds: new Map(),

    // panes
    panes: {},

    // ============ Pane 数据生命周期 ============
    ensurePane: async (paneId) => {
      if (!get().panes[paneId]) {
        // 尝试从持久化配置读 viewMode 默认值(没有则用 'details')
        let defaultView: ViewMode = 'details';
        try {
          const all = await window.tabula.config.all();
          if (all.defaultView) defaultView = all.defaultView as ViewMode;
        } catch {
          /* noop */
        }
        set({
          panes: {
            ...get().panes,
            [paneId]: { ...emptyPaneData(), viewMode: defaultView },
          },
        });
      }
    },

    removePaneData: (paneId) => {
      set((s) => {
        if (!(paneId in s.panes)) return s;
        const next = { ...s.panes };
        delete next[paneId];
        return { panes: next };
      });
    },

    // ============ 目录 ============
    loadDir: async (paneId, path) => {
      // 无 active tab 时自动建一个 tab 再加载
      const layout = useLayoutStore.getState();
      const paneNode = findPaneInLayout(layout.rootLayout, paneId);
      if (paneNode?.type === 'pane' && !paneNode.activeTabId) {
        const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
        useLayoutStore.getState().pane.openTab(paneId, {
          id: tabId,
          type: 'folder',
          title,
          path,
          pinned: false,
          closable: true,
          history: [path],
          historyIndex: 0,
        });
      }
      get().ensurePane(paneId);
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: {
            ...(s.panes[paneId] ?? emptyPaneData()),
            loading: true,
            error: null,
            currentPath: path,
            breadcrumb: pathToBreadcrumb(path),
            selectedPaths: new Set(),
            cursorPath: null,
            lastClickedPath: null,
            renameTarget: null,
            searchQuery: '',
            searchOpen: false,
          },
        },
      }));
      const result = await window.tabula.fs.listDir(path);
      if (result.ok) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), entries: result.data.entries, loading: false },
          },
        }));
      } else {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), loading: false, error: result.error.message, entries: [] },
          },
        }));
      }
    },

    refresh: async (paneId) => {
      const data = get().panes[paneId];
      if (!data || !data.currentPath) return;
      const result = await window.tabula.fs.listDir(data.currentPath);
      if (result.ok) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), entries: result.data.entries, error: null, selectedPaths: new Set() },
          },
        }));
      } else {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), error: result.error.message },
          },
        }));
      }
    },

    // ============ 视图(per-pane) ============
    setViewMode: (paneId, mode) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), viewMode: mode },
        },
      }));
      void persistConfig(VIEW_KEY, mode); // 持久化最后一个切换的视图模式(新 pane 默认值)
    },

    // G007: 设置 pane 的分组模式(per-pane;v1 不持久化,UI 渲染延后实现)
    setGroupBy: (paneId, mode) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), groupBy: mode },
        },
      }));
    },

    cycleSort: (field) => {
      const { sortBy, sortDir } = get();
      let nextDir: SortDir;
      if (sortBy !== field) {
        nextDir = 'asc';
      } else {
        if (sortDir === 'asc') nextDir = 'desc';
        else if (sortDir === 'desc') nextDir = null;
        else nextDir = 'asc';
      }
      set({ sortBy: field, sortDir: nextDir });
      void persistConfig(SORTBY_KEY, field);
      void persistConfig(SORTDIR_KEY, nextDir);
    },

    toggleShowHidden: () => {
      const v = !get().showHidden;
      set({ showHidden: v });
      void persistConfig(HIDDEN_KEY, v);
    },

    toggleShowExtensions: () => {
      const v = !get().showExtensions;
      set({ showExtensions: v });
      void persistConfig(EXT_KEY, v);
    },

    hydrateFromConfig: async () => {
      try {
        const all = await window.tabula.config.all();
        set({
          sortBy: (all.sortBy ?? 'name') as SortField,
          sortDir: (all.sortDir !== undefined ? all.sortDir : 'asc') as SortDir,
          showHidden: all.showHidden ?? false,
          showExtensions: all.showExtensions ?? true,
        });
      } catch (e) {
        console.warn('[file-store] hydrate failed', e);
      }
    },

    // ============ 选择 ============
    selectOne: (paneId, path) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set([path]), cursorPath: path, lastClickedPath: path },
        },
      }));
    },

    toggleSelect: (paneId, path) => {
      const data = get().panes[paneId];
      if (!data) return;
      const sel = new Set(data.selectedPaths);
      if (sel.has(path)) sel.delete(path);
      else sel.add(path);
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: sel, cursorPath: path, lastClickedPath: path },
        },
      }));
    },

    rangeSelect: (paneId, path) => {
      const data = get().panes[paneId];
      if (!data) return;
      const { entries, lastClickedPath } = data;
      const { sortBy, sortDir, showHidden } = get();
      const list = computeFilteredSorted(entries, { sortBy, sortDir, showHidden, searchQuery: data.searchQuery });
      const endIdx = list.findIndex((e) => e.path === path);
      let startIdx = 0;
      if (lastClickedPath) {
        const s = list.findIndex((e) => e.path === lastClickedPath);
        if (s >= 0) startIdx = s;
      }
      if (endIdx < 0) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: path, lastClickedPath: path },
          },
        }));
        return;
      }
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const sel = new Set(data.selectedPaths);
      for (let i = lo; i <= hi; i++) sel.add(list[i]!.path);
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: sel, cursorPath: path },
        },
      }));
    },

    clearSelection: (paneId) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(), cursorPath: null, lastClickedPath: null },
        },
      }));
    },

    selectAll: (paneId) => {
      const data = get().panes[paneId];
      if (!data) return;
      const { sortBy, sortDir, showHidden } = get();
      const list = computeFilteredSorted(data.entries, { sortBy, sortDir, showHidden, searchQuery: data.searchQuery });
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(list.map((e) => e.path)) },
        },
      }));
    },

    // G002: 反选 — 已选中变未选中,未选中变已选中(限定当前可见/过滤后的 entries)
    selectInvert: (paneId) => {
      const data = get().panes[paneId];
      if (!data) return;
      const { sortBy, sortDir, showHidden } = get();
      const list = computeFilteredSorted(data.entries, { sortBy, sortDir, showHidden, searchQuery: data.searchQuery });
      const inverted = new Set<string>();
      for (const e of list) {
        if (!data.selectedPaths.has(e.path)) inverted.add(e.path);
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: inverted },
        },
      }));
    },

    // G004: 橡皮筋拖框 — 用传入的 paths 替换 selectedPaths。
    // - 未知 paneId:no-op
    // - 空数组:等价于 clearSelection(同时清掉 cursor / lastClicked)
    // - 非空:用新 Set 替换;保留 cursor/lastClicked 不动(用户通常还在框选后做后续操作)
    selectRect: (paneId, paths) => {
      const data = get().panes[paneId];
      if (!data) return;
      const next = new Set(paths);
      if (next.size === 0) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: {
              ...(s.panes[paneId] ?? emptyPaneData()),
              selectedPaths: next,
              cursorPath: null,
              lastClickedPath: null,
            },
          },
        }));
        return;
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: next },
        },
      }));
    },

    setCursor: (paneId, path) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: path, lastClickedPath: path ?? s.panes[paneId]?.lastClickedPath ?? null },
        },
      }));
    },

    moveCursor: (paneId, delta, viewportSize) => {
      const data = get().panes[paneId];
      if (!data) return;
      const { sortBy, sortDir, showHidden } = get();
      const list = computeFilteredSorted(data.entries, { sortBy, sortDir, showHidden, searchQuery: data.searchQuery });
      if (list.length === 0) return;
      let idx = data.cursorPath ? list.findIndex((e) => e.path === data.cursorPath) : -1;
      if (idx < 0) {
        idx = delta > 0 ? 0 : list.length - 1;
      } else {
        if (Math.abs(delta) === 1) {
          idx = Math.max(0, Math.min(list.length - 1, idx + (delta > 0 ? 1 : -1)));
        } else {
          idx = Math.max(0, Math.min(list.length - 1, idx + delta));
        }
      }
      const target = list[idx]!;
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: target.path, lastClickedPath: target.path, selectedPaths: new Set([target.path]) },
        },
      }));
    },

    cursorToEdge: (paneId, edge) => {
      const data = get().panes[paneId];
      if (!data) return;
      const { sortBy, sortDir, showHidden } = get();
      const list = computeFilteredSorted(data.entries, { sortBy, sortDir, showHidden, searchQuery: data.searchQuery });
      if (list.length === 0) return;
      const target = edge === 'start' ? list[0]! : list[list.length - 1]!;
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), cursorPath: target.path, lastClickedPath: target.path, selectedPaths: new Set([target.path]) },
        },
      }));
    },

    // ============ 重命名 ============
    beginRename: (paneId, path) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: path },
        },
      }));
    },

    endRename: (paneId) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: null },
        },
      }));
    },

    renameEntry: async (paneId, oldPath, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return { ok: false, error: '名称不能为空' };
      const oldName = basename(oldPath);
      if (trimmed === oldName) {
        set((s) => ({
          panes: {
            ...s.panes,
            [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: null },
          },
        }));
        return { ok: true };
      }
      const data = get().panes[paneId];
      const parent = parentPath(oldPath);
      const newPath = joinPath(parent, trimmed);
      // POSIX rename(2) 在目标已存在时静默覆盖 — 必须 stat 预检
      // 注意:排除"自己改自己名"的情况(trimmed === oldName 已上面拦截,但 basename
      // 大小写敏感的 FS 上 case-only rename 是允许的,这里也放过)
      if (newPath !== oldPath) {
        const exists = await window.tabula.fs.stat(newPath);
        if (exists.ok) {
          return { ok: false, error: `已存在同名项: ${trimmed}` };
        }
      }
      const res = await window.tabula.fs.rename(oldPath, newPath);
      if (!res.ok) {
        return { ok: false, error: res.error.message };
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), renameTarget: null },
        },
      }));
      if (data?.currentPath) {
        await get().refresh(paneId);
      }
      return { ok: true };
    },

    // ============ 删除 ============
    deleteSelected: async (paneId) => {
      const data = get().panes[paneId];
      if (!data) return { ok: true, count: 0 };
      const { selectedPaths, currentPath } = data;
      if (selectedPaths.size === 0) return { ok: true, count: 0 };
      const paths = Array.from(selectedPaths);
      const filtered = paths.filter((p) => p !== currentPath);
      if (filtered.length === 0) return { ok: false, error: '不能删除当前目录', count: 0 };
      const res = await window.tabula.fs.delete(filtered, true);
      if (!res.ok) {
        return { ok: false, error: res.error.message, count: filtered.length };
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(), cursorPath: null },
        },
      }));
      await get().refresh(paneId);
      return { ok: true, count: filtered.length };
    },

    // ============ P3: 永久删除(不走回收站)============
    permanentDelete: async (paneId, paths) => {
      if (!paths || paths.length === 0) return { ok: true, count: 0 };
      const data = get().panes[paneId];
      const currentPath = data?.currentPath ?? '';
      const filtered = paths.filter((p) => p !== currentPath);
      if (filtered.length === 0) return { ok: false, error: '不能删除当前目录', count: 0 };
      // useTrash = false 永久删除
      const res = await window.tabula.fs.delete(filtered, false);
      if (!res.ok) {
        get().showToast(`永久删除失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message, count: filtered.length };
      }
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), selectedPaths: new Set(), cursorPath: null },
        },
      }));
      await get().refresh(paneId);
      get().showToast(`已永久删除 ${filtered.length} 项`, 'success', 2500);
      return { ok: true, count: filtered.length };
    },

    // ============ 路径栏 ============
    openPathBar: (paneId, initial) => {
      const data = get().panes[paneId];
      set({
        pathBarOpen: true,
        pathBarTargetPaneId: paneId,
        pathBarValue: initial ?? data?.currentPath ?? '',
        pathBarError: null,
        pathBarCompletions: [],
      });
    },

    closePathBar: () => {
      set({ pathBarOpen: false, pathBarValue: '', pathBarError: null, pathBarCompletions: [] });
    },

    setPathBarValue: (value) => {
      set({ pathBarValue: value, pathBarError: null, pathBarCompletions: [] });
    },

    completePathBar: () => {
      const { pathBarValue, pathBarTargetPaneId } = get();
      if (!pathBarValue) return;
      const m = pathBarValue.match(/^(.*[\\/])([^\\/]*)$/);
      let base: string;
      let prefix: string;
      if (m) {
        base = m[1]!;
        prefix = m[2]!.toLowerCase();
      } else {
        if (/^[a-zA-Z]:$/.test(pathBarValue)) {
          base = pathBarValue + '\\';
          prefix = '';
        } else {
          const cur = pathBarTargetPaneId ? get().panes[pathBarTargetPaneId]?.currentPath : '';
          base = cur ?? '';
          prefix = pathBarValue.toLowerCase();
        }
      }
      void (async () => {
        const res = await window.tabula.fs.listDir(base);
        if (!res.ok) {
          set({ pathBarError: res.error.message, pathBarCompletions: [] });
          return;
        }
        const dirs = res.data.entries
          .filter((e) => e.isDirectory && (prefix === '' || e.name.toLowerCase().startsWith(prefix)))
          .map((e) => joinPath(base, e.name));
        if (dirs.length === 0) {
          set({ pathBarError: '没有匹配的目录', pathBarCompletions: [] });
          return;
        }
        if (dirs.length === 1) {
          set({ pathBarValue: dirs[0] + '\\', pathBarCompletions: dirs, pathBarError: null });
          return;
        }
        const names = dirs.map((p) => basename(p));
        const minLen = Math.min(...names.map((n) => n.length));
        let common = '';
        for (let i = 0; i < minLen; i++) {
          const c = names[0]![i]!.toLowerCase();
          if (names.every((n) => n[i]!.toLowerCase() === c)) common += names[0]![i];
          else break;
        }
        const newValue =
          common.length > prefix.length ? joinPath(base, common) : pathBarValue;
        set({
          pathBarValue: newValue,
          pathBarCompletions: dirs,
          pathBarError: common.length > prefix.length ? null : `候选 ${dirs.length} 项(再次 Tab 切换)`,
        });
      })();
    },

    submitPathBar: async () => {
      const { pathBarValue, pathBarCompletions, pathBarTargetPaneId } = get();
      let target = pathBarValue.trim();
      if (!target) {
        set({ pathBarError: '路径不能为空' });
        return;
      }
      if (pathBarCompletions.length > 0 && target.endsWith('\\') === false && target.endsWith('/') === false) {
        const first = pathBarCompletions[0];
        if (first?.toLowerCase().startsWith(target.toLowerCase())) {
          target = first;
        }
      }
      const res = await window.tabula.fs.listDir(target);
      if (!res.ok) {
        set({ pathBarError: res.error.message });
        return;
      }
      set({ pathBarOpen: false, pathBarValue: '', pathBarError: null, pathBarCompletions: [] });
      if (pathBarTargetPaneId) {
        await get().loadDir(pathBarTargetPaneId, target);
      }
    },

    // ============ 过滤+排序输出 ============
    getFilteredSortedEntries: (paneId) => {
      const data = get().panes[paneId];
      if (!data) return [];
      const { sortBy, sortDir, showHidden } = get();
      return computeFilteredSorted(data.entries, { sortBy, sortDir, showHidden, searchQuery: data.searchQuery });
    },

    // ============ P3: 工具 - 取 pane 路径 ============
    getPanePath: (paneId) => {
      return get().panes[paneId]?.currentPath ?? '';
    },

    getPanePathByLayout: (paneId) => {
      // 走 file-store 缓存的 currentPath(loadDir 同步)
      // 不再回退 layout-store(避免循环 import)
      return get().panes[paneId]?.currentPath ?? null;
    },

    // ============ P3: 剪贴板 ============
    copySelected: (paneId) => {
      const data = get().panes[paneId];
      if (!data || data.selectedPaths.size === 0) {
        get().showToast('未选中任何项', 'warn');
        return;
      }
      const paths = Array.from(data.selectedPaths);
      set({ clipboard: { mode: 'copy', paths, sourcePaneId: paneId } });
      // 顺便写系统剪贴板(纯文本,每行一个路径)
      void navigator.clipboard?.writeText(paths.join('\n')).catch(() => null);
      get().showToast(`已复制 ${paths.length} 项(可粘贴)`, 'info', 2000);
    },

    cutSelected: (paneId) => {
      const data = get().panes[paneId];
      if (!data || data.selectedPaths.size === 0) {
        get().showToast('未选中任何项', 'warn');
        return;
      }
      const paths = Array.from(data.selectedPaths);
      set({ clipboard: { mode: 'cut', paths, sourcePaneId: paneId } });
      void navigator.clipboard?.writeText(paths.join('\n')).catch(() => null);
      get().showToast(`已剪切 ${paths.length} 项(Ctrl+V 粘贴)`, 'info', 2000);
    },

    clearClipboard: () => {
      set({ clipboard: null });
    },

    // ============ P3: 粘贴 ============
    pasteToPane: async (paneId) => {
      const cb = get().clipboard;
      if (!cb || cb.paths.length === 0) {
        get().showToast('剪贴板为空', 'warn');
        return;
      }
      const destDir = get().getPanePath(paneId) || get().getPanePathByLayout(paneId) || '';
      if (!destDir) {
        get().showToast('无法确定目标目录', 'error');
        return;
      }
      const mode: 'copy' | 'move' = cb.mode === 'cut' ? 'move' : 'copy';
      const result = await get().performBulk(cb.paths, destDir, mode, paneId);
      if (result.ok) {
        // 复制/移动完成后刷新目标 pane 列表
        await get().loadDir(paneId, destDir);
        // 若源 pane 与目标 pane 不同，刷新源 pane（move 时清剪贴板后可看到源目录变化）
        const srcPaneId = cb.sourcePaneId;
        if (srcPaneId && srcPaneId !== paneId) {
          const srcPath = get().getPanePath(srcPaneId);
          if (srcPath) await get().loadDir(srcPaneId, srcPath);
        }
      }
    },

    // ============ P3: 拖放 ============
    startDrag: (paths, sourcePaneId) => {
      set({
        dragState: { paths, sourcePaneId, effect: 'move', targetPath: null, targetKind: null },
      });
    },

    setDragTarget: (targetPath, targetKind, effect) => {
      const cur = get().dragState;
      if (!cur) return;
      set({
        dragState: { ...cur, targetPath, targetKind, effect: effect ?? cur.effect },
      });
    },

    updateDragEffect: (effect) => {
      const cur = get().dragState;
      if (!cur) return;
      set({ dragState: { ...cur, effect } });
    },

    endDrag: () => {
      set({ dragState: null });
    },

    // ============ P3: 新建 / 批量打开 ============
    createFolder: async (paneId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: '名称不能为空' };
      const destDir = get().getPanePath(paneId);
      if (!destDir) return { ok: false, error: '当前目录未加载' };
      // 目标已存在 → 拒绝(POSIX mkdir 目录已存在会返回 EEXIST,但写文件式的 fs.mkdir
      // 实现可能直接当 OK 处理;统一用 stat 预检避免覆盖/歧义)
      const target = joinPath(destDir, trimmed);
      const exists = await window.tabula.fs.stat(target);
      if (exists.ok) {
        const msg = `已存在同名项: ${trimmed}`;
        get().showToast(msg, 'error', 4000);
        return { ok: false, error: msg };
      }
      const res = await window.tabula.fs.mkdir(destDir, trimmed);
      if (!res.ok) {
        get().showToast(`新建文件夹失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message };
      }
      get().showToast(`已新建文件夹: ${trimmed}`, 'success', 2000);
      await get().refresh(paneId);
      return { ok: true, path: res.data };
    },

    createFile: async (paneId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: '名称不能为空' };
      const destDir = get().getPanePath(paneId);
      if (!destDir) return { ok: false, error: '当前目录未加载' };
      const target = joinPath(destDir, trimmed);
      // writeFile('') 会直接覆盖已存在文件(文件内容清空)→ 必须先 stat 拦截
      const exists = await window.tabula.fs.stat(target);
      if (exists.ok) {
        const msg = `已存在同名文件: ${trimmed}`;
        get().showToast(msg, 'error', 4000);
        return { ok: false, error: msg };
      }
      const res = await window.tabula.fs.writeFile(target, '');
      if (!res.ok) {
        get().showToast(`新建文件失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message };
      }
      get().showToast(`已新建文件: ${trimmed}`, 'success', 2000);
      await get().refresh(paneId);
      return { ok: true, path: target };
    },

    openSelected: async (paneId) => {
      const data = get().panes[paneId];
      if (!data || data.selectedPaths.size === 0) return;
      const entries = data.entries;
      for (const p of data.selectedPaths) {
        const e = entries.find((x) => x.path === p);
        if (!e) continue;
        if (e.isDirectory) {
          // 目录:在当前 pane 加载(P3 简化:不新开 tab;v2 可加 openInNewTab 选项)
          await get().loadDir(paneId, e.path);
          break; // 一次只切一个(选中多目录只切第一个)
        } else {
          void window.tabula.fs.openPath(e.path);
        }
      }
    },

    // ============ P3: Toast / Progress ============
    showToast: (message, kind = 'info', durationMs = 3000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      set((s) => ({
        toasts: [...s.toasts, { id, message, kind, duration: durationMs, createdAt: Date.now() }],
      }));
      if (durationMs > 0) {
        setTimeout(() => get().dismissToast(id), durationMs);
      }
      return id;
    },

    dismissToast: (id) => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    setProgress: (p) => {
      set({ progress: p });
    },

    // ============ P3: 冲突解决 ============
    resolveConflict: async (resolution, newName) => {
      const pc = get().pendingConflicts;
      if (!pc) return;
      if (resolution === 'cancelAll') {
        set({ pendingConflicts: null });
        get().showToast('已取消粘贴', 'info', 2000);
        return;
      }
      const head = pc.queue[0];
      if (!head) return;

      // 处理当前冲突
      if (resolution === 'skip') {
        pc.queue.shift();
      } else if (resolution === 'overwrite') {
        pc.resolved.push({ source: head.sourcePath, dest: head.destPath, overwrite: true });
        pc.queue.shift();
      } else if (resolution === 'rename') {
        // 受限于 fs.copy/move 现有 API(只能指定目标 dir,不能指定新文件名),
        // v1 简化:rename 实际走"两步法"——先复制到 destDir(basename)后重命名。
        // 但要避免覆盖现有同名文件,所以先做 fs.copy(overwrite=false),失败时
        // 退化为"skip + 提示用户重命名后重试"。
        // 为了保证可以重命名,先 fs.copy 到 destDir(假设 destDir 中没有同名;
        // 但我们已知有冲突),所以这里我们先 fs.copy 到一个临时后缀名?
        // 不行:我们没有 temp API。
        // 简化:rename 等价于 skip + 提示(P3 v1 妥协)。
        pc.queue.shift();
        get().showToast(
          `「${head.sourceName}」:重命名选项暂用「跳过」处理。请粘贴后手动重命名。`,
          'info',
          3500,
        );
      }

      // 没有更多冲突,执行批量
      if (pc.queue.length === 0) {
        const allOps = [...pc.autoResolved, ...pc.resolved];
        set({ pendingConflicts: null });
        if (allOps.length === 0) {
          get().showToast('无文件需要处理', 'info', 1500);
          return;
        }
        const verb = pc.mode === 'copy' ? '复制' : '移动';
        get().setProgress({
          operation: pc.mode,
          count: allOps.length,
          message: `正在${verb} ${allOps.length} 项…`,
        });
        try {
          let success = 0;
          let firstError: string | null = null;
          for (const op of allOps) {
            if (op.dest === op.source) continue;
            if (pc.mode === 'copy') {
              const r = await window.tabula.fs.copy({
                sources: [op.source],
                destination: head.destDir,
                overwrite: op.overwrite,
              });
              if (r.ok) success++;
              else if (!firstError) firstError = r.error.message;
            } else {
              const r = await window.tabula.fs.move({
                sources: [op.source],
                destination: head.destDir,
              });
              if (r.ok) success++;
              else if (!firstError) firstError = r.error.message;
            }
          }
          get().setProgress(null);
          if (pc.mode === 'move') {
            const cb = get().clipboard;
            if (cb && cb.mode === 'cut') set({ clipboard: null });
          }
          if (firstError) {
            get().showToast(
              `${verb}失败: ${firstError} (成功 ${success}/${allOps.length})`,
              'error',
              4000,
            );
          } else {
            get().showToast(`已${verb} ${success} 项`, 'success', 2500);
          }
          // 冲突全部解决后刷新目标 pane
          if (pc.paneId) {
            void get().loadDir(pc.paneId, pc.destinationDir);
          }
        } catch (e) {
          get().setProgress(null);
          get().showToast(`${verb}失败: ${String(e)}`, 'error', 4000);
        }
        return;
      }
      // 有更多冲突,更新队列继续处理
      set({ pendingConflicts: { ...pc } });
    },

    // ============ P3: 回收站 ============
    loadTrash: async () => {
      set({ trashLoading: true, trashError: null });
      const result = await window.tabula.fs.trashList();
      if (result.ok) {
        set({ trashItems: result.data.entries, trashLoading: false });
      } else {
        set({ trashLoading: false, trashError: result.error.message });
      }
    },

    restoreTrashItems: async (itemPaths) => {
      if (!itemPaths.length) return { ok: true };
      const items = get().trashItems;
      let failed = 0;
      for (const itemPath of itemPaths) {
        const item = items.find((x) => x.itemPath === itemPath);
        const res = await window.tabula.fs.trashRestore(itemPath, item?.originalPath ?? undefined);
        if (!res.ok) failed++;
      }
      if (failed > 0) {
        get().showToast(`恢复完成，${failed} 项失败`, 'warn', 3000);
      } else {
        get().showToast(`已恢复 ${itemPaths.length} 项`, 'success', 2000);
      }
      await get().loadTrash();
      return { ok: failed === 0 };
    },

    permanentDeleteItems: async (itemPaths) => {
      if (!itemPaths.length) return { ok: true };
      const res = await window.tabula.fs.delete(itemPaths, false);
      if (!res.ok) {
        get().showToast(`永久删除失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message };
      }
      get().showToast(`已永久删除 ${itemPaths.length} 项`, 'success', 2500);
      const remaining = get().trashItems.filter((x) => !itemPaths.includes(x.itemPath));
      set({ trashItems: remaining, trashSelectedPaths: new Set() });
      return { ok: true };
    },

    emptyTrash: async () => {
      const res = await window.tabula.fs.trashEmpty();
      if (!res.ok) {
        get().showToast(`清空回收站失败: ${res.error.message}`, 'error', 4000);
        return { ok: false, error: res.error.message };
      }
      get().showToast('回收站已清空', 'success', 2500);
      set({ trashItems: [], trashSelectedPaths: new Set() });
      return { ok: true };
    },

    trashSelectOne: (itemPath) => {
      set({ trashSelectedPaths: new Set([itemPath]) });
    },

    trashToggleSelect: (itemPath) => {
      const sel = new Set(get().trashSelectedPaths);
      if (sel.has(itemPath)) sel.delete(itemPath);
      else sel.add(itemPath);
      set({ trashSelectedPaths: sel });
    },

    trashRangeSelect: (itemPath) => {
      const items = get().trashItems;
      const endIdx = items.findIndex((x) => x.itemPath === itemPath);
      if (endIdx < 0) return;
      const sel = new Set(get().trashSelectedPaths);
      for (let i = 0; i <= endIdx; i++) sel.add(items[i]!.itemPath);
      set({ trashSelectedPaths: sel });
    },

    trashClearSelection: () => {
      set({ trashSelectedPaths: new Set() });
    },

    trashSelectAll: () => {
      const all = get().trashItems.map((x) => x.itemPath);
      set({ trashSelectedPaths: new Set(all) });
    },

    getTrashCount: () => get().trashItems.length,

    // ============ P4: 当前目录过滤 (Ctrl+F) ============
    openSearch: (paneId) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchOpen: true },
        },
      }));
    },
    closeSearch: (paneId) => {
      // Esc 退出 / 清空:折叠面板,但保留 query(用户可以再 Ctrl+F 出来)
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchOpen: false },
        },
      }));
    },
    setSearchQuery: (paneId, q) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchQuery: q },
        },
      }));
    },
    clearSearch: (paneId) => {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: { ...(s.panes[paneId] ?? emptyPaneData()), searchQuery: '', searchOpen: false },
        },
      }));
    },

    // ============ P4: 预览 (Space) ============
    openPreview: (entry) => {
      // 关闭上一个的 blobUrl(避免内存泄漏)
      const prev = get().previewState;
      if (prev?.blobUrl) {
        try { URL.revokeObjectURL(prev.blobUrl); } catch { /* noop */ }
      }
      set({
        previewState: {
          entry,
          blobUrl: null,
          text: null,
          loading: true,
          error: null,
          truncated: false,
          totalLines: 0,
        },
      });
    },
    closePreview: () => {
      const cur = get().previewState;
      if (cur?.blobUrl) {
        try { URL.revokeObjectURL(cur.blobUrl); } catch { /* noop */ }
      }
      set({ previewState: null });
    },
    setPreviewLoading: (loading) => {
      const cur = get().previewState;
      if (!cur) return;
      set({ previewState: { ...cur, loading } });
    },
    setPreviewData: (data) => {
      const cur = get().previewState;
      if (!cur) return;
      set({
        previewState: {
          ...cur,
          loading: false,
          error: null,
          blobUrl: data.blobUrl !== undefined ? data.blobUrl : cur.blobUrl,
          text: data.text !== undefined ? data.text : cur.text,
          truncated: data.truncated ?? cur.truncated,
          totalLines: data.totalLines ?? cur.totalLines,
        },
      });
    },
    setPreviewError: (msg) => {
      const cur = get().previewState;
      if (!cur) return;
      set({
        previewState: { ...cur, loading: false, error: msg },
      });
    },
    previewNavigate: (delta) => {
      const cur = get().previewState;
      if (!cur) return false;
      // 走当前 active pane(预览是从那里打开的)
      const activePaneId = useLayoutStore.getState().activePaneId;
      if (!activePaneId) return false;
      const entries = get().getFilteredSortedEntries(activePaneId);
      if (entries.length === 0) return false;
      const curIdx = entries.findIndex((e) => e.path === cur.entry.path);
      if (curIdx < 0) return false;
      // 沿 delta 方向找第一个非目录条目;到边界就停
      let nextIdx = curIdx;
      for (let step = 0; step < entries.length; step += 1) {
        nextIdx += delta;
        if (nextIdx < 0 || nextIdx >= entries.length) {
          // 越界:停在边界(不循环)
          return false;
        }
        const candidate = entries[nextIdx];
        if (candidate.isDirectory) continue; // 跳过目录
        get().openPreview(candidate);
        return true;
      }
      return false;
    },

    // ============ P4: 全局搜索 (Ctrl+P / Ctrl+Shift+F) ============
    openGlobalSearch: async () => {
      // 获取当前 pane 的路径作为搜索根目录
      const layout = useLayoutStore.getState();
      const activePaneId = layout.activePaneId;
      const paneNode = findPaneInLayout(layout.rootLayout, activePaneId);
      const rootPath = paneNode?.type === 'pane'
        ? get().getPanePath(activePaneId) || getCachedRootPath()
        : getCachedRootPath();

      set({
        globalSearch: {
          open: true,
          query: '',
          fileType: 'all',
          rootPath,
          scannedDrives: [rootPath],
          scanning: false,
          scanError: null,
          entries: [],
          results: [],
          selectedIndex: 0,
          page: 0,
          pageSize: 100,
          elapsedMs: 0,
        },
      });
    },

    /** P4 v1: 执行递归搜索 */
    runGlobalSearch: async (query: string, rootPath: string, fileType: FileTypeFilter) => {
      if (!query || query.trim().length === 0) {
        set((s) => ({
          globalSearch: {
            ...s.globalSearch,
            entries: [],
            results: [],
            elapsedMs: 0,
          },
        }));
        return;
      }

      set((s) => ({
        globalSearch: { ...s.globalSearch, scanning: true, scanError: null },
      }));

      const res = await window.tabula.fs.search({
        path: rootPath,
        query: query.trim(),
        maxResults: 500,
        fileType,
        maxDepth: 5,
      });

      if (!res.ok) {
        set((s) => ({
          globalSearch: {
            ...s.globalSearch,
            scanning: false,
            scanError: res.error.message,
          },
        }));
        return;
      }

      const entries: GlobalSearchHit[] = res.data.entries.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.isDirectory,
        size: e.size,
        mtime: e.mtime,
        driveRoot: rootPath,
        score: e.score,
        matchType: e.matchType,
      }));

      set((s) => ({
        globalSearch: {
          ...s.globalSearch,
          scanning: false,
          entries,
          results: entries,
          selectedIndex: 0,
          page: 0,
          elapsedMs: res.data.elapsedMs,
        },
      }));
    },
    closeGlobalSearch: () => {
      set((s) => ({ globalSearch: { ...s.globalSearch, open: false, query: '' } }));
    },
    setGlobalSearchQuery: (q) => {
      const cur = get().globalSearch;
      // 如果有 query 且和之前不同,触发递归搜索
      if (q.trim() && q.trim() !== cur.query) {
        void get().runGlobalSearch(q.trim(), cur.rootPath || getCachedRootPath(), cur.fileType);
      }
      set({
        globalSearch: {
          ...cur,
          query: q,
          selectedIndex: 0,
        },
      });
    },
    setGlobalSearchFileType: (fileType: FileTypeFilter) => {
      const cur = get().globalSearch;
      // 重新搜索
      if (cur.query.trim()) {
        void get().runGlobalSearch(cur.query, cur.rootPath || getCachedRootPath(), fileType);
      }
      set({
        globalSearch: {
          ...cur,
          fileType,
          selectedIndex: 0,
        },
      });
    },
    setGlobalSearchSelectedIndex: (idx) => {
      const cur = get().globalSearch;
      if (cur.results.length === 0) return;
      const clamped = Math.max(0, Math.min(cur.results.length - 1, idx));
      set({ globalSearch: { ...cur, selectedIndex: clamped } });
    },
    setGlobalSearchPage: (page: number) => {
      const cur = get().globalSearch;
      const maxPage = Math.max(0, Math.ceil(cur.results.length / cur.pageSize) - 1);
      set({ globalSearch: { ...cur, page: Math.max(0, Math.min(maxPage, page)) } });
    },
    recomputeGlobalResults: () => {
      const cur = get().globalSearch;
      set({
        globalSearch: {
          ...cur,
          results: filterGlobalHits(cur.entries, cur.query),
        },
      });
    },

    // ============ P3: 批量 copy / move 入口 ============
    performBulk: async (sources, destDir, mode, paneId) => {
           if (sources.length === 0) return { ok: true, moved: 0 };
      // 不能把目录粘贴到自己或子目录(简单防呆:检测 destDir 是否在 sources 之下)
      // v1:不防呆,交给用户
      // 先扫冲突
      const conflicts: ConflictItem[] = [];
      const autoResolved: { source: string; dest: string; overwrite: boolean }[] = [];
      for (const src of sources) {
        if (!src) continue;
               const srcName = basename(src);
        if (!srcName) {
          continue;
        }
        const dest = joinPath(destDir, srcName);
        // 标准化:去掉末尾斜杠再比较(Windows src 有无斜杠不一致)
        const normDest = dest.replace(/[\\/]+$/, '');
        const normSrc = src.replace(/[\\/]+$/, '');
        if (normDest === normSrc) {
          // 同源同目标:move 直接跳过;copy 在同目录需生成新名(加 -copy)
          if (mode === 'move') {
            continue;
          }
          // copy:在同目录生成带序号的副本名
          const dotIdx = srcName.lastIndexOf('.');
          const base = dotIdx > 0 ? srcName.slice(0, dotIdx) : srcName;
          const ext = dotIdx > 0 ? srcName.slice(dotIdx) : '';
          let copyName = base + ' - 副本' + ext;
          let copyDest = joinPath(destDir, copyName);
          let counter = 2;
          while ((await window.tabula.fs.exists(copyDest)) && counter <= 99) {
            copyName = base + ' - 副本 (' + counter + ')' + ext;
            copyDest = joinPath(destDir, copyName);
            counter++;
          }
          const exists = await window.tabula.fs.exists(copyDest);
          if (exists) {
            get().showToast('无法生成不重名的副本', 'error', 3000);
            continue;
          }
          autoResolved.push({ source: src, dest: copyDest, overwrite: false });
          continue;
        }
        const exists = await window.tabula.fs.exists(dest);
        if (exists) {
          // 收集 stat
          const stat = await window.tabula.fs.stat(dest);
          conflicts.push({
            sourcePath: src,
            sourceName: srcName,
            destPath: dest,
            destDir,
            destName: srcName,
            isDirectory: stat.ok ? stat.data.isDirectory : false,
          });
        } else {
          autoResolved.push({ source: src, dest, overwrite: false });
        }
      }
      if (conflicts.length > 0) {
        set({
          pendingConflicts: {
            paneId: paneId ?? '',
            sources,
            destinationDir: destDir,
            mode,
            resolved: [],
            queue: conflicts,
            autoResolved,
          },
        });
        return { ok: true, moved: 0 }; // 等待用户解决
      }
      // 无冲突,直接执行
      const verb = mode === 'copy' ? '复制' : '移动';
      get().setProgress({ operation: mode, count: autoResolved.length, message: `正在${verb} ${autoResolved.length} 项…` });
      try {
        let success = 0;
        let firstError: string | null = null;
        for (const op of autoResolved) {
                   if (mode === 'copy') {
            const r = await window.tabula.fs.copy({
              sources: [op.source],
              destination: destDir,
              overwrite: op.overwrite,
            });
            if (r.ok) success++;
            else if (!firstError) firstError = r.error.message;
          } else {
            const r = await window.tabula.fs.move({
              sources: [op.source],
              destination: destDir,
            });
            if (r.ok) success++;
            else if (!firstError) firstError = r.error.message;
          }
        }
        get().setProgress(null);
        if (firstError) {
          get().showToast(`${verb}失败: ${firstError} (成功 ${success}/${autoResolved.length})`, 'error', 4000);
          return { ok: false, moved: success, error: firstError };
        } else {
          get().showToast(`已${verb} ${success} 项`, 'success', 2500);
          if (mode === 'move') {
            const cb = get().clipboard;
            if (cb && cb.mode === 'cut') set({ clipboard: null });
          }
          // 完成后刷新目标 pane（移动时源 pane 由 pasteToPane 层级处理）
          if (paneId) {
            void get().loadDir(paneId, destDir);
          }
          return { ok: true, moved: success };
        }
      } catch (e) {
        get().setProgress(null);
        get().showToast(`${verb}失败: ${String(e)}`, 'error', 4000);
        return { ok: false, moved: 0, error: String(e) };
      }
    },

    // ============ P7: 缩略图 =============
    // 用模块级 Map 存 in-flight Promise(同 path 并发请求去重)
    // — 不放 store 内部是因为 store state 序列化会丢 Promise
    loadThumbnail: async (filePath, mtime) => {
      const cur = get().thumbnails.get(filePath);
      if (cur && cur.mtime === mtime) {
        return cur;
      }
      // 复用 in-flight
      const inflight = inflightThumbnails.get(filePath);
      if (inflight) {
        return inflight;
      }
      // 标 loading
      set((s) => {
        const next = new Set(s.thumbnailLoading);
        next.add(filePath);
        return { thumbnailLoading: next };
      });
      const p = (async () => {
        try {
          const res = await window.tabula.fs.getThumbnail(filePath);
          if (!res.ok) return null;
          const entry: ThumbnailEntry = {
            dataUrl: res.data.dataUrl,
            mtime: res.data.mtime,
            loadedAt: Date.now(),
          };
          set((s) => {
            const next = new Map(s.thumbnails);
            next.set(filePath, entry);
            return { thumbnails: next };
          });
          return entry;
        } catch {
          return null;
        } finally {
          inflightThumbnails.delete(filePath);
          set((s) => {
            const next = new Set(s.thumbnailLoading);
            next.delete(filePath);
            return { thumbnailLoading: next };
          });
        }
      })();
      inflightThumbnails.set(filePath, p);
      return p;
    },

    clearThumbnails: () => {
      set({ thumbnails: new Map(), thumbnailLoading: new Set() });
    },

    // ============ Archive (压缩 / 解压) ============
    startCompress: async (sources: string[], sourcePaneId?: string) => {
      if (!sources || sources.length === 0) {
        get().showToast('未选中任何项', 'warn');
        return { ok: false, error: '未选中任何项' };
      }
      // 自动在源所在目录生成 zip 文件名,不弹任何对话框
      // 单选 → 源文件名.zip; 多选 → "N 项.zip"
      const defaultName =
        sources.length === 1
          ? (sources[0].split(/[\\/]/).filter(Boolean).pop() ?? 'archive') + '.zip'
          : `${sources.length} 项.zip`;
      // 取第一个源文件的目录作为输出目录
      const firstDir = sources[0].split(/[\\/]/).slice(0, -1).join('/');
      const destination = firstDir + '/' + defaultName;

      const req: CompressRequest = { sources, destination, sourcePaneId };
      const result = await window.tabula.archive.compress(req);
      if (!result.ok) {
        get().showToast(`压缩失败: ${result.error.message}`, 'error', 4000);
        return { ok: false, error: result.error.message };
      }
      const jobId = result.data.jobId;
      const toastId = get().showToast(`正在压缩 ${defaultName}…`, 'info', 0);
      set((s) => {
        const jobs = new Map(s.archiveJobs);
        jobs.set(jobId, { jobId, phase: 'pending', processed: 0, total: -1 });
        const toasts = new Map(s.archiveToasts);
        toasts.set(jobId, toastId);
        const paneIds = new Map(s.archivePaneIds);
        if (sourcePaneId) paneIds.set(jobId, sourcePaneId);
        return { archiveJobs: jobs, archiveToasts: toasts, archivePaneIds: paneIds };
      });
      return { ok: true };
    },

    startExtract: async (archive, destination, sourcePaneId?: string) => {
      if (!archive) {
        return { ok: false, error: 'archive 不能为空' };
      }
      // 默认解压目标: 同目录 / 文件名(去后缀)
      let dest: string | null = destination ?? null;
      if (!dest) {
        dest = await window.tabula.fs.pickDirectory();
        if (!dest) return { ok: false, error: '已取消' };
      }
      // 计算默认输出 zip 文件名(用作 toast)
      const archiveName = archive.split(/[\\/]/).filter(Boolean).pop() ?? archive;

      const req: ExtractRequest = { archive, destination: dest, overwrite: false };
      const result = await window.tabula.archive.extract(req);
      if (!result.ok) {
        // DESTINATION_EXISTS 用更友好的提示
        if (result.error.code === 'DESTINATION_EXISTS') {
          get().showToast(`目标已存在,解压取消:${result.error.message}`, 'warn', 4000);
        } else {
          get().showToast(`解压失败: ${result.error.message}`, 'error', 4000);
        }
        return { ok: false, error: result.error.message };
      }
      const jobId = result.data.jobId;
      const toastId = get().showToast(`正在解压 ${archiveName}…`, 'info', 0);
      set((s) => {
        const jobs = new Map(s.archiveJobs);
        jobs.set(jobId, { jobId, phase: 'pending', processed: 0, total: -1 });
        const toasts = new Map(s.archiveToasts);
        toasts.set(jobId, toastId);
        const paneIds = new Map(s.archivePaneIds);
        if (sourcePaneId) paneIds.set(jobId, sourcePaneId);
        return { archiveJobs: jobs, archiveToasts: toasts, archivePaneIds: paneIds };
      });
      return { ok: true };
    },

    cancelArchive: async (jobId) => {
      await window.tabula.archive.cancelJob(jobId);
    },

    updateArchiveJob: (progress) => {
      const { jobId, phase, currentEntry, percent, error } = progress;
      // 1. 写 store
      set((s) => {
        const jobs = new Map(s.archiveJobs);
        jobs.set(jobId, progress);
        return { archiveJobs: jobs };
      });
      // 2. 更新对应 toast
      const toastId = get().archiveToasts.get(jobId);
      if (!toastId) return;
      if (phase === 'done') {
        get().dismissToast(toastId);
        // 完成后自动刷新触发该操作的 pane
        const paneId = get().archivePaneIds.get(jobId);
        if (paneId && get().panes[paneId]) {
          const path = get().panes[paneId]?.currentPath;
          if (path) void get().loadDir(paneId, path);
        }
        get().showToast(
          currentEntry ? `${currentEntry.split(/[\\/]/).pop()} 完成` : '归档完成',
          'success',
          2500,
        );
        // 清理 map 项(终态后)
        setTimeout(() => {
          set((s) => {
            const jobs = new Map(s.archiveJobs);
            jobs.delete(jobId);
            const toasts = new Map(s.archiveToasts);
            toasts.delete(jobId);
            const paneIds = new Map(s.archivePaneIds);
            paneIds.delete(jobId);
            return { archiveJobs: jobs, archiveToasts: toasts, archivePaneIds: paneIds };
          });
        }, 500);
      } else if (phase === 'error') {
        get().dismissToast(toastId);
        get().showToast(`归档失败: ${error?.message ?? '未知错误'}`, 'error', 4000);
        setTimeout(() => {
          set((s) => {
            const jobs = new Map(s.archiveJobs);
            jobs.delete(jobId);
            const toasts = new Map(s.archiveToasts);
            toasts.delete(jobId);
            const paneIds = new Map(s.archivePaneIds);
            paneIds.delete(jobId);
            return { archiveJobs: jobs, archiveToasts: toasts, archivePaneIds: paneIds };
          });
        }, 500);
      } else if (phase === 'cancelled') {
        get().dismissToast(toastId);
        get().showToast('已取消', 'info', 2000);
        setTimeout(() => {
          set((s) => {
            const jobs = new Map(s.archiveJobs);
            jobs.delete(jobId);
            const toasts = new Map(s.archiveToasts);
            toasts.delete(jobId);
            const paneIds = new Map(s.archivePaneIds);
            paneIds.delete(jobId);
            return { archiveJobs: jobs, archiveToasts: toasts, archivePaneIds: paneIds };
          });
        }, 500);
      } else {
        // 进行中:更新文案
        const phaseLabel =
          phase === 'reading' ? '读取'
            : phase === 'compressing' ? '压缩'
            : phase === 'writing' ? '写入'
            : phase === 'extracting' ? '解压'
            : phase === 'pending' ? '准备' : '处理';
        const entryLabel = currentEntry
          ? ` ${currentEntry.split(/[\\/]/).pop() ?? currentEntry}`
          : '';
        const percentLabel = percent !== undefined ? ` (${percent}%)` : '';
        // 用一个新 toast 替换(dismiss 旧的,show 新的同 id 是不可能的 — 直接 push 新 toast)
        // 简化:用 showToast 创建一个新 toast,旧的 dismiss
        // 但 dismiss + show 会闪,改为只 push 一条新的 progress toast,
        // 用 archiveToasts map 跟踪最新的 toast id
        get().dismissToast(toastId);
        const newToastId = get().showToast(
          `${phaseLabel}${entryLabel}${percentLabel}`,
          'info',
          0,
        );
        set((s) => {
          const toasts = new Map(s.archiveToasts);
          toasts.set(jobId, newToastId);
          return { archiveToasts: toasts };
        });
      }
    },
  };
});

/** 工具: 构造一个新的 folder tab */
export function makeFolderTab(path: string, title?: string): import('@tabula/bridge').Tab {
  const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const name = basename(path) || path;
  return {
    id,
    type: 'folder',
    path,
    title: title ?? name,
    pinned: false,
    closable: true,
    history: path ? [path] : [],
    historyIndex: path ? 0 : -1,
  };
}

/** 工具: 在 layout 树里查找 pane 节点 */
function findPaneInLayout(
  node: import('@tabula/bridge').LayoutNode,
  paneId: string,
): import('@tabula/bridge').LayoutNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null;
  for (const child of node.children) {
    const result = findPaneInLayout(child, paneId);
    if (result) return result;
  }
  return null;
}
