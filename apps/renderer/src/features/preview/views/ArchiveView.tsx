import { useEffect, useState } from 'react';
import { decodeTar } from '@tabula/core/tar';

// =================== 压缩包列表 ===================

/** fflate 解析后的统一 entry 形态 */
export interface ArchiveEntry {
  name: string;
  size: number;
  isDir: boolean;
  /** 文本文件前 8KB (仅 zip 内嵌纯文本时填充, 二进制/null) */
  preview?: string | null;
}

export function formatArchiveSize(n: number): string {
  if (n === 0) return '0';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const TEXT_PREVIEW_EXTS = new Set([
  '.txt', '.md', '.json', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx',
  '.yml', '.yaml', '.toml', '.ini', '.conf', '.env', '.csv', '.tsv', '.log', '.sh', '.bash',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.lua', '.sql',
  '.gitignore', '.dockerignore', '.editorconfig', '.properties',
]);

/**
 * ZIP 使用 fflate；TAR 使用独立 TAR 解析器；TGZ 先解 gzip 再解析 TAR。
 * 单文件 gzip 展示解压后的大小及短文本预览。
 */
export async function parseArchive(ab: ArrayBuffer, ext: string): Promise<ArchiveEntry[]> {
  const { unzipSync, strFromU8, gunzipSync } = await import('fflate');
  if (['.7z', '.rar', '.bz2'].includes(ext)) throw new Error('当前不支持此归档格式');
  if (ext === '.tar' || ext === '.tgz' || ext === '.gz') {
    const bytes = ext === '.tar' ? new Uint8Array(ab) : gunzipSync(new Uint8Array(ab));
    if (ext === '.gz' && !(bytes.length >= 512 && new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar')) return [{ name: nameFromGz(ab), size: bytes.length, isDir: false, preview: bytes.length < 8192 ? strFromU8(bytes) : null }];
    return decodeTar(bytes).map(file => ({ name: file.name, size: file.data.length, isDir: file.directory, preview: !file.directory && file.data.length < 8192 && TEXT_PREVIEW_EXTS.has('.' + file.name.split('.').pop()?.toLowerCase()) ? strFromU8(file.data) : null }));
  }
  const raw = new Uint8Array(ab);
  let unzipped: Record<string, Uint8Array> = {};
  try {
    unzipped = unzipSync(raw);
  } catch (err) {
    throw new Error(`压缩包解析失败: ${(err as Error).message}`);
  }

  const entries: ArchiveEntry[] = [];
  for (const [name, val] of Object.entries(unzipped)) {
    const isDir = name.endsWith('/');
    const data = val;
    const size = data ? data.byteLength : 0;
    let preview: string | null = null;
    if (data && !isDir && size < 8 * 1024) {
      // 文本类: 8KB 内解码作预览
      const ext2 = name.toLowerCase().includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
      if (TEXT_PREVIEW_EXTS.has(ext2) || (data.byteLength < 2048 && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(strFromU8(data.slice(0, 256))))) {
        try {
          preview = strFromU8(data.slice(0, 8 * 1024));
        } catch { /* keep null */ }
      }
    }
    entries.push({ name, size, isDir, preview });
  }
  // 排序: 目录在前 (按字母), 文件在后
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export function nameFromGz(ab: ArrayBuffer): string {
  // 从 .gz 头取原文件名 (RFC 1952 FNAME 字段)
  const bytes = new Uint8Array(ab);
  let i = 10; // 跳过 GZ magic(2) + method(1) + flags(1) + mtime(4) + xfl(1) + os(1)
  if (bytes[3] & 0x04) { if (bytes.length < 12) return 'decompressed.bin'; i += 2 + bytes[10] + (bytes[11] << 8); }
  if (bytes.length > i && (bytes[3] & 0x08)) {
    const start = i;
    while (i < bytes.length && bytes[i] !== 0) i++;
    return new TextDecoder().decode(bytes.slice(start, i)) || 'decompressed.bin';
  }
  return 'decompressed.bin';
}

export function ArchiveView({ url, name, ext }: { url: string; name: string; ext: string; }) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        const result = await parseArchive(ab, ext);
        if (cancelled) return;
        setEntries(result);
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [url, ext]);

  if (error) {
    return (
      <div className="preview-error">
        <div className="error-icon">⚠</div>
        <div className="error-message">压缩包解析失败: {error}</div>
        <div className="preview-error-meta">
          {ext === '.7z' || ext === '.rar'
            ? <span>当前不支持 7z / rar 格式 (fflate 不支持)</span>
            : null}
        </div>
      </div>
    );
  }
  if (entries === null) {
    return <div className="preview-loading"><div className="loading-spinner" /><div>解压中…</div></div>;
  }

  const dirCount = entries.filter((e) => e.isDir).length;
  const fileCount = entries.length - dirCount;

  return (
    <div className="preview-archive-wrap">
      <div className="preview-archive-summary">
        <strong>{name}</strong>
        <span> · {entries.length} 项 ({dirCount} 目录 / {fileCount} 文件)</span>
      </div>
      <div className="preview-archive-list">
        {entries.map((e, i) => (
          <div key={i} className={`preview-archive-row ${e.isDir ? 'is-dir' : ''}`}>
            <span className="preview-archive-icon">{e.isDir ? '📁' : '📄'}</span>
            <span className="preview-archive-name" title={e.name}>{e.name}</span>
            <span className="preview-archive-size">{e.isDir ? '—' : formatArchiveSize(e.size)}</span>
            {e.preview !== undefined && e.preview !== null && (
              <pre className="preview-archive-preview">{e.preview}{e.preview.length >= 8 * 1024 ? '\n…' : ''}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
