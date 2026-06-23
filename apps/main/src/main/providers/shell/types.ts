/**
 * ShellProvider — 平台特定的"启动外部进程 / 打开系统终端"能力抽象。
 *
 * openTerminal 在用户从工具栏「终端」按钮触发,要求:
 *  - Windows:  PowerShell.exe,工作目录为当前 pane 路径
 *  - macOS:    Terminal.app,自动 cd 到目标
 *  - Linux:    试 x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal,xterm + bash 兜底
 *
 * openWith 在「打开方式」对话框选完程序后触发,直接 spawn 程序并把文件路径传给它。
 *  - Windows:  spawn(program, [file])
 *  - macOS:    open -a <program> <file>
 *  - Linux:    xdg-open <file>(忽略 program,走默认关联)
 */
import type { Result } from '@tabula/bridge';

export interface ShellProvider {
  /** 在指定目录打开系统终端 */
  openTerminal(path: string): Promise<Result<void>>;
  /** 用指定程序打开文件 */
  openWith(filePath: string, program: string): Promise<Result<void>>;
}
