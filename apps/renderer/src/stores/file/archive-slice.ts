import type { FileSlice } from './types';
import type { CompressRequest, ExtractRequest } from '@tabula/bridge';

type Actions =
  | 'startCompress'
  | 'startExtract'
  | 'cancelArchive'
  | 'updateArchiveJob';

type SetFileState = Parameters<FileSlice<Actions>>[0];

function registerJob(set: SetFileState, jobId: string, toastId: string, sourcePaneId?: string): void {
  set(state => {
    const jobs = new Map(state.archiveJobs);
    jobs.set(jobId, { jobId, phase: 'pending', processed: 0, total: -1 });
    const toasts = new Map(state.archiveToasts);
    toasts.set(jobId, toastId);
    const paneIds = new Map(state.archivePaneIds);
    if (sourcePaneId) paneIds.set(jobId, sourcePaneId);
    return { archiveJobs: jobs, archiveToasts: toasts, archivePaneIds: paneIds };
  });
}

function scheduleJobCleanup(set: SetFileState, jobId: string): void {
  setTimeout(() => {
    set(state => {
      const jobs = new Map(state.archiveJobs);
      jobs.delete(jobId);
      const toasts = new Map(state.archiveToasts);
      toasts.delete(jobId);
      const paneIds = new Map(state.archivePaneIds);
      paneIds.delete(jobId);
      return { archiveJobs: jobs, archiveToasts: toasts, archivePaneIds: paneIds };
    });
  }, 500);
}

export const createArchiveSlice: FileSlice<Actions> = (set, get) => ({
  // ============ Archive (压缩 / 解压) ============
  startCompress: async (sources: string[], sourcePaneId?: string, format = 'zip') => {
    if (!sources || sources.length === 0) {
      get().showToast('未选中任何项', 'warn');
      return { ok: false, error: '未选中任何项' };
    }
    // 源目录和所选格式仅提供默认值，最终位置由保存对话框决定。
    const defaultName =
      sources.length === 1
        ? (sources[0].split(/[\\/]/).filter(Boolean).pop() ?? 'archive') + '.' + format
        : `${sources.length} 项.${format}`;
    // 取第一个源文件的目录作为输出目录
    const firstDir = sources[0].split(/[\\/]/).slice(0, -1).join('/');
    const destination = await window.tabula.fs.saveDialog({ title: '保存归档', defaultPath: firstDir + '/' + defaultName, filters: [{ name: format.toUpperCase() + ' 归档', extensions: [format] }] });
    if (!destination) return { ok: false, error: '已取消' };

    const req: CompressRequest = { sources, destination, sourcePaneId };
    const result = await window.tabula.archive.compress(req);
    if (!result.ok) {
      get().showToast(`压缩失败: ${result.error.message}`, 'error', 4000);
      return { ok: false, error: result.error.message };
    }
    const jobId = result.data.jobId;
    const toastId = get().showToast(`正在压缩 ${defaultName}…`, 'info', 0);
    registerJob(set, jobId, toastId, sourcePaneId);
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
    registerJob(set, jobId, toastId, sourcePaneId);
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
      scheduleJobCleanup(set, jobId);
    } else if (phase === 'error') {
      get().dismissToast(toastId);
      get().showToast(`归档失败: ${error?.message ?? '未知错误'}`, 'error', 4000);
      scheduleJobCleanup(set, jobId);
    } else if (phase === 'cancelled') {
      get().dismissToast(toastId);
      get().showToast('已取消', 'info', 2000);
      scheduleJobCleanup(set, jobId);
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
  }
});
