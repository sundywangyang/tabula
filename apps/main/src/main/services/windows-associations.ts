import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface SystemAssociation { name: string; identity: string }
type Request = { action: 'list'; extension: string } | { action: 'open'; path: string; identity: string; name: string };

// Enumerate and invoke the same Windows Shell association handlers used by Open With.
// The request travels through stdin as JSON, never as executable PowerShell source.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("973810ae-9599-4b88-9e4d-6ee98c9552da")]
interface IEnumAssocHandlers { [PreserveSig] int Next(uint count, out IAssocHandler handler, out uint fetched); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("f04061ac-1659-4a3f-a954-775aa57fc083")]
interface IAssocHandler {
  void GetName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  void GetUIName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  void GetIconLocation([MarshalAs(UnmanagedType.LPWStr)] out string path, out int index);
  [PreserveSig] int IsRecommended();
  void MakeDefault([MarshalAs(UnmanagedType.LPWStr)] string description);
  void Invoke(IDataObject data);
  void CreateInvoker(IDataObject data, out IntPtr invoker);
}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
interface IShellItem { void BindToHandler(IntPtr context, ref Guid bhid, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IDataObject data); }
public class TabulaAssociation { public string name; public string identity; }
public static class TabulaShellAssociations {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)] static extern int SHAssocEnumHandlers(string extension, int filter, out IEnumAssocHandlers handlers);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)] static extern int SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
  static IEnumAssocHandlers GetHandlers(string extension) {
    IEnumAssocHandlers handlers;
    // Only handlers Windows marks as relevant to this extension, not generic Open With programs.
    Marshal.ThrowExceptionForHR(SHAssocEnumHandlers(extension, 1, out handlers));
    return handlers;
  }
  public static TabulaAssociation[] List(string extension) {
    var rows = new List<TabulaAssociation>(); var handlers = GetHandlers(extension);
    try {
      IAssocHandler handler; uint fetched; int status;
      while ((status = handlers.Next(1, out handler, out fetched)) == 0 && fetched == 1) {
        try {
          string name, identity; handler.GetName(out identity); handler.GetUIName(out name);
          if (!String.IsNullOrWhiteSpace(name) && !String.IsNullOrWhiteSpace(identity)) rows.Add(new TabulaAssociation { name = name, identity = identity });
        } catch (COMException) { /* Ignore stale or broken registrations. */ }
        finally { Marshal.ReleaseComObject(handler); }
      }
      Marshal.ThrowExceptionForHR(status);
      return rows.ToArray();
    } finally { Marshal.ReleaseComObject(handlers); }
  }
  public static void Open(string path, string expectedIdentity, string expectedName) {
    var handlers = GetHandlers(System.IO.Path.GetExtension(path));
    try {
      IAssocHandler handler; uint fetched; int status;
      while ((status = handlers.Next(1, out handler, out fetched)) == 0 && fetched == 1) {
        try {
          string identity, name;
          try { handler.GetName(out identity); handler.GetUIName(out name); }
          catch (COMException) { continue; }
          if (!String.Equals(identity, expectedIdentity, StringComparison.Ordinal) || !String.Equals(name, expectedName, StringComparison.Ordinal)) continue;
          Guid itemId = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"); IShellItem item;
          Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(path, IntPtr.Zero, ref itemId, out item));
          try {
            Guid bhid = new Guid("B8C0BD9F-ED24-455C-83E6-D5390C4FE8C4");
            Guid dataId = new Guid("0000010e-0000-0000-c000-000000000046"); IDataObject data;
            item.BindToHandler(IntPtr.Zero, ref bhid, ref dataId, out data);
          try {
            // Invoke may wait for the associated application to finish; signal that
            // the validated request is being dispatched before entering Shell code.
            Console.Out.WriteLine("TABULA_ASSOCIATION_DISPATCHED"); Console.Out.Flush();
            handler.Invoke(data);
          } finally { Marshal.ReleaseComObject(data); }
          } finally { Marshal.ReleaseComObject(item); }
          return;
        } finally { Marshal.ReleaseComObject(handler); }
      }
      Marshal.ThrowExceptionForHR(status);
      throw new InvalidOperationException("系统应用关联已发生变化，请重新打开菜单");
    } finally { Marshal.ReleaseComObject(handlers); }
  }
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.action -eq 'list') {
  $items = [TabulaShellAssociations]::List([string]$request.extension)
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($items) -Compress -Depth 4))
} elseif ($request.action -eq 'open') {
  [TabulaShellAssociations]::Open([string]$request.path, [string]$request.identity, [string]$request.name)
  [Console]::Out.WriteLine('{}')
} else { throw '无效的系统应用请求' }
`;

async function invokeWindowsShell(request: Request, onLateError?: (error: Error) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let dispatched = false;
    let finished = false;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (dispatched) onLateError?.(error); else reject(error);
    };
    // Some Shell handlers remain in Invoke after the application window appears.
    const timeout = request.action === 'open' ? 120_000 : 15_000;
    const timer = setTimeout(() => {
      child.kill();
      // After dispatch, a handler can wait for the application to close, so
      // this is an unconfirmed outcome rather than a confirmed launch failure.
      if (dispatched) { fail(new Error('系统应用启动尚未确认，请检查应用窗口或尝试使用其他应用打开')); return; }
      fail(new Error(request.action === 'open' ? '打开系统应用超时' : '查询系统应用超时'));
    }, timeout);
    let output = '', errors = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (request.action === 'open' && !dispatched && /TABULA_ASSOCIATION_DISPATCHED\r?\n/.test(output)) {
        dispatched = true; resolve(undefined);
      }
      if (output.length > 1024 * 1024) child.kill();
    });
    child.stderr.on('data', (chunk: string) => { if (errors.length < 8192) errors += chunk; });
    child.once('error', error => fail(error));
    child.once('close', code => {
      if (finished) return;
      if (code !== 0) { fail(new Error(errors.trim() || `系统应用操作失败 (${code})`)); return; }
      finished = true; clearTimeout(timer);
      if (dispatched) return;
      if (request.action === 'open') { reject(new Error('系统应用启动请求未送达')); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error('无法读取系统应用列表')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request), 'utf8');
  });
}
export async function listWindowsAssociations(extension: string): Promise<SystemAssociation[]> {
  const data = await invokeWindowsShell({ action: 'list', extension });
  if (!Array.isArray(data) || data.some(item => !item || typeof item.name !== 'string' || typeof item.identity !== 'string')) throw new Error('系统应用列表无效');
  return data;
}
export async function invokeWindowsAssociation(path: string, association: SystemAssociation, onLateError?: (error: Error) => void): Promise<void> {
  await invokeWindowsShell({ action: 'open', path, identity: association.identity, name: association.name }, onLateError);
}
