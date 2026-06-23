/**
 * ArchiveManager — IPC 编排层。
 *
 * 职责:
 * 1. 持有一个 ArchiveProvider 单例(委托 getArchiveProvider())
 * 2. 订阅 provider 进度事件,通过 webContents.send 广播到所有窗口
 * 3. 暴露简单方法给 IPC handler 直接调用
 *
 * 与 zip-provider 的职责分离:
 * - provider: 纯逻辑(扫描/压缩/解压/进度),无 electron 依赖
 * - manager: 把进度翻译成 IPC 事件推送给渲染端
 *
 * 为什么不用 electron 自带 EventEmitter: provider 已经用 Set<listener>
 * 实现,这里再加一层包装保持简单;无外部订阅场景,不必用 EventEmitter。
 */
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type {
  ArchiveError,
  ArchiveInfo,
  ArchiveProgress,
  CompressRequest,
  ExtractRequest,
  Result,
} from '@tabula/bridge';
import { getArchiveProvider } from '../providers/archive';
import type { ArchiveProvider } from '../providers/archive';

class ArchiveManager {
  private provider: ArchiveProvider;
  private unsubProvider: (() => void) | null = null;

  constructor() {
    this.provider = getArchiveProvider();
    // 订阅 provider 进度,广播给所有窗口
    this.unsubProvider = this.provider.onJobUpdate((progress) => {
      this.broadcastToAllWindows(progress);
    });
  }

  /** 销毁(测试用) */
  dispose(): void {
    this.unsubProvider?.();
    this.unsubProvider = null;
  }

  list(archivePath: string): Promise<Result<ArchiveInfo, ArchiveError>> {
    return this.provider.list(archivePath);
  }

  compress(req: CompressRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    return this.provider.compress(req);
  }

  extract(req: ExtractRequest): Promise<Result<{ jobId: string }, ArchiveError>> {
    return this.provider.extract(req);
  }

  getJob(jobId: string): Promise<Result<ArchiveProgress, ArchiveError>> {
    return this.provider.getJob(jobId);
  }

  cancelJob(jobId: string): Promise<Result<void, ArchiveError>> {
    return this.provider.cancelJob(jobId);
  }

  /** 把进度事件广播到所有窗口(包括发送方) */
  private broadcastToAllWindows(progress: ArchiveProgress): void {
    const channel = IpcChannels.ARCHIVE_JOB_UPDATE;
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      // 没有窗口时(单元测试场景)不广播
      return;
    }
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(channel, progress);
      } catch {
        // 单个窗口失败不影响其他
      }
    }
  }
}

/** 单例 — main 进程共用一份 */
export const archiveManager = new ArchiveManager();

/** 测试钩子 — 重新构造 manager(强制清理 provider 单例) */
export function resetArchiveManagerForTesting(): void {
  archiveManager.dispose();
  // 通过 setArchiveProviderForTesting(null) 重置 provider 后,
  // 下次构造 archiveManager 会拿到新的 provider 实例
}