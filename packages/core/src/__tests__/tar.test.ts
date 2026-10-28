import { describe, expect, it } from 'vitest';
import { decodeTar, encodeTar, validateArchiveName } from '../tar';
describe('TAR codec', () => {
  it('roundtrips UTF-8, long PAX names, file bytes and empty directories', () => {
    const files = [{ name: '空目录/', directory: true, data: new Uint8Array() }, { name: '中文/' + '长文件名'.repeat(40) + '.txt', directory: false, data: new TextEncoder().encode('内容\nUTF-8') }];
    const result = decodeTar(encodeTar(files));
    expect(result.map(f => [f.name, f.directory, [...f.data]])).toEqual(files.map(f => [f.name, f.directory, [...f.data]]));
  });
  it.each(['../escape', '/absolute', 'C:\\escape', 'foo/../../bar', '\\\\server\\share', 'folder/a:stream'])('rejects unsafe name %s', name => expect(() => validateArchiveName(name)).toThrow());
  it('rejects corrupted checksums and truncated payloads', () => {
    const bytes = encodeTar([{ name: 'a.txt', data: new Uint8Array([1, 2]), directory: false }]); bytes[0] ^= 1;
    expect(() => decodeTar(bytes)).toThrow('校验');
    expect(() => decodeTar(new Uint8Array(100))).toThrow();
  });
  it('empty archive remains valid', () => expect(decodeTar(encodeTar([]))).toEqual([]));
});
