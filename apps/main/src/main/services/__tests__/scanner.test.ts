// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FileScanner } from '../scanner';
import JSZip from 'jszip';
import * as xlsx from 'xlsx';
let root: string;
const parent = resolve('out/test-fixtures');
beforeEach(async () => { await fs.mkdir(parent, { recursive: true }); root = await fs.mkdtemp(join(parent, 'scanner-')); });
afterEach(async () => { if (dirname(root) !== parent) throw new Error('Invalid fixture'); await fs.rm(root, { recursive: true, force: true }); });
describe('content scanner and duplicate finder', () => {
  it('searches contents, reports line numbers and ignores filename-only matches and binary files', async () => {
    await fs.writeFile(join(root, 'a.txt'), 'first\nThe Needle\nlast'); await fs.writeFile(join(root, 'Needle.txt'), 'nothing');
    await fs.writeFile(join(root, 'b.bin'), Buffer.from([0, 1, 2]));
    const result = await new FileScanner().search({ root, jobId: 'search', query: 'needle' });
    expect(result.items).toEqual([expect.objectContaining({ name: 'a.txt', line: 2, snippet: 'The Needle' })]);
    expect((await new FileScanner().search({ root, jobId: 'case', query: 'needle', caseSensitive: true })).items).toEqual([]);
  });
  it('extracts Office XML and spreadsheet text through their own format handlers', async () => {
    const zip = new JSZip(); zip.file('word/document.xml', '<w:document><w:p>文档 needle</w:p></w:document>');
    await fs.writeFile(join(root, 'a.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
    const book = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['needle in cell']]), 'Sheet');
    await fs.writeFile(join(root, 'b.xlsx'), xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }));
    const result = await new FileScanner().search({ root, jobId: 'office', query: 'needle' });
    expect(result.items.map(hit => hit.name).sort()).toEqual(['a.docx', 'b.xlsx']);
  });
  it('groups equal content while excluding same-size different contents', async () => {
    await fs.writeFile(join(root, 'one'), 'ABCD'); await fs.writeFile(join(root, 'two'), 'ABCD'); await fs.writeFile(join(root, 'three'), 'DCBA');
    const result = await new FileScanner().duplicates({ root, jobId: 'dups' });
    expect(result.items).toHaveLength(1); expect(result.items[0].paths.map(p => p.split(/[\\/]/).pop()).sort()).toEqual(['one', 'two']);
  });
  it('extracts searchable text from a real PDF without rendering a page', async () => {
    const content = 'BT /F1 12 Tf 20 80 Td (PDF needle example) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf); pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await fs.writeFile(join(root, 'sample.pdf'), pdf);
    const result = await new FileScanner().search({ root, jobId: 'pdf', query: 'needle' });
    expect(result.warnings).toEqual([]); expect(result.items[0]).toMatchObject({ name: 'sample.pdf', snippet: expect.stringContaining('PDF needle example') });
  });
  it('cancels scanning through progress callback and does not leave stale jobs', async () => {
    await Promise.all(Array.from({ length: 55 }, (_, i) => fs.writeFile(join(root, `${i}.txt`), 'needle')));
    const scanner = new FileScanner(p => scanner.cancel(p.jobId));
    expect((await scanner.search({ root, jobId: 'cancel', query: 'needle' })).cancelled).toBe(true);
    expect((await scanner.search({ root, jobId: 'cancel', query: 'missing' })).cancelled).toBe(true);
  });
  it('returns root errors and applies hidden filtering', async () => {
    await fs.writeFile(join(root, '.hidden.txt'), 'needle');
    expect((await new FileScanner().search({ root, jobId: 'hidden', query: 'needle' })).items).toEqual([]);
    expect((await new FileScanner().search({ root, jobId: 'hidden2', query: 'needle', includeHidden: true })).items).toHaveLength(1);
    await expect(new FileScanner().search({ root: join(root, 'missing'), jobId: 'bad', query: 'q' })).rejects.toThrow();
  });
});
