/**
 * 命令派发器 (P7 v1 收口)
 *
 * 职责:
 * - `commands:run` IPC handler:接收渲染端的「执行命令 X」请求
 * - 在 COMMAND_CATALOG 里查 id 是否存在;不存在 → 立刻返回 UNKNOWN_COMMAND
 * - 存在 → 通过 `commands:run-command` 事件把请求推回**发起方所在的渲染窗口**
 *   (不直接执行:实际命令体仍在渲染端,因为现在所有内置命令的副作用
 *   都在 renderer 那边 — keydown handler / store action / layout 操作等。
 *   主进程目前没有同一份命令的"主进程版"实现,直接派发会导致双源真相。)
 *
 * 后续如果把命令体搬到主进程(比如 file.delete),把 handler 改成
 * 真正调用 service 即可,IPC 形状不变。
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '@tabula/bridge';
import type { RunCommandError, RunCommandResult } from '@tabula/bridge';
import { getCommandSpec } from './command-catalog';

/** 失败结果工厂(给 IPC handler 返,渲染端拿 ok=false) */
function errResult(code: RunCommandError['code'], message: string): RunCommandResult {
  return { ok: false, error: { code, message } };
}

/** 取发起 invoke 的 BrowserWindow(可能是 null,理论上不会) */
function senderWindow(evt: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(evt.sender);
}

/**
 * 处理一次 `commands:run` 调用。
 * 返回 RunCommandResult(给 ipcMain.handle 用)。
 */
export function dispatchRunCommand(
  evt: IpcMainInvokeEvent,
  commandId: string,
  _args?: unknown[],
): RunCommandResult {
  if (typeof commandId !== 'string' || commandId.length === 0) {
    return errResult('UNKNOWN_COMMAND', '命令 id 必须是非空字符串');
  }
  const spec = getCommandSpec(commandId);
  if (!spec) {
    return errResult('UNKNOWN_COMMAND', `未知命令: ${commandId}`);
  }
  // 合法 → 推回发起方所在的渲染窗口
  const win = senderWindow(evt);
  if (!win || win.isDestroyed()) {
    return errResult('UNKNOWN', '发起方窗口不可用,无法派发命令');
  }
  win.webContents.send(IpcChannels.COMMANDS_RUN_COMMAND, { commandId });
  return { ok: true, data: { commandId } };
}
