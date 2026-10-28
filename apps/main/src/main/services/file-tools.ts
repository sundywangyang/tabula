import { FileScanner } from './scanner';
import { NetworkService } from './network';
import { createLink, linkInfo, retargetLink } from './links';
import { folderIcons, setFolderIcon } from './folder-icons';
import { openDefaultApplicationSettings } from './default-application';
import { listActivity, recordActivity } from '../store/activity-store';
import type { Result, ToolMethods, ToolProgress } from '@tabula/bridge';
import { mapError } from '../fs/result';

type ToolHandlers = {
  [K in keyof ToolMethods]: (
    input: ToolMethods[K]['input'],
  ) => ToolMethods[K]['output'] | Promise<ToolMethods[K]['output']>;
};

/** Dispatch tools through their bridge contract, retaining one error boundary. */
export class FileToolsService {
  readonly scanner: FileScanner;
  readonly network = new NetworkService();
  private readonly handlers: ToolHandlers;

  constructor(progress: (p: ToolProgress) => void) {
    this.scanner = new FileScanner(progress);
    this.handlers = {
      contentSearch: request => this.scanner.search(request),
      duplicates: request => this.scanner.duplicates(request),
      cancel: request => this.scanner.cancel(request.jobId),
      history: request => listActivity(request?.path, request?.limit),
      linkInfo: request => linkInfo(request.path),
      createLink: async request => {
        const output = await createLink(request.target, request.path, request.kind);
        recordActivity({
          operation: request.kind === 'hardlink' ? '创建硬链接' : '创建符号链接',
          phase: 'do', paths: [request.target], destinations: [request.path],
        });
        return output;
      },
      retargetLink: async request => {
        const output = await retargetLink(request.path, request.target);
        recordActivity({
          operation: '修改链接目标',
          phase: 'do', paths: [request.path], destinations: [request.target],
        });
        return output;
      },
      connect: request => this.network.connect(request),
      mounts: () => this.network.list(),
      disconnect: request => this.network.disconnect(request.path),
      folderIcon: request => setFolderIcon(request.path, request.image, request.reset),
      folderIcons: request => folderIcons(request.paths),
      defaultApplication: request => openDefaultApplicationSettings(request.path),
    };
  }

  async run<K extends keyof ToolMethods>(
    method: K, input: ToolMethods[K]['input'],
  ): Promise<Result<ToolMethods[K]['output']>> {
    try {
      if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(this.handlers, method)) throw new Error('未知文件工具');
      const output = await this.handlers[method](input);
      return { ok: true, data: output };
    } catch (error) {
      return mapError(error);
    }
  }
}
