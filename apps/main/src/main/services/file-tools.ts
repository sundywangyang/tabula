import { shell } from 'electron';
import { extname } from 'node:path';
import { FileScanner } from './scanner';
import { NetworkService } from './network';
import { createLink, linkInfo, retargetLink } from './links';
import { folderIcons, setFolderIcon } from './folder-icons';
import { listActivity, recordActivity } from '../store/activity-store';
import type { Result, ToolMethods, ToolProgress } from '@tabula/bridge';
import { mapError } from '../fs/result';

export class FileToolsService {
  readonly scanner: FileScanner;
  readonly network = new NetworkService();
  constructor(progress: (p: ToolProgress) => void) { this.scanner = new FileScanner(progress); }
  async run<K extends keyof ToolMethods>(method: K, input: ToolMethods[K]['input']): Promise<Result<ToolMethods[K]['output']>> {
    try {
      const request = input as any;
      let output: unknown;
      switch (method) {
        case 'contentSearch': output = await this.scanner.search(request); break;
        case 'duplicates': output = await this.scanner.duplicates(request); break;
        case 'cancel': this.scanner.cancel(request.jobId); break;
        case 'history': output = listActivity(request?.path, request?.limit); break;
        case 'linkInfo': output = await linkInfo(request.path); break;
        case 'createLink': output = await createLink(request.target, request.path, request.kind); recordActivity({ operation: request.kind === 'hardlink' ? '创建硬链接' : '创建符号链接', phase: 'do', paths: [request.target], destinations: [request.path] }); break;
        case 'retargetLink': output = await retargetLink(request.path, request.target); recordActivity({ operation: '修改链接目标', phase: 'do', paths: [request.path], destinations: [request.target] }); break;
        case 'connect': output = await this.network.connect(request); break;
        case 'mounts': output = this.network.list(); break;
        case 'disconnect': await this.network.disconnect(request.path); break;
        case 'folderIcon': output = await setFolderIcon(request.path, request.image, request.reset); break;
        case 'folderIcons': output = folderIcons(request.paths); break;
        case 'defaultApplication': {
          const ext = extname(request.path);
          if (!ext || !/^\.[\w-]+$/.test(ext)) throw new Error('请选择带有效扩展名的文件');
          if (process.platform !== 'win32') throw new Error('请在系统文件属性中更改此类型的默认应用');
          await shell.openExternal(`ms-settings:defaultapps?fileExt=${encodeURIComponent(ext)}`);
          output = { opened: true, message: `已打开 ${ext} 的系统默认应用设置，请在系统界面选择应用并确认。` };
          break;
        }
        default: throw new Error('未知文件工具');
      }
      return { ok: true, data: output as ToolMethods[K]['output'] };
    } catch (error) { return mapError(error); }
  }
}
