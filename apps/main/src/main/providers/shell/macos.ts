/**
 * macOS ShellProvider — `open -a` 走 LaunchServices 启动 Terminal 或指定程序。
 */
import { spawn } from 'node:child_process';
import type { Result } from '@tabula/bridge';
import type { ShellProvider } from './types';

function mapErr(err: unknown): Result<void> {
  const e = err as NodeJS.ErrnoException;
  return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
}

export class MacosShellProvider implements ShellProvider {
  async openTerminal(path: string): Promise<Result<void>> {
    if (!path || typeof path !== 'string') {
      return { ok: false, error: { code: 'UNKNOWN', message: '路径为空' } };
    }
    try {
      const child = spawn('open', ['-a', 'Terminal', path], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, data: undefined };
    } catch (err) {
      return mapErr(err);
    }
  }

  async openWith(filePath: string, program: string): Promise<Result<void>> {
    try {
      const child = spawn('open', ['-a', program, filePath], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, data: undefined };
    } catch (err) {
      return mapErr(err);
    }
  }
}
