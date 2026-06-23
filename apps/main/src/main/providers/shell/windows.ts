/**
 * Windows ShellProvider — PowerShell 启动 + 直接 spawn 程序。
 *
 * openTerminal:
 *   cmd.exe /c start "" /D <path> powershell.exe -NoExit
 *   - 必须经 cmd 触发( start 是 cmd 内置命令)
 *   - 第一个 "" 是 start 的 title 槽位,必须给,否则它会以为第一个参数是 title
 *   - /D 后跟工作目录,免去路径里空格 / 引号的转义陷阱
 *
 * openWith:
 *   直接 spawn(program, [filePath]),detached + unref(),父进程退出不影响子进程
 */
import { spawn } from 'node:child_process';
import type { Result } from '@tabula/bridge';
import type { ShellProvider } from './types';

function mapErr(err: unknown): Result<void> {
  const e = err as NodeJS.ErrnoException;
  return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
}

export class WindowsShellProvider implements ShellProvider {
  async openTerminal(path: string): Promise<Result<void>> {
    if (!path || typeof path !== 'string') {
      return { ok: false, error: { code: 'UNKNOWN', message: '路径为空' } };
    }
    try {
      const child = spawn(
        'cmd.exe',
        ['/c', 'start', '""', '/D', path, 'powershell.exe', '-NoExit'],
        { detached: true, stdio: 'ignore', windowsHide: false },
      );
      child.unref();
      return { ok: true, data: undefined };
    } catch (err) {
      return mapErr(err);
    }
  }

  async openWith(filePath: string, program: string): Promise<Result<void>> {
    try {
      const child = spawn(program, [filePath], { detached: true, windowsHide: true });
      child.unref();
      return { ok: true, data: undefined };
    } catch (err) {
      return mapErr(err);
    }
  }
}
