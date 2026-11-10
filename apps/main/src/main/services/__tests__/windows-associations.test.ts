// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { invokeWindowsAssociation, listWindowsAssociations } from '../windows-associations';

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

function mockProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  return child;
}

it('returns once an open request is dispatched even when the Shell handler stays busy', async () => {
  vi.useFakeTimers();
  const child = mockProcess();
  const opened = invokeWindowsAssociation('C:\\test.rar', { name: 'Example', identity: 'example' });
  child.stdout.write('TABULA_ASSOCIATION_DISPATCHED\r\n');
  await expect(opened).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(child.kill).not.toHaveBeenCalled();
  child.emit('close', 0);
});

it('reports failures that arrive after a request was dispatched', async () => {
  vi.useFakeTimers();
  const child = mockProcess();
  const onError = vi.fn();
  const opened = invokeWindowsAssociation('C:\\test.rar', { name: 'Example', identity: 'example' }, onError);
  child.stdout.write('TABULA_ASSOCIATION_DISPATCHED\n');
  await opened;
  child.stderr.write('launch failed');
  child.emit('close', 1);
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][0].message).toBe('launch failed');
});

it('rejects an open operation that ends without dispatching the request', async () => {
  const child = mockProcess();
  const opened = invokeWindowsAssociation('C:\\test.rar', { name: 'Example', identity: 'example' });
  child.stdout.write('{}');
  child.emit('close', 0);
  await expect(opened).rejects.toThrow('系统应用启动请求未送达');
});

it('reports an unconfirmed result when monitoring a long-running handler ends', async () => {
  vi.useFakeTimers();
  const child = mockProcess();
  const onError = vi.fn();
  const opened = invokeWindowsAssociation('C:\\test.rar', { name: 'Example', identity: 'example' }, onError);
  child.stdout.write('TABULA_ASSOCIATION_DISPATCHED\n');
  await opened;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(child.kill).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][0].message).toBe('系统应用启动尚未确认，请检查应用窗口或尝试使用其他应用打开');
  child.emit('close', 1);
  expect(onError).toHaveBeenCalledOnce();
});

it('still times out a stalled association lookup', async () => {
  vi.useFakeTimers();
  const child = mockProcess();
  const outcome = listWindowsAssociations('.rar').catch(error => error);
  await vi.advanceTimersByTimeAsync(15_000);
  expect((await outcome).message).toBe('查询系统应用超时');
  expect(child.kill).toHaveBeenCalledOnce();
});
