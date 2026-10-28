import { useMemo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';

// =================== RTF 文档 ===================

/**
 * 主进程使用 Node RTF 转换器生成 HTML,渲染端只负责显示。
 * 限制: 嵌入图/复杂表格/页眉页脚 不可见 (rtf-to-html 局限).
 */
export function RtfView({ html }: { html: string; }) {
  return (
    <div
      className="preview-rtf-wrap"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// =================== Markdown 渲染 ===================

export function MarkdownView({ text }: { text: string; }) {
  // 配置 marked:代码块走 highlight.js
  const html = useMemo(() => {
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
    // 拦截 code 节点做高亮
    const renderer = new marked.Renderer();
    renderer.code = (codeObj: { text: string; lang?: string; escaped?: boolean; }) => {
      const code = typeof codeObj === 'string' ? codeObj : codeObj.text;
      const lang = typeof codeObj === 'string' ? '' : (codeObj.lang ?? '');
      let highlighted = escapeHtml(code);
      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(code, { language: lang }).value;
        } catch {
          /* noop */
        }
      } else {
        try {
          highlighted = hljs.highlightAuto(code).value;
        } catch {
          /* noop */
        }
      }
      const langClass = lang ? ` class="language-${escapeHtml(lang)} hljs"` : ' class="hljs"';
      return `<pre><code${langClass}>${highlighted}</code></pre>`;
    };
    return marked.parse(text, { renderer, async: false }) as string;
  }, [text]);

  return (
    <div
      className="preview-markdown"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// =================== 文本 / 代码:行号 ===================

export function TextWithLineNumbers({ text }: { text: string; }) {
  const lines = text.split(/\r?\n/);
  // 末行如果是空字符串(text 以 \n 结尾),不显示行号(N 行 → N 个行号)
  const display = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  return (
    <div className="preview-textview">
      <div className="preview-linenums" aria-hidden>
        {display.map((_, i) => (
          <div key={i} className="preview-linenum">{i + 1}</div>
        ))}
      </div>
      <pre className="preview-text">
        {display.map((line, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="preview-textline">{line || ' '}</div>
        ))}
      </pre>
    </div>
  );
}

// =================== 工具 ===================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
