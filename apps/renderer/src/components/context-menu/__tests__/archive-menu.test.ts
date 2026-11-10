import { beforeEach, expect, it, vi } from 'vitest';
import { buildMenuItems } from '../menu-items';
import { entry, seedFiles } from '../../../stores/__tests__/file-fixtures';
import { useFileStore } from '../../../stores/file-store';

beforeEach(async () => { await seedFiles(); });
function menu(path: string, selection = [path]) {
  const target = entry(path);
  return buildMenuItems({ paneId: 'p', targetEntry: target, isEmptySpace: false, selectedPaths: new Set(selection), currentPath: 'C:\\folder', clipboard: null, actions: useFileStore.getState() })
    .find(item => item.label === '压缩/解压')!.submenu!;
}
it('offers RAR extraction and uses the right-clicked archive even in a mixed selection', () => {
  const extract = vi.fn(); useFileStore.setState({ startExtract: extract });
  const items = menu('C:\\folder\\中文.RAR', ['C:\\folder\\other.zip', 'C:\\folder\\中文.RAR']);
  expect(items.filter(item => item.label === '解压到此处')).toHaveLength(1);
  items.find(item => item.label === '解压到此处')!.action!();
  expect(extract).toHaveBeenCalledWith('C:\\folder\\中文.RAR', 'C:\\folder', 'p');
});
it.each(['archive.rar', 'archive.7z', 'archive.zip', 'archive.tar.gz'])('offers the application chooser for %s', async name => {
  window.tabula.fs.openWithDialog = vi.fn(async () => {});
  const items = menu(`C:\\folder\\${name}`);
  items.find(item => item.label === '使用其他应用打开…')!.action!();
  expect(window.tabula.fs.openWithDialog).toHaveBeenCalledWith(`C:\\folder\\${name}`);
  if (name.endsWith('.7z')) expect(items.some(item => item.label === '解压到此处')).toBe(false);
});

it('shows detected software and opens the selected archive with that application', () => {
  window.tabula.fs.openWithArchiveApplication = vi.fn(async () => ({ method: 'application' as const }));
  const target = entry('C:\\folder\\中文.rar');
  const items = buildMenuItems({ paneId: 'p', targetEntry: target, isEmptySpace: false, selectedPaths: new Set([target.path]), currentPath: 'C:\\folder', clipboard: null,
    actions: useFileStore.getState(), archiveApplications: [{ id: '7zip', name: '7-Zip' }, { id: 'winrar', name: 'WinRAR' }] })
    .find(item => item.label === '压缩/解压')!.submenu!;
  items.find(item => item.label === '使用 WinRAR 打开')!.action!();
  expect(window.tabula.fs.openWithArchiveApplication).toHaveBeenCalledWith(target.path, 'winrar');
  expect(items.some(item => item.label === '使用其他应用打开…')).toBe(true);
});

it('explains that a downloaded archive needs a selection in the system chooser', async () => {
  window.tabula.fs.openWithArchiveApplication = vi.fn(async () => ({ method: 'system-chooser' as const }));
  const showToast = vi.fn();
  const target = entry('C:\\folder\\中文.rar');
  const actions = { ...useFileStore.getState(), showToast };
  const items = buildMenuItems({ paneId: 'p', targetEntry: target, isEmptySpace: false,
    selectedPaths: new Set([target.path]), currentPath: 'C:\\folder', clipboard: null, actions,
    archiveApplications: [{ id: 'app', name: '工具' }] }).find(item => item.label === '压缩/解压')!.submenu!;
  items.find(item => item.label === '使用 工具 打开')!.action!();
  await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('请在系统窗口中选择应用并按提示确认', 'info', 5000));
});
