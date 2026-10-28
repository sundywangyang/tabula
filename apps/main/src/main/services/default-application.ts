import { shell } from 'electron';
import { extname } from 'node:path';
import type { ToolMethods } from '@tabula/bridge';

export async function openDefaultApplicationSettings(
  path: string,
): Promise<ToolMethods['defaultApplication']['output']> {
  const ext = extname(path);
  if (!ext || !/^\.[\w-]+$/.test(ext)) throw new Error('请选择带有效扩展名的文件');
  if (process.platform !== 'win32') throw new Error('请在系统文件属性中更改此类型的默认应用');
  await shell.openExternal(`ms-settings:defaultapps?fileExt=${encodeURIComponent(ext)}`);
  return { opened: true, message: `已打开 ${ext} 的系统默认应用设置，请在系统界面选择应用并确认。` };
}
