import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { NativeFileClipboard } from '@tabula/bridge';

// Windows PowerShell ships with Windows and provides the native OLE file-drop format.
// Paths are transferred as JSON on stdin rather than interpolated into a command.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TabulaClipboardSequence { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); [DllImport("user32.dll")] public static extern bool OpenClipboard(IntPtr owner); [DllImport("user32.dll")] public static extern bool EmptyClipboard(); [DllImport("user32.dll")] public static extern bool CloseClipboard(); }'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.action -eq 'read') {
  $before = [TabulaClipboardSequence]::GetClipboardSequenceNumber()
  $data = [System.Windows.Forms.Clipboard]::GetDataObject()
  $paths = @()
  $mode = 'copy'
  if ($null -ne $data -and $data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
    $paths = @($data.GetData([System.Windows.Forms.DataFormats]::FileDrop))
    if ($data.GetDataPresent('Preferred DropEffect')) {
      $effect = $data.GetData('Preferred DropEffect')
      if ($effect -is [System.IO.MemoryStream]) { $bytes = $effect.ToArray(); if ($bytes.Length -ge 4 -and ([BitConverter]::ToInt32($bytes, 0) -band 2)) { $mode = 'cut' } }
      elseif ($effect -is [byte[]] -and $effect.Length -ge 4 -and ([BitConverter]::ToInt32($effect, 0) -band 2)) { $mode = 'cut' }
    }
  }
  $after = [TabulaClipboardSequence]::GetClipboardSequenceNumber()
  if ($before -ne $after) { throw '剪贴板在读取时发生变化，请重试' }
  $result = @{ paths = $paths; mode = $mode; sequence = $after }
} elseif ($request.action -eq 'write') {
  $list = New-Object System.Collections.Specialized.StringCollection
  foreach ($path in $request.paths) { [void]$list.Add([string]$path) }
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetFileDropList($list)
  $effect = if ($request.mode -eq 'cut') { 2 } else { 1 }
  $stream = New-Object System.IO.MemoryStream(,[BitConverter]::GetBytes([int]$effect))
  $data.SetData('Preferred DropEffect', $stream)
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
  $result = @{ paths = @($request.paths); mode = $request.mode; sequence = [TabulaClipboardSequence]::GetClipboardSequenceNumber() }
} elseif ($request.action -eq 'clear') {
  if (-not [TabulaClipboardSequence]::OpenClipboard([IntPtr]::Zero)) { throw '无法打开系统剪贴板' }
  try {
    $sequence = [TabulaClipboardSequence]::GetClipboardSequenceNumber()
    $cleared = $sequence -eq [uint32]$request.sequence
    if ($cleared -and -not [TabulaClipboardSequence]::EmptyClipboard()) { throw '无法清空系统剪贴板' }
  } finally { [void][TabulaClipboardSequence]::CloseClipboard() }
  $result = @{ cleared = $cleared }
} else { throw 'Invalid clipboard action' }
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 5))
`;

function invokeClipboard(request: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const exe = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('访问系统剪贴板超时')); }, 15000);
    let output = ''; let errors = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { errors += chunk; });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error(errors.trim() || `剪贴板操作失败 (${code})`)); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error(`无法读取系统剪贴板: ${output}`)); }
    });
    child.stdin.end(JSON.stringify(request), 'utf8');
  });
}

export async function readWindowsFileClipboard(): Promise<NativeFileClipboard> {
  return invokeClipboard({ action: 'read' });
}

export async function writeWindowsFileClipboard(paths: string[], mode: 'copy' | 'cut'): Promise<NativeFileClipboard> {
  if (!paths.length || paths.some((path) => !isAbsolute(path))) throw new Error('文件剪贴板路径无效');
  return invokeClipboard({ action: 'write', paths, mode });
}

export async function clearWindowsFileClipboard(sequence: number): Promise<boolean> {
  return (await invokeClipboard({ action: 'clear', sequence })).cleared === true;
}
