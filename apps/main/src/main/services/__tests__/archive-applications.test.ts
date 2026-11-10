// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createArchiveApplicationService } from '../archive-applications';

const path = 'C:\\测试文件\\中文 & 特殊字符.rar';
const associations = [
  { name: '某个新压缩工具', identity: 'C:\\自定义安装\\Archive.exe' },
  { name: '商店压缩应用', identity: 'AppX.Archive.Application' },
];
function setup() {
  const list = vi.fn(async (_extension: string) => associations);
  const invoke = vi.fn(async (_path: string, _item: { name: string; identity: string }) => {});
  const isFile = vi.fn(async (_path: string) => true);
  const needsSystemChooser = vi.fn(async (_path: string) => false);
  const openChooser = vi.fn(async (_path: string) => {});
  return { list, invoke, isFile, needsSystemChooser, openChooser, service: createArchiveApplicationService({ platform: 'win32', list, invoke, isFile, needsSystemChooser, openChooser }) };
}
it.skipIf(process.platform !== 'win32')('shows arbitrary system-associated programs without a maintained software list', async () => {
  const { service, list } = setup(); const apps = await service.list(path);
  expect(list).toHaveBeenCalledWith('.rar');
  expect(apps.map(item => item.name)).toEqual(associations.map(item => item.name));
  expect(apps.every(item => /^[a-f0-9]{64}$/.test(item.id))).toBe(true);
  expect(JSON.stringify(apps)).not.toContain('Archive.exe');
});
it.skipIf(process.platform !== 'win32')('rechecks the selected handler and passes the original file to Windows', async () => {
  const { service, invoke, list } = setup(); const apps = await service.list(path);
  await service.open(path, apps[1].id);
  expect(list).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledWith(path, associations[1]);
  list.mockResolvedValueOnce([]);
  await expect(service.open(path, apps[1].id)).rejects.toThrow('关联已发生变化');
  expect(invoke).toHaveBeenCalledTimes(1);
});
it.skipIf(process.platform !== 'win32')('rejects forged ids and missing files and removes duplicate registrations', async () => {
  const { service, invoke, list, isFile } = setup(); list.mockResolvedValueOnce([associations[0], associations[0]]);
  expect(await service.list(path)).toHaveLength(1);
  await expect(service.open(path, 'arbitrary.exe')).rejects.toThrow();
  isFile.mockResolvedValueOnce(false);
  await expect(service.open(path, 'a'.repeat(64))).rejects.toThrow('不存在');
  expect(invoke).not.toHaveBeenCalled();
});
it.skipIf(process.platform !== 'win32')('uses the visible system chooser for a downloaded archive', async () => {
  const { service, invoke, needsSystemChooser, openChooser } = setup();
  const apps = await service.list(path);
  needsSystemChooser.mockResolvedValueOnce(true);
  expect(await service.open(path, apps[1].id)).toEqual({ method: 'system-chooser' });
  expect(openChooser).toHaveBeenCalledWith(path);
  expect(invoke).not.toHaveBeenCalled();
});
it('returns no applications on unsupported platforms', async () => {
  const service = createArchiveApplicationService({ platform: 'linux', list: vi.fn(), invoke: vi.fn(), isFile: vi.fn(), needsSystemChooser: vi.fn(), openChooser: vi.fn() });
  expect(await service.list(process.platform === 'win32' ? path : '/tmp/a.zip')).toEqual([]);
});
