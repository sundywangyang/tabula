import { promises as fs, createReadStream } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ScanRequest, ScanResult, ContentHit, DuplicateGroup, ToolProgress } from '@tabula/bridge';

const textExtensions = new Set('txt md markdown csv tsv log json jsonl xml html htm css scss js jsx ts tsx py go rs c cpp h java cs rb php sh bash sql lua toml ini conf cfg yaml yml env svg vue svelte gd tex'.split(' '));
const xmlText = (xml: string) => xml.replace(/<\/(?:w:p|a:p|text:p)>/g, '\n').replace(/<(?:w:tab|a:br)\b[^>]*\/>/g, '\t').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export async function extractText(path: string, size: number): Promise<string | null> {
  const ext = extname(path).slice(1).toLowerCase();
  if (size > 32 * 1024 * 1024) throw new Error('超过内容搜索的 32 MB 单文件上限');
  if (textExtensions.has(ext) || !ext || basename(path).startsWith('.')) {
    const buffer = await fs.readFile(path);
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
    if (buffer.subarray(0, 8192).includes(0)) return null;
    return buffer.toString('utf8');
  }
  if (['docx', 'pptx', 'odt'].includes(ext)) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await fs.readFile(path));
    const files = Object.values(zip.files).filter(f => /^(word\/document|ppt\/slides\/slide\d+|content)\.xml$/.test(f.name));
    return (await Promise.all(files.map(async f => {
      const size = (f as any)._data?.uncompressedSize;
      if (size > 32 * 1024 * 1024) throw new Error('文档解压后过大');
      return xmlText(await f.async('string'));
    }))).join('\n');
  }
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    const xlsx = await import('xlsx');
    const book = xlsx.read(await fs.readFile(path), { type: 'buffer', sheetRows: 100000 });
    return book.SheetNames.map(name => name + '\n' + xlsx.utils.sheet_to_csv(book.Sheets[name])).join('\n');
  }
  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(path)), useSystemFonts: true, isEvalSupported: false }).promise;
    try {
      const pages: string[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 1000); i++) {
        const page = await doc.getPage(i);
        pages.push((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '));
        page.cleanup();
      }
      return pages.join('\n');
    } finally { await doc.destroy(); }
  }
  return null;
}

export class FileScanner {
  private jobs = new Map<string, AbortController>();
  constructor(private readonly progress: (p: ToolProgress) => void = () => {}) {}
  cancel(id: string) { this.jobs.get(id)?.abort(); }
  private async scan<T>(request: ScanRequest, consume: (path: string, size: number, result: ScanResult<T>, signal: AbortSignal) => Promise<void>): Promise<ScanResult<T>> {
    if (!request.root || !request.jobId || this.jobs.has(request.jobId)) throw new Error('扫描目录或任务编号无效');
    if (!(await fs.stat(request.root)).isDirectory()) throw new Error('请选择文件夹');
    const controller = new AbortController();
    this.jobs.set(request.jobId, controller);
    const result: ScanResult<T> = { items: [], warnings: [], cancelled: false, truncated: false };
    let count = 0;
    const walk = async (root: string, depth: number): Promise<void> => {
      if (controller.signal.aborted || result.truncated) return;
      if (depth > Math.min(request.maxDepth ?? 64, 256)) { result.warnings.push(`达到深度上限: ${root}`); return; }
      let entries;
      try { entries = await fs.readdir(root, { withFileTypes: true }); }
      catch (e) { result.warnings.push(`${root}: ${(e as Error).message}`); return; }
      for (const entry of entries) {
        if (controller.signal.aborted || result.truncated) break;
        if ((!request.includeHidden && entry.name.startsWith('.')) || entry.isSymbolicLink()) continue;
        const path = join(root, entry.name);
        if (++count > 100000 || result.items.length >= 5000) { result.truncated = true; break; }
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile()) {
          try { await consume(path, (await fs.stat(path)).size, result, controller.signal); }
          catch (e) { if (!controller.signal.aborted) result.warnings.push(`${path}: ${(e as Error).message}`); }
        }
        if (count % 25 === 0) { this.progress({ jobId: request.jobId, scanned: count, matched: result.items.length, currentPath: path }); await new Promise(resolve => setImmediate(resolve)); }
      }
    };
    try { await walk(request.root, 0); result.cancelled = controller.signal.aborted; return result; }
    finally { this.jobs.delete(request.jobId); }
  }
  search(request: ScanRequest & { query: string; caseSensitive?: boolean }) {
    if (!request.query.trim()) throw new Error('请输入搜索内容');
    const needle = request.caseSensitive ? request.query : request.query.toLocaleLowerCase();
    return this.scan<ContentHit>(request, async (path, size, result) => {
      const text = await extractText(path, size);
      if (text === null) return;
      let hits = 0;
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if ((request.caseSensitive ? line : line.toLocaleLowerCase()).includes(needle)) {
          result.items.push({ path, name: basename(path), line: index + 1, snippet: line.trim().slice(0, 300) });
          if (++hits >= 10 || result.items.length >= 5000) break;
        }
      }
    });
  }
  async duplicates(request: ScanRequest): Promise<ScanResult<DuplicateGroup>> {
    const bySize = new Map<number, string[]>();
    // Keep one controller alive through both scanning and hashing, including cancellation.
    const scan = await this.scan<never>(request, async (path, size) => { const group = bySize.get(size) ?? []; group.push(path); bySize.set(size, group); });
    const result: ScanResult<DuplicateGroup> = { ...scan, items: [] };
    if (scan.cancelled) return result;
    const controller = new AbortController(); this.jobs.set(request.jobId, controller);
    let count = 0;
    try {
      for (const [size, paths] of bySize) {
        if (controller.signal.aborted) break;
        if (paths.length < 2) continue;
        const hashes = new Map<string, string[]>();
        for (const path of paths) {
          if (controller.signal.aborted) break;
          try {
            const before = await fs.stat(path); const hash = createHash('sha256');
            for await (const chunk of createReadStream(path, { signal: controller.signal })) hash.update(chunk);
            const after = await fs.stat(path);
            if (before.size !== size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('文件扫描期间发生变化');
            const digest = hash.digest('hex'); const group = hashes.get(digest) ?? []; group.push(path); hashes.set(digest, group);
          } catch (e) { if (!controller.signal.aborted) result.warnings.push(`${path}: ${(e as Error).message}`); }
          this.progress({ jobId: request.jobId, scanned: ++count, matched: result.items.length, currentPath: path });
        }
        for (const [hash, duplicates] of hashes) if (duplicates.length > 1) result.items.push({ hash, size, paths: duplicates });
      }
      result.cancelled = controller.signal.aborted;
      return result;
    } finally { this.jobs.delete(request.jobId); }
  }
}
