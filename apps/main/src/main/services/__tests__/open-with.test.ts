// @vitest-environment node
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { beforeEach, expect, it, vi } from 'vitest';
import { openWindowsApplicationChooser } from '../open-with';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it.skipIf(process.platform !== 'win32')('passes a Unicode path as one argument without using a shell', async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockImplementation(() => { queueMicrotask(() => child.emit('spawn')); return child as never; });
  const path = 'C:\\我的文件\\a & b.rar';
  await openWindowsApplicationChooser(path);
  expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/rundll32\.exe$/i), ['shell32.dll,OpenAs_RunDLL', path], expect.objectContaining({ stdio: 'ignore' }));
  expect(child.unref).toHaveBeenCalledOnce();
});
it.skipIf(process.platform !== 'win32')('reports a launch failure', async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockImplementation(() => { queueMicrotask(() => child.emit('error', new Error('launch failed'))); return child as never; });
  await expect(openWindowsApplicationChooser('C:\\archive.rar')).rejects.toThrow('launch failed');
});
