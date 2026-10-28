import { promises as fs } from 'node:fs';
import rtfToHtml from '@iarna/rtf-to-html';
import type { Result } from '@tabula/bridge';
import { mapError, ok } from './result';

/** The converter depends on Node streams; keep it out of the browser bundle. */
export async function readRtf(path: string): Promise<Result<string>> {
  try {
    if ((await fs.stat(path)).size > 20 * 1024 * 1024) throw new Error('RTF 文件过大，无法预览');
    const text = await fs.readFile(path, 'utf8');
    if (!text.trimStart().startsWith('{\\rtf')) throw new Error('不是有效的 RTF 文档');
    const end = text.lastIndexOf('}');
    if (end < 0) throw new Error('RTF 文档不完整');
    // rtf-parser only emits completed paragraphs. Flush the last one before closing the document.
    const normalized = `${text.slice(0, end)}\\par ${text.slice(end)}`;
    const html = await new Promise<string>((resolve, reject) => {
      rtfToHtml.fromString(normalized, (error, result) => {
        if (error) reject(error);
        // The converter returns a complete HTML document. Its body stylesheet must not style the app.
        else if (typeof result === 'string') resolve(result.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? result);
        else reject(new Error('RTF 转换未返回内容'));
      });
    });
    return ok(html);
  } catch (error) { return mapError(error, path); }
}
