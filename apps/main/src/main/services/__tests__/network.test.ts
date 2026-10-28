// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NetworkService } from '../network';
describe('network mounts', () => {
  it('maps SMB with explicit arguments, lists it and disconnects only owned mappings', async () => {
    const run = vi.fn(async () => ''); const service = new NetworkService('win32', run, async () => false);
    const mount = await service.connect({ protocol: 'smb', server: 'files.local', share: 'team', drive: 'Y', username: 'user', password: 'secret' });
    expect(run).toHaveBeenCalledWith('net.exe', ['use', 'Y:', '\\\\files.local\\team', 'secret', '/user:user', '/persistent:no']);
    expect(service.list()).toEqual([mount]); await service.disconnect(mount.path); expect(service.list()).toEqual([]);
    await expect(service.disconnect('C:\\')).rejects.toThrow('当前会话');
  });
  it('rejects occupied drives and invalid paths without running a command', async () => {
    const run = vi.fn(async () => ''); const service = new NetworkService('win32', run, async () => true);
    await expect(service.connect({ protocol: 'smb', server: 'host', share: 'share', drive: 'Y' })).rejects.toThrow('占用');
    await expect(service.connect({ protocol: 'smb', server: 'bad host', share: 'share' })).rejects.toThrow('有效');
    expect(run).not.toHaveBeenCalled();
  });
  it('constructs anonymous NFS mounts and redacts failed SMB credentials', async () => {
    const run = vi.fn(async () => ''); const service = new NetworkService('win32', run, async () => false);
    await service.connect({ protocol: 'nfs', server: 'files.local', share: '/exports/team', drive: 'X' });
    expect(run).toHaveBeenCalledWith('mount.exe', ['-o', 'anon', 'files.local:/exports/team', 'X:']);
    const failed = new NetworkService('win32', async () => { throw new Error('password secret failed'); }, async () => false);
    await expect(failed.connect({ protocol: 'smb', server: 'host', share: 'share', password: 'secret' })).rejects.toThrow('***');
  });
});
