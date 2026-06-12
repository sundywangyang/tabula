/**
 * Ext-Host Bootstrap Script
 *
 * 运行在独立的 Node 子进程中，负责：
 * - 加载插件代码（require）
 * - 实现 ExtensionContext API
 * - 处理主进程发来的 JSON-RPC 请求
 *
 * 协议：stdin/stdout JSON-RPC（每条消息以 \n 分隔）
 */
import { readFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { ExtensionManifest } from '@tabula/bridge';

// ==================== 类型 ====================

interface Disposable {
  dispose(): void;
}

type CommandHandler = (...args: unknown[]) => unknown;

interface ExtContextCommands {
  registerCommand(cmd: string, handler: CommandHandler): Disposable;
}

interface ExtContextPanels {
  register(panel: { id: string; title: string; icon?: string }): Disposable;
}

interface ExtContextWorkspace {
  readFile(path: string): Promise<string>;
}

interface ExtensionContext {
  subscriptions: Disposable[];
  commands: ExtContextCommands;
  panels: ExtContextPanels;
  workspace: ExtContextWorkspace;
  rootPath: string;
  extensionId: string;
  /**
   * 推送 panel 数据到 renderer(主进程会广播到所有 BrowserWindow 的 ext:panel-data 频道)
   * panelId 应与 panels.register() 的 id 一致
   */
  pushPanelData(panelId: string, payload: unknown): void;
}

interface RpcMessage {
  id?: number;
  method: string;
  params?: unknown;
}

// ==================== 插件注册表 ====================

interface LoadedPlugin {
  manifest: ExtensionManifest;
  activate: (ctx: ExtensionContext) => Promise<void> | void;
  deactivate?: () => void | Promise<void>;
  subscriptions: Disposable[];
}

const loadedPlugins = new Map<string, LoadedPlugin>();

// ==================== ExtensionContext 实现 ====================

class ExtensionContextImpl implements ExtensionContext {
  subscriptions: Disposable[] = [];
  extensionId: string;
  rootPath: string;

  constructor(extensionId: string, rootPath: string) {
    this.extensionId = extensionId;
    this.rootPath = rootPath;
  }

  pushPanelData(panelId: string, payload: unknown): void {
    sendNotification('mainHost.panelData', {
      panelId,
      extensionId: this.extensionId,
      payload,
    });
  }

  commands: ExtContextCommands = {
    registerCommand: (cmd: string, handler: CommandHandler): Disposable => {
      commandHandlers.set(cmd, handler);
      sendNotification('mainHost.registerCommand', { command: cmd, extensionId: this.extensionId });

      const disposable: Disposable = {
        dispose: () => {
          commandHandlers.delete(cmd);
        },
      };
      this.subscriptions.push(disposable);
      return disposable;
    },
  };

  panels: ExtContextPanels = {
    register: (panel): Disposable => {
      sendNotification('mainHost.registerPanel', {
        id: panel.id,
        title: panel.title,
        icon: panel.icon,
        extensionId: this.extensionId,
        location: 'left',
      });

      const disposable: Disposable = { dispose: () => {} };
      this.subscriptions.push(disposable);
      return disposable;
    },
  };

  workspace: ExtContextWorkspace = {
    readFile: async (path: string): Promise<string> => {
      const absolutePath = isAbsolute(path) ? path : resolve(this.rootPath, path);
      const content = readFileSync(absolutePath, 'utf-8');
      return content;
    },
  };
}

const commandHandlers = new Map<string, CommandHandler>();

// ==================== JSON-RPC 通信 ====================

function sendMessage(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// 重要:JSON-RPC 协议独占 stdout(每行一条 JSON 消息)。
// ext-host 子进程 + extension 内的 console.log 默认会写 stdout,
// 会被主进程 JsonRpcChannel 当成"非法 JSON 消息" 解析失败(已知的 P6 v1 噪音 bug)。
// 解决:把 console.log/error/info/warn 重定向到 stderr,
// 这样 ext-host bootstrap 自己的 banner、extension 内的 console 输出都不污染通道。
// 注意:sendMessage() 直接走 process.stdout.write,绕过 console → 不受影响。
const _originalLog = console.log;
const _originalInfo = console.info;
const _originalWarn = console.warn;
const _stderrWrite = (s: string) => process.stderr.write(s + '\n');
console.log = (...args: unknown[]) => _stderrWrite(args.map(String).join(' '));
console.info = (...args: unknown[]) => _stderrWrite(args.map(String).join(' '));
console.warn = (...args: unknown[]) => _stderrWrite(args.map(String).join(' '));
// console.error 已经是 stderr,不需要重定向;但保留引用防止 lint 报 unused
void _originalLog; void _originalInfo; void _originalWarn;

function sendResponse(id: number, result?: unknown, error?: { code: number; message: string }): void {
  if (error) {
    sendMessage({ id, error });
  } else {
    sendMessage({ id, result });
  }
}

function sendNotification(method: string, params?: unknown): void {
  sendMessage({ method, params });
}

let messageBuffer = '';

process.stdin.on('data', (chunk: Buffer) => {
  messageBuffer += chunk.toString();
  const lines = messageBuffer.split('\n');
  messageBuffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as RpcMessage;
      handleMessage(msg);
    } catch (err) {
      console.error('[ext-host-bootstrap] parse error:', err);
    }
  }
});

// ==================== 消息处理 ====================

async function handleMessage(msg: RpcMessage): Promise<void> {
  try {
    const result = await dispatch(msg);
    if (msg.id !== undefined) {
      sendResponse(msg.id, result);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[ext-host-bootstrap] handler error:', errorMsg);
    if (msg.id !== undefined) {
      sendResponse(msg.id, undefined, { code: -32603, message: errorMsg });
    }
  }
}

async function dispatch(msg: RpcMessage): Promise<unknown> {
  switch (msg.method) {
    case 'extHost.initialize': {
      // 主进程初始化 ext-host
      const params = msg.params as { extensions: ExtensionManifest[]; userExtensionsDir: string };
      console.log('[ext-host-bootstrap] initialized with', params.extensions.length, 'extensions');
      sendNotification('mainHost.initialized', { version: '0.1.0' });
      return { ok: true };
    }

    case '$activateExtension': {
      // 激活插件
      const params = msg.params as { id: string; mainPath: string; rootPath: string };
      await activateExtension(params.id, params.mainPath, params.rootPath);
      sendNotification('mainHost.extensionActivated', { id: params.id });
      return { ok: true };
    }

    case '$deactivateExtension': {
      const params = msg.params as { id: string };
      await deactivateExtension(params.id);
      sendNotification('mainHost.extensionDeactivated', { id: params.id });
      return { ok: true };
    }

    case 'extHost.invokeCommand': {
      const params = msg.params as { command: string; args: unknown[] };
      const handler = commandHandlers.get(params.command);
      if (!handler) {
        throw new Error(`Command not found: ${params.command}`);
      }
      return handler(...params.args);
    }

    default:
      throw new Error(`Unknown method: ${msg.method}`);
  }
}

// ==================== 插件加载 ====================

async function activateExtension(
  id: string,
  mainPath: string,
  rootPath: string,
): Promise<void> {
  if (loadedPlugins.has(id)) return;

  console.log(`[ext-host-bootstrap] activating: ${id}`);

  const require = createRequire(import.meta.url);

  // 解析入口文件
  const absoluteMain = isAbsolute(mainPath)
    ? mainPath
    : resolve(rootPath, mainPath);

  let mod: { activate?: (ctx: ExtensionContext) => unknown; deactivate?: () => unknown } | unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(absoluteMain);
  } catch (err) {
    console.error(`[ext-host-bootstrap] failed to load ${id}:`, err);
    throw err;
  }

  const activateFn = typeof mod === 'function' ? mod : (mod as { activate?: (ctx: ExtensionContext) => unknown }).activate;
  const deactivateFn = (mod as { deactivate?: () => unknown }).deactivate;

  if (typeof activateFn !== 'function') {
    throw new Error(`Extension ${id} does not export an activate function`);
  }

  const ctx = new ExtensionContextImpl(id, rootPath);

  try {
    const result = activateFn(ctx);
    if (result instanceof Promise) {
      await result;
    }
  } catch (err) {
    console.error(`[ext-host-bootstrap] activate error for ${id}:`, err);
    throw err;
  }

  loadedPlugins.set(id, {
    manifest: { id, name: id, displayName: id, version: '0.0.0', main: mainPath, engines: { app: '*' }, activationEvents: [], contributes: {}, path: rootPath, enabled: true, builtin: false },
    activate: activateFn as (ctx: ExtensionContext) => Promise<void> | void,
    deactivate: deactivateFn,
    subscriptions: ctx.subscriptions,
  });

  console.log(`[ext-host-bootstrap] activated: ${id}`);
}

async function deactivateExtension(id: string): Promise<void> {
  const plugin = loadedPlugins.get(id);
  if (!plugin) return;

  // dispose 所有 subscription
  for (const sub of plugin.subscriptions) {
    try {
      sub.dispose();
    } catch (err) {
      console.error(`[ext-host-bootstrap] dispose error for ${id}:`, err);
    }
  }

  // 调用插件的 deactivate
  if (plugin.deactivate) {
    try {
      const result = plugin.deactivate();
      if (result instanceof Promise) await result;
    } catch (err) {
      console.error(`[ext-host-bootstrap] deactivate error for ${id}:`, err);
    }
  }

  loadedPlugins.delete(id);
  console.log(`[ext-host-bootstrap] deactivated: ${id}`);
}

// ==================== 启动 ====================

console.log('[ext-host-bootstrap] process started, pid:', process.pid);
