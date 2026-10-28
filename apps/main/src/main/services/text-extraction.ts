import { promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';

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
