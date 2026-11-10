import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

/** Opens the system's application chooser without shell interpolation. */
export async function openWindowsApplicationChooser(path: string): Promise<void> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('文件路径无效');
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['shell32.dll,OpenAs_RunDLL', path], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
