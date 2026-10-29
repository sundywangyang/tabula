// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readWindowsFileClipboard, writeWindowsFileClipboard, clearWindowsFileClipboard } from '../windows-file-clipboard';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

describe.skipIf(process.platform !== 'win32' || process.env.TABULA_CLIPBOARD_LIVE !== '1')('Windows clipboard manual checks', () => {
  it('reads the actual system clipboard without changing it', async () => {
    const result = await readWindowsFileClipboard();
    expect(Array.isArray(result.paths)).toBe(true);
    expect(['copy', 'cut']).toContain(result.mode);
    expect(result.sequence).toBeTypeOf('number');
  }, 20000);

  it('round trips file paths and cut state, and restores the original clipboard', async () => {
    const backupScript = `Add-Type -AssemblyName System.Windows.Forms; $old = [System.Windows.Forms.Clipboard]::GetDataObject(); [Console]::WriteLine('READY'); [Console]::In.ReadLine() | Out-Null; if ($null -eq $old) { [System.Windows.Forms.Clipboard]::Clear() } else { [System.Windows.Forms.Clipboard]::SetDataObject($old, $true, 10, 100) }`;
    const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(backupScript, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    const ready = await Promise.race([once(lines, 'line'), once(child, 'exit').then(() => { throw new Error('clipboard backup exited'); })]);
    expect(ready[0]).toBe('READY');
    try {
      const paths = [join(process.cwd(), 'README.md'), join(process.cwd(), 'docs')];
      await writeWindowsFileClipboard(paths, 'cut');
      const cut = await readWindowsFileClipboard();
      expect(cut.paths).toEqual(paths);
      expect(cut.mode).toBe('cut');
      await writeWindowsFileClipboard([paths[0]], 'copy');
      expect(await clearWindowsFileClipboard(cut.sequence)).toBe(false);
      const copy = await readWindowsFileClipboard();
      expect(copy.paths).toEqual([paths[0]]);
      expect(copy.mode).toBe('copy');
    } finally {
      child.stdin.end('\n');
      const [code] = await once(child, 'exit');
      lines.close();
      expect(code).toBe(0);
    }
  }, 30000);
});
