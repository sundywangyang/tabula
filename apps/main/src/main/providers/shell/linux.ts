/**
 * Linux ShellProvider — 候选终端列表 + xdg-open 默认关联。
 *
 * openTerminal:
 *   依次尝试 x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal,
 *   首个 spawn 成功的胜出,xterm + bash -c "cd … && bash" 兜底。
 *
 * openWith:
 *   xdg-open <file>(用户传入的 program 在 Linux 下没标准语义,走默认关联)
 */
import { spawn } from 'node:child_process';
import type { Result } from '@tabula/bridge';
import type { ShellProvider } from './types';

function mapErr(err: unknown): Result<void> {
  const e = err as NodeJS.ErrnoException;
  return { ok: false, error: { code: (e?.code ?? 'UNKNOWN') as any, message: e?.message ?? String(err) } };
}

export class LinuxShellProvider implements ShellProvider {
  async openTerminal(path: string): Promise<Result<void>> {
    if (!path || typeof path !== 'string') {
      return { ok: false, error: { code: 'UNKNOWN', message: '路径为空' } };
    }
    const candidates: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['x-terminal-emulator', [`--working-directory=${path}`]],
      ['gnome-terminal', [`--working-directory=${path}`]],
      ['konsole', ['--workdir', path]],
      ['xfce4-terminal', [`--working-directory=${path}`]],
    ];
    for (const [cmd, args] of candidates) {
      try {
        const child = spawn(cmd, [...args], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, data: undefined };
      } catch {
        // 该终端不存在,继续试下一个
      }
    }
    // 兜底
    try {
      const safePath = path.replace(/'/g, "'\\''");
      const child = spawn('xterm', ['-e', `bash -c "cd '${safePath}' && bash"`], {
        detached: true, stdio: 'ignore',
      });
      child.unref();
      return { ok: true, data: undefined };
    } catch (err) {
      return mapErr(err);
    }
  }

  async openWith(filePath: string, _program: string): Promise<Result<void>> {
    try {
      const child = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' });
      child.unref();
      // 备注:Linux 下"指定程序"语义需要 desktop entry 解析,这版先走 xdg-open 默认关联
      return { ok: true, data: undefined };
    } catch (err) {
      return mapErr(err);
    }
  }
}
