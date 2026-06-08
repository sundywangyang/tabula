/**
 * JSON-RPC 通信通道
 *
 * 主进程 <→ ext-host 子进程 通过 stdin/stdout 传递 JSON-RPC 消息。
 * 每条消息以单个换行符(\n)分隔。
 */
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { app } from 'electron';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from './json-rpc-types';
import { MainHostMethods } from './json-rpc-types';

export type NotificationHandler = (method: string, params?: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class JsonRpcChannel {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers: NotificationHandler[] = [];
  private messageBuffer = '';
  private _ready = false;

  get ready(): boolean {
    return this._ready;
  }

  /**
   * 启动 ext-host 子进程
   */
  start(): void {
    if (this.proc) return;

    // 构建子进程启动脚本路径。
    // 在 dev 模式: out/main/ext-host/ext-host-bootstrap.mjs(相对 process.cwd())
    // 在打包模式: process.resourcesPath/app.asar.unpacked/out/main/ext-host/ext-host-bootstrap.mjs
    //   (asarUnpack 让此文件落在 .unpacked 真实目录,Node 才能 spawn)
    const extHostScript = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'ext-host', 'ext-host-bootstrap.mjs')
      : join(app.getAppPath(), 'out', 'main', 'ext-host', 'ext-host-bootstrap.mjs');

    // 用项目自带的 Node (electron 的 process.execPath 即为 Node 二进制)
    // 但 electron 二进制默认启动 app,需要 ELECTRON_RUN_AS_NODE=1 让它当 Node 跑
    const nodePath = process.execPath;

    this.proc = spawn(nodePath, [extHostScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TABULA_EXT_HOST: '1',
        // electron 二进制需要此 env var 才会以 Node 模式运行而非启动 app
        ELECTRON_RUN_AS_NODE: '1',
      },
      windowsHide: true,
    });

    // stderr 输出到主进程日志
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      console.error('[ext-host]', chunk.toString().trim());
    });

    // stdout 接收 JSON-RPC 消息
    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.messageBuffer += chunk.toString();
      this.processMessages();
    });

    this.proc.on('error', (err) => {
      console.error('[ext-host] process error:', err);
      this._ready = false;
    });

    this.proc.on('exit', (code, signal) => {
      console.log(`[ext-host] process exited: code=${code} signal=${signal}`);
      this._ready = false;
      // 拒绝所有未完成的请求
      for (const [id, pending] of this.pending) {
        pending.reject(new Error(`ext-host process exited: ${code}`));
      }
      this.pending.clear();
    });

    console.log('[ext-host] child process started, pid:', this.proc.pid);
  }

  /**
   * 优雅关闭子进程
   */
  stop(): void {
    if (this.proc) {
      this.proc.stdin?.end();
      this.proc.kill('SIGTERM');
      this.proc = null;
      this._ready = false;
    }
  }

  /**
   * 注册通知处理器（接收 ext-host → 主进程的主动通知）
   */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.push(handler);
    return () => {
      const idx = this.notificationHandlers.indexOf(handler);
      if (idx !== -1) this.notificationHandlers.splice(idx, 1);
    };
  }

  /**
   * 发送请求并等待响应（主进程 → ext-host）
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.proc || !this.proc.stdin) {
      throw new Error('ext-host process not running');
    }

    const id = this.nextId++;
    const req: JsonRpcRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.sendRaw(req);

      // 超时：30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  /**
   * 发送通知，不等待响应（主进程 → ext-host）
   */
  notify(method: string, params?: unknown): void {
    if (!this.proc || !this.proc.stdin) {
      console.warn('[ext-host] cannot send notification: process not running');
      return;
    }
    const notification: JsonRpcNotification = { method, params };
    this.sendRaw(notification);
  }

  private sendRaw(msg: JsonRpcRequest | JsonRpcNotification): void {
    if (this.proc?.stdin) {
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  /**
   * 处理接收到的消息缓冲区，解析并分发
   */
  private processMessages(): void {
    const lines = this.messageBuffer.split('\n');
    // 保留最后一个不完整的行
    this.messageBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
        this.dispatch(msg);
      } catch (err) {
        console.error('[ext-host] failed to parse JSON-RPC message:', line, err);
      }
    }
  }

  private dispatch(msg: JsonRpcResponse | JsonRpcNotification): void {
    // 响应（有 id）
    if ('id' in msg) {
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (pending) {
        if (msg.error) {
          pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 通知（无 id）
    const handler = this.notificationHandlers;
    for (const h of handler) {
      try {
        h(msg.method, msg.params);
      } catch (err) {
        console.error('[ext-host] notification handler error:', msg.method, err);
      }
    }
  }
}
