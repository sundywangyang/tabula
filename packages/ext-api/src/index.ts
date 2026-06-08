/**
 * @tabula/ext-api
 *
 * 插件 SDK,给扩展作者用。
 *
 * 用法:
 *
 * ```ts
 * import { commands, ExtensionContext } from '@tabula/ext-api';
 *
 * export function activate(ctx: ExtensionContext) {
 *   ctx.subscriptions.push(
 *     commands.registerCommand('myExt.hello', () => {
 *       window.alert('Hi from extension!');
 *     })
 *   );
 * }
 *
 * export function deactivate() {}
 * ```
 */
export const VERSION = '0.1.0';
export const API_STATUS = 'live' as const;

// ==================== 类型 ====================

/** 可释放资源 */
export interface Disposable {
  dispose(): void;
}

/** 注册命令的处理函数 */
export type CommandHandler = (...args: unknown[]) => unknown;

/** 面板描述符 */
export interface PanelDescriptor {
  id: string;
  title: string;
  icon?: string;
  location?: 'left' | 'right' | 'bottom';
}

// ==================== ExtensionContext ====================

export interface ExtensionContext {
  /** 生命周期结束时自动 dispose 的资源 */
  subscriptions: Disposable[];

  /** 命令注册 API */
  commands: {
    /** 注册一个命令，返回 disposable */
    registerCommand(cmd: string, handler: CommandHandler): Disposable;
  };

  /** 面板注册 API */
  panels: {
    /** 注册一个侧边栏面板 */
    register(panel: PanelDescriptor): Disposable;
  };

  /** 工作区 API（受限制的文件访问） */
  workspace: {
    /** 读取文件内容（UTF-8） */
    readFile(path: string): Promise<string>;
  };

  /** 插件根目录路径 */
  rootPath: string;

  /** 插件 ID */
  extensionId: string;
}

// ==================== 导出 ====================

// 占位命令 API（插件内部调用）
// 实际实现由 ext-host 子进程注入
export const commands = {
  registerCommand(_cmd: string, _handler: CommandHandler): Disposable {
    return { dispose: () => {} };
  },
};

export const panels = {
  register(_panel: PanelDescriptor): Disposable {
    return { dispose: () => {} };
  },
};

export const workspace = {
  readFile(_path: string): Promise<string> {
    return Promise.reject(new Error('workspace API is only available in extension host context'));
  },
};
