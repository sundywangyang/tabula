/**
 * JSON-RPC 协议类型定义
 *
 * 扩展宿主与主进程之间通过 stdin/stdout 传输 JSON-RPC 消息。
 * 协议参考 VS Code 的 JSON-RPC over stdio 规范。
 */

export interface JsonRpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** 内置错误码 */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// 扩展宿主方法名（主进程 → ext-host）
export const ExtHostMethods = {
  INITIALIZE: 'extHost.initialize',
  INVOKE_COMMAND: 'extHost.invokeCommand',
  DISPOSE_EXTENSION: 'extHost.disposeExtension',
} as const;

// 扩展宿主通知名（ext-host → 主进程）
export const MainHostMethods = {
  INITIALIZED: 'mainHost.initialized',
  EXTENSION_ACTIVATED: 'mainHost.extensionActivated',
  EXTENSION_DEACTIVATED: 'mainHost.extensionDeactivated',
  REGISTER_COMMAND: 'mainHost.registerCommand',
  REGISTER_PANEL: 'mainHost.registerPanel',
  REGISTER_PREVIEWER: 'mainHost.registerPreviewer',
  REGISTER_VIEW: 'mainHost.registerView',
  COMMAND_INVOKED: 'mainHost.commandInvoked',
  PANEL_DATA: 'mainHost.panelData',
  ERROR: 'mainHost.error',
} as const;
