/**
 * 平台抽象层 — 类型契约
 *
 * 设计目标:把所有 `process.platform === 'X'` 分支下沉到 platform/{win,mac,linux}.ts,
 * 业务模块通过 `getPlatform().<area>.<op>(...)` 调用,不再关心平台细节。
 *
 * PlatformAdapter 覆盖以下能力:
 *  - 元信息(id / name / defaultRootPath / quitOnAllWindowsClosed)
 *  - window(icon 路径、titleBarStyle、autoHideMenuBar、macOS dock icon)
 *  - shortcut(系统保留键组合 — 用户不能绑定这些)
 *  - trash(列出 / 恢复 / 清空回收站)
 *  - drive(列出挂载卷)
 *  - shell(打开系统终端 / 用指定程序打开文件)
 *
 * 跨平台"丢回收站"(`shell.trashItem`)是 Electron 提供的统一 API,直接走
 * node:fs/fsService.deletePaths,不需要再抽 platform.delete。
 */
import type {
  DriveInfo,
  KeyCombo,
  Result,
  TrashListResult,
} from '@tabula/bridge';

/** Node 进程平台 id(原值) */
export type PlatformId = NodeJS.Platform;

/** 业务侧平台名(给 UI / 日志 / 跨进程 IPC 用) */
export type PlatformName = 'windows' | 'macos' | 'linux';

/** 解析路径上下文(给 icon / dock icon 等需要"dev vs 打包"区分的接口) */
export interface ResolvePathContext {
  isDev: boolean;
  /** process.resourcesPath(dev 模式 = 仓库根) */
  resourcesPath: string;
  /** __dirname 解析到的 main 进程目录(用于相对路径回溯到 build-assets) */
  appRoot: string;
}

export interface WindowChrome {
  /** 主窗口 BrowserWindow.icon */
  getIconPath(ctx: ResolvePathContext): string;
  /** macOS dock icon(其他平台 = undefined,不调) */
  getDockIconPath?(ctx: ResolvePathContext): string;
  titleBarStyle: 'hidden' | 'hiddenInset' | 'default';
  autoHideMenuBar: boolean;
}

export interface ShortcutOps {
  /** 该平台上 OS 占用的键组合(用户不能绑这些) */
  getReservedKeyCombos(): KeyCombo[];
}

export interface TrashOps {
  list(): Promise<Result<TrashListResult>>;
  restore(itemPath: string, originalPath?: string): Promise<Result<void>>;
  empty(): Promise<Result<void>>;
}

export interface DriveOps {
  list(): Promise<DriveInfo[]>;
}

export interface ShellOps {
  /** 在指定目录打开系统终端(Win=PowerShell, mac=Terminal, Linux=常见终端之一) */
  openTerminal(path: string): Promise<Result<void>>;
  /** 用指定程序打开文件(Win=直接 spawn, mac=`open -a`, Linux=`xdg-open`) */
  openWith(filePath: string, program: string): Promise<Result<void>>;
}

/** 平台行为总契约 — win/mac/linux 各自实现一份 */
export interface PlatformAdapter {
  /** Node 原生 platform id(win32 / darwin / linux) */
  readonly id: PlatformId;
  /** 业务侧平台名(windows / macos / linux) */
  readonly name: PlatformName;
  /** 用户家目录根(Win=`C:\Users`、mac/linux=`/`) */
  readonly defaultRootPath: string;
  /** 所有窗口关闭后是否退出(macOS = false) */
  readonly quitOnAllWindowsClosed: boolean;

  readonly window: WindowChrome;
  readonly shortcut: ShortcutOps;
  readonly trash: TrashOps;
  readonly drive: DriveOps;
  readonly shell: ShellOps;
}
