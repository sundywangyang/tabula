/**
 * ArchiveProvider — 压缩 / 解压能力抽象。
 *
 * 抽象原因: 归档逻辑纯 JS(fflate),平台无关;但保留 provider 形态以与
 * shell/drive/trash/window 一致,便于测试时 mock。
 *
 * 与 shell 不同: 没有 windows.ts / macos.ts / linux.ts,因为归档库跨平台
 * 行为一致。`index.ts` 直接 `new ZipArchiveProvider()` 单例。
 */
import type {
  ArchiveError,
  ArchiveInfo,
  ArchiveProgress,
  CompressRequest,
  ExtractRequest,
  Result,
} from '@tabula/bridge';

export interface ArchiveProvider {
  /**
   * 同步列出归档内全部 entry(快速,用于侧边栏预览)。
   * 损坏 / 加密 / 不存在 → ok=false + ArchiveError。
   */
  list(archivePath: string): Promise<Result<ArchiveInfo, ArchiveError>>;

  /**
   * 启动压缩任务。同步返回 jobId,实际工作在后台执行,
   * 通过 `onJobUpdate` 推送 `ArchiveProgress`,最终 phase = done。
   */
  compress(req: CompressRequest): Promise<Result<{ jobId: string }, ArchiveError>>;

  /**
   * 启动解压任务。同步返回 jobId,实际工作在后台执行,
   * 通过 `onJobUpdate` 推送 `ArchiveProgress`,最终 phase = done。
   */
  extract(req: ExtractRequest): Promise<Result<{ jobId: string }, ArchiveError>>;

  /** 拉取任务当前状态(UI 主动查询用) */
  getJob(jobId: string): Promise<Result<ArchiveProgress, ArchiveError>>;

  /** 取消正在执行的任务;终态 phase = cancelled */
  cancelJob(jobId: string): Promise<Result<void, ArchiveError>>;

  /** 订阅进度事件;返回取消订阅函数 */
  onJobUpdate(listener: (progress: ArchiveProgress) => void): () => void;
}

/** ArchiveProvider 内部 job 状态(不导出) */
export interface ArchiveJobInternal {
  jobId: string;
  phase: ArchiveProgress['phase'];
  processed: number;
  total: number;
  currentEntry?: string;
  /** phase=error 时携带,getJob 时回填到 progress */
  lastError?: ArchiveError;
  /** 用于取消正在进行的 fflate 操作 */
  terminator?: () => void;
  /** 标记是否被用户取消(此时即使 fflate 自然完成也置 cancelled) */
  cancelled: boolean;
  /** 解压任务: 目标目录路径(overwrite 检查用) */
  destination?: string;
}

export type { ArchiveError };