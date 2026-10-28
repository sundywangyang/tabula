import Store from 'electron-store';
import { nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { runCommand, type CommandRunner } from './network';
interface IconRecord { data: string; originalIni: string | null; writable: boolean }
let store: Store<{ icons: Record<string, IconRecord> }> | undefined;
const storage = (): Store<{ icons: Record<string, IconRecord> }> => store ??= new Store<{ icons: Record<string, IconRecord> }>({ name: 'tabula-folder-icons', defaults: { icons: {} } });
export function folderIcons(paths: string[]): Record<string, string> {
  const icons = storage().get('icons', {});
  return Object.fromEntries(paths.filter(p => icons[p]).map(p => [p, icons[p].data]));
}
export function migrateFolderIcons(mappings: Array<{ source: string; destination: string }>, copy = false) {
  const icons = storage().get('icons', {}); const next = { ...icons };
  const updates: Record<string, IconRecord> = {};
  for (const [path, value] of Object.entries(icons)) {
    const mapping = mappings.find(m => path === m.source || path.startsWith(m.source + '\\') || path.startsWith(m.source + '/'));
    if (mapping) { if (!copy) delete next[path]; updates[mapping.destination + path.slice(mapping.source.length)] = value; }
  }
  storage().set('icons', { ...next, ...updates });
}
export async function setFolderIcon(path: string, image?: string, reset = false, run: CommandRunner = runCommand): Promise<string | null> {
  const stat = await fs.stat(path);
  if (!stat.isDirectory()) throw new Error('只能设置文件夹图标');
  const icons = storage().get('icons', {}); const existing = icons[path];
  const iniPath = join(path, 'desktop.ini'), iconPath = join(path, '.tabula-folder.ico');
  if (reset) {
    if (!existing) return null;
    if (process.platform === 'win32') {
      await run('attrib.exe', ['-h', '-s', iniPath]); await run('attrib.exe', ['-h', '-s', iconPath]);
      if (existing.originalIni === null) await fs.unlink(iniPath);
      else await fs.writeFile(iniPath, Buffer.from(existing.originalIni, 'base64'));
      await fs.unlink(iconPath);
      if (existing.writable) await run('attrib.exe', ['-r', path]);
    }
    delete icons[path]; storage().set('icons', icons); return null;
  }
  if (!image) return existing?.data ?? null;
  const source = nativeImage.createFromPath(image);
  if (source.isEmpty()) throw new Error('无法读取图像，请选择 PNG/JPG/ICO 文件');
  const png = source.resize({ width: 128, height: 128, quality: 'best' }).toPNG();
  const data = `data:image/png;base64,${png.toString('base64')}`;
  let original = existing?.originalIni;
  if (process.platform === 'win32') {
    if (!existing && await fs.access(iconPath).then(() => true, () => false)) throw new Error('目标存在同名自定义图标文件，请先处理冲突');
    const originalBytes = await fs.readFile(iniPath).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (original === undefined) original = originalBytes?.toString('base64') ?? null;
    const bytes = Buffer.alloc(22 + png.length);
    bytes.writeUInt16LE(1, 2); bytes.writeUInt16LE(1, 4); bytes[6] = 128; bytes[7] = 128;
    bytes.writeUInt16LE(1, 10); bytes.writeUInt16LE(32, 12); bytes.writeUInt32LE(png.length, 14); bytes.writeUInt32LE(22, 18); png.copy(bytes, 22);
    let text = originalBytes ? originalBytes[0] === 0xff && originalBytes[1] === 0xfe ? originalBytes.subarray(2).toString('utf16le') : originalBytes.toString('utf8') : '';
    const section = /^\[\.ShellClassInfo\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/im;
    if (section.test(text)) text = text.replace(section, (_, body: string) => '[.ShellClassInfo]\r\n' + body.replace(/^(?:IconResource|IconFile|IconIndex)\s*=.*\r?\n?/gim, '') + '\r\nIconResource=.tabula-folder.ico,0\r\n');
    else text += '\r\n[.ShellClassInfo]\r\nIconResource=.tabula-folder.ico,0\r\n';
    if (existing) { await run('attrib.exe', ['-h', '-s', iniPath]); await run('attrib.exe', ['-h', '-s', iconPath]); }
    await fs.writeFile(iconPath, bytes);
    await fs.writeFile(iniPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
    await run('attrib.exe', ['+h', '+s', iniPath]); await run('attrib.exe', ['+h', iconPath]); await run('attrib.exe', ['+r', path]);
  }
  icons[path] = { data, originalIni: original ?? null, writable: existing?.writable ?? !!(stat.mode & 0o200) };
  storage().set('icons', icons); return data;
}
