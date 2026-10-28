import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { NetworkMount, NetworkRequest } from '@tabula/bridge';
export type CommandRunner = (program: string, args: string[]) => Promise<string>;
export const runCommand: CommandRunner = (program, args) => new Promise((resolve, reject) => {
  execFile(program, args, { windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    // Never echo arguments: a network credential may be present.
    if (error) reject(new Error(stderr.trim() || stdout.trim() || `无法运行 ${program}，请检查系统组件和权限`));
    else resolve(stdout);
  });
});
export class NetworkService {
  private mounted = new Map<string, NetworkMount>();
  constructor(private readonly platform: NodeJS.Platform = process.platform, private readonly run: CommandRunner = runCommand,
    private readonly exists: (path: string) => Promise<boolean> = async p => fs.access(p).then(() => true, () => false)) {}
  list() { return [...this.mounted.values()]; }
  async connect(request: NetworkRequest): Promise<NetworkMount> {
    if (!request || !['smb', 'nfs'].includes(request.protocol) || !/^[\w.:-]+$/.test(request.server) || !request.share || /[\0\r\n]/.test(request.share + (request.username ?? '') + (request.password ?? ''))) throw new Error('请输入有效的服务器和共享目录');
    if (this.platform !== 'win32') throw new Error('此构建的网络映射支持 Windows；其他平台请先在系统挂载，再通过地址栏访问');
    let drive = request.drive?.trim().toUpperCase().replace(/:$/, '');
    if (drive && !/^[D-Z]$/.test(drive)) throw new Error('盘符必须为 D–Z');
    if (!drive) for (let code = 90; code >= 68; code--) { const candidate = String.fromCharCode(code); if (!await this.exists(`${candidate}:\\`)) { drive = candidate; break; } }
    if (!drive || await this.exists(`${drive}:\\`)) throw new Error('盘符已占用或没有空闲盘符');
    const path = `${drive}:\\`;
    const share = request.share.replace(/^[\\/]+/, '').replace(/\//g, '\\');
    if (share.split('\\').some(part => part === '..' || part === '.')) throw new Error('共享路径不能包含相对目录');
    const remote = request.protocol === 'smb' ? `\\\\${request.server}\\${share}` : `${request.server}:/${share.replace(/\\/g, '/')}`;
    try {
      if (request.protocol === 'smb') {
        const args = ['use', `${drive}:`, remote];
        if (request.password) args.push(request.password);
        if (request.username) args.push(`/user:${request.username}`);
        args.push('/persistent:no');
        await this.run('net.exe', args);
      } else {
        if (request.username || request.password) throw new Error('Windows NFS 使用系统 NFS 身份配置，此处仅支持匿名挂载');
        await this.run('mount.exe', ['-o', 'anon', remote, `${drive}:`]);
      }
    } catch (error) {
      let message = (error as Error).message;
      if (request.password) message = message.split(request.password).join('***');
      throw new Error(`连接失败: ${message}`);
    }
    const mount: NetworkMount = { path, remote, protocol: request.protocol };
    this.mounted.set(path, mount);
    return mount;
  }
  async disconnect(path: string) {
    const mount = this.mounted.get(path);
    if (!mount) throw new Error('只能断开在当前会话中由 Tabula 建立的映射');
    await this.run(mount.protocol === 'smb' ? 'net.exe' : 'umount.exe', mount.protocol === 'smb' ? ['use', path.slice(0, 2), '/delete', '/y'] : [path.slice(0, 2)]);
    this.mounted.delete(path);
  }
}
