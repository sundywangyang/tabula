/**
 * 预览面板 (P4)
 *
 * 全屏 overlay,选中 1 个文件按 Space 打开。
 * 内容分发:
 *   - 图片:  内联 blob URL 渲染
 *   - Markdown: marked 解析 + highlight.js 代码高亮
 *   - 代码/文本: 行号 + 等宽字体
 *   - 未知/PDF/二进制: 元信息 + 提示
 *
 * 数据流:从 window.tabula.fs.readFile 取一次,数据缓存在 file-store.previewState。
 * 大文件(>1MB 文本)截断到 100 行;图片 >5MB 拒绝加载。
 */
import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import { useFileStore } from '../../stores/file-store';
import './PreviewPanel.css';

// 阈值:文本/代码/MD 超过此大小截断到 100 行
const TEXT_TRUNCATE_BYTES = 1024 * 1024; // 1MB
const TEXT_TRUNCATE_LINES = 100;
// 图片超过此大小直接拒绝(避免一次性载入大图片卡死)
const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.ico', '.heic', '.avif', '.tiff', '.tif', '.psd', '.raw',
]);
const MARKDOWN_EXTS = new Set(['.md', '.markdown']);
const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.htm', '.xml', '.yaml', '.yml', '.toml',
  '.sh', '.bash', '.zsh', '.ps1', '.sql', '.lua', '.rb', '.php',
]);
const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.ini', '.conf', '.env']);

type PreviewKind = 'image' | 'markdown' | 'code' | 'text' | 'unsupported';

function detectKind(ext: string): PreviewKind {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'unsupported';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function PreviewPanel() {
  const preview = useFileStore((s) => s.previewState);
  const closePreview = useFileStore((s) => s.closePreview);
  const setPreviewLoading = useFileStore((s) => s.setPreviewLoading);
  const setPreviewData = useFileStore((s) => s.setPreviewData);
  const setPreviewError = useFileStore((s) => s.setPreviewError);
  const showToast = useFileStore((s) => s.showToast);
  const containerRef = useRef<HTMLDivElement>(null);

  const entry = preview?.entry ?? null;
  const kind = entry ? detectKind(entry.ext) : 'unsupported';

  // 加载内容(在 preview.loading 翻为 true / entry 变化时重跑)
  useEffect(() => {
    if (!entry || !preview) return;
    if (!preview.loading) return; // 已经有内容了
    if (preview.blobUrl !== null || preview.text !== null) return; // 已有缓存(blobUrl=null 表示未缓存,允许是空文本)

    // 目录不预览
    if (entry.isDirectory) {
      setPreviewError('不能预览文件夹');
      return;
    }

    const ext = entry.ext;
    const localKind = detectKind(ext);
    console.error('[Preview] loading. ext:', ext, 'kind:', localKind, 'size:', entry.size, 'path:', entry.path);
    let cancelled = false;

    const run = async () => {
      try {
        if (localKind === 'unsupported') {
          // 文本类型才尝试当 utf-8 显示,其他直接 unsupported
          setPreviewLoading(false);
          return;
        }

        if (localKind === 'image') {
          if (entry.size > IMAGE_MAX_BYTES) {
            setPreviewError(
              `图片过大 (${formatSize(entry.size)}),无法预览(>${formatSize(IMAGE_MAX_BYTES)} 拒绝加载)。`,
            );
            return;
          }
          const res = await window.tabula.fs.readFile(entry.path, 'binary');
          if (cancelled) return;
          if (!res.ok) {
            console.error('[Preview] readFile failed:', res.error);
            setPreviewError(res.error.message);
            showToast(`预览失败: ${res.error.message}`, 'error', 3500);
            return;
          }
          console.error('[Preview] readFile ok. data type:', typeof res.data, 'instanceof ArrayBuffer:', res.data instanceof ArrayBuffer, 'length:', (res.data as ArrayBuffer).byteLength);
          const ab = res.data as ArrayBuffer;
          const mime = mimeFromExt(ext);
          const blob = new Blob([ab], { type: mime });
          const url = URL.createObjectURL(blob);
          setPreviewData({ blobUrl: url });
          return;
        }

        // 文本 / 代码 / Markdown:读 utf-8
        if (entry.size > TEXT_TRUNCATE_BYTES * 5) {
          // 5MB 以上的文本/代码直接拒绝(避免 OOM)
          setPreviewError(
            `文件过大 (${formatSize(entry.size)}),无法预览。`,
          );
          showToast(`预览失败: 文件过大`, 'error', 3500);
          return;
        }
        const res = await window.tabula.fs.readFile(entry.path, 'utf-8');
        if (cancelled) return;
        if (!res.ok) {
          setPreviewError(res.error.message);
          showToast(`预览失败: ${res.error.message}`, 'error', 3500);
          return;
        }
        const text = res.data as string;
        const allLines = text.split(/\r?\n/);
        const truncated = entry.size > TEXT_TRUNCATE_BYTES;
        const showLines = truncated ? allLines.slice(0, TEXT_TRUNCATE_LINES) : allLines;
        const displayText = showLines.join('\n');
        setPreviewData({
          text: displayText,
          truncated,
          totalLines: allLines.length,
        });
      } catch (e) {
        if (cancelled) return;
        setPreviewError(String(e));
        showToast(`预览失败: ${String(e)}`, 'error', 3500);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.path, entry?.mtime, entry?.size, preview?.loading]);

  // Esc 关闭
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePreview();
      }
    };
    // 用 capture 确保在 App.tsx 全局监听之前先收到
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [preview, closePreview]);

  // 自动 focus
  useEffect(() => {
    if (preview) containerRef.current?.focus();
  }, [preview]);

  if (!preview || !entry) return null;
  console.error('[Preview] rendering. entry:', entry.name, 'ext:', entry.ext, 'kind:', kind, 'blobUrl:', preview.blobUrl?.slice(0, 30), 'error:', preview.error);

  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePreview();
      }}
    >
      <div className="preview-panel" ref={containerRef} tabIndex={-1}>
        <div className="preview-header">
          <div className="preview-title">
            <span className="preview-icon">{kind === 'image' ? '🖼' : kind === 'markdown' ? '📝' : kind === 'code' ? '📜' : '📄'}</span>
            <span className="preview-filename" title={entry.path}>{entry.name}</span>
            <span className="preview-meta">
              {formatSize(entry.size)} · {formatDate(entry.mtime)} · {entry.ext || '文件'}
            </span>
          </div>
          <button
            className="preview-close"
            onClick={closePreview}
            title="关闭 (Esc)"
            aria-label="关闭预览"
          >
            ✕
          </button>
        </div>

        <div className="preview-body">
          {preview.loading && !preview.error && (
            <div className="preview-loading">
              <div className="loading-spinner" />
              <div>加载中…</div>
            </div>
          )}

          {preview.error && (
            <div className="preview-error">
              <div className="error-icon">⚠</div>
              <div className="error-message">{preview.error}</div>
              <div className="preview-error-meta">
                路径: <code>{entry.path}</code>
                <br />
                大小: {formatSize(entry.size)} · 修改时间: {formatDate(entry.mtime)}
              </div>
            </div>
          )}

          {!preview.error && !preview.loading && (
            <>
              {kind === 'image' && preview.blobUrl && (
                <div className="preview-image-wrap">
                  <img
                    className="preview-image"
                    src={preview.blobUrl}
                    alt={entry.name}
                    draggable={false}
                  />
                </div>
              )}
              {kind === 'markdown' && preview.text !== null && (
                <MarkdownView text={preview.text} />
              )}
              {(kind === 'code' || kind === 'text') && preview.text !== null && (
                <TextWithLineNumbers text={preview.text} />
              )}
              {kind === 'unsupported' && (
                <div className="preview-unsupported">
                  <div className="unsupported-icon">🚫</div>
                  <div className="unsupported-title">此文件类型暂不支持预览</div>
                  <div className="preview-error-meta">
                    扩展名: <code>{entry.ext || '(无)'}</code>
                    <br />
                    大小: {formatSize(entry.size)} · 修改时间: {formatDate(entry.mtime)}
                    <br />
                    路径: <code>{entry.path}</code>
                  </div>
                </div>
              )}
            </>
          )}

          {preview.truncated && (
            <div className="preview-truncated-banner">
              ⚠ 文件过大,仅显示前 {TEXT_TRUNCATE_LINES} 行(共 {preview.totalLines} 行)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =================== Markdown 渲染 ===================

function MarkdownView({ text }: { text: string }) {
  // 配置 marked:代码块走 highlight.js
  const html = useMemo(() => {
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
    // 拦截 code 节点做高亮
    const renderer = new marked.Renderer();
    renderer.code = (codeObj: { text: string; lang?: string; escaped?: boolean }) => {
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

function TextWithLineNumbers({ text }: { text: string }) {
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

function mimeFromExt(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.bmp':
      return 'image/bmp';
    case '.ico':
      return 'image/x-icon';
    case '.heic':
      return 'image/heic';
    case '.avif':
      return 'image/avif';
    case '.tiff':
    case '.tif':
      return 'image/tiff';
    case '.psd':
      return 'image/vnd.adobe.photoshop';
    case '.raw':
      return 'image/raw';
    default:
      return 'application/octet-stream';
  }
}
