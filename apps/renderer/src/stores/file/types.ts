import type { StateCreator } from 'zustand';
import type { ArchiveProgress, FsEntry, TrashEntry, FileTypeCategory } from '@tabula/bridge';

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
  resolved: { source: string; dest: string; overwrite: boolean; }[];
  /** 待处理的冲突(队列头一个会显示) */
  queue: ConflictItem[];
  /** 跳过/已处理不冲突的源(sourcePath -> destPath) */
  autoResolved: { source: string; dest: string; overwrite: boolean; }[];
}

/** 单个 pane 持有的文件系统数据(独立于 layout 结构) */
export interface PaneFileData {
  fileType?: FileTypeCategory;
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

export interface FileStore {
  thumbnailSize: number;
  setThumbnailSize: (size: number) => void;
  setFileType: (paneId: string, type: FileTypeCategory) => void;
  revealInPane: (paneId: string, path: string) => Promise<void>;
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
  archiveJobs: Map<string, ArchiveProgress & { sourcePaneId?: string; }>;
  /** jobId → 显示该进度的 toast id(取消/完成后 dismiss) */
  archiveToasts: Map<string, string>;
  /** jobId → 触发该任务的 paneId(用于完成后刷新) */
  archivePaneIds: Map<string, string>;

  // ===== 每 pane 数据分片 =====
  panes: Record<string, PaneFileData>;

  // ============ Per-pane: 目录 ============
  ensurePane: (paneId: string) => Promise<void>;
  removePaneData: (paneId: string) => void;
  clearPaneDirectory: (paneId: string) => void;
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
  ) => Promise<{ ok: boolean; error?: string; }>;

  // ============ Per-pane: 删除(走回收站)============
  deleteSelected: (paneId: string) => Promise<{ ok: boolean; error?: string; count: number; }>;

  // ============ P3: 永久删除(不走回收站)============
  permanentDelete: (paneId: string, paths: string[]) => Promise<{ ok: boolean; error?: string; count: number; }>;

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
  createFolder: (paneId: string, name: string) => Promise<{ ok: boolean; error?: string; path?: string; }>;
  createFile: (paneId: string, name: string) => Promise<{ ok: boolean; error?: string; path?: string; }>;
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
  startCompress: (sources: string[], sourcePaneId?: string, format?: 'zip' | 'tar' | 'tgz') => Promise<{ ok: boolean; error?: string; }>;
  /**
   * 启动解压任务。弹目录选择框让用户选解压目标,
   * 然后调主进程解压,订阅进度通过 toast 显示。
   */
  startExtract: (archive: string, destination?: string, sourcePaneId?: string) => Promise<{ ok: boolean; error?: string; }>;
  /** 取消正在执行的归档任务 */
  cancelArchive: (jobId: string) => Promise<void>;
  /** 由 ARCHIVE_JOB_UPDATE 事件触发,更新 archiveJobs + 关联 toast 文案 */
  updateArchiveJob: (progress: ArchiveProgress) => void;

  // ============ P3: 冲突解决 ============
  resolveConflict: (resolution: ConflictResolution, newName?: string) => Promise<void>;

  // ============ P3: 回收站 ============
  loadTrash: () => Promise<void>;
  restoreTrashItems: (itemPaths: string[]) => Promise<{ ok: boolean; error?: string; }>;
  permanentDeleteItems: (itemPaths: string[]) => Promise<{ ok: boolean; error?: string; }>;
  emptyTrash: () => Promise<{ ok: boolean; error?: string; }>;
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
  setPreviewData: (data: { blobUrl?: string | null; text?: string | null; truncated?: boolean; totalLines?: number; }) => void;
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
  ) => Promise<{ ok: boolean; moved: number; error?: string; }>;

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

/** A domain's actions share the same store instance and update boundary. */
export type FileSlice<K extends keyof FileStore> = StateCreator<FileStore, [], [], Pick<FileStore, K>>;
