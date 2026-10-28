export interface TarFile { name: string; data: Uint8Array; directory: boolean }
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const block = (n: number) => Math.ceil(n / 512) * 512;
const MAX_BYTES = 1024 * 1024 * 1024;
function text(bytes: Uint8Array) { const zero = bytes.indexOf(0); return decoder.decode(zero < 0 ? bytes : bytes.subarray(0, zero)); }
function octal(bytes: Uint8Array) { const raw = text(bytes).trim(); if (!/^[0-7]*$/.test(raw)) throw new Error('不支持的 TAR 数值字段'); const value = parseInt(raw || '0', 8); if (!Number.isSafeInteger(value) || value < 0) throw new Error('无效 TAR 大小'); return value; }
export function validateArchiveName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0') || normalized.split('/').some(p => p === '..' || p.includes(':'))) throw new Error(`不安全的归档路径: ${name}`);
  return normalized.replace(/^\.\//, '');
}
export function decodeTar(bytes: Uint8Array): TarFile[] {
  if (bytes.length > MAX_BYTES || bytes.length < 1024 || bytes.length % 512) throw new Error('TAR 大小无效或超过 1 GB');
  const files: TarFile[] = []; let offset = 0; let pax: Record<string, string> = {}; let longName = '';
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(v => v === 0)) break;
    const expected = octal(header.subarray(148, 156));
    const checksum = header.reduce((sum, v, i) => sum + (i >= 148 && i < 156 ? 32 : v), 0);
    if (expected !== checksum) throw new Error('TAR 校验和不匹配');
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(header.subarray(345, 500));
    const name = (prefix ? prefix + '/' : '') + text(header.subarray(0, 100));
    const size = type !== 'x' && pax.size ? Number(pax.size) : octal(header.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES || offset + 512 + size > bytes.length) throw new Error('TAR 条目数据截断或过大');
    const data = bytes.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') {
      let p = 0;
      while (p < data.length) {
        const space = data.indexOf(32, p); if (space < p) throw new Error('无效 PAX 记录');
        const length = Number(decoder.decode(data.subarray(p, space)));
        if (!Number.isInteger(length) || length < 4 || p + length > data.length) throw new Error('PAX 记录截断');
        const record = decoder.decode(data.subarray(space + 1, p + length - 1));
        const equals = record.indexOf('='); if (equals > 0) pax[record.slice(0, equals)] = record.slice(equals + 1);
        p += length;
      }
    } else if (type === 'L') longName = text(data);
    else if (type === '0' || type === '5') {
      const path = validateArchiveName(pax.path || longName || name);
      if (path && path !== './' && path !== '.') files.push({ name: path, directory: type === '5' || path.endsWith('/'), data });
      pax = {}; longName = '';
    } else throw new Error(`不支持 TAR 条目类型 ${type}，链接不会被解压`);
    offset += 512 + block(size);
  }
  if (!files.length && offset === 0 && !bytes.subarray(0, 1024).every(v => v === 0)) throw new Error('不是有效的 TAR');
  return files;
}
function header(name: string, size: number, type: string): Uint8Array {
  const out = new Uint8Array(512);
  const put = (at: number, value: string) => out.set(encoder.encode(value), at);
  put(0, name); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
  put(124, size.toString(8).padStart(11, '0') + '\0'); put(136, '00000000000\0'); put(148, '        ');
  put(156, type); put(257, 'ustar\0'); put(263, '00');
  put(148, out.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ');
  return out;
}
export function encodeTar(files: TarFile[]): Uint8Array {
  const chunks: Uint8Array[] = []; let total = 1024;
  const append = (h: Uint8Array, data: Uint8Array) => { chunks.push(h, data, new Uint8Array(block(data.length) - data.length)); total += 512 + block(data.length); if (total > MAX_BYTES) throw new Error('TAR 超过 1 GB 上限'); };
  files.forEach((file, i) => {
    const name = validateArchiveName(file.name);
    const long = encoder.encode(name).length > 99;
    if (long) {
      const record = ` path=${name}\n`; let length = encoder.encode(record).length + 1;
      while (encoder.encode(String(length) + record).length !== length) length = encoder.encode(String(length) + record).length;
      const data = encoder.encode(String(length) + record); append(header(`PaxHeader/${i}`, data.length, 'x'), data);
    }
    const data = file.directory ? new Uint8Array() : file.data;
    append(header(long ? `entry-${i}` : name, data.length, file.directory ? '5' : '0'), data);
  });
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
